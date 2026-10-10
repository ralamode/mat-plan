import { movementSlug, newId } from '@mat-plan/shared';
import { and, eq, type SQL } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import type { Executor } from './executor';
import { insertMovementOwnedBy, movementInHousehold, movementIsGlobal } from './ownership';

/**
 * Find-or-create a `movements` row from a free-text movement name, and return its internal id.
 *
 * ## TEN-2b — GLOBAL-FIRST, and the order is load-bearing
 *
 * 1. the **global** namespace (`household_id IS NULL`) — the curated seed rows. Found ⇒ return it.
 * 2. **this household's own** namespace (`household_id = scope`). Found ⇒ return it.
 * 3. otherwise **insert into this household's own** namespace.
 *
 * ⚠️ **Not household-first, and that is not a style choice.** This function can only ever author
 * `{publicId, slug, name, isBodyweight: false}` — never `pattern`, never `unit_default`. So a
 * household row is always a **strictly worse** version of a curated one, and household-first would
 * let free text shadow the seeded `box_jump` (`is_bodyweight: true`) with a row declaring it
 * loaded-with-no-unit, which `queries/program-day.ts` reads as *"the MOVEMENT's declaration"*.
 * Reasoning, and the future cost of flipping it (a repoint migration, not a flag):
 * `docs/plans/ten-2a-household-movements.md`.
 *
 * ## ⚠️ The TEN-2b → TEN-2c window: one leak survives, deliberately
 *
 * The **non-partial** `movements_slug_unique` is live until TEN-2c, so **at most one row per slug
 * exists in the whole table** — two households cannot both hold a row for one slug. When step 3
 * collides with it, exactly one thing is true: *another household already owns this slug* (step 1
 * proved no global row holds it; step 2 proved we do not). Two outcomes are reachable, and TEN-2a
 * chose between them:
 *
 * - **propagate the `23505`** ⇒ household A can permanently deny household B the ability to log any
 *   name A typed first — an availability primitive, in the arc whose purpose is isolation;
 * - **fall back to the unscoped row** ⇒ B is handed A's row: the **pre-existing** read leak TEN-1 1d
 *   proved and TEN-2c closes.
 *
 * The fallback below is the second, because a kid's session write failing forever is worse than a
 * leak that is already there. ⚠️ **It is a trade, not a fix.** It is bounded by the named invite
 * precondition (*no second household between TEN-2b's deploy and TEN-2c's*), and **TEN-2c deletes
 * this whole `catch` along with the constraint it keys on.**
 *
 * ⚠️ **And it has a price the schema cannot express:** the caller's `entries.movement_id` then points
 * at a movement owned by **another** household, so `docs/runbooks.md`'s household-deletion step 11
 * (`DELETE FROM movements WHERE household_id = H`) aborts `23503`. Measured, asserted in `db:verify`,
 * and written into the runbook with its repair step. The correct response is to repoint the other
 * household's rows to a clone — **never** to null the column, which would promote the row into the
 * global reference namespace.
 *
 * ## Why this core lives here at all
 *
 * `apps/web/lib/dal/catalog.ts` is `server-only` and imports the app's env, so `db:verify` cannot
 * execute it; re-typing these statements in the proof would have made the proof a lookalike of the
 * code instead of the code itself (write-path.md invariant 3). `packages/db/scripts/verify.ts` →
 * *"the catalog verdict"* runs **this** function, in both directions.
 *
 * ⚠️ **No throw here may interpolate `name` or `slug`.** Both derive from the one free-text box the
 * privacy notice warns people may put a person's name into, and `apps/web/lib/sentry-scrub.ts` passes
 * `exception.value` through verbatim — so an interpolated slug is household free text reaching a
 * third-party processor by an error path.
 */
export async function findOrCreateMovement(
  exec: Executor,
  scope: HouseholdScope,
  name: string,
): Promise<number> {
  const slug = movementSlug(name);

  /** One shape for all four lookups, so none can forget `limit(1)` or the id pluck. */
  const movementIdWhere = async (where: SQL | undefined): Promise<number | undefined> => {
    const [row] = await exec
      .select({ id: schema.movements.id })
      .from(schema.movements)
      .where(where)
      .limit(1);
    return row?.id;
  };

  // (1) GLOBAL FIRST — a curated row wins over anything this function could author.
  const globalId = await movementIdWhere(and(eq(schema.movements.slug, slug), movementIsGlobal()));
  if (globalId !== undefined) return globalId;

  // (2) …then this household's own namespace.
  const ownId = await movementIdWhere(
    and(eq(schema.movements.slug, slug), movementInHousehold(scope)),
  );
  if (ownId !== undefined) return ownId;

  // (3) …then insert into it. The arbiter is `uq_movements_household_slug`, whose predicate the
  // insert repeats literally — see `insertMovementOwnedBy`.
  try {
    await insertMovementOwnedBy(exec, scope, {
      publicId: newId(),
      slug,
      name,
      isBodyweight: false,
    });
  } catch (err) {
    if (!isGlobalSlugCollision(err)) throw err;
    // The TEN-2b→2c window, documented above. Resolve UNSCOPED: the row belongs to another
    // household, so neither namespace predicate can see it.
    const sharedId = await movementIdWhere(eq(schema.movements.slug, slug));
    if (sharedId === undefined) throw err;
    // This is the ONLY control on the denial primitive, so it must not fire silently.
    console.warn(
      '[TEN-2b] movements slug collision across households: returned another household’s row ' +
        'rather than failing the write. Pre-existing read leak, closes at TEN-2c; leaves a ' +
        'cross-household entries.movement_id that blocks household deletion (runbooks.md step 11).',
    );
    return sharedId;
  }

  const id = await movementIdWhere(
    and(eq(schema.movements.slug, slug), movementInHousehold(scope)),
  );
  if (id === undefined) throw new Error('movement not found after upsert');
  return id;
}

/**
 * Was this the **global**, non-partial `movements_slug_unique` rejecting the insert?
 *
 * ⚠️ **Read off the error AND its `cause`.** The `cause` nesting is `DrizzleQueryError`'s, not the
 * driver's: production is node-postgres through a pooler, while `db:verify` is PGlite, which puts the
 * fields at the top level. A one-level shape difference would make this return `false` forever —
 * silently restoring the denial primitive with every gate green.
 *
 * Narrow on purpose: a `23503` from the household FK, a `23502`, a `public_id` collision or a
 * connection error must all still propagate.
 */
function isGlobalSlugCollision(err: unknown): boolean {
  return [err, (err as { cause?: unknown })?.cause].some((e) => {
    const pg = e as { code?: string; constraint?: string } | undefined;
    return pg?.code === '23505' && pg.constraint === schema.MOVEMENT_SLUG_UNIQUE_CONSTRAINT;
  });
}
