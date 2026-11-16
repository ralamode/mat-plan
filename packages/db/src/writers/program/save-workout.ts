import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  foldName,
  newId,
  PROGRAM_REFUSAL,
  saveWorkoutSchema,
  TRACKING_TYPE_FIELDS,
  trackingTypeSchema,
  UNIT_DIMENSION_BY_CODE,
  unitsForTrackingType,
  type ProgramResult,
  type WorkoutDraftItem,
} from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { insertWorkoutOwnedBy, liveTemplateBlockIn, movementIsAvailableTo } from '../ownership';
import { shiftIntoBand } from './shift-band';

/** The editor's Reps rule (§4 "As built", maintainer): a whole number from 1 to 1000, or blank. */
const TARGET_REPS_RANGE = { min: 1, max: 1000 } as const;

type Refusal = { ok: false; reason: (typeof PROGRAM_REFUSAL)[keyof typeof PROGRAM_REFUSAL] };
const refuse = (reason: Refusal['reason']): Refusal => ({ ok: false, reason });

/**
 * A saved draft's supersets (§4 "As built", maintainer; plan D14): each group's items are
 * neighbours, numbered 1..n in order, at least two of them, with `restAfter` on the last item only.
 * The editor fixes a draft up after every move and remove; the writer relies on that and refuses a
 * draft that is not so.
 */
export function supersetsAreWellFormed(items: readonly WorkoutDraftItem[]): boolean {
  const closed = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const group = item.superset?.group ?? null;
    const next = items[i + 1]?.superset?.group ?? null;
    if (group === null) {
      if (item.restAfter !== null) return false;
      continue;
    }
    const previous = items[i - 1]?.superset?.group ?? null;
    const place = previous === group ? items[i - 1]!.superset!.order + 1 : 1;
    if (closed.has(group) || item.superset!.order !== place) return false;
    const last = next !== group;
    if (last) {
      if (place < 2) return false;
      closed.add(group);
    } else if (item.restAfter !== null) {
      return false;
    }
  }
  return true;
}

/** The fields of one item that its tracking type allows (plan §2, `TRACKING_TYPE_FIELDS`). */
function itemFitsItsType(item: WorkoutDraftItem): boolean {
  const fields = TRACKING_TYPE_FIELDS[item.trackingType];
  if (item.targetReps !== null) {
    if (!fields.reps || !/^\d+$/.test(item.targetReps)) return false;
    const reps = Number(item.targetReps);
    if (reps < TARGET_REPS_RANGE.min || reps > TARGET_REPS_RANGE.max) return false;
  }
  if (fields.slot === null) return item.quantities.length === 0;
  if (item.quantities.length > 1) return false;
  const units = unitsForTrackingType(item.trackingType);
  return item.quantities.every((q) => q.slot === fields.slot && units.includes(q.unit));
}

/**
 * `ProgramActions.saveWorkout`'s writer (FAM-1 step 6a-ii; plan D19). The draft is the workout's
 * full state, in order. Correct on a bare `db` or inside a transaction: its writes run in one.
 *
 * Refusals, all before any write:
 *
 * 1. `invalid`: the draft fails `saveWorkoutSchema`, its supersets are not well formed, an item's
 *    fields do not fit its type, an item's `trackingType` is not the item's own, or a
 *    `prescriptionClientId` this workout already knows names another item (or a removed card).
 * 2. `not_found` (the same answer for every case, ADR 0006): the program is not this household's
 *    live program; `workoutPublicId` names no live workout of it; an item is not available to the
 *    household.
 * 3. `name_taken`: another live workout of the program has the same folded name (plan D5).
 *
 * The write (D19): rows are matched by `prescriptionClientId`, so a card keeps its row, and the
 * entries logged against it, whatever its place. A card that is gone is hidden with its quantities;
 * a new card (or a swapped item, whose card the editor gave a new id) is a new row. Places are set
 * through {@link shiftIntoBand}. A replayed save matches every card and adds nothing.
 */
