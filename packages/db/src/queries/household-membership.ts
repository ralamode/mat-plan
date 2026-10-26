import { and, eq, isNull } from 'drizzle-orm';

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
 * It is deliberately NOT exported from the package barrel.
 *
 * `deleted_at IS NULL` repeats `uq_household_members_clerk_user`'s own predicate, which is also the
 * index this lookup rides.
 */
export async function membershipHousehold(exec: Executor, clerkUserId: string): Promise<number[]> {
  const rows = await exec
    .select({ householdId: schema.householdMembers.householdId })
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

  return rows.map((r) => r.householdId);
}
