import { METRIC_AGGREGATION, type MetricAggregation } from './metrics';

/**
 * Fold repeated readings of a metric into its single rolled-up value, per the metric's
 * `aggregation`. This is the ONE place the sum/max/avg/last semantics are defined.
 *
 * WHY IT LIVES IN `shared`, not `apps/web`: the same fold is computed in three places that
 * must agree — V1-6a's daily in-memory totals (calls this directly), V1-6b's weekly SQL
 * adherence, and V1-13's CSV pivot. SQL can't import TS, but it CAN be pinned against this
 * kernel's golden vectors (see the `foldAggregation` test), so the semantics can't silently
 * diverge (NULL handling, which readings count, rounding). It is domain math, not the
 * progression engine (`packages/engine` is reserved for `(state, inputs) => decision`).
 *
 * PRECONDITIONS:
 *  - `values` is NON-EMPTY (a caller skips a metric with zero readings).
 *  - for `last`, `values` are ordered NEWEST-FIRST (the DAL returns `desc(created_at)`);
 *    `last` returns `values[0]`. A caller with ascending rows must reverse first.
 */
export function foldAggregation(aggregation: MetricAggregation, values: readonly number[]): number {
  switch (aggregation) {
    case METRIC_AGGREGATION.sum:
      return values.reduce((a, b) => a + b, 0);
    // reduce, not Math.max(...values) — avoids the spread arg-count ceiling on large arrays.
    case METRIC_AGGREGATION.max:
      return values.reduce((a, b) => (b > a ? b : a), values[0]);
    case METRIC_AGGREGATION.avg:
      return values.reduce((a, b) => a + b, 0) / values.length;
    case METRIC_AGGREGATION.last:
      return values[0];
  }
}

/**
 * Assert a metric's aggregation is one the WEEKLY SQL ROLLUP can compute (V1-6b-2 adherence),
 * and return which — `'sum'` or `'max'`. The SINGLE source for the `{sum,max}` membership the
 * weekly rollup rests on: reused by the read DAL's row→DTO mapper (to pick the actualSum vs
 * actualMax column with a typed switch) and pinned by `db:verify`'s membership guard, so the
 * set can't drift between them.
 *
 * Throws on `avg`/`last`: the weekly rollup computes only SUM + MAX (an avg/last calisthenics
 * metric would need a different query), so a non-`{sum,max}` target must fail loudly here rather
 * than silently read the wrong column. The DAL query filters targets to CALISTHENICS_METRIC_KEYS,
 * so for correctly-authored data this throw is unreachable defense-in-depth.
 */
export function assertRollupAggregation(aggregation: MetricAggregation): 'sum' | 'max' {
  switch (aggregation) {
    case METRIC_AGGREGATION.sum:
      return 'sum';
    case METRIC_AGGREGATION.max:
      return 'max';
    default:
      throw new Error(
        `aggregation '${aggregation}' has no weekly SQL rollup (expected 'sum' or 'max')`,
      );
  }
}
