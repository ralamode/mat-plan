import { type CalisthenicsMetricKey, CALISTHENICS_METRIC_KEYS } from './activity-metric-map';

/**
 * The calisthenics ramp schedule (V1-6b) — per-week TARGET values the kids ramp toward,
 * keyed by calisthenics metric. This is per-profile CONFIG data (a coach-authored weekly
 * calendar), NOT reference/catalog data — hence `ramp-schedule.ts`, not `catalog-ramp.ts`.
 * The seed used to expand it into `ramp_targets` rows; since `OPS-2` PR 1 nothing writes them in
 * production (the expansion and the schedule are deleted). The V1-6b-2 read DAL joins actual weekly `entries` performance against those rows to compute
 * adherence in SQL (see ADR 0002 for why `ramp_target`, not `goal`/`prescription_target`).
 *
 * The metric domain is DERIVED from `CALISTHENICS_METRIC_KEYS` (the single source in
 * `activity-metric-map.ts`) — a week's `targets` must supply exactly those keys, so the
 * schedule can't drift to a metric the calisthenics activity doesn't record.
 */

/** The metric keys a ramp week targets — exactly the calisthenics metric set. */
export type CalisthenicsRampMetricKey = CalisthenicsMetricKey;

/** Re-exported for the ramp's readers (the weekly adherence SQL and its proof). */
export { CALISTHENICS_METRIC_KEYS };

/**
 * Days in a ramp week — the half-open adherence window is `[week_start, week_start + WEEK_LENGTH_DAYS)`.
 * Named so the weekly-adherence SQL (`week_start + N`) and the `db:verify` proof share one literal.
 */
export const WEEK_LENGTH_DAYS = 7;

// OPS-2 PR 1 (plan D4, the maintainer's Q6): `CALISTHENICS_RAMP_SCHEDULE` and its `RampWeek` shape are
// gone with the seed's ramp expansion, their only consumer. The schedule had shipped empty since
// V1-6b-1; a real one arrives the way FAM-1's programs do, never through a production seed.
