import { ENTRY_STATUS, METRIC_KEYS, PRACTICE_UNIT, SEED_METRIC_KEYS } from '@mat-plan/shared';
import { and, eq, isNotNull, isNull, ne, type SQL } from 'drizzle-orm';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import { bodyweightSlot } from './bodyweight';
import { practiceSlot } from './checkin';
import type { Executor } from './executor';
import { hideEntries } from './hide';
import { isLiveProfile } from './ownership';

/**
 * Single values: one number per athlete, per day, per slot. Bodyweight today; 3b-life adds practice.
 * This module holds what the day page's **Clear** needs (V1-24 3b-bw, plan W9): the pre-read the
 * amend action bounds its day with, and the clear itself.
 *
 * ## Per-metric wrappers over one private core
 *
 * The metric is a **pinned constant** inside each exported wrapper, never an argument — the doctrine
 * `updateBodyweightEntryById` states (`bodyweight.ts`): a parameter can be passed wrong by a future
 * caller, a constant cannot. Without the pin, a crafted POST could clear a push-up bout or a check-in
 * by naming its id. 3b-life adds `clearPractice` as a second wrapper over the same core.
 *
 * ## The shape is written here, not borrowed from `amendableBodyweight`
 *
 * That predicate carries `deleted_at IS NULL`, and both functions here must see a HIDDEN row too: the
 * pre-read so a replay of a clear reaches the clear (and its day bound), the clear so it can answer a
 * replay as a replay. Its metric pin is also its own, so `db:mutations` can drop it and prove that the
 * clear's wrong-metric proof goes red (a shared pin would turn the amend's proofs red first).
 */

type SingleValueMetric = {
  readonly metricKey: string;
  /** The natural key of the metric's one-per-day index, as a conjunct (live-ness added by the caller). */
  readonly slot: (profileId: number, day: string) => SQL | undefined;
};

/**
 * ⚠️ `bodyweightSlot` is the DEFAULT slot (the index's coalesce to 'morning'). Inert while no writer
 * sets `context`; when V1-32 writes real slots, the clear's holder check keys on the row's context.
 */
const BODYWEIGHT: SingleValueMetric = {
  metricKey: SEED_METRIC_KEYS.bodyweight,
  slot: bodyweightSlot,
};

/** `practiceSlot` is exactly `PRACTICE_DAY_UNIQUE_INDEX`'s key: practice has no slot column. */
const PRACTICE: SingleValueMetric = {
  metricKey: METRIC_KEYS.practice_minutes,
  slot: bodyweightSlot,
};

/** One owned, numeric, `done` entry of `metric`, live OR hidden. Ownership is `isLiveProfile`. */
function ownedSingleValue(
  metric: SingleValueMetric,
  profilePublicId: string,
  scope: HouseholdScope,
  entryId: string,
) {
  return and(
    isLiveProfile(profilePublicId, scope),
    eq(schema.entries.publicId, entryId),
    eq(schema.entries.metricKey, metric.metricKey),
    eq(schema.entries.status, ENTRY_STATUS.done),
    isNotNull(schema.entries.valueNum),
    isNull(schema.entries.valueText),
  );
}

/**
 * The DAY of the row an amend or a clear names. `null` for a row that is not this profile's, not in
 * this household, or not a numeric `done` weigh-in.
 *
 * ⚠️ **It sees a hidden row** (no `deleted_at` filter), so a replayed clear reaches `clearBodyweight`
 * (which answers it) and is still bounded by the row's own day. It returns ONLY the day: nothing of a
 * hidden row's value, or even that it is hidden, crosses it. Listed in `delete-and-restore.md`'s
 * reader audit.
 */
export async function bodyweightRowForAmend(
  exec: Executor,
  args: RowForAmendArgs,
): Promise<{ day: string } | null> {
  return singleValueRowForAmend(exec, BODYWEIGHT, args);
}

/** `bodyweightRowForAmend`'s twin for a practice (V1-24 3b-life): its DAY only, live or hidden. */
export async function practiceRowForAmend(
  exec: Executor,
  args: RowForAmendArgs,
): Promise<{ day: string } | null> {
  return singleValueRowForAmend(exec, PRACTICE, args);
}

type RowForAmendArgs = { profilePublicId: string; scope: HouseholdScope; entryId: string };

