import { and, asc, count, eq, inArray, isNull, max } from 'drizzle-orm';

import {
  copyDraftSchema,
  copyName,
  foldName,
  MAX_DAY_SLOTS,
  MAX_PROGRAM_WORKOUTS,
  newId,
  PROGRAM_REFUSAL,
  type ProgramResult,
} from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { insertWorkoutOwnedBy, liveTemplateBlockIn } from '../ownership';
import { refuse } from './refuse';

/**
 * `ProgramActions.copyWorkout`'s writer (FAM-1 step 6a-iii-b; contract change C15). Copies a workout
 * of any of the household's programs into one of its programs, its own included, optionally onto
 * weekdays of that program's week.
 *
 * - **The copy is independent of its source**: a new workout row, new prescription rows (new client
 *   ids) and new quantity rows, so an edit to either never reaches the other. Only its provenance
 *   points back: `copied_from_workout_id` and the source program's name frozen now.
 * - **Its name** (C15): `CopyDraft.name` when given; otherwise `copyName(name)` (the name and
 *   " (copy)", cut to fit) in the workout's own program, and the workout's own name in another.
 *   **A name a live workout of the target already has, folded, answers `name_taken`**, whichever
 *   way it was chosen: never two workouts of one name in a program.
 * - **A replay** (the same `clientId`, into the same program) answers the first copy's workout and
 *   writes nothing. It is checked once the target program is found, before the source and the
 *   name, so it still answers after the source was removed; a replay of a copy removed since, or
 *   into a program removed since, is `not_found`.
 * - **Weekdays**: the copy goes last on each day named, with `label`. It is new, so no day holds it.
 * - Refusals, before anything is written, in this order: `invalid` (the schema; a blank `name` is
 *   refused, not defaulted), `not_found` (the target program, or the source workout, is not the
 *   household's live one), `limit_reached` (the target program holds `MAX_PROGRAM_WORKOUTS` live
 *   workouts, or a weekday named holds `MAX_DAY_SLOTS`; C35, judged before the name), `name_taken`.
 * - One transaction, locking the target program's block first, as every writer of a program does
 *   (lane guide invariant 12), so a copy and a save of the target cannot interleave. The source is
 *   read in one statement (not locked), so a save of the source in another program is seen whole.
 */
