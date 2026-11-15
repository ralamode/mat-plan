import { formatPrescribedForExport } from '../csv/prescribed';
import { CSV_UNIT_SUFFIX, formatNumeric } from '../csv/value';
import { TRACKING_TYPE } from '../movements';
import type { Unit } from '../units';
import { TRACKING_TYPE_FIELDS } from './pieces';
import type { WorkoutDraftItem } from './program-shapes';

/**
 * A prescription as one line of text, for all seven tracking types (FAM-1 plan §4, §2).
 *
 * ONE renderer, three callers: the day page's `prescribedText`, the row writer's
 * `prescribed_snapshot`, and the export. What a row is frozen against is these bytes, so a change
 * here changes what every later ✓ stores.
 *
 * The format is the accepted prototype's: `4 × 8 @ 25 lb`, `3 × 10`, `3 × 30 s`, `6 × 40 yd`,
 * `5 min`, `10 lb`, and `''` for a Check.
 *
 * 🔴 **The `@mat-plan/shared/program/prescribed-text` subpath, not the root barrel.** It builds on
 * `formatPrescribedForExport` (`../csv/prescribed`), and `csv/` is kept out of the barrel that
 * `'use client'` components import. Its callers are the DAL, the writers and the export.
 *
 * That function composes the per-set part and the `@ load`. Its own `3x10` spelling is bytes that
 * exist in every exported month and is pinned by its test, so the multiplication sign is the one
 * part written here.
 */

/** The fields of a prescription the text is made from. A `WorkoutDraft` item fits as it is. */
export type PrescribedTextParts = Pick<
  WorkoutDraftItem,
  'trackingType' | 'sets' | 'targetReps' | 'quantities'
>;

/**
 * A unit as the text spells it: the code, except seconds, which is `s`, and the plain `count`,
 * which is the bare number. The CSV's suffix map is the one place that already knows the first, so
 * it is read here; pounds are bare there and `lb` here.
 */
function withUnit(value: number, unit: Unit): string {
  const number = formatNumeric(value);
  return unit === 'count' ? number : `${number} ${CSV_UNIT_SUFFIX[unit] || unit}`;
}

/** The type's quantity (`TRACKING_TYPE_FIELDS` says which slot), or `null` when it has no target. */
function target(parts: PrescribedTextParts): { value: number; unit: Unit } | null {
  const { slot } = TRACKING_TYPE_FIELDS[parts.trackingType];
  const quantity = parts.quantities.find((q) => q.slot === slot);
  // `value: null` is "log in this unit, no target": the unit alone is not a prescription.
  return quantity && quantity.value !== null
    ? { value: quantity.value, unit: quantity.unit }
    : null;
}

/** `sets × each`, or `each` alone when there is no set count. */
function perSet(sets: number | null, each: string): string {
  return sets ? `${sets} × ${each}`.trimEnd() : each;
}

export function prescribedText(parts: PrescribedTextParts): string {
  const fields = TRACKING_TYPE_FIELDS[parts.trackingType];
  const quantity = target(parts);
  const quantityText = quantity ? withUnit(quantity.value, quantity.unit) : '';

  // Where a row has reps, the reps are the per-set part and the quantity is a load beside them.
  // A load of zero is no load: `4 × 8`, never `4 × 8 @ 0 lb`.
  const each = fields.reps ? (parts.targetReps ?? '') : quantityText;
  const load = fields.reps && quantity && quantity.value > 0 ? quantityText : '';

  // One set of a distance reads as the distance alone: `400 m`, not `1 × 400 m`.
  const oneDistance = parts.trackingType === TRACKING_TYPE.distance && parts.sets === 1;
  const sets = fields.sets && !oneDistance ? parts.sets : null;

  // The export's renderer joins the per-set part and the load: `each [@ load]`.
  return formatPrescribedForExport({
    sets: null,
    targetReps: perSet(sets, each),
    reps: null,
    load,
  });
}
