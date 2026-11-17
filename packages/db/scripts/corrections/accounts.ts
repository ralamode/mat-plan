import { CLERK_USER_ID_PATTERN } from '@mat-plan/shared';
import { and, inArray, isNull } from 'drizzle-orm';

import * as schema from '../../src/schema';
import type { Executor } from '../../src/writers/executor';
import { CorrectionRefusal } from './redact';
import { fixtureBindIsAllowed } from './target-url';

/**
 * The account checks the two corrections that write `household_members` share
 * (`household-claim-…` and `create-household-…`; `PRIV-3` RC, D2). Factored out of the claim so
 * `PRIV-3` 2b reuses them rather than writing a second copy.
 *
 * Each function returns facts or a reason CODE, never a sentence that names an id: each correction
 * renders a refusal in its own words, and `create-household-…` renders positions only.
 */

/**
 * The environment variable `create-household-…` reads its accounts from (D1). Its value is a list of
 * `user_…` ids separated by whitespace. ⚠️ Passed inline on the one command, never `export`ed: a
 * command line is visible through `ps`, a process's environment only to its owner, and an exported
 * variable reaches every later child of the shell.
 */
export const CREATE_HOUSEHOLD_ACCOUNTS_ENV = 'CREATE_HOUSEHOLD_CLERK_USER_IDS';

/**
 * The accounts in `raw`, split on any whitespace. Refuses (with counts and positions only) when the
 * list is empty or names one account twice: a repeated id is an operator's paste error, and binding
 * it once would hide that the other account they meant is missing.
 */
export function parseAccountList(raw: string | undefined): string[] {
  const ids = (raw ?? '').split(/\s+/).filter((id) => id.length > 0);
  if (ids.length === 0) {
    throw new CorrectionRefusal(
      `set ${CREATE_HOUSEHOLD_ACCOUNTS_ENV} for this one command: one or more Clerk user ids, ` +
        'separated by spaces, read with `read -rs` (never typed inline, never exported). ' +
        'Nothing written.',
    );
  }
  const first = new Map<string, number>();
  ids.forEach((id, i) => {
    const seen = first.get(id);
    if (seen !== undefined) {
      throw new CorrectionRefusal(
        `account ${i + 1} of ${ids.length} repeats account ${seen + 1}; nothing written`,
      );
    }
    first.set(id, i);
  });
  return ids;
}

/** Why an account may not be bound here, or `null` when it may. */
export type AccountIssue = 'shape' | 'fixture-remote' | null;

/**
 * The shape check, then the fixture check (`fixtureBindIsAllowed`). The fixture principal always
 * fits the shape, so for it this order and the claim's historical one (fixture first) agree.
 */
export function accountIssue(clerkUserId: string): AccountIssue {
  if (!CLERK_USER_ID_PATTERN.test(clerkUserId)) return 'shape';
  if (!fixtureBindIsAllowed(clerkUserId)) return 'fixture-remote';
  return null;
}

/**
 * The LIVE memberships of these accounts, in any household.
 *
 * The predicate repeats the partial unique index's own (`uq_household_members_clerk_user`:
 * `clerk_user_id … WHERE deleted_at IS NULL`), so this finds exactly the rows that would make an
 * insert fail. ⚠️ **Deliberately not `membershipHousehold`** (`src/queries/household-membership.ts`):
 * that query also requires the household to be live and stops at two rows, so a member of a
 * soft-deleted household would pass this check and then fail on the index.
 */
export async function liveMembershipsOf(
  exec: Executor,
  clerkUserIds: readonly string[],
): Promise<{ clerkUserId: string; householdId: number; publicId: string }[]> {
  if (clerkUserIds.length === 0) return [];
  return exec
    .select({
      clerkUserId: schema.householdMembers.clerkUserId,
      householdId: schema.householdMembers.householdId,
      publicId: schema.householdMembers.publicId,
    })
    .from(schema.householdMembers)
    .where(
      and(
        inArray(schema.householdMembers.clerkUserId, [...clerkUserIds]),
        isNull(schema.householdMembers.deletedAt),
      ),
    );
}
