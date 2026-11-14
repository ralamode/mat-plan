import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import type { Executor } from '../writers/executor';
import { isLiveProfile } from '../writers/ownership';

/**
 * 🔴 **The repo's FIRST read that returns `deleted_at IS NOT NULL` rows, and it says so because every
 * other reader must not.** ADR 0008 decision 2: a hidden row is invisible everywhere except the one
 * surface built to show it — the day's "Hidden — Restore" region. Every other query in this package
 * and in `lib/dal` filters tombstones, and
 * [delete-and-restore.md](../../../../docs/features/delete-and-restore.md) carries the audit of all
 * of them. If a second module ever needs hidden rows, it belongs here rather than growing a
 * `includeHidden` flag on a live reader, which is how a tombstone reaches an export.
 *
 * ⚠️ **Neither function reads `scope.householdId` directly** — both go through `isLiveProfile`, so
 * `packages/db/src/scope.test.ts`'s rule that exactly one module names that field still holds.
 */

/** `deleted_at` as the fixed-format UTC text a hide token is — the same expression `hide.ts` uses. */
const hiddenAtText = sql<string>`to_char(${schema.entries.deletedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export type HiddenEntryRow = {
  entryPublicId: string;
  hiddenAt: string;
  kind: string | null;
  metricKey: string | null;
  movementName: string | null;
  value: string | null;
  unit: string;
  createdAt: Date;
};

/**
 * Every hidden entry of one athlete on one day, newest event first.
 *
 * The rows carry what a label needs and nothing more — `B1-2` turns them into DTOs and computes each
 * item's placement, because "which live entry does this sit after" is a question about the live list,
 * which this query deliberately does not load.
 *
 * ⚠️ Ordered by `deleted_at` **descending, then `created_at` ascending**: events newest-first (the
 * most recent mistake is the one being undone), but within one event the items keep the order they
 * were logged in, so a folded row restores reading the way it was written.
 */
export async function hiddenEntriesForDay(
  exec: Executor,
  args: { profilePublicId: string; scope: HouseholdScope; day: string },
): Promise<HiddenEntryRow[]> {
  return exec
    .select({
      entryPublicId: schema.entries.publicId,
      hiddenAt: hiddenAtText,
      kind: schema.entries.kind,
      metricKey: schema.entries.metricKey,
      movementName: schema.entries.movementName,
      value: schema.entries.valueNum,
      unit: schema.entries.unit,
      createdAt: schema.entries.createdAt,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(
      and(
        isLiveProfile(args.profilePublicId, args.scope),
        eq(schema.entries.activityDate, args.day),
        isNotNull(schema.entries.deletedAt),
      ),
    )
    .orderBy(desc(schema.entries.deletedAt), schema.entries.createdAt);
}

export type HiddenDayCount = { day: string; hidden: number };

/**
 * The OTHER days of this athlete that still hold hidden items, newest day first.
 *
 * 🔴 **Why it exists at all:** a mistake is usually found on the day it was made, but a hide can be
 * discovered weeks later — and an item that is only reachable by already knowing which day it is on
 * is not reachable. This is the one read that answers "where else is there something to restore".
 *
 * ⚠️ `day` is returned as **text**, not a `Date`. `activity_date` is a plain `DATE`, and mapping it
 * through a JS `Date` is how a calendar day picks up a timezone it never had — V1-6c's rule, and the
 * same class of trap as the token's microseconds.
 */
export async function hiddenDayCounts(
  exec: Executor,
  args: { profilePublicId: string; scope: HouseholdScope; exceptDay: string },
): Promise<HiddenDayCount[]> {
  return exec
    .select({
      day: sql<string>`to_char(${schema.entries.activityDate}, 'YYYY-MM-DD')`,
      hidden: sql<number>`count(*)::int`,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(
      and(
        isLiveProfile(args.profilePublicId, args.scope),
        isNotNull(schema.entries.deletedAt),
        sql`${schema.entries.activityDate} <> ${args.exceptDay}`,
      ),
    )
    .groupBy(schema.entries.activityDate)
    .orderBy(desc(schema.entries.activityDate));
}
