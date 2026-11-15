import { formatPrescribedForExport } from '../csv/prescribed';
import { CSV_UNIT_SUFFIX, formatNumeric } from '../csv/value';
import { TRACKING_TYPE } from '../movements';
import { QUANTITY_SLOT, type QuantitySlot } from '../quantity-slots';
import type { Unit } from '../units';
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
 * It builds on `formatPrescribedForExport` (`../csv/prescribed`), which composes the per-set part
 * and the `@ load`. That function's own `3x10` spelling is bytes that exist in every exported month
 * and is pinned by its test, so the multiplication sign is the one part written here.
 */

/** The fields of a prescription the text is made from. A `WorkoutDraft` item fits as it is. */
export type PrescribedTextParts = Pick<
  WorkoutDraftItem,
  'trackingType' | 'sets' | 'targetReps' | 'quantities'
>;

/**
 * A unit as the text spells it: the code, except seconds, which is `s`. The CSV's suffix map is the
 * one place that already knows that, so it is read here; pounds are bare there and `lb` here.
 */
function unitText(unit: Unit): string {
  return CSV_UNIT_SUFFIX[unit] || unit;
}

/** `25 lb`, or `''` when the slot is absent or has no target ("log in this unit, no target"). */
function quantityText(parts: PrescribedTextParts, slot: QuantitySlot): string {
  const quantity = parts.quantities.find((q) => q.slot === slot);
  if (!quantity || quantity.value === null) return '';
  return `${formatNumeric(quantity.value)} ${unitText(quantity.unit)}`;
}

/** `sets × each`, or `each` alone when there is no set count. */
function perSet(sets: number | null, each: string): string {
  return sets ? `${sets} × ${each}`.trimEnd() : each;
}

/** The per-set part and an optional load, joined the way the export joins them: `each [@ load]`. */
function withLoad(each: string, load: string): string {
  return formatPrescribedForExport({ sets: null, targetReps: each, reps: null, load });
}

export function prescribedText(parts: PrescribedTextParts): string {
  const primary = quantityText(parts, QUANTITY_SLOT.primary);
  switch (parts.trackingType) {
    case TRACKING_TYPE.check:
      return '';
    case TRACKING_TYPE.count:
    case TRACKING_TYPE.duration:
      return primary;
    case TRACKING_TYPE.reps:
      return perSet(parts.sets, parts.targetReps ?? '');
    case TRACKING_TYPE.weight_reps:
      return withLoad(perSet(parts.sets, parts.targetReps ?? ''), primary);
    case TRACKING_TYPE.time_sets:
      return perSet(parts.sets, primary);
    case TRACKING_TYPE.distance:
      // One set of a distance reads as the distance alone: `2 yd`, not `1 × 2 yd`.
      return perSet(
        parts.sets !== null && parts.sets > 1 ? parts.sets : null,
        quantityText(parts, QUANTITY_SLOT.distance),
      );
  }
}
