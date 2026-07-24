import {
  ACTIVITY_METRIC_MAP,
  ACTIVITY_TYPE_KEYS,
  ENTRY_STATUS,
  foldAggregation,
  type MetricAggregation,
} from '@mat-plan/shared';

import type { EntryDTO } from '@/lib/dal/entries';

/**
 * Calisthenics daily totals (V1-6a) — the digital tally sheet. Pure and route-agnostic
 * (no `server-only`, type-only `EntryDTO` import), like `entry-label.ts`.
 *
 * Folds each metric's same-day readings into one total via the shared `foldAggregation`
 * kernel (sum for the counters, max for the skill step), dispatching on `aggregation`
 * carried on the DTO — NOT reaching into the seed catalog. Order follows
 * `ACTIVITY_METRIC_MAP.calisthenics` (the display order), not global seed order.
 *
 * In-memory over the day's already-fetched rows — no query, no engine. (Weekly SQL
 * adherence is V1-6b, where pulling a week into memory would be wrong.)
 */
export type MetricTotal = {
  metricKey: string;
  label: string;
  /** The rolled-up value: Σ reps for the counters, best single reading for the skill step. */
  total: number;
  /** How many bouts were logged today — the paper tally's "sets". */
  readings: number;
};

export function calisthenicsTotals(entries: readonly EntryDTO[]): MetricTotal[] {
  const byMetric = new Map<string, EntryDTO[]>();
  for (const e of entries) {
    // Only 'done' readings count. V1-9 may add 'skipped' — a skipped bout must not sum into
    // the total, so filter here even though every V1-6a write is 'done' today.
    if (
      e.activityKey !== ACTIVITY_TYPE_KEYS.calisthenics ||
      e.metricKey === null ||
      e.value === null ||
      e.aggregation === null ||
      e.status !== ENTRY_STATUS.done
    ) {
      continue;
    }
    const list = byMetric.get(e.metricKey) ?? [];
    list.push(e);
    byMetric.set(e.metricKey, list);
  }

  const totals: MetricTotal[] = [];
  for (const metricKey of ACTIVITY_METRIC_MAP[ACTIVITY_TYPE_KEYS.calisthenics]) {
    const rows = byMetric.get(metricKey);
    if (!rows?.length) continue;
    totals.push({
      metricKey,
      label: rows[0].metricLabel ?? metricKey,
      // aggregation is a per-metric constant; every row for this key carries the same value.
      total: foldAggregation(
        rows[0].aggregation as MetricAggregation,
        rows.map((r) => r.value as number),
      ),
      readings: rows.length,
    });
  }
  return totals;
}
