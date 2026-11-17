import {
  itemUnit,
  prescribedTarget,
  type PrescribedTarget,
  type QuantitySlot,
  quantitySlotSchema,
  type TrackingType,
  type Unit,
  unitSchema,
} from '@mat-plan/shared';
import { prescribedText } from '@mat-plan/shared/program/prescribed-text';

/**
 * FAM-1 12a, decision E5 — **a prescription's derived terms, from ONE pure function**: its live
 * quantities as numbers, its `target`, the unit the item logs in, and its prescribed text. The day
 * resolver's live heading (`./day-plan.ts`) and the row writer's frozen `prescribed_snapshot`
 * (`writers/day/log-row.ts`) both call it, so what a row is logged against and what the page shows
 * above it cannot diverge.
 *
 * It wraps the shared rules rather than restating them: `itemUnit` (C13), `prescribedTarget` and the
 * one renderer, `prescribedText`, plus the numeric conversion and the two-in-one-slot throw
 * (`liveQuantities`). No I/O; the caller reads the rows.
 */

/**
 * A prescription's live quantity as a LEFT JOIN onto `prescription_quantities` returns it (`numeric`
 * as a string): all NULL where the prescription has none.
 */
export type PrescriptionQuantityRow = {
  slot: string | null;
  unit: string | null;
  valueMin: string | null;
  valueMax: string | null;
};

/** A live quantity with its numbers converted. `valueMax` is set for a range. */
export type PrescribedQuantity = {
  slot: QuantitySlot;
  unit: Unit;
  value: number | null;
  valueMax: number | null;
};

export type PrescriptionTerms = {
  target: PrescribedTarget;
  /** `itemUnit`: the type's fixed unit, else the slot's prescribed unit; `null` for a Check and Reps. */
  unit: Unit | null;
  /** The one renderer's line, from the target's quantities, so a range renders as the page shows it. */
  text: string;
};

const toNumber = (v: string | null) => (v === null ? null : Number(v));

/**
 * A prescription's LIVE quantity rows with their numbers converted. A row with no slot or unit (the
 * LEFT JOIN's empty side) is skipped.
 *
 * 🔴 Two live quantities in one slot throw: `PRESCRIPTION_QUANTITY_SLOT_UNIQUE_INDEX` makes that
 * impossible, so seeing one means a read stopped filtering hidden rows. Failing beats copying
 * whichever came first. The message names the internal id only.
 */
export function liveQuantities(
  prescriptionId: number,
  rows: readonly PrescriptionQuantityRow[],
): PrescribedQuantity[] {
  const quantities: PrescribedQuantity[] = rows.flatMap((q) =>
    q.slot === null || q.unit === null
      ? []
      : [
          {
            slot: quantitySlotSchema.parse(q.slot),
            unit: unitSchema.parse(q.unit),
            value: toNumber(q.valueMin),
            valueMax: toNumber(q.valueMax),
          },
        ],
  );
  if (new Set(quantities.map((q) => q.slot)).size !== quantities.length) {
    throw new Error(`prescription ${prescriptionId} has two live quantities in one slot`);
  }
  return quantities;
}

/** The terms of one prescription, from its {@link liveQuantities}. */
export function prescriptionTerms(prescription: {
  trackingType: TrackingType;
  sets: number | null;
  targetReps: string | null;
  quantities: readonly PrescribedQuantity[];
}): PrescriptionTerms {
  const target = prescribedTarget(prescription.targetReps, prescription.quantities);
  return {
    target,
    unit: itemUnit(prescription.trackingType, prescription.quantities),
    text: prescribedText({
      trackingType: prescription.trackingType,
      sets: prescription.sets,
      targetReps: prescription.targetReps,
      quantities: target.quantities,
    }),
  };
}
