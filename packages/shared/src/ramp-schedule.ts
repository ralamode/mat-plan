import { type CalisthenicsMetricKey, CALISTHENICS_METRIC_KEYS } from './activity-metric-map';

/**
 * The calisthenics ramp schedule (V1-6b) — per-week TARGET values the kids ramp toward,
 * keyed by calisthenics metric. This is per-profile CONFIG data (a coach-authored weekly
 * calendar), NOT reference/catalog data — hence `ramp-schedule.ts`, not `catalog-ramp.ts`.
 * The seed expands it into `ramp_targets` rows (schedule × kid profiles × metric keys); the
 * V1-6b-2 read DAL joins actual weekly `entries` performance against those rows to compute
 * adherence in SQL (see ADR 0002 for why `ramp_target`, not `goal`/`prescription_target`).
 *
 * The metric domain is DERIVED from `CALISTHENICS_METRIC_KEYS` (the single source in
 * `activity-metric-map.ts`) — a week's `targets` must supply exactly those keys, so the
 * schedule can't drift to a metric the calisthenics activity doesn't record.
 */

/** The metric keys a ramp week targets — exactly the calisthenics metric set. */
export type CalisthenicsRampMetricKey = CalisthenicsMetricKey;

/** Re-exported for the DB seed's row fan-out (schedule × profiles × THESE keys). */
export { CALISTHENICS_METRIC_KEYS };

/**
 * Days in a ramp week — the half-open adherence window is `[week_start, week_start + WEEK_LENGTH_DAYS)`.
 * Named so the weekly-adherence SQL (`week_start + N`) and the `db:verify` proof share one literal.
 */
export const WEEK_LENGTH_DAYS = 7;

/**
 * One week of the ramp: the ISO-week Monday (UTC, `YYYY-MM-DD`) and the target value for
 * each calisthenics metric that week. `targets` is a total map over the metric keys, so a
 * missing metric is a compile error (the schedule stays complete as the metric set evolves).
 */
export type RampWeek = {
  /** ISO-week Monday (UTC), `YYYY-MM-DD` — matches `ramp_targets.week_start`. */
  weekStart: string;
  /** Target value per calisthenics metric (reps for the counters, level for the skill step). */
  targets: Record<CalisthenicsRampMetricKey, number>;
};

/**
 * SHIPPED EMPTY on purpose (V1-6b-1). The real ramp numbers are Ray's domain data — a fixed
 * weekly calendar that ramps rep targets to a CAP, coach-adjustable — and land in a later
 * DATA-ONLY follow-up, not here. Shipping `[]` avoids writing FICTION to prod: `migrate.yml`
 * seeds on merge, and the seed's `onConflictDoNothing` on the natural key would make any
 * placeholder rows permanently sticky (a re-seed with real numbers would be a no-op, not an
 * update). V1-6b-1 delivers the TABLE + the seed MECHANISM + the SQL-adherence proof; the
 * numbers are a separate, reversible-by-omission change.
 */
export const CALISTHENICS_RAMP_SCHEDULE: readonly RampWeek[] = [];
