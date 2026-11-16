import { formatPrescribedForExport } from '../csv/prescribed';
import { TRACKING_TYPE } from '../movements';
import type { Unit } from '../units';
import { slotQuantity, TRACKING_TYPE_FIELDS } from './pieces';
import type { WorkoutDraftItem } from './program-shapes';
import { quantityText } from './quantity-text';

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
 * 🔴 **Kept out of the ROOT BARREL, because it builds on `formatPrescribedForExport`
 * (`../csv/prescribed`)**, and `csv/` stays out of the barrel every `'use client'` component
 * imports. It is the `@mat-plan/shared/program/prescribed-text` subpath instead. That is a rule
 * about the barrel, not about the server: this module is pure (no I/O, no `server-only`), so a
 * client component MAY import the subpath directly when it needs a whole prescription's line. Its
 * callers today are the DAL, the writers and the export.
 *
 * `formatPrescribedForExport` composes the per-set part and the `@ load`. Its own `3x10` spelling
 * is bytes that exist in every exported month and is pinned by its test, so the multiplication
 * sign is the one part written here.
 *
 * **A single quantity is spelled by `quantityText` (`./quantity-text`), the root-barrel spelling**:
 * the day screen writes a logged value with it, so a logged `30 s` and a prescribed `3 × 30 s`
 * agree.
 */

/** The fields of a prescription the text is made from. A `WorkoutDraft` item fits as it is. */
export type PrescribedTextParts = Pick<
  WorkoutDraftItem,
  'trackingType' | 'sets' | 'targetReps' | 'quantities'
>;

/** The type's quantity (`slotQuantity`), or `null` when it has no target. */
function target(parts: PrescribedTextParts): { value: number; unit: Unit } | null {
  const quantity = slotQuantity(parts, parts.quantities);
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
  const amount = quantity ? quantityText(quantity.value, quantity.unit) : '';

  // Where a row has reps, the reps are the per-set part and the quantity is a load beside them.
  // A load of zero is no load: `4 × 8`, never `4 × 8 @ 0 lb`.
  const each = fields.reps ? (parts.targetReps ?? '') : amount;
  const load = fields.reps && quantity && quantity.value > 0 ? amount : '';

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
