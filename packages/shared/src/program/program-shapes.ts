import { z } from 'zod';

import { isoDaySchema } from '../date';
import { WEEKDAYS, weekdaySchema } from '../day';
import { uuidSchema } from '../id';
import { movementLabelSchema, movementNameSchema, trackingTypeSchema } from '../movements';
import { MAX_HOUSEHOLD_ATHLETES } from '../profiles';
import { MAX_WORKOUT_ITEMS } from '../programming';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import {
  athleteLabelSchema,
  nullableNoteSchema,
  prescribedQuantitiesSchema,
  programNameSchema,
  slotLabelSchema,
  supersetSchema,
  targetRepsSchema,
  workoutNameSchema,
} from './pieces';

/**
 * The program builder's shapes (FAM-1 plan §4): what the builder's screens load, and what they hand
 * to `ProgramActions`. Lane B's screens and lane P's writers and queries meet here.
 *
 * Each action input has a schema here, so the preview route's fake and the real action refuse the
 * same things.
 */

/** No two the same. Used where the plan says "once" or "the full order". */
const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;

/**
 * One item on a workout card. `itemName` and `trackingType` are display: the writer re-reads both
 * from the item the id names.
 *
 * Which fields a type uses is `TRACKING_TYPE_FIELDS` (`./pieces`): `sets` for the set-based types,
 * `targetReps` where a row has reps, one quantity in the type's slot. The schema does not enforce
 * the pairing; the writer does, and answers `invalid`.
 */
export const workoutDraftItemSchema = z.object({
  /**
   * The card's identity, stable across saves and reorders (ADR 0007 Amendment 3, plan D19). **The
   * editor mints it**: one per card when the card is added, and a new one when a card's item is
   * swapped. The writer matches rows by it, and refuses (`invalid`) an id it already knows under a
   * different item.
   */
  prescriptionClientId: uuidSchema,
  itemPublicId: uuidSchema,
  itemName: movementLabelSchema,
  trackingType: trackingTypeSchema,
  sets: z.number().int().min(1).max(MAX_SETS_PER_MOVEMENT).nullable(),
  /** Text, as `prescriptions.target_reps` is; a template row writes a whole number (plan D2). */
  targetReps: targetRepsSchema,
  quantities: prescribedQuantitiesSchema,
  /** The author's instructions, shown with the item every time. */
  notes: nullableNoteSchema,
  superset: supersetSchema,
  /** On the group's LAST item only (plan D14); `null` everywhere else. */
  restAfter: slotLabelSchema,
});
export type WorkoutDraftItem = z.infer<typeof workoutDraftItemSchema>;

/**
 * What the workout editor LOADS: builder ⇄ DAL.
 *
 * `name` may be `''` because the editor also loads a workout that has no name yet
 * (`workoutPublicId: null`, the `new-workout-empty` fixture). What it SAVES is `saveWorkoutSchema`.
 */
export const workoutDraftSchema = z.object({
  programPublicId: uuidSchema,
  /** Minted by the editor when the workout is new; one save attempt replays under it. */
  workoutClientId: uuidSchema,
  /** `null`: a new workout. */
  workoutPublicId: uuidSchema.nullable(),
  name: workoutNameSchema.or(z.literal('')),
  description: nullableNoteSchema,
  /** In order. */
  items: z
    .array(workoutDraftItemSchema)
    .max(MAX_WORKOUT_ITEMS)
    .refine((items) => distinct(items.map((item) => item.prescriptionClientId)), {
      message: 'each card has its own prescriptionClientId',
    }),
});
export type WorkoutDraft = z.infer<typeof workoutDraftSchema>;

/** `saveWorkout`'s input: the same draft, with a name. An empty name is refused here. */
export const saveWorkoutSchema = workoutDraftSchema.extend({ name: workoutNameSchema });

/** One slot of a weekday: a workout and its optional label. */
const weekSlotSchema = z.object({
  workoutPublicId: uuidSchema,
  label: slotLabelSchema,
});

/**
 * A week: for each weekday (0 = Sunday, `WEEKDAYS`), its workouts in the author's order. Every
 * weekday is present; a rest day is `[]`.
 *
 * **A workout appears at most once on a day**, so a day never holds more slots than the program has
 * workouts. The schema refuses a repeat; the writer answers it `once_per_day`.
 */
export const weekDaysSchema = z.record(
  weekdaySchema,
  z.array(weekSlotSchema).refine((slots) => distinct(slots.map((slot) => slot.workoutPublicId)), {
    message: 'a workout runs at most once a day',
  }),
);

/** The week editor → `saveWeek`. The full state, in order. */
export const weekDraftSchema = z.object({
  programPublicId: uuidSchema,
  days: weekDaysSchema,
});
export type WeekDraft = z.infer<typeof weekDraftSchema>;

/** A program, by id and name: one entry of a list a person picks from. */
export const programRefSchema = z.object({
  programPublicId: uuidSchema,
  name: programNameSchema,
});

/** The Programs list: each program, in the household's order, and the athletes on it. */
export const programListSchema = z.array(
  programRefSchema.extend({
    athletes: z.array(athleteLabelSchema).max(MAX_HOUSEHOLD_ATHLETES),
  }),
);
export type ProgramList = z.infer<typeof programListSchema>;

