import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import {
  QUANTITY_SLOT_CODES,
  quantitySlotSchema,
  trackingTypeSchema,
  unitSchema,
  uuidSchema,
  type WorkoutDraft,
} from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { liveTemplateBlockIn } from '../../writers/ownership';

/**
 * A saved workout as the editor loads it (`WorkoutDraft`; FAM-1 step 6a-ii): the workout's live
 * items in order, each with its item's name and type and its live quantities. `null` when the
 * program is not this household's live program, or the workout is not a live workout of it (the
 * same answer for each, ADR 0006).
 *
 * The contract's `heavy-a-draft` fixture is this read's both-sides test (`verify/program.ts`).
 *
 * - `itemName` and `trackingType` are the item's own, read from `movements`.
 * - A quantity's `value` is `value_min` as a number, or `null` ("log in this unit, no target").
 *   `value_max` is not part of the contract yet; nothing writes it.
 * - Quantities are in `QUANTITY_SLOT_CODES` order, so a two-slot item reads the same on every load.
 * - Hidden cards and hidden quantities are left out (a hidden card's id is refused by a save).
 * - ⚠️ Three statements, not one snapshot: a save committing between them can load a card without
 *   its quantity. Accepted while one person edits a program; a version column is the fix if two
 *   devices ever edit one workout at once.
 */
export async function readWorkoutDraft(
  exec: Executor,
  scope: HouseholdScope,
  ids: { programPublicId: string; workoutPublicId: string },
): Promise<WorkoutDraft | null> {
  // An id from a URL that is not a uuid is `null`, never a 22P02 thrown by Postgres.
  if (!uuidSchema.safeParse(ids.programPublicId).success) return null;
  if (!uuidSchema.safeParse(ids.workoutPublicId).success) return null;
  const [workout] = await exec
    .select({
      id: schema.workouts.id,
      publicId: schema.workouts.publicId,
      clientId: schema.workouts.clientId,
      name: schema.workouts.name,
      description: schema.workouts.description,
    })
    .from(schema.workouts)
    .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.workouts.blockId))
    .where(
      and(
        eq(schema.workouts.publicId, ids.workoutPublicId),
        isNull(schema.workouts.deletedAt),
        eq(schema.programBlocks.publicId, ids.programPublicId),
        liveTemplateBlockIn(scope),
      ),
    );
  if (!workout) return null;

  const rows = await exec
    .select({
      id: schema.prescriptions.id,
      clientId: schema.prescriptions.clientId,
      itemPublicId: schema.movements.publicId,
      itemName: schema.movements.name,
      trackingType: schema.movements.trackingType,
      sets: schema.prescriptions.sets,
      targetReps: schema.prescriptions.targetReps,
      notes: schema.prescriptions.notes,
      restAfter: schema.prescriptions.restAfter,
      supersetLabel: schema.prescriptions.supersetLabel,
      supersetOrder: schema.prescriptions.supersetOrder,
    })
    .from(schema.prescriptions)
    .innerJoin(schema.movements, eq(schema.movements.id, schema.prescriptions.movementId))
    .where(
      and(eq(schema.prescriptions.workoutId, workout.id), isNull(schema.prescriptions.deletedAt)),
    )
    .orderBy(asc(schema.prescriptions.idx));

  const quantities =
    rows.length === 0
      ? []
      : await exec
          .select({
            prescriptionId: schema.prescriptionQuantities.prescriptionId,
            slot: schema.prescriptionQuantities.slot,
            unit: schema.prescriptionQuantities.unit,
            valueMin: schema.prescriptionQuantities.valueMin,
          })
          .from(schema.prescriptionQuantities)
          .where(
            and(
              inArray(
                schema.prescriptionQuantities.prescriptionId,
                rows.map((r) => r.id),
              ),
              isNull(schema.prescriptionQuantities.deletedAt),
            ),
          );
  const slotRank = (slot: string) => QUANTITY_SLOT_CODES.indexOf(quantitySlotSchema.parse(slot));

  return {
    programPublicId: ids.programPublicId,
    workoutClientId: workout.clientId,
    workoutPublicId: workout.publicId,
    name: workout.name,
    description: workout.description,
    items: rows.map((row) => ({
      prescriptionClientId: row.clientId!,
      itemPublicId: row.itemPublicId,
      itemName: row.itemName,
      trackingType: trackingTypeSchema.parse(row.trackingType),
      sets: row.sets,
      targetReps: row.targetReps,
      quantities: quantities
        .filter((q) => q.prescriptionId === row.id)
        .sort((a, b) => slotRank(a.slot) - slotRank(b.slot))
        .map((q) => ({
          slot: quantitySlotSchema.parse(q.slot),
          unit: unitSchema.parse(q.unit),
          value: q.valueMin === null ? null : Number(q.valueMin),
        })),
      notes: row.notes,
      superset:
        row.supersetLabel === null ? null : { group: row.supersetLabel, order: row.supersetOrder! },
      restAfter: row.restAfter,
    })),
  };
}
