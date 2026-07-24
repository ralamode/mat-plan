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
  /** Each bout's value, oldest → newest (the DAL returns desc, so this is reversed). */
  values: number[];
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
    const values = rows.map((r) => r.value as number);
    totals.push({
      metricKey,
      label: rows[0].metricLabel ?? metricKey,
      // aggregation is a per-metric constant; every row for this key carries the same value.
      total: foldAggregation(rows[0].aggregation as MetricAggregation, values),
      readings: rows.length,
      values: [...values].reverse(), // DAL desc(createdAt) → show oldest-first: "20, 30"
    });
  }
  return totals;
}

/**
 * One display row per line of the "Logged entries" list (V1-6a). Non-accumulating entries
 * render individually as before; the day's calisthenics bouts are GROUPED into ONE row per
 * exercise (so N bouts don't read as N duplicate rows). The grouped row appears at the
 * position of the exercise's newest bout, preserving the desc(createdAt) order of the rest.
 */
export type TodayRow =
  { kind: 'entry'; entry: EntryDTO } | { kind: 'calisthenics'; total: MetricTotal };

export function todayRows(entries: readonly EntryDTO[]): TodayRow[] {
  const totalByMetric = new Map(calisthenicsTotals(entries).map((t) => [t.metricKey, t]));
  const emitted = new Set<string>();
  const rows: TodayRow[] = [];
  for (const e of entries) {
    if (e.activityKey === ACTIVITY_TYPE_KEYS.calisthenics && e.metricKey !== null) {
      // Emit the grouped row once, at the newest bout; skip the rest. Skip entirely if the
      // metric was filtered out of the totals (null value / non-done) so it doesn't render raw.
      if (emitted.has(e.metricKey)) continue;
      emitted.add(e.metricKey);
      const total = totalByMetric.get(e.metricKey);
      if (total) rows.push({ kind: 'calisthenics', total });
      continue;
    }
    rows.push({ kind: 'entry', entry: e });
  }
  return rows;
}
