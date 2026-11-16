import { ENTRY_STATUS, SEED_METRIC_KEYS } from '@mat-plan/shared';
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import type { Executor } from '../writers/executor';
import { isLiveProfile } from '../writers/ownership';

/**
 * "Last time 72.5 lb": the profile's latest LIVE weigh-in strictly BEFORE `day` (V1-24 3b-bw, plan W10).
 *
 * The same shape the day page shows a weigh-in with (numeric, `done`, never a text value), so the hint
 * can only name a weight the athlete's own page would show on its day. `activity_date < day`, never
 * `<=`: the viewed day's own weigh-in is the logged row, not a hint, and a later day must never leak
 * into an earlier one's.
 *
 * Ordered by `activity_date desc, created_at desc, id desc`: one weigh-in per day is the index's rule
 * for LIVE rows, but a pre-1d day can hold two, and the tiebreak makes the answer deterministic.
 * `idx_entries_profile_date` serves the profile + date range.
 *
 * ⚠️ `deleted_at IS NULL` is the whole of the privacy claim: a cleared weigh-in must not come back as a
 * hint. `db:mutations` drops it and `db:verify` goes red.
 */
export async function lastBodyweightBefore(
  exec: Executor,
  args: { profilePublicId: string; scope: HouseholdScope; day: string },
): Promise<{ value: number; unit: string; day: string } | null> {
  const [row] = await exec
    .select({
      value: schema.entries.valueNum,
      unit: schema.entries.unit,
      day: schema.entries.activityDate,
    })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(
      and(
        isLiveProfile(args.profilePublicId, args.scope),
        eq(schema.entries.metricKey, SEED_METRIC_KEYS.bodyweight),
        eq(schema.entries.status, ENTRY_STATUS.done),
        isNotNull(schema.entries.valueNum),
        isNull(schema.entries.valueText),
        isNull(schema.entries.deletedAt),
        lt(schema.entries.activityDate, args.day),
      ),
    )
    .orderBy(
      desc(schema.entries.activityDate),
      desc(schema.entries.createdAt),
      desc(schema.entries.id),
    )
    .limit(1);
  return row?.value == null ? null : { value: Number(row.value), unit: row.unit, day: row.day };
}
