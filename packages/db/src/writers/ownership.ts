import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import type { Executor } from './executor';

/**
 * The ownership predicates every guarded write shares (V1-24 PR 1b; household-scoped since TEN-1 1b).
 *
 * ## Why these are named rather than re-typed
 *
 * `and(eq(profiles.publicId, …), isNull(profiles.deletedAt))` appeared **eleven** times across the
 * writers, the queries and the app DAL. `queries/program-day.ts` already argues the case against
 * itself, one function down:
 *
 * > *"THE ownership predicate … Named once and used by BOTH sub-selects below … so the two can never
 * > drift into scoping by different rules — which is exactly how a BOLA hole gets introduced by a
 * > later edit."*
 *
 * That reasoning does not stop at a function boundary. AGENTS.md: *"Reuse small logic too — a
 * validation/derivation used in two places becomes one exported helper, not a copy-paste."* This is a
 * **security** predicate, which is the strongest case there is for single-sourcing it.
 *
 * ⚠️ Extracted here with **two** consumers, not speculatively: `updateStrengthSetById` converts to a
 * caller in the same PR, so V1-9's existing `db:verify` cross-profile proof covers this helper for
 * free (and `db:verify` proves the profile soft-delete half for both writers). `listEntriesForDay`
 * (the app DAL's day read) and `weeklyAdherenceRows` joined in DAL-1 — the two sites that had
 * skipped the soft-delete half.
 *
 * ## TEN-1 1b — the third conjunct IS the tenancy seam
 *
 * `isLiveProfile` now takes a **required** `HouseholdScope` and emits `profiles.household_id = $n`
 * alongside its existing two conjuncts. The parameter is required and positional **on purpose**: it
 * makes every unconverted call site a **compile error**, which is the plan's primary safety
 * mechanism — `docs/milestones/beta-1.md` § 2 names a missed scope as a cross-family leak, and
 * `docs/plan.md` → DAL-2 has watched this predicate drift once already (*"DAL-1 is what drift looks
 * like"*). An optional or defaulted parameter is the single change that would make a missed site
 * invisible, which is why `packages/db/src/scope.test.ts` fails on one.
 *
 * ## TEN-1 1c — the hand-written count is ZERO
 *
 * 1c converted the tail: `logCheckinEntries`, `writeStrengthSession`'s in-transaction resolve,
 * `programDayRows`'s `isThisProfile`, `export-month`'s three reads, and `seed.ts`'s plural variant
 * (`inArray` where this has `eq`, so it takes `inHousehold` directly — the household half, from the
 * one function allowed to unwrap the scope). **There is no copy of this predicate left in
 * `packages/db/src/**` or `apps/web/lib/dal/**`** (bar the probe below). 1d's structural guard,
 * `apps/web/lib/dal/scoped.test.ts`, inspects **only** `apps/web/lib/dal/*.ts`; `packages/db/src`
 * is held by `scope.test.ts`'s containment rules and by `db:verify`, not by a text scan.
 *
 * ## TEN-1 1d — zero in `lib/dal`, `packages/db/src` and the corrections registry
 *
 * ⚠️ **Not zero everywhere.** `apps/web/scripts/screenshot-ephemeral.ts` still hand-writes
 * `eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID)` to stage screenshot fixtures. It is an
 * exception, not a leak: it only ever runs against the throwaway database it provisions itself, and
 * nothing inspects it.
 *
 * 1c left three copies in `packages/db/scripts/corrections/registry.ts` — a verbatim pre-1c predicate
 * in `kbSwingsLoadRepsSwap`, and `inHousehold`'s body hand-written twice in `nullRoutineToFull` — and
 * said so rather than claiming them away, because they sit outside the domain 1d's `lib/dal` guard
 * inspects and `scope.test.ts`'s "exactly one module reads `scope.householdId`" could not see them
 * (they named a raw id, not a scope). **1d converted all three.** A correction now resolves its
 * household into a `HouseholdScope` (`liveHouseholdScope`) and rides `isLiveProfile` where there is a
 * `public_id` and `inHousehold` for the one bulk shape — so no correction holds a raw `household_id`
 * either, and ADR 0006's capability rule holds in the scripts too.
 *
 * **THREE sites deliberately do NOT use it** (TEN-2b removed the fourth — see below), each
 * documented where it lives:
 *
 * 1. `reportScopeMiss`'s existence-only probe (`apps/web/lib/dal/household.ts`) — how the miss path
 *    tells `cross_household` from `unknown_resource`. Returns `void`, so it cannot be copied into
 *    something that returns data.
 * 2. `getActivityTypeByKey` and 3. `getMetricDefinition` (`apps/web/lib/dal/catalog.ts`) — genuinely
 *    global reference reads. ⚠️ **It is these two `cache()`d readers that reach `db`, not the
 *    `getActivityTypeIdByKey` / `assertMetricKeyExists` wrappers** this list named before 1d: those
 *    delegate and build no query, so an allowlist keyed on them would have exempted the wrong
 *    symbols. `scoped.test.ts` finds the real ones by construction.
 * ✅ **The fourth is GONE as of TEN-2b, and that is the whole point of the arc.**
 * `findOrCreateMovementId` was listed here as a WRITE that could not be scoped because `movements`
 * had nothing to scope by. It now takes a `HouseholdScope` and resolves **global-first** through the
 * `movements` helpers at the foot of this file, so `scoped.test.ts`'s dead-entry assertion forced its
 * allowlist entry out rather than letting it stand as coverage nobody re-earned.
 * ⚠️ **One residual survives to TEN-2c, and it is not an allowlist entry:** while the non-partial
 * `movements_slug_unique` lives, two households cannot both hold a row for one slug, so the resolver's
 * `23505` fallback hands the second household the first's row — the pre-existing read leak, kept
 * deliberately in preference to a permanent write failure. See `movement-catalog.ts`'s docblock and
 * `db:verify` → "the catalog verdict".
 *
 * A NEW read or write that wants to be none of these is a design question, not an edit: use this
 * helper. All three are enforced as allowlists with a reason each — `apps/web/lib/dal/scoped.test.ts`
 * — not as this prose.
 *
 * ⚠️ **`profiles.household_id` is typed NULLABLE in drizzle and is NOT NULL in the database.**
 * `0001_loose_barracuda.sql` adds `profiles_household_id_not_null` as `CHECK … NOT VALID` and then
 * `VALIDATE`s it, so no orphan profile can exist — `schema.ts` keeps the column nullable only
 * because the backfill needed it to be. **Do not conclude from the drizzle type that orphans are
 * possible and add an `OR household_id IS NULL` escape**: that would be a hole in the one security
 * predicate this seam exists to create. Tightening the drizzle type has its own backlog row (the
 * plan's R9); `SET NOT NULL` is catalog-only when a validated CHECK already exists (PG ≥ 12).
 */