/** The program page, and the data its two dialogs (Put someone on, Copy to…) open with. */
export const programViewSchema = z
  .object({
    programPublicId: uuidSchema,
    name: programNameSchema,
    /**
     * The household's today, set by the DAL, as `DayPlan.today` is. The page reads it to say
     * "starts" or "since" beside an athlete (`since` after today is a start still to come), and
     * the Put-on dialog to offer today or tomorrow as `AssignDraft.from`.
     */
    today: isoDaySchema,
    /**
     * Who's on it. `since` is the day they start, which may be after today. `lastDay` is set once
     * they were taken off: the last day they are on it. `alsoOn` names their other programs.
     */
    athletes: z.array(
      z.object({
        profilePublicId: uuidSchema,
        name: athleteLabelSchema,
        since: isoDaySchema,
        lastDay: isoDaySchema.nullable(),
        alsoOn: z.array(programNameSchema),
      }),
    ),
    /**
     * "Put someone on": every athlete in the household. `on` is whether they are on this program
     * already; `keeps` names the programs they are on now, in their own order, this one included.
     */
    candidates: z.array(
      z.object({
        profilePublicId: uuidSchema,
        name: athleteLabelSchema,
        on: z.boolean(),
        keeps: z.array(programNameSchema),
      }),
    ),
    workouts: z.array(
      z.object({
        workoutPublicId: uuidSchema,
        name: workoutNameSchema,
        itemCount: z.number().int().min(0).max(MAX_WORKOUT_ITEMS),
        /** The weekdays whose slots name this workout, **Monday first** (1, 2, … 6, 0), each once. */
        usedOn: z.array(weekdaySchema).max(WEEKDAYS.length).refine(distinct),
        /** Where a copied workout came from. The program's name is frozen at copy time. */
        copiedFrom: z.object({ programName: programNameSchema, on: isoDaySchema }).nullable(),
      }),
    ),
    week: weekDaysSchema,
    /** "Copy to…": the household's other programs, in the Programs list's order. */
    otherPrograms: z.array(programRefSchema),
  })
  .refine(
    (view) => {
      const known = new Set(view.workouts.map((workout) => workout.workoutPublicId));
      return Object.values(view.week).every((slots) =>
        slots.every((slot) => known.has(slot.workoutPublicId)),
      );
    },
    { message: 'every slot of the week names one of the program’s workouts' },
  );
export type ProgramView = z.infer<typeof programViewSchema>;

/**
 * Whether an athlete has started on a program by `today`: their `since` is today or earlier.
 * `since` may be after today (Put on, starting tomorrow), and then they are listed but not started.
 *
 * One rule, three readers: the page's "since" or "starts" wording, what Take off does (someone who
 * has not started simply leaves; someone who has stays through today), and the preview's fake.
 * Both days are `isoDaySchema` text, which sorts as the calendar does.
 */
export function hasStarted(athlete: { since: string }, today: string): boolean {
  return athlete.since <= today;
}

/**
 * `createProgram`'s input. **A program is created by naming it**: there is no unnamed program on the
 * server. `clientId` is one create attempt; a retry reuses it.
 */
export const createProgramSchema = z.object({ clientId: uuidSchema, name: programNameSchema });
export type CreateProgram = z.infer<typeof createProgramSchema>;

/** `renameProgram`'s input. */
export const renameProgramSchema = z.object({
  programPublicId: uuidSchema,
  name: programNameSchema,
});
export type RenameProgram = z.infer<typeof renameProgramSchema>;

/** `newItem`'s input: a name a person typed (`movementNameSchema`'s rules) and its type. */
export const newItemSchema = z.object({
  name: movementNameSchema,
  trackingType: trackingTypeSchema,
});
export type NewItem = z.infer<typeof newItemSchema>;

/** Put someone on a program. `from` is today or tomorrow; the action checks it against its own clock. */
export const assignDraftSchema = z.object({
  programPublicId: uuidSchema,
  profilePublicIds: z.array(uuidSchema).min(1).max(MAX_HOUSEHOLD_ATHLETES).refine(distinct),
  from: isoDaySchema,
});
export type AssignDraft = z.infer<typeof assignDraftSchema>;

/** Take an athlete off a program, after today. */
export const takeOffSchema = z.object({
  programPublicId: uuidSchema,
  profilePublicId: uuidSchema,
});
export type TakeOff = z.infer<typeof takeOffSchema>;

/**
 * One athlete's programs in the order their day page lists them.
 *
 * **The full order, every time**: `programPublicIds` must be a permutation of the athlete's
 * `DayPlan.currentPrograms`, each program once. The schema refuses a repeat; the writer refuses
 * (`invalid`) a list that leaves one out or names one the athlete is not on.
 */
export const programOrderSchema = z.object({
  profilePublicId: uuidSchema,
  programPublicIds: z.array(uuidSchema).min(1).refine(distinct, {
    message: 'each program once',
  }),
});
export type ProgramOrder = z.infer<typeof programOrderSchema>;

/** Copy a workout into a program, optionally onto weekdays. `clientId` is one copy attempt. */
export const copyDraftSchema = z.object({
  clientId: uuidSchema,
  workoutPublicId: uuidSchema,
  toProgramPublicId: uuidSchema,
  weekdays: z.array(weekdaySchema).max(WEEKDAYS.length).refine(distinct),
  label: slotLabelSchema,
});
export type CopyDraft = z.infer<typeof copyDraftSchema>;
