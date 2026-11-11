import { movementSlug, newId, type SessionMovementInput } from '@mat-plan/shared';
import { and, eq, type SQL } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import type { Executor } from './executor';
import {
  insertMovementOwnedBy,
  movementInHousehold,
  movementIsAvailableTo,
  movementIsGlobal,
} from './ownership';
import type { ResolvedSessionMovement } from './strength-session';

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
  await insertMovementOwnedBy(exec, scope, {
    publicId: newId(),
    slug,
    name,
    isBodyweight: false,
  });

  const id = await movementIdWhere(
    and(eq(schema.movements.slug, slug), movementInHousehold(scope)),
  );
  if (id === undefined) throw new Error('movement not found after upsert');
  return id;
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

/**
 * The refusal a bad movement id earns, as ONE string with **no id and no name in it**.
 *
 * 🔴 **Byte-identical for "unknown" and "another household's", deliberately** (PICK-1 Decision 2,
 * security N2). Two different messages would turn this into an oracle: a caller could enumerate
 * which public ids exist by reading the refusal, which is the 404-never-403 rule ADR 0006 applies to
 * profiles, applied to the catalog.
 *
 * ⚠️ **And it interpolates nothing, for the reason `findOrCreateMovement`'s docblock gives at
 * length:** a thrown value reaches Sentry verbatim (`apps/web/lib/sentry-scrub.ts` passes
 * `exception.value` through), and a movement name is free text the privacy notice warns people may
 * put a person's name into. A slug is derived from that same text, so it is no safer.
 */
export const MOVEMENT_NOT_AVAILABLE = 'Movement not available';

/**
 * Thrown when a submitted `movementPublicId` names no movement this household may use.
 *
 * **It THROWS rather than returning a typed envelope** (PICK-1 Decision 2). No screen can produce
 * one: the picker offers only rows its read returned, movements are never deleted, and no merge
 * exists — so this is AGENTS.md's "unexpected → throw" and the athlete gets `error.tsx` with their
 * form intact via the action's own catch. ⚠️ **`C4m` (merge) makes a dead id reachable** and owns
 * turning this into a typed refusal; both the write-path and movement-picker guides record that.
 *
 * A named class, not a bare `Error`, so `writeStrengthSession`'s in-transaction re-check can raise
 * the SAME failure as phase 1 without re-typing the message, and a test can assert the type.
 */
export class MovementNotAvailableError extends Error {
  constructor() {
    super(MOVEMENT_NOT_AVAILABLE);
    this.name = 'MovementNotAvailableError';
  }
}

/**
 * `movements.public_id` → the row, **only if this household may use it**: a global (curated) row or
 * one of its own. THE one resolver by public id (PICK-1 Decision 2; `V1-22` A4 calls it too, so the
 * namespace rule is not re-expressed per surface).
 *
 * Returns `null` for "no such row for you" — unknown, another household's, or soft-deleted — and the
 * caller turns all of those into the one {@link MOVEMENT_NOT_AVAILABLE} refusal.
 *
 * ⚠️ **It deliberately ACCEPTS a household row whose slug a global row shadows** (correctness S3).
 * `findOrCreateMovement` is global-first, so free text can never REACH such a row — but it is the
 * household's own row, with its own history, and refusing it here would make a row unusable by the
 * only people who own it. PICK-1 PR 4's list simply never offers one (`db:verify` case (b)), so the
 * only ways in are a crafted id or a catalog seed landing after a pick. The consequence is recorded
 * in `write-path.md`: the frozen `prescribed` snapshot keys on `movement_id` (V1-22 chunk 2 D1), so
 * an entry on the household row misses a prescription naming the global one and freezes `''`.
 *
 * 🔴 **The predicate is `movementIsAvailableTo(scope)` from `writers/ownership.ts`, composed there
 * and not here** — live ∧ (global ∨ own), the same expression `writeStrengthSession`'s
 * in-transaction re-check uses. The two sides of this seam must answer identically or one of them
 * scopes weaker; that helper's docblock has the reason and what a hand-composed copy at each site
 * cost (a mutation patch that could only redden one of them).
 */
