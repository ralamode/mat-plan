import { movementSlug, newId, type TrackingType, trackingTypeSchema } from '@mat-plan/shared';
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
 * `{publicId, slug, name, isBodyweight: false}` (plus a `tracking_type`, since FAM-1 step 3) — never
 * `pattern`, never `unit_default`. So a
 * household row is always a **strictly worse** version of a curated one, and household-first would
 * let free text shadow the seeded `box_jump` (`is_bodyweight: true`) with a row declaring it
 * loaded-with-no-unit, which `queries/program-day.ts` reads as *"the MOVEMENT's declaration"*.
 * Reasoning, and the future cost of flipping it (a repoint migration, not a flag):
 * `docs/plans/ten-2a-household-movements.md`.
 *
 * ## The `23505` fallback is gone — TEN-2d deleted it
 *
 * ✅ **TEN-2c (migration 0017) dropped the non-partial `movements_slug_unique`; TEN-2d (0018)
 * `VALIDATE`d the end-state CHECK and removed the fallback this docblock used to describe.** While the
 * constraint lived, at most one row per slug existed in the whole table — two households could not
 * both hold a row for one slug — so step 3 collided whenever another household already owned the slug.
 * TEN-2a chose to hand the caller the other household's row rather than fail a kid's session write
 * forever, and that choice is what the fallback was.
 *
 * With the constraint gone, step 3's only arbiter is `uq_movements_household_slug`: an insert into
 * **this** household's namespace cannot collide with **another** household's row, so there was nothing
 * left for the `catch` to catch. It outlived 0017 by exactly one PR because nothing in `migrate.yml`
 * couples a migration to the Vercel deploy — had the app won that race, a catch-less resolver would
 * have met a schema that still had the constraint and raised a raw `23505` out of a session write.
 * AGENTS.md's rule is that a destructive contract runs **after** the app that stopped depending on it.
 *
 * ⚠️ **The price it already paid is DATA, and that outlives the code.** Every reference the fallback
 * minted is an `entries.movement_id` pointing at a movement owned by **another** household, so
 * `docs/runbooks.md`'s household-deletion step 11 (`DELETE FROM movements WHERE household_id = H`)
 * aborts `23503`. Measured, asserted in `db:verify` — which since TEN-2c proves the count is zero and
 * that step 11 **succeeds** — and written into the runbook with its repair step. The correct response
 * to a non-zero count is to repoint the other household's rows to a clone, **never** to null the
 * column: that would promote the row into the global reference namespace, and it is now also rejected
 * by `movements_global_row_has_pattern`, since this writer can never author a `pattern`.
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
  return (await findOrCreateTypedMovement(exec, scope, name)).id;
}

/** A movement the resolver found or made, with the type it ACTUALLY has (which may not be the one asked for). */
export interface ResolvedMovementRef {
  id: number;
  trackingType: TrackingType;
}

/**
 * {@link findOrCreateMovement}, for a caller that names the new item's tracking type (FAM-1 step 3,
 * plan §2 and D25), and gets back the type the row has.
 *
 * 🔴 **`trackingType` is written ONLY when this call INSERTS the row.** A name that matches an
 * existing item (global first, then this household's own) returns that item **unchanged, with its own
 * type**, whatever was asked: nothing retypes a row (D25), and the caller shows the type it got back
 * ("a new item whose name matches an existing one selects that item and shows its type"). That branch
 * is silent on purpose: no throw, no log, because the name is household free text (see above).
 *
 * Omitting `trackingType` inserts at the column default (`weight_reps`), which is what an item made in
 * the old strength form gets.
 */
export async function findOrCreateTypedMovement(
  exec: Executor,
  scope: HouseholdScope,
  name: string,
  trackingType?: TrackingType,
): Promise<ResolvedMovementRef> {
  const slug = movementSlug(name);

  /** One shape for all four lookups, so none can forget `limit(1)` or the id and type pluck. */
  const movementWhere = async (
    where: SQL | undefined,
  ): Promise<ResolvedMovementRef | undefined> => {
    const [row] = await exec
      .select({ id: schema.movements.id, trackingType: schema.movements.trackingType })
      .from(schema.movements)
      .where(where)
      .limit(1);
    // The column is CHECK-pinned to TRACKING_TYPES; parsing narrows it without a cast. ⚠️ This is a
    // throw site on the legacy strength path too: it fires only if a row holds a type this code does
    // not know (an eighth type written by newer code before this deploy is replaced). Add a type by
    // deploying the const before any writer can store it.
    return row && { id: row.id, trackingType: trackingTypeSchema.parse(row.trackingType) };
  };

  // (1) GLOBAL FIRST — a curated row wins over anything this function could author.
  const globalRow = await movementWhere(and(eq(schema.movements.slug, slug), movementIsGlobal()));
  if (globalRow !== undefined) return globalRow;

  // (2) …then this household's own namespace.
  const ownRow = await movementWhere(
    and(eq(schema.movements.slug, slug), movementInHousehold(scope)),
  );
  if (ownRow !== undefined) return ownRow;

  // (3) …then insert into it. The arbiter is `uq_movements_household_slug`, whose predicate the
  // insert repeats literally — see `insertMovementOwnedBy`.
  await insertMovementOwnedBy(exec, scope, {
    publicId: newId(),
    slug,
    name,
    isBodyweight: false,
    ...(trackingType === undefined ? {} : { trackingType }),
  });

  const created = await movementWhere(
    and(eq(schema.movements.slug, slug), movementInHousehold(scope)),
  );
  if (created === undefined) throw new Error('movement not found after upsert');
  return created;
}

/**
 * The name of the constraint **migration 0017 dropped**, module-private because the schema no longer
 * has it. `schema.ts` held this as `MOVEMENT_SLUG_UNIQUE_CONSTRAINT` and its docblock promised
 * *"TEN-2c DELETES it, and this const with it"* — a const exported from the module that DECLARES the
 * live schema would now name something the schema does not contain, which is worse than a literal.
 *
 * It is still a named value rather than an inline string because the `catch` below is the only thing
 * left that matches it, and `TEN-2d` deletes both in one edit. `db:verify` holds the other surviving
 * copy, in the assertion that this name is **absent** from `pg_constraint`.
 */
const DROPPED_GLOBAL_SLUG_UNIQUE = 'movements_slug_unique';