/**
 * THE household conjunct for `profiles` — and, with the `movements` helpers at the foot of this
 * file, one of the handful of reads of `scope.householdId` in the **one module** allowed any.
 *
 * ⚠️ TEN-2b made that distinction matter: it is "exactly one MODULE", never "exactly one function".
 * `packages/db/src/scope.test.ts` asserts the module, which is what ADR 0006 actually needs.
 *
 * ADR 0006's forward-compatibility requirement 1 is that the scope stay a **capability**, never a
 * naked tenant id. That survives a refactor only if unwrapping it happens in exactly one place: a
 * call site that destructures `scope.householdId` to build its own `eq()` has turned the capability
 * back into a number, and COACH-1's _"not mine, but shared with me"_ would then have to widen every
 * such site instead of this one function. `packages/db/src/scope.test.ts` pins it.
 */
export function inHousehold(scope: HouseholdScope) {
  return eq(schema.profiles.householdId, scope.householdId);
}

/** THE live-profile predicate, household-scoped. One definition; no call site can scope weaker. */
export function isLiveProfile(profilePublicId: string, scope: HouseholdScope) {
  return and(
    eq(schema.profiles.publicId, profilePublicId),
    isNull(schema.profiles.deletedAt),
    inHousehold(scope),
  );
}

/**
 * Internal ids of the LIVE entries owned by the profile named by `public_id`, **inside `scope`**.
 *
 * Drizzle's `update()` cannot JOIN and `sql.raw` is banned (AGENTS.md), so every guarded UPDATE
 * proves parent ownership by riding this as `inArray(<fk>, ownedEntryIds(exec, id, scope))`. Taking
 * the PUBLIC id — never an internal one from the request — is the seam itself; the scope is its
 * second half, and it reaches both amends plus the amend re-read without any of those writers
 * building a predicate of its own.
 */
