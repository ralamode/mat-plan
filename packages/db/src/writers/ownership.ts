import { and, eq, isNull } from 'drizzle-orm';

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
 * one function allowed to unwrap the scope). **There is no copy of this predicate left anywhere in
 * the repo**, which is what lets 1d's structural guard be absolute rather than shipping with an
 * allowlist that then has to shrink.
 *
 * Two reads deliberately do NOT use it, both documented where they live: `reportScopeMiss`'s
 * existence-only probe (`apps/web/lib/dal/household.ts` — it is how the miss path distinguishes
 * `cross_household` from `unknown_resource`, and it returns `void`), and `catalog.ts`'s three global
 * reference reads. A NEW read or write that wants to be neither is a design question, not an edit:
 * use this helper.
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
 * THE household conjunct — the **only** place in the repo that reads `scope.householdId`.
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
