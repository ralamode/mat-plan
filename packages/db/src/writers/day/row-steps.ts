import {
  ROW_REFUSAL,
  type RowRefusal,
  type RowResult,
  type RowValues,
  TRACKING_TYPE_FIELDS,
  type TrackingType,
  trackingTypeSchema,
  unitsForTrackingType,
} from '@mat-plan/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { Schema } from '../../client';
import { schema } from '../../client';
import { liveQuantities, type PrescribedQuantity } from '../../queries/day/prescription-terms';
import { readRowValues } from '../../queries/day/stored-row-values';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { isLiveProfile, movementIsAvailableTo } from '../ownership';

/**
 * The steps the day's row writers share (FAM-1 11c, plan S1): `logRow`, `untickRow` and
 * `retickRow` (`log-row.ts`, 11b) and `amendRow` (`amend-row.ts`, 11c-i). Lifted out of `log-row.ts`
 * unchanged, so Change runs the same checks as a ✓ rather than a copy of them.
 *
 * ⚠️ Not exported from `writers/day/index.ts`: each step runs inside its caller's transaction, and
 * the ids it takes are ones the caller already proved owned.
 */

/** Why a refused row write did not happen, thrown so the transaction rolls back. Never escapes. */
export class RowRefused extends Error {
  constructor(readonly reason: RowRefusal) {
    super(`row write refused: ${reason}`);
    this.name = 'RowRefused';
  }
}

/** Refuse from inside a writer's transaction: everything it began is rolled back. */
export function refuse(reason: RowRefusal): never {
  throw new RowRefused(reason);
}

/** Run one writer's transaction, turning a `RowRefused` into its typed answer. */
export async function rowTransaction(
  db: NodePgDatabase<Schema>,
  fn: (tx: Executor) => Promise<RowResult>,
): Promise<RowResult> {
  try {
    return await db.transaction((tx) => fn(tx));
  } catch (error) {
    if (error instanceof RowRefused) return { ok: false, reason: error.reason };
    throw error;
  }
}

/**
 * Step 1: **the profile, by `public_id` inside the scope** (`isLiveProfile`), else `not_found`.
 * Returns its internal id and `archived_at`, which the window check reads. Split from the window
 * (11c, S1) because Change learns its day from the entry, after it has found it.
 */
export async function openProfile(
  exec: Executor,
  args: { scope: HouseholdScope; profilePublicId: string },
): Promise<{ id: number; archivedAt: Date | null }> {
  const [profile] = await exec
    .select({ id: schema.profiles.id, archivedAt: schema.profiles.archivedAt })
    .from(schema.profiles)
    .where(isLiveProfile(args.profilePublicId, args.scope))
    .limit(1);
  if (!profile) refuse(ROW_REFUSAL.not_found);
  return profile;
}

/** What one stored row holds, read the one way (`readRowValues`). A program row always has a set. */
export async function storedValues(exec: Executor, entryId: number): Promise<RowValues> {
  const values = (await readRowValues(exec, [entryId])).get(entryId);
  if (!values) throw new Error(`program row entry ${entryId} has no live set`);
  return values;
}

/**
 * **Does the prescription's quantity fit its tracking type?** Every live quantity is in the type's
 * slot and in a unit the type may use (`unitsForTrackingType`, the editor's own list: the fixed unit
 * where the type has one); and a type whose unit comes from the prescription has one. A malformed
 * prescription (a Duration in `lb`) answers `bad_value` rather than storing a wrong row or reaching
 * `entryUnitFor`'s throw.
 */
export function fitsItsType(trackingType: TrackingType, quantities: readonly PrescribedQuantity[]) {
  const fields = TRACKING_TYPE_FIELDS[trackingType];
  const units = unitsForTrackingType(trackingType);
  const fits = quantities.every((q) => q.slot === fields.slot && units.includes(q.unit));
  const unitKnown = fields.slot === null || fields.unit !== null || quantities.length > 0;
  return fits && unitKnown;
}

/** A row found by its `public_id` (from a request) or by internal id (read off an owned row). */
export type ById = { publicId: string } | { id: number };

/** What `rowItem` found: the prescription, its live quantities and its movement's type. */
export type RowItem = {
  prescription: {
    id: number;
    movementId: number;
    sets: number | null;
    targetReps: string | null;
    supersetLabel: string | null;
    supersetOrder: number | null;
  };
  quantities: PrescribedQuantity[];
  movement: { name: string };
  trackingType: TrackingType;
};

/**
 * Steps 5 and 6: **the prescription, IN this workout, and its movement.**
 *
 * - The prescription is named by `public_id` (a ✓) or by internal id (Change, which read it off its
 *   own locked entry), and must belong to `workoutId`: a mismatched pair is `not_found`. Its live
 *   quantities come in the same statement. A hidden one is `program_changed`.
 * - The movement is re-checked inside the transaction against the household
 *   (`movementIsAvailableTo`), else `not_found`.
 */
export async function rowItem(
  exec: Executor,
  scope: HouseholdScope,
  args: { prescription: ById; workoutId: number },
): Promise<RowItem> {
  // 5 — the prescription, IN this workout (a mismatched pair is `not_found`), with its live
  //     quantities in the same statement.
  const rows = await exec
    .select({
      id: schema.prescriptions.id,
      deletedAt: schema.prescriptions.deletedAt,
      movementId: schema.prescriptions.movementId,
      sets: schema.prescriptions.sets,
      targetReps: schema.prescriptions.targetReps,
      supersetLabel: schema.prescriptions.supersetLabel,
      supersetOrder: schema.prescriptions.supersetOrder,
      slot: schema.prescriptionQuantities.slot,
      unit: schema.prescriptionQuantities.unit,
      valueMin: schema.prescriptionQuantities.valueMin,
      valueMax: schema.prescriptionQuantities.valueMax,
    })
    .from(schema.prescriptions)
    .leftJoin(
      schema.prescriptionQuantities,
      and(
        eq(schema.prescriptionQuantities.prescriptionId, schema.prescriptions.id),
        isNull(schema.prescriptionQuantities.deletedAt),
      ),
    )
    .where(
      and(
        'publicId' in args.prescription
          ? eq(schema.prescriptions.publicId, args.prescription.publicId)
          : eq(schema.prescriptions.id, args.prescription.id),
        eq(schema.prescriptions.workoutId, args.workoutId),
      ),
    );
  const prescription = rows[0];
  if (!prescription) refuse(ROW_REFUSAL.not_found);
  if (prescription.deletedAt !== null) refuse(ROW_REFUSAL.program_changed);
  // Its live quantities as numbers; two in one slot throw (`liveQuantities`, E5).
  const quantities = liveQuantities(prescription.id, rows);

  // 6 — the movement, re-checked inside the transaction against the household.
  const [movement] = await exec
    .select({ name: schema.movements.name, trackingType: schema.movements.trackingType })
    .from(schema.movements)
    .where(and(eq(schema.movements.id, prescription.movementId), movementIsAvailableTo(scope)))
    .limit(1);
  if (!movement) refuse(ROW_REFUSAL.not_found);
  return {
    prescription: {
      id: prescription.id,
      movementId: prescription.movementId,
      sets: prescription.sets,
      targetReps: prescription.targetReps,
      supersetLabel: prescription.supersetLabel,
      supersetOrder: prescription.supersetOrder,
    },
    quantities,
    movement: { name: movement.name },
    trackingType: trackingTypeSchema.parse(movement.trackingType),
  };
}