export async function saveWorkout(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<ProgramResult<{ workoutPublicId: string }>> {
  const parsed = saveWorkoutSchema.safeParse(input);
  if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
  const draft = parsed.data;
  if (!supersetsAreWellFormed(draft.items) || !draft.items.every(itemFitsItsType)) {
    return refuse(PROGRAM_REFUSAL.invalid);
  }

  return exec.transaction(async (tx) => {
    // The block first, FOR SHARE (insertWorkoutOwnedBy's lock order), then the workout FOR UPDATE.
    const [block] = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(
        and(eq(schema.programBlocks.publicId, draft.programPublicId), liveTemplateBlockIn(scope)),
      )
      .for('share');
    if (!block) return refuse(PROGRAM_REFUSAL.not_found);

    const workouts = await tx
      .select({
        id: schema.workouts.id,
        publicId: schema.workouts.publicId,
        clientId: schema.workouts.clientId,
        name: schema.workouts.name,
        deletedAt: schema.workouts.deletedAt,
      })
      .from(schema.workouts)
      .where(eq(schema.workouts.blockId, block.id))
      .for('update');
    // A new workout's replay is found by its client id; an existing one by its public id.
    const self = workouts.find((w) =>
      draft.workoutPublicId === null
        ? w.clientId === draft.workoutClientId
        : w.publicId === draft.workoutPublicId,
    );
    if ((draft.workoutPublicId !== null && !self) || self?.deletedAt) {
      return refuse(PROGRAM_REFUSAL.not_found);
    }
    const folded = foldName(draft.name);
    if (workouts.some((w) => w !== self && !w.deletedAt && foldName(w.name) === folded)) {
      return refuse(PROGRAM_REFUSAL.name_taken);
    }

    // Every item: available to this household, and of the type the draft says.
    const itemIds = [...new Set(draft.items.map((item) => item.itemPublicId))];
    const movements =
      itemIds.length === 0
        ? []
        : await tx
            .select({
              id: schema.movements.id,
              publicId: schema.movements.publicId,
              trackingType: schema.movements.trackingType,
            })
            .from(schema.movements)
            .where(and(inArray(schema.movements.publicId, itemIds), movementIsAvailableTo(scope)));
    const movementOf = new Map(movements.map((m) => [m.publicId, m]));
    if (movementOf.size !== itemIds.length) return refuse(PROGRAM_REFUSAL.not_found);
    for (const item of draft.items) {
      const own = trackingTypeSchema.parse(movementOf.get(item.itemPublicId)!.trackingType);
      if (own !== item.trackingType) return refuse(PROGRAM_REFUSAL.invalid);
    }

    // The rows this workout already has, live or hidden (a hidden row still owns its client id).
    const rows = self
      ? await tx
          .select({
            id: schema.prescriptions.id,
            clientId: schema.prescriptions.clientId,
            movementId: schema.prescriptions.movementId,
            deletedAt: schema.prescriptions.deletedAt,
          })
          .from(schema.prescriptions)
          .where(eq(schema.prescriptions.workoutId, self.id))
      : [];
    const rowOf = new Map(rows.map((r) => [r.clientId!, r]));
    for (const item of draft.items) {
      const row = rowOf.get(item.prescriptionClientId);
      const movementId = movementOf.get(item.itemPublicId)!.id;
      if (row && (row.deletedAt !== null || row.movementId !== movementId)) {
        return refuse(PROGRAM_REFUSAL.invalid);
      }
    }

    // ── the writes ──
    let workout: { id: number; publicId: string };
    if (self) {
      await tx
        .update(schema.workouts)
        .set({ name: draft.name, description: draft.description, updatedAt: sql`now()` })
        .where(eq(schema.workouts.id, self.id));
      workout = self;
    } else {
      const made = await insertWorkoutOwnedBy(tx, scope, {
        blockId: block.id,
        clientId: draft.workoutClientId,
        name: draft.name,
        description: draft.description,
      });
      if (!made) return refuse(PROGRAM_REFUSAL.not_found);
      workout = made;
    }

    const kept = new Set(draft.items.map((item) => item.prescriptionClientId));
    const gone = rows
      .filter((r) => r.deletedAt === null && !kept.has(r.clientId!))
      .map((r) => r.id);
    if (gone.length > 0) {
      await tx
        .update(schema.prescriptionQuantities)
        .set({ deletedAt: sql`now()` })
        .where(
          and(
            inArray(schema.prescriptionQuantities.prescriptionId, gone),
            isNull(schema.prescriptionQuantities.deletedAt),
          ),
        );
      await tx
        .update(schema.prescriptions)
        .set({ deletedAt: sql`now()` })
        .where(inArray(schema.prescriptions.id, gone));
    }

    await shiftIntoBand(
      tx,
      schema.prescriptions,
      and(eq(schema.prescriptions.workoutId, workout.id), isNull(schema.prescriptions.deletedAt)),
    );

    for (const [idx, item] of draft.items.entries()) {
      const values = {
        idx,
        sets: item.sets,
        targetReps: item.targetReps,
        notes: item.notes,
        restAfter: item.restAfter,
        supersetLabel: item.superset?.group ?? null,
        supersetOrder: item.superset?.order ?? null,
      };
      const row = rowOf.get(item.prescriptionClientId);
      let prescriptionId: number;
      if (row) {
        await tx
          .update(schema.prescriptions)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(schema.prescriptions.id, row.id));
        prescriptionId = row.id;
      } else {
        const [inserted] = await tx
          .insert(schema.prescriptions)
          .values({
            ...values,
            publicId: newId(),
            blockId: block.id,
            workoutId: workout.id,
            clientId: item.prescriptionClientId,
            movementId: movementOf.get(item.itemPublicId)!.id,
          })
          .returning({ id: schema.prescriptions.id });
        prescriptionId = inserted!.id;
      }
      await saveQuantities(tx, prescriptionId, item);
    }

    return { ok: true, workoutPublicId: workout.publicId };
  });
}

