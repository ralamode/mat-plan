import { ENTRY_STATUS, WEEK_LENGTH_DAYS } from '@mat-plan/shared';
import { and, eq, gte, inArray, isNull, lt, max, sql, sum } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { schema } from '../client';
import type { HouseholdScope } from '../scope';
import { isLiveProfile } from '../writers/ownership';

/**
 * The weekly calisthenics ramp-adherence query (V1-6b-2), single-sourced here so the app read
 * DAL and the `db:verify` proof run the IDENTICAL SQL (the proof would otherwise cover a
 * different join shape than the DAL ships — the panel R1 fix). `db` is typed like the seed's
 * (`NodePgDatabase<schema>`); the PGlite verify harness passes its cast db, exactly as it does
 * to `seed()`.
 *
 * Shape: targets DRIVE the rows (`FROM ramp_targets`), so an empty schedule → zero rows → the
 * caller renders nothing. A **LEFT JOIN** to `entries` means a target with no logged bouts this
 * week still returns a row with NULL actuals (the caller coerces → 0). All four entry filters
 * sit in the JOIN `ON` (never the `WHERE`) — moving any to `WHERE` would silently inner-join and
 * drop the zero-bout rows. Targets are filtered to `metricKeys` (CALISTHENICS_METRIC_KEYS) so a
 * stray non-calisthenics target degrades (excluded) instead of reaching the aggregation guard.
 * Both `sum` and `max` are computed; the caller picks per metric via `assertRollupAggregation`.
 */
export function weeklyAdherenceRows(
  db: NodePgDatabase<typeof schema>,
  args: {
    profilePublicId: string;
    weekStart: string;
    activityTypeId: number;
    metricKeys: readonly string[];
    /** TEN-1: the household this request is authorized for. The third conjunct of `isLiveProfile`. */
    scope: HouseholdScope;
  },
) {
  return (
    db
      .select({
        metricKey: schema.rampTargets.metricKey,
        label: schema.metricDefinitions.label,
        aggregation: schema.metricDefinitions.aggregation,
        target: schema.rampTargets.targetValue,
        actualSum: sum(schema.entries.valueNum),
        actualMax: max(schema.entries.valueNum),
      })
      .from(schema.rampTargets)
      // Ownership seam: scope by the LIVE profile's public_id (`isLiveProfile`, the same predicate
      // `listEntriesForDay` uses — DAL-1), never a raw internal id. Since TEN-1 1b that predicate
      // also carries `profiles.household_id = scope`, so this read is household-scoped by the same
      // definition every other scoped read uses — there is no second rule here to drift.
      .innerJoin(schema.profiles, eq(schema.rampTargets.profileId, schema.profiles.id))
      // For the metric's display label AND its rollup aggregation.
      .innerJoin(
        schema.metricDefinitions,
        eq(schema.rampTargets.metricKey, schema.metricDefinitions.key),
      )
      .leftJoin(
        schema.entries,
        and(
          eq(schema.entries.profileId, schema.rampTargets.profileId),
          eq(schema.entries.metricKey, schema.rampTargets.metricKey),
          eq(schema.entries.activityTypeId, args.activityTypeId), // calisthenics-only (deliberate scope)
          eq(schema.entries.status, ENTRY_STATUS.done),
          isNull(schema.entries.deletedAt),
          gte(schema.entries.activityDate, schema.rampTargets.weekStart),
          // `::int` is required — a bare interpolated number binds as an untyped param, and
          // `date + $n` (unknown) is an ambiguous operator; `date + int` resolves to a date.
          lt(
            schema.entries.activityDate,
            sql`${schema.rampTargets.weekStart} + ${WEEK_LENGTH_DAYS}::int`,
          ),
        ),
      )
      .where(
        and(
          isLiveProfile(args.profilePublicId, args.scope),
          eq(schema.rampTargets.weekStart, args.weekStart),
          isNull(schema.rampTargets.deletedAt),
          inArray(schema.rampTargets.metricKey, [...args.metricKeys]),
        ),
      )
      .groupBy(
        schema.rampTargets.metricKey,
        schema.metricDefinitions.label,
        schema.metricDefinitions.aggregation,
        schema.rampTargets.targetValue,
      )
  );
}

/** One raw adherence row (drizzle-inferred). The DAL maps this → its `AdherenceDTO`. */
export type WeeklyAdherenceRow = Awaited<ReturnType<typeof weeklyAdherenceRows>>[number];
