import type { WeeklyAdherenceRow } from '@mat-plan/db';
import {
  assertRollupAggregation,
  CALISTHENICS_METRIC_KEYS,
  type MetricAggregation,
} from '@mat-plan/shared';

/**
 * Pure row→DTO shaping for weekly ramp adherence (V1-6b-2). Route-agnostic and DB-free (type-only
 * `WeeklyAdherenceRow` import), like `activity-totals.ts` — so the whole mapping is fast unit tests
 * (AGENTS.md: push logic into the sync, testable layer; the DAL stays a thin query + this call).
 */
export type AdherenceDTO = {
  metricKey: string;
  label: string;
  actual: number;
  target: number;
};

/**
 * Map one raw adherence row → DTO. Picks the actual column by the metric's rollup aggregation via a
 * TYPED switch (never a dynamic `row[token]`, which would silently read 0 on an alias rename),
 * coercing pg's numeric-strings; a target with no logged bouts this week has a NULL actual → 0.
 */
export function toAdherence(row: WeeklyAdherenceRow): AdherenceDTO {
  const which = assertRollupAggregation(row.aggregation as MetricAggregation);
  const actualRaw = which === 'sum' ? row.actualSum : row.actualMax;
  return {
    metricKey: row.metricKey,
    label: row.label,
    actual: Number(actualRaw ?? 0),
    target: Number(row.target),
  };
}

const DISPLAY_ORDER = new Map(CALISTHENICS_METRIC_KEYS.map((k, i) => [k as string, i]));

/**
 * Shape the raw rows into the display list: map each, drop degenerate `target <= 0` rows (the CHECK
 * allows `>= 0`; `<progress max={0}>` renders indeterminate), and order by the calisthenics display
 * order (the same source the totals card uses) so the bars match — SQL `GROUP BY` order is unspecified.
 */
export function toAdherenceList(rows: readonly WeeklyAdherenceRow[]): AdherenceDTO[] {
  return rows
    .map(toAdherence)
    .filter((d) => d.target > 0)
    .sort((a, b) => (DISPLAY_ORDER.get(a.metricKey) ?? 0) - (DISPLAY_ORDER.get(b.metricKey) ?? 0));
}