/**
 * An item's prescribed quantities, by place `(prescription, slot)`: an existing slot is updated, a
 * slot no longer in the draft is hidden, a new one inserted. So a replayed save leaves the rows as
 * they are and adds none, hidden ones included.
 */
async function saveQuantities(
  tx: Executor,
  prescriptionId: number,
  item: WorkoutDraftItem,
): Promise<void> {
  const live = await tx
    .select({ id: schema.prescriptionQuantities.id, slot: schema.prescriptionQuantities.slot })
    .from(schema.prescriptionQuantities)
    .where(
      and(
        eq(schema.prescriptionQuantities.prescriptionId, prescriptionId),
        isNull(schema.prescriptionQuantities.deletedAt),
      ),
    );
  const wanted = new Map(item.quantities.map((q) => [q.slot as string, q]));
  for (const row of live) {
    const q = wanted.get(row.slot);
    if (!q) {
      await tx
        .update(schema.prescriptionQuantities)
        .set({ deletedAt: sql`now()` })
        .where(eq(schema.prescriptionQuantities.id, row.id));
      continue;
    }
    wanted.delete(row.slot);
    await tx
      .update(schema.prescriptionQuantities)
      .set({
        unit: q.unit,
        dimension: UNIT_DIMENSION_BY_CODE[q.unit],
        valueMin: q.value === null ? null : String(q.value),
        valueMax: null,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.prescriptionQuantities.id, row.id));
  }
  for (const q of wanted.values()) {
    await tx.insert(schema.prescriptionQuantities).values({
      prescriptionId,
      slot: q.slot,
      unit: q.unit,
      dimension: UNIT_DIMENSION_BY_CODE[q.unit],
      valueMin: q.value === null ? null : String(q.value),
    });
  }
}
