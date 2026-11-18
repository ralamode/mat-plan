import { ENTRY_STATUS, ENTRY_STATUS_LABELS, SET_STATUS } from '../enums';
import { QUANTITY_SLOT } from '../quantity-slots';
import { UNIT_DIMENSION } from '../units';
import { buildLoad, type ExportSet } from './load';
import { dimensionOf } from './value';

/** One logged movement — an `entry` plus its `entry_sets`, as the export reads it. */
export type ExportMovement = {
  /** `entries.status` — MOVEMENT level. A skipped movement carries ZERO set rows. */
  status: string;
  sets: readonly (ExportSet & { status: string })[];
};

/**
 * **A Count logged in `count` writes its number in `reps`, and `load` stays empty** (FAM-1 14a; the
 * maintainer, 2026-11-17: `…,plank-taps,1,25,,…`).
 *
 * A count is "how many", which is what `reps` already means. It never goes in `load`, where a bare
 * number means pounds: `CSV_UNIT_SUFFIX.count` stays `null`, so a count that reached `load` would still
 * be refused (`assertExportableUnit`). A set that carries BOTH reps and a count throws: the export
 * never picks one of two numbers the athlete logged.
 */
function countAsReps(set: ExportSet, context: string): ExportSet {
  const counts = set.quantities.filter(
    (q) => q.slot === QUANTITY_SLOT.primary && dimensionOf(q.unit) === UNIT_DIMENSION.count,
  );
  if (counts.length === 0) return set;
  if (set.reps !== null || counts.length > 1) {
    throw new Error(`CSV export: ${context} has reps and a count, and only one can be written`);
  }
  return {
    ...set,
    reps: Number(counts[0].value),
    quantities: set.quantities.filter((q) => q !== counts[0]),
  };
}

/** The three columns the aggregator produces. */
export type AggregatedSets = { sets: string; reps: string; load: string };

/**
 * Collapse a per-set list to the corpus's shape: **a scalar when uniform, a slash-list otherwise**.
 *
 * `5/5/5` would diff against `5`, so the collapse is mandatory, not cosmetic. A 1-set movement is
 * always a scalar and never a 1-element list (contract open question 3).
 */
function collapse(values: readonly string[]): string {
  if (values.length === 0) return '';
  return values.every((v) => v === values[0]) ? values[0] : values.join('/');
}

/**
 * One logged movement → the `sets` / `reps` / `load` columns (V1-13).
 *
 * ## `sets` is a COUNT, and a skip is not a set
 *
 * `SKIPPED` comes from **`entries.status`** — the MOVEMENT — never from a set's status. That is not
 * a style choice: `SET_STATUSES` is `['done','sub_failure']` and `shared/enums.ts` explains why a
 * skipped set row is never written — *"the CSV export derives `sets` from `COUNT(entry_sets)`, so a
 * skipped set row would silently over-count"*. So a skipped movement carries **zero** set rows and
 * emits `0,0,SKIPPED`, matching the real byte:
 *
 * ```
 * 2020-06-02,trainer,bulgarian-split-squat,0,0,SKIPPED,2x6/leg,acceptable — drop-if-yellow item
 * ```
 *
 * A PARTIAL skip — 5 prescribed, 3 done — counts only what happened: `sets=3` with 3-element lists,
 * so the contract's `sets == list length` assertion still holds. Skipped sets never enter either list.
 *
 * ## `reps` has exactly two non-integer shapes
 *
 * A per-set slash-list, and the literal `sub-failure`. The byte comes from `ENTRY_STATUS_LABELS`
 * rather than being re-typed here — `enums.ts` states that the badge and the exporter must emit the
 * SAME string, and an app-local copy is how they drift.
 */
export function aggregateMovement(movement: ExportMovement, context: string): AggregatedSets {
  if (movement.status === ENTRY_STATUS.skipped) {
    // `0` is meaningful and distinct from empty here — attempted-and-logged-at-zero, not unknown.
    return { sets: '0', reps: '0', load: 'SKIPPED' };
  }

  const counted = movement.sets
    .filter((s) => s.status !== ENTRY_STATUS.skipped)
    .map((s, i) => ({ ...countAsReps(s, `${context} set ${i + 1}`), status: s.status }));
  if (counted.length === 0) return { sets: '0', reps: '', load: '' };

  // One set going to failure makes the whole movement's `reps` read `sub-failure`; the corpus has no
  // shape for "4/3/sub-failure/2", and the real row is `2020-06-02,trainer,pull-ups,2,sub-failure,…`.
  const subFailure = counted.some((s) => s.status === SET_STATUS.sub_failure);

  return {
    sets: String(counted.length),
    reps: subFailure
      ? ENTRY_STATUS_LABELS[ENTRY_STATUS.sub_failure]
      : collapse(counted.map((s) => (s.reps === null ? '' : String(s.reps)))),
    load: collapse(counted.map((s, i) => buildLoad(s, `${context} set ${i + 1}`))),
  };
}
