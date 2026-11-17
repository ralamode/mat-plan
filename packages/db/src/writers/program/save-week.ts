import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  PROGRAM_REFUSAL,
  WEEKDAYS,
  weekDraftSchema,
  type ProgramRefusal,
  type ProgramResult,
  type Weekday,
} from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { liveTemplateBlockIn } from '../ownership';
import { shiftIntoBand } from './shift-band';

const refuse = (reason: ProgramRefusal) => ({ ok: false as const, reason });

/**
 * Whether every issue is the week schema's "a workout runs at most once a day" refinement: a
 * `custom` issue on one day (`['days', weekday]`). Every other check in `weekDraftSchema` lands on a
 * field inside a slot, or on the draft itself.
 */
type Issues = NonNullable<ReturnType<typeof weekDraftSchema.safeParse>['error']>['issues'];
const onlyRepeats = (issues: Issues) =>
  issues.length > 0 &&
  issues.every((i) => i.code === 'custom' && i.path.length === 2 && i.path[0] === 'days');

/** A live slot's address within its block: a workout appears at most once a day. */
const slotKey = (weekday: number, workoutId: number) => `${weekday}:${workoutId}`;

/**
 * `ProgramActions.saveWeek`'s writer (FAM-1 step 6b). The draft is the week's full state: for each
 * weekday, its workouts in order, each with an optional label. Correct on a bare `db` or inside a
 * transaction: its writes run in one.
 *
 * - **Refusals, before anything is written:** a draft the schema refuses is `invalid`, except a
 *   workout twice on one day, which is `once_per_day` (also when the two ids differ only in case);
 *   a program that is not this household's live program, or a workout that is not one of its live
 *   workouts, is `not_found`.
 * - **A slot keeps its row** while its workout stays on that day: only its place and label change.
 *   A slot that is gone is hidden, which frees its place and its once-a-day key (both unique indexes
 *   are partial on live rows), so the same workout can be put back on that day later. A week saved
 *   unchanged writes nothing.
 * - **Places move through the band** (`shiftIntoBand`), so two slots can swap without meeting on
 *   the slot index.
 * - **Saves of one program run one after the other:** the program's row is locked first, as
 *   `saveWorkout` locks it, so a save of the week and a save of a workout cannot interleave.
 */
export async function saveWeek(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<ProgramResult> {
  const parsed = weekDraftSchema.safeParse(input);
  if (!parsed.success) {
    return refuse(
      onlyRepeats(parsed.error.issues) ? PROGRAM_REFUSAL.once_per_day : PROGRAM_REFUSAL.invalid,
    );
  }
  // Postgres compares a uuid in any case and answers in lower case; ids compare in JS below.
  const programPublicId = parsed.data.programPublicId.toLowerCase();
  const days = WEEKDAYS.map((weekday) => ({
    weekday,
    slots: parsed.data.days[weekday].map((slot) => ({
      workoutPublicId: slot.workoutPublicId.toLowerCase(),
      label: slot.label,
    })),
  }));
  for (const { slots } of days) {
    if (new Set(slots.map((s) => s.workoutPublicId)).size !== slots.length) {
      return refuse(PROGRAM_REFUSAL.once_per_day);
    }
  }

  return exec.transaction(async (tx) => {
    const [block] = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(and(eq(schema.programBlocks.publicId, programPublicId), liveTemplateBlockIn(scope)))
      .for('no key update');
    if (!block) return refuse(PROGRAM_REFUSAL.not_found);

    const workouts = await tx
      .select({ id: schema.workouts.id, publicId: schema.workouts.publicId })
      .from(schema.workouts)
      .where(and(eq(schema.workouts.blockId, block.id), isNull(schema.workouts.deletedAt)));
    const workoutId = new Map(workouts.map((w) => [w.publicId, w.id]));

    const wanted: Array<{
      weekday: Weekday;
      idx: number;
      workoutId: number;
      label: string | null;
    }> = [];
    for (const { weekday, slots } of days) {
      for (const [idx, slot] of slots.entries()) {
        const id = workoutId.get(slot.workoutPublicId);
        if (id === undefined) return refuse(PROGRAM_REFUSAL.not_found);
        wanted.push({ weekday, idx, workoutId: id, label: slot.label });
      }
    }

    const live = await tx
      .select({
        id: schema.blockDayWorkouts.id,
        weekday: schema.blockDayWorkouts.weekday,
        idx: schema.blockDayWorkouts.idx,
        workoutId: schema.blockDayWorkouts.workoutId,
        label: schema.blockDayWorkouts.label,
      })
      .from(schema.blockDayWorkouts)
      .where(
        and(
          eq(schema.blockDayWorkouts.blockId, block.id),
          isNull(schema.blockDayWorkouts.deletedAt),
        ),
      );
    const liveByKey = new Map(live.map((row) => [slotKey(row.weekday, row.workoutId), row]));

    const kept = new Set<number>();
    const moved: Array<{ id: number; idx: number; label: string | null }> = [];
    const relabelled: Array<{ id: number; label: string | null }> = [];
    const added: typeof wanted = [];
    for (const slot of wanted) {
      const row = liveByKey.get(slotKey(slot.weekday, slot.workoutId));
      if (!row) {
        added.push(slot);
        continue;
      }
      kept.add(row.id);
      if (row.idx !== slot.idx) moved.push({ id: row.id, idx: slot.idx, label: slot.label });
      else if (row.label !== slot.label) relabelled.push({ id: row.id, label: slot.label });
    }
    const gone = live.filter((row) => !kept.has(row.id)).map((row) => row.id);
    if (gone.length + moved.length + relabelled.length + added.length === 0) return { ok: true };

    // Hidden first: a gone slot frees its place and its once-a-day key for what replaces it.
    if (gone.length > 0) {
      await tx
        .update(schema.blockDayWorkouts)
        .set({ deletedAt: sql`now()` })
        .where(inArray(schema.blockDayWorkouts.id, gone));
    }
    if (moved.length > 0) {
      await shiftIntoBand(
        tx,
        schema.blockDayWorkouts,
        and(
          eq(schema.blockDayWorkouts.blockId, block.id),
          inArray(
            schema.blockDayWorkouts.id,
            moved.map((m) => m.id),
          ),
        ),
      );
    }
    for (const { id, ...values } of [...moved, ...relabelled]) {
      await tx
        .update(schema.blockDayWorkouts)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.blockDayWorkouts.id, id));
    }
    if (added.length > 0) {
      await tx
        .insert(schema.blockDayWorkouts)
        .values(added.map((slot) => ({ blockId: block.id, ...slot })));
    }
    return { ok: true };
  });
}