export async function resolveMovementByPublicId(
  exec: Executor,
  scope: HouseholdScope,
  publicId: string,
): Promise<{ id: number; name: string; slug: string } | null> {
  const [row] = await exec
    .select({
      id: schema.movements.id,
      name: schema.movements.name,
      slug: schema.movements.slug,
    })
    .from(schema.movements)
    .where(and(eq(schema.movements.publicId, publicId), movementIsAvailableTo(scope)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve every submitted movement to a {@link ResolvedSessionMovement}, **ids before inserts**.
 *
 * 🔴 **Two phases, and the ORDER is the point** (PICK-1 Decision 2, correctness B2):
 *
 * - **Phase 1** — every `movementPublicId` through {@link resolveMovementByPublicId}. Any `null`
 *   throws {@link MovementNotAvailableError}. Reads only; nothing is written.
 * - **Phase 2**, reached only when phase 1 succeeded in full — `findOrCreateMovement` for the typed
 *   ones, which INSERTS.
 *
 * So **a refused body commits no typed sibling**. Swap the phases and a session naming one bad id
 * plus one novel typed name leaves the typed name's catalog row behind for ever, with no session to
 * explain it — the TEN-2b-1 residual gaining a new instance. `NN-typed-before-ids.patch` makes that
 * swap and `db:verify` case (a) goes red on "zero new `movements` rows".
 *
 * ⚠️ **This is a PRE-CHECK, not the seam.** `writeStrengthSession` re-checks every `movementId`
 * against the same two predicates INSIDE its transaction (security B1, the TOCTOU): between this
 * read and that write a movement could be soft-deleted, or — once `MOV-1`/`C4m` exist — repointed.
 * The seam is the in-transaction check, exactly as the profile resolve already is.
 *
 * 🔴 **Built FIELD BY FIELD, never `{ ...m, movementId }`** (security S1). A spread would carry
 * `movementPublicId` and the CLIENT's label into the writer's argument, where the label would
 * overwrite the database's name on the id path — silently undoing "the id decides". The exhaustive
 * mapped-type return makes a key added to `ResolvedSessionMovement` later a compile error here
 * rather than a silent `undefined` (correctness round 2, B1): `status`, `supersetClientId` and
 * `supersetOrder` are optional, so a dropped one of those would otherwise take the column default
 * and nothing would say so. ⚠️ `movementId` is required, so the ONE key the V1-22 chunk-2 snapshot
 * depends on cannot be dropped silently with or without the mapped type.
 */
export async function resolveSessionMovements(
  exec: Executor,
  scope: HouseholdScope,
  movements: readonly SessionMovementInput[],
): Promise<ResolvedSessionMovement[]> {
  // Phase 1 — ids. Independent reads, so in parallel; every one is awaited before phase 2 begins.
  const byPublicId = new Map<string, { id: number; name: string }>();
  await Promise.all(
    movements.map(async (m) => {
      if (m.movementPublicId === undefined) return;
      const row = await resolveMovementByPublicId(exec, scope, m.movementPublicId);
      if (!row) throw new MovementNotAvailableError();
      byPublicId.set(m.movementPublicId, row);
    }),
  );

  // Phase 2 — typed names. Find-or-create INSERTS, which is why it cannot start until every id above
  // resolved. Also in parallel: idempotent by slug, and independent of each other.
  const typedIds = await Promise.all(
    movements.map(async (m) =>
      m.movementPublicId === undefined
        ? await findOrCreateMovement(exec, scope, m.movementName)
        : undefined,
    ),
  );

  return movements.map((m, i): ExhaustiveResolvedSessionMovement => {
    const resolved =
      m.movementPublicId === undefined ? undefined : byPublicId.get(m.movementPublicId);
    const movementId = resolved?.id ?? typedIds[i];
    // Unreachable: phase 1 throws on an unresolved id and phase 2 throws on a failed upsert. Named
    // rather than `!`, because the mapped type below would otherwise accept `undefined` here and the
    // writer's required `movementId` would arrive as one.
    if (movementId === undefined) throw new MovementNotAvailableError();
    return {
      clientId: m.clientId,
      unit: m.unit,
      sets: m.sets,
      status: m.status,
      supersetClientId: m.supersetClientId,
      supersetOrder: m.supersetOrder,
      movementId,
      // 🔴 The DATABASE's name on the id path, the client's text only when there is no id.
      movementName: resolved?.name ?? m.movementName,
    };
  });
}

/**
 * {@link ResolvedSessionMovement} with every key made **required** — the builder's return type in
 * {@link resolveSessionMovements}, so a field added to the writer's input later fails to compile
 * here instead of silently taking a column default (correctness round 2, B1). Not exported: a
 * construction constraint, not a contract.
 *
 * The `Record<…, unknown>` conjunct is what makes each key REQUIRED; intersecting it leaves every
 * value type exactly as the writer declares it. So the builder must write all eight keys, an
 * optional one may be written as an explicit `undefined` (which is what a flat movement does), a
 * REQUIRED one may not, and the result is still assignable to `ResolvedSessionMovement`.
 *
 * ⚠️ **Not `{[K in keyof T]-?: T[K]}`** — the obvious spelling, and it does not work. A homomorphic
 * mapped type with `-?` strips `undefined` from the value too (it is how `Required<T>` is defined),
 * so `supersetClientId` became `string` and the builder could not write the `undefined` a flat
 * movement needs. Adding `| undefined` back then widened `movementName` and `movementId`, breaking
 * the return type. Both were probed before this spelling was chosen.
 */
type ExhaustiveResolvedSessionMovement = ResolvedSessionMovement &
  Record<keyof ResolvedSessionMovement, unknown>;
