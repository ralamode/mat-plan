import { HIDE_REASON, type ClearEvent } from '@mat-plan/shared';
import { and, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import type { Executor } from '../writers/executor';
import { isLiveProfile } from '../writers/ownership';

/**
 * A day's clear events (V1-9b B1-2), and the conjuncts every reader and writer of them shares.
 *
 * 🔴 **One predicate for a clear.** `clearDay`'s replay, `restoreClear`'s select and the banner's
 * read (`clearEventsForDay`) all use `clearEventOn`, so the banner offers exactly what Restore all
 * restores and what a replayed clear answers. Before B1-2 the predicate was written twice in
 * `writers/hide.ts`; a third copy here would have been free to drift.
 *
 * A leaf module: `writers/hide.ts` imports it, and it imports no writer but `ownership.ts`, so there
 * is no cycle. It is not star-exported from the package: the app reaches the read through
 * `clearEventsForDay`, and the conjuncts stay inside `packages/db`.
 *
 * ⚠️ Nothing here reads `scope.householdId`: ownership goes through `isLiveProfile`
 * (`src/scope.test.ts`).
 */

/**
 * `deleted_at`, rendered as the fixed-format UTC text a token is.
 *
 * ⚠️ Used for the SELECT that produces a token and the UPDATE that returns one, so the two can never
 * disagree about the format. `writers/hide.ts` re-exports it, its home before B1-2.
 */
export const hiddenAtText = sql<string>`to_char(${schema.entries.deletedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The owned athlete's entries on one day: the join to `profiles` is the caller's. */
export function ownedOnDay(args: {
  profilePublicId: string;
  scope: HouseholdScope;
  day: string;
}): SQL {
  return and(
    isLiveProfile(args.profilePublicId, args.scope),
    eq(schema.entries.activityDate, args.day),
  )!;
}

/**
 * The owned athlete's entries on one day that Clear this day hid and that still carry its reason
 * (B2-0). A blank amend, an un-tick or a correction leaves the reason NULL, so none of those is ever a
 * clear (delete-and-restore.md invariant 1b). The join to `profiles` is the caller's.
 */
export function clearEventOn(args: {
  profilePublicId: string;
  scope: HouseholdScope;
  day: string;
}): SQL {
  return and(ownedOnDay(args), eq(schema.entries.hideReason, HIDE_REASON.clear_day))!;
}

/**
 * Every clear of one athlete's day, newest first, each with the number of entries it still holds
 * hidden. The banner (B2) draws from this; which events it offers is B2's call (plan § B1-2).
 *
 * The token is printed from the grouped `deleted_at` by `hiddenAtText`, the same text `restoreClear`
 * compares, so a token read here restores exactly its rows (`db:verify`'s round trip proves it).
 * Hidden rows' VALUES never leave: this returns a token and a count.
 */
export async function clearEventsForDay(
  exec: Executor,
  args: { profilePublicId: string; scope: HouseholdScope; day: string },
): Promise<ClearEvent[]> {
  return exec
    .select({ hiddenAt: hiddenAtText, count: sql<number>`count(*)::int` })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(and(clearEventOn(args), isNotNull(schema.entries.deletedAt)))
    .groupBy(schema.entries.deletedAt)
    .orderBy(desc(schema.entries.deletedAt));
}