export async function copyWorkout(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<ProgramResult<{ workoutPublicId: string }>> {
  const parsed = copyDraftSchema.safeParse(input);
  if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
  const draft = parsed.data;

  return exec.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(
        and(eq(schema.programBlocks.publicId, draft.toProgramPublicId), liveTemplateBlockIn(scope)),
      )
      .for('no key update');
    if (!target) return refuse(PROGRAM_REFUSAL.not_found);

    const targetWorkouts = await tx
      .select({
        publicId: schema.workouts.publicId,
        clientId: schema.workouts.clientId,
        name: schema.workouts.name,
        deletedAt: schema.workouts.deletedAt,
      })
      .from(schema.workouts)
      .where(eq(schema.workouts.blockId, target.id));
    const replay = targetWorkouts.find((w) => w.clientId === draft.clientId);
    if (replay) {
      return replay.deletedAt === null
        ? { ok: true as const, workoutPublicId: replay.publicId }
        : refuse(PROGRAM_REFUSAL.not_found);
    }

    // The source in ONE statement: its row, its live items in order and their live quantities, so a
    // save of the source committing meanwhile (another program, not locked here) is seen whole or
    // not at all. Not `FOR SHARE` on the source's block: a copy P→Q and a copy Q→P would each hold
    // their target's lock and wait on the other's.
    const sourceRows = await tx
      .select({
        id: schema.workouts.id,
        blockId: schema.workouts.blockId,
        name: schema.workouts.name,
        description: schema.workouts.description,
        programName: schema.programBlocks.name,
        item: {
          id: schema.prescriptions.id,
          movementId: schema.prescriptions.movementId,
          sets: schema.prescriptions.sets,
          targetReps: schema.prescriptions.targetReps,
          notes: schema.prescriptions.notes,
          restAfter: schema.prescriptions.restAfter,
          supersetLabel: schema.prescriptions.supersetLabel,
          supersetOrder: schema.prescriptions.supersetOrder,
        },
        quantity: {
          slot: schema.prescriptionQuantities.slot,
          dimension: schema.prescriptionQuantities.dimension,
          unit: schema.prescriptionQuantities.unit,
          valueMin: schema.prescriptionQuantities.valueMin,
          valueMax: schema.prescriptionQuantities.valueMax,
        },
      })
      .from(schema.workouts)
      .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.workouts.blockId))
      .leftJoin(
        schema.prescriptions,
        and(
          eq(schema.prescriptions.workoutId, schema.workouts.id),
          isNull(schema.prescriptions.deletedAt),
        ),
      )
      .leftJoin(
        schema.prescriptionQuantities,
        and(
          eq(schema.prescriptionQuantities.prescriptionId, schema.prescriptions.id),
          isNull(schema.prescriptionQuantities.deletedAt),
        ),
      )
      .where(
        and(
          eq(schema.workouts.publicId, draft.workoutPublicId),
          isNull(schema.workouts.deletedAt),
          liveTemplateBlockIn(scope),
        ),
      )
      .orderBy(asc(schema.prescriptions.idx), asc(schema.prescriptionQuantities.slot));
    const source = sourceRows[0];
    if (!source) return refuse(PROGRAM_REFUSAL.not_found);
    type Item = NonNullable<(typeof sourceRows)[number]['item']>;
    type Quantity = NonNullable<(typeof sourceRows)[number]['quantity']>;
    const items: Array<{ item: Item; quantities: Quantity[] }> = [];
    for (const row of sourceRows) {
      if (!row.item) continue;
      const last = items[items.length - 1];
      const entry = last?.item.id === row.item.id ? last : { item: row.item, quantities: [] };
      if (entry !== last) items.push(entry);
      if (row.quantity) entry.quantities.push(row.quantity);
    }

    // The program it lands in is full (C35, invariant 30): its own count, never the source's, and
    // judged before the name. A replay answered above, so it is never capped.
    if (targetWorkouts.filter((w) => w.deletedAt === null).length >= MAX_PROGRAM_WORKOUTS) {
      return refuse(PROGRAM_REFUSAL.limit_reached);
    }
    // So is a weekday it would go on: no day may hold more than `MAX_DAY_SLOTS` (the read parses the
    // week with that cap), and a copy writes its slots without a week draft to parse.
    if (draft.weekdays.length > 0) {
      const full = await tx
        .select({ weekday: schema.blockDayWorkouts.weekday, n: count() })
        .from(schema.blockDayWorkouts)
        // The slots the week shows: a live workout's (`readWeek`'s join), so the cap matches the page.
        .innerJoin(
          schema.workouts,
          and(
            eq(schema.workouts.id, schema.blockDayWorkouts.workoutId),
            isNull(schema.workouts.deletedAt),
          ),
        )
        .where(
          and(
            eq(schema.blockDayWorkouts.blockId, target.id),
            inArray(schema.blockDayWorkouts.weekday, [...draft.weekdays]),
            isNull(schema.blockDayWorkouts.deletedAt),
          ),
        )
        .groupBy(schema.blockDayWorkouts.weekday);
      if (full.some((day) => day.n >= MAX_DAY_SLOTS)) return refuse(PROGRAM_REFUSAL.limit_reached);
    }

    const name = draft.name ?? (source.blockId === target.id ? copyName(source.name) : source.name);
    const folded = foldName(name);
    if (targetWorkouts.some((w) => w.deletedAt === null && foldName(w.name) === folded)) {
      return refuse(PROGRAM_REFUSAL.name_taken);
    }

    const made = await insertWorkoutOwnedBy(tx, scope, {
      blockId: target.id,
      clientId: draft.clientId,
      name,
      description: source.description,
      copiedFrom: { workoutId: source.id, programName: source.programName },
    });
    if (!made) return refuse(PROGRAM_REFUSAL.not_found);
    // The block lock and the replay read above mean no twin of this copy can have landed first.
    if (!made.created) return refuse(PROGRAM_REFUSAL.retry);

    for (const [
      idx,
      {
        item: { id: _sourceId, ...item },
        quantities: own,
      },
    ] of items.entries()) {
      const [copied] = await tx
        .insert(schema.prescriptions)
        .values({
          ...item,
          idx,
          publicId: newId(),
          clientId: newId(),
          blockId: target.id,
          workoutId: made.id,
        })
        .returning({ id: schema.prescriptions.id });
      if (own.length > 0) {
        await tx
          .insert(schema.prescriptionQuantities)
          .values(own.map((q) => ({ ...q, prescriptionId: copied!.id })));
      }
    }

    for (const weekday of draft.weekdays) {
      const [last] = await tx
        .select({ idx: max(schema.blockDayWorkouts.idx) })
        .from(schema.blockDayWorkouts)
        .where(
          and(
            eq(schema.blockDayWorkouts.blockId, target.id),
            eq(schema.blockDayWorkouts.weekday, weekday),
            isNull(schema.blockDayWorkouts.deletedAt),
          ),
        );
      await tx.insert(schema.blockDayWorkouts).values({
        blockId: target.id,
        weekday,
        idx: last?.idx === null || last?.idx === undefined ? 0 : last.idx + 1,
        workoutId: made.id,
        label: draft.label,
      });
    }

    return { ok: true as const, workoutPublicId: made.publicId };
  });
}
