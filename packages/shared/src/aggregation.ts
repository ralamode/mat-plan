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
