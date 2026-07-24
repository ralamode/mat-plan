import { ACTIVITY_TYPE_KEYS, ENTRY_KIND, METRIC_VALUE_TYPE } from '@mat-plan/shared';

import type { EntryDTO } from '@/lib/dal/entries';
import { minutesToClock } from '@/lib/date';

/**
 * Human label for a logged entry (V1-4, extended V1-5). Route-AGNOSTIC and pure — no
 * `server-only`, so the history view and the CSV export (later PRs) reuse it. Type-only
 * import of `EntryDTO` (erased at compile time) keeps this off the DAL's server runtime.
 *
 * Dispatch is over MUTUALLY EXCLUSIVE data-model discriminants, not an ordered ladder:
 * `entries_value_source_check` is at-most-one, so a row names a metric, OR a movement,
 * OR neither (a bare habit — the shape V1-5 introduces). Order is therefore not
 * load-bearing among branches 1-3.
 *
 *   1. `metricKey`     → a generalized metric entry; branch on `valueType`.
 *   2. `movementName`  → a strength lift.
 *   3. `activityLabel` → a check-in with neither source (a habit).
 *
 * ⚠️ The legacy `kind` fallbacks below are DEAD IN THE DATABASE and kept only as a
 * belt-and-braces default. Migration 0002 step 4a backfilled `metric_key='bodyweight'`
 * onto every legacy bodyweight row (and `entries_shape_check` forces `movement_name` on
 * every strength row), so real rows are always caught by branch 1 or 2. Branch 1 is where
 * the e2e's `Bodyweight — 72.5 lb` actually comes from — NOT the `kind` branch. Deleted
 * at V1-1d. Do not build new logic on them, and do not "fix" a bug by reordering them.
 *
 * The em-dash is U+2014 (`—`), matching the byte-identical output the Today view rendered
 * before the V1-4 generalization.
 */
export function entryLabel(e: EntryDTO): string {
  // 1. Generalized metric entry — dispatch on the metric's value_type.
  if (e.metricKey !== null) {
    switch (e.valueType) {
      // A bool metric is a done/not-done check-in: the label IS the statement.
      case METRIC_VALUE_TYPE.bool:
        return e.metricLabel!;
      // A 1-10 rating reads as a rating, not as its storage unit ('count').
      case METRIC_VALUE_TYPE.scale_10:
        return e.value === null ? e.metricLabel! : `${e.metricLabel} — ${e.value}/10`;
      // EXTENSIBLE seam: V1-6 folds in `aggregation` (sum/max) for calisthenics totals;
      // V1-7 adds `duration`. Only the value_types actually rendered today are cased.
      case METRIC_VALUE_TYPE.number:
      case METRIC_VALUE_TYPE.count:
      default:
        return e.value === null ? e.metricLabel! : `${e.metricLabel} — ${e.value} ${e.unit}`;
    }
  }

  // 2. Strength lift (names a movement, no metric).
  if (e.movementName !== null) {
    return e.movementName;
  }

  // 3a. Wake (V1-7): a timing "neither-source" event — `value` is local minutes-since-midnight,
  // rendered tz-free as a clock. Dispatch on `activityKey` (the robust discriminant; `unit` is
  // display-only), and place it BEFORE the generic bare-habit branch — which would otherwise catch
  // wake (also metricKey/movement-null) and render "Wake" with no time. Falls through when value is
  // NULL (impossible for a real wake row, but then branch 3 yields the plain "Wake").
  if (e.activityKey === ACTIVITY_TYPE_KEYS.wake && e.value !== null) {
    return `${e.activityLabel} — ${minutesToClock(e.value)}`;
  }

  // 3. Check-in with NEITHER source — a bare habit ("Rice bucket"). V1-5.
  if (e.activityLabel !== null) {
    return e.activityLabel;
  }

  // 4. Legacy `kind` fallbacks — unreachable against real rows (see the note above).
  if (e.kind === ENTRY_KIND.bodyweight) {
    return e.value === null ? 'Bodyweight' : `Bodyweight — ${e.value} ${e.unit}`;
  }
  return 'Strength';
}
