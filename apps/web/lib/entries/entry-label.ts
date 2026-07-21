import { ENTRY_KIND } from '@mat-plan/shared';

import type { EntryDTO } from '@/lib/dal/entries';

/**
 * Human label for a logged entry (V1-4). Route-AGNOSTIC and pure — no `server-only`,
 * so the history view and the CSV export (later PRs) reuse the exact same rendering.
 * Type-only import of `EntryDTO` (erased at compile time) keeps this off the DAL's
 * server-only runtime.
 *
 * Dispatch is on the DATA MODEL discriminant, not a display-string ladder:
 *   1. `metricKey` set  → a generalized metric entry; branch on `valueType`.
 *   2. `movementName`   → a strength lift.
 *   3. legacy fallback  → a pre-generalized (`metric_key IS NULL`) bodyweight row.
 *
 * The em-dash is U+2014 (`—`), matching the byte-identical output the Today view
 * rendered before this generalization (e2e asserts `Bodyweight — 72.5 lb`).
 */
export function entryLabel(e: EntryDTO): string {
  // 1. Generalized metric entry — dispatch on the metric's value_type.
  if (e.metricKey !== null) {
    switch (e.valueType) {
      // EXTENSIBLE seam: V1-5 adds `'bool'` / `'scale_10'` rendering; V1-6 folds in
      // `aggregation` (sum/max) for calisthenics totals. Only the value_types V1-4
      // actually renders (number/count) are implemented now — no speculative cases.
      case 'number':
      case 'count':
      default:
        return e.value === null ? e.metricLabel! : `${e.metricLabel} — ${e.value} ${e.unit}`;
    }
  }

  // 2. Strength lift (metric_key IS NULL, names a movement).
  if (e.movementName !== null) {
    return e.movementName;
  }

  // 3. Legacy fallback: a pre-generalized bodyweight row that never got a metric_key.
  if (e.kind === ENTRY_KIND.bodyweight) {
    return e.value === null ? 'Bodyweight' : `Bodyweight — ${e.value} ${e.unit}`;
  }
  return 'Strength';
}