/** The one pre-read both wrappers share; the metric stays a pinned constant in each wrapper. */
async function singleValueRowForAmend(
  exec: Executor,
  metric: SingleValueMetric,
  args: RowForAmendArgs,
): Promise<{ day: string } | null> {
  const [row] = await exec
    .select({ day: schema.entries.activityDate })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(ownedSingleValue(metric, args.profilePublicId, args.scope, args.entryId))
    .limit(1);
  return row ? { day: row.day } : null;
}

export type ClearSingleValueResult = { cleared: true } | { stale: true } | { notFound: true };

type ClearArgs = {
  profilePublicId: string;
  scope: HouseholdScope;
  entryId: string;
  /** GUARD ONLY: the unit the form showed. */
  unit: string;
  /** GUARD ONLY: the value the form showed (optimistic concurrency, as the amend's). */
  seenValue: number;
};

/**
 * Clear ONE logged bodyweight: hide it, as one event, through `hideEntries` (V1-24 3b-bw).
 *
 * - `cleared`: hidden now, or already hidden by this same clear (a replay).
 * - `stale`: the row no longer holds what the form showed (another phone changed it), or it was
 *   cleared and the day's slot has been re-entered since.
 * - `notFound`: not this profile's, not this household's, or not a weigh-in.
 */
export async function clearBodyweight(
  exec: Executor,
  args: ClearArgs,
): Promise<ClearSingleValueResult> {
  return clearSingleValue(exec, BODYWEIGHT, args);
}

/**
 * Clear ONE logged practice (V1-24 3b-life), `clearBodyweight`'s twin. The unit is the metric's own,
 * pinned here and never posted: a row in any other unit answers `stale`.
 */
export async function clearPractice(
  exec: Executor,
  args: Omit<ClearArgs, 'unit'>,
): Promise<ClearSingleValueResult> {
  return clearSingleValue(exec, PRACTICE, { ...args, unit: PRACTICE_UNIT });
}

async function clearSingleValue(
  exec: Executor,
  metric: SingleValueMetric,
  args: ClearArgs,
): Promise<ClearSingleValueResult> {
  // The writer opens the transaction: the lock below and the hide must be one unit, or a concurrent
  // amend could land between the compare and the hide. Nested inside a caller's transaction, drizzle
  // makes this a savepoint.
  return exec.transaction(async (tx) => {
    // 🔴 **Lock, THEN compare.** A WHERE carrying `seenValue` would make a row amended under this
    // render match nothing, and the answer would be `notFound` instead of `stale`. Locking the row
    // (live or hidden) and comparing in JS means a concurrent amend or clear is waited for, and its
    // result is what gets compared. `OF entries`: never lock the profile, which would serialise every
    // write for the athlete (hide.ts's reasoning).
    const [row] = await tx
      .select({
        id: schema.entries.id,
        profileId: schema.entries.profileId,
        day: schema.entries.activityDate,
        unit: schema.entries.unit,
        value: schema.entries.valueNum,
        deletedAt: schema.entries.deletedAt,
      })
      .from(schema.entries)
      .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
      .where(ownedSingleValue(metric, args.profilePublicId, args.scope, args.entryId))
      .limit(1)
      .for('update', { of: schema.entries });

    if (!row) return { notFound: true };

    if (row.deletedAt !== null) {
      // Already hidden. A replay of this clear, unless the day's slot is held again: then another
      // phone cleared and re-entered, and this form's view of the day is out of date.
      const [holder] = await tx
        .select({ id: schema.entries.id })
        .from(schema.entries)
        .where(
          and(
            metric.slot(row.profileId, row.day),
            isNull(schema.entries.deletedAt),
            ne(schema.entries.id, row.id),
          ),
        )
        .limit(1);
      return holder ? { stale: true } : { cleared: true };
    }

    // `numeric(8,3)` arrives as a string (`'84.500'`); `Number` compares it exactly to the posted value.
    if (row.unit !== args.unit || Number(row.value) !== args.seenValue) return { stale: true };

    // `hide.ts` stays the only app writer of `deleted_at` (delete-and-restore.md invariant 1). The
    // row is locked and proven owned, so a `notFound` here is a contract break, not an outcome.
    const hidden = await hideEntries(tx, {
      profilePublicId: args.profilePublicId,
      scope: args.scope,
      day: row.day,
      entryPublicIds: [args.entryId],
    });
    if ('notFound' in hidden) {
      throw new Error('clearSingleValue: hideEntries refused a row this transaction had locked');
    }
    return { cleared: true };
  });
}
