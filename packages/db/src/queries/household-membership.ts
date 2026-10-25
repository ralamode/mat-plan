import { and, eq, isNull } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from '../writers/executor';

/**
 * AUTH-1 1b — which household a Clerk account belongs to, or `null`.
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
 * ⚠️ Returns the INTERNAL id, which is the one thing a caller may not freely hold — so the only
 * legitimate consumer is `getHouseholdScope()`, which immediately wraps it into a `HouseholdScope`.
 * It is deliberately NOT exported from the package barrel.
 *
 * `deleted_at IS NULL` repeats `uq_household_members_clerk_user`'s own predicate, which is also the
 * index this lookup rides.
 */
export async function membershipHousehold(
  exec: Executor,
  clerkUserId: string,
): Promise<number | null> {
  const rows = await exec
    .select({ householdId: schema.householdMembers.householdId })
    .from(schema.householdMembers)
    .where(
      and(
        eq(schema.householdMembers.clerkUserId, clerkUserId),
        isNull(schema.householdMembers.deletedAt),
      ),
    )
    .limit(1);

  return rows[0]?.householdId ?? null;
}
