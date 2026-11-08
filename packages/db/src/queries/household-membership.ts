import { and, eq, isNull } from 'drizzle-orm';

import type { HouseholdRole } from '@mat-plan/shared';

import { schema } from '../client';
import type { Executor } from '../writers/executor';

/**
 * AUTH-1 1b — the LIVE households a Clerk account belongs to, capped at two.
 *
 * **Ships DARK.** Nothing calls this in 1b. It exists now so 1c's diff is the resolver body rather
 * than a new query plus a resolver body, and so the access path has a `db:verify` proof before
 * anything depends on it.
 *
 * Its own module rather than a function beside `liveHouseholdIds`, because the two answer opposite
 * questions: that one asks "which households are live" (a tenancy census, pre-auth), this one asks
 * "which household is THIS account's" (an identity lookup, post-auth). Sharing a module would make
 * 1c's diff touch the census.
 *
 * ⚠️ Returns INTERNAL ids, which are the one thing a caller may not freely hold — so the only
 * legitimate consumer is `getHouseholdScope()`, which immediately wraps it into a `HouseholdScope`.
 * ⚠️ **It IS exported from the package barrel since `AUTH-1` 1c-4, and this said the opposite.** The
 * `exports` map publishes only `"."`, so the DAL had no other way to reach it; what keeps the
 * sentence above true is now a guard rather than module resolution — `src/scope.test.ts` pins that
 * exactly one file under `apps/web` names this function.
 *
 * `deleted_at IS NULL` repeats `uq_household_members_clerk_user`'s own predicate, which is also the
 * index this lookup rides.
 */
export type Membership = {
  readonly householdId: number;
  readonly role: HouseholdRole;
};

export async function membershipHousehold(
  exec: Executor,
  clerkUserId: string,
): Promise<Membership[]> {
  const rows = await exec
    .select({
      householdId: schema.householdMembers.householdId,
      // 🔴 **The ROLE comes from THIS row, not a second lookup (PROF-1 b-s), and that is a safety
      // property rather than a saved query.** `uq_household_members_clerk_user` is partial on
      // `deleted_at IS NULL` (`schema.ts`), so one account can hold a **soft-deleted `owner` row in
      // household X beside a live `member` row in Y**. A second lookup keyed on `clerk_user_id` —
      // or one that forgot the `deleted_at` conjunct — would return the dead owner row and make a
      // member an owner. Reading the role in the query that already carries BOTH `deleted_at`
      // conjuncts makes that unrepresentable, and leaves no TOCTOU window between the role read and
      // the write it authorizes.
      role: schema.householdMembers.role,
    })
    .from(schema.householdMembers)
    .innerJoin(schema.households, eq(schema.households.id, schema.householdMembers.householdId))
    .where(
      and(
        eq(schema.householdMembers.clerkUserId, clerkUserId),
        isNull(schema.householdMembers.deletedAt),
        // 🔴 AND SO IS THE HOUSEHOLD. Without this a member of a SOFT-DELETED household still
        // resolves a working scope and can read its profiles — the exact thing TEN-1 extracted
        // `liveHouseholdIds` to prevent, whose docblock calls `deleted_at IS NULL` "the load-bearing
        // conjunct". The first version of this function lost it; `db:verify` now proves both halves.
        isNull(schema.households.deletedAt),
      ),
    )
    // An AMBIGUITY PROBE, not a pick, and deliberately no ORDER BY. `LIMIT 1` would silently choose
    // when two live memberships exist, which is how two households get cross-wired with nothing in
    // the logs. The caller sees the count and decides; one live row is the only resolvable answer.
    .limit(2);

  // The CHECK (`household_members_role_check`) pins the column to `HOUSEHOLD_ROLES`, and
  // `db:verify` binds that CHECK back to the const — so the cast is the schema's guarantee surfacing
  // in the type, the same shape `profiles.kind` uses at every read site.
  return rows.map((r) => ({ householdId: r.householdId, role: r.role as HouseholdRole }));
}