export function ownedEntryIds(exec: Executor, profilePublicId: string, scope: HouseholdScope) {
  return exec
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(and(isLiveProfile(profilePublicId, scope), isNull(schema.entries.deletedAt)));
}

/**
 * ## TEN-2b — `movements`' two namespaces, and the one insert that owns a row
 *
 * `movements` is the only table with **two** namespaces rather than one tenancy seam
 * ([TEN-2a's plan](../../../../docs/plans/ten-2a-household-movements.md)):
 * `household_id IS NULL` is a **value** — reference data owned by no household, the 35 curated seed
 * rows — and `household_id = <scope>` is one household's own free text. So it needs a namespace
 * predicate pair as well as a household conjunct, and the four helpers below are not
 * interchangeable with `inHousehold` / `isLiveProfile` above.
 *
 * **Naming convention, stated so a third table does not invent a third one:** an **unprefixed**
 * helper (`inHousehold`, `isLiveProfile`) is the `profiles` tenancy seam, which every other table
 * reaches *through*. A helper for a table that carries its own `household_id` is **prefixed**
 * (`movementInHousehold`). `movements` is the first; it should not be the pattern's only example.
 *
 * **Why these two live HERE rather than beside the resolver:** `movementInHousehold` and
 * `insertMovementOwnedBy` read `scope.householdId`, and `packages/db/src/scope.test.ts` asserts that
 * exactly one **module** does. The two namespace predicates do not read the scope at all; they live
 * here because they have two consumers each (this file's own rule: *"extracted with two consumers,
 * not speculatively"*) — the resolver's lookups plus `seed.ts`' arbiter and `seedProgram`.
 */

/** `movements.household_id IS NULL` — the GLOBAL reference namespace, owned by no household. */
export function movementIsGlobal() {
  return isNull(schema.movements.householdId);
}

/** `movements.household_id IS NOT NULL` — any household's own namespace. */
export function movementIsOwned() {
  return isNotNull(schema.movements.householdId);
}

/** `movements.household_id = <scope>` — THIS household's namespace. */
export function movementInHousehold(scope: HouseholdScope) {
  return eq(schema.movements.householdId, scope.householdId);
}

/**
 * Insert a movement **owned by `scope`**, arbitrated by `uq_movements_household_slug`.
 *
 * ⚠️ **This performs the insert rather than returning the owner value, and that is the point.** A
 * `movementOwnerValues(scope)` helper returning `{ householdId }` would hand every caller the naked
 * tenant id via `.householdId` — without matching `scope.test.ts`'s `/[Ss]cope\.householdId/` regex,
 * so the guard behind ADR 0006 forward-1 would silently stop covering the one new way to defeat it.
 * Keeping the number inside this module means the capability rule still has a gate behind it.
 *
 * The `where:` predicate **repeats the partial index's own predicate, literally** — it must, or
 * Postgres cannot infer a partial index as the arbiter and the statement fails `42P10`
 * ([lessons.md](../../../../docs/lessons.md)). ⚠️ It goes in **`where:`**, never `targetWhere:`:
 * `onConflictDoNothing` reads `config.where` and **silently drops** `targetWhere`.
 */
export async function insertMovementOwnedBy(
  exec: Executor,
  scope: HouseholdScope,
  row: { publicId: string; slug: string; name: string; isBodyweight: boolean },
): Promise<void> {
  await exec
    .insert(schema.movements)
    .values({ ...row, householdId: scope.householdId })
    .onConflictDoNothing({
      target: [schema.movements.householdId, schema.movements.slug],
      where: movementIsOwned(),
    });
}
