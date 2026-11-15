import { z } from 'zod';

import { isoDaySchema } from '../date';
import { WEEKDAYS, weekdaySchema } from '../day';
import { uuidSchema } from '../id';
import { movementLabelSchema, trackingTypeSchema } from '../movements';
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
  workoutNameSchema,
} from './pieces';

/**
 * The program builder's shapes (FAM-1 plan §4): what the builder's screens load, and what they hand
 * to `ProgramActions`. Lane B's screens and lane P's writers and queries meet here.
 */

/**
 * One item on a workout card. `itemName` and `trackingType` are display: the writer re-reads both
 * from the item the id names.
 *
 * Which fields a type uses is plan §2's table: `sets` for the set-based types, `targetReps` for Reps
 * and Weight × reps, a `primary` quantity for Count, Weight × reps, Duration and Time per set, a
 * `distance` quantity for Distance. The schema does not enforce the pairing; the writer does, and
 * answers `invalid`.
 */
export const workoutDraftItemSchema = z.object({
  /** Stable across saves and reorders (ADR 0007 Amendment 3, plan D19). Swapping the item mints a new one. */
  prescriptionClientId: uuidSchema,
  itemPublicId: uuidSchema,
  itemName: movementLabelSchema,
  trackingType: trackingTypeSchema,
  sets: z.number().int().min(1).max(MAX_SETS_PER_MOVEMENT).nullable(),
  /** Text, as `prescriptions.target_reps` is; a template row writes a whole number (plan D2). */
  targetReps: slotLabelSchema.nullable(),
  quantities: prescribedQuantitiesSchema,
  /** The author's instructions, shown with the item every time. */
  notes: nullableNoteSchema,
  superset: supersetSchema,
  /** On the group's LAST item only (plan D14); `null` everywhere else. */
  restAfter: slotLabelSchema.nullable(),
});
export type WorkoutDraftItem = z.infer<typeof workoutDraftItemSchema>;

/**
 * What the workout editor loads AND saves: builder ⇄ DAL → `saveWorkout`.
 *
 * `name` may be `''` because a draft is also what the editor loads for a workout that has no name
 * yet (`workoutPublicId: null`, the `new-workout-empty` fixture). Saving one is refused: the save
 * boundary checks `workoutNameSchema` and answers `invalid`.
 */
export const workoutDraftSchema = z.object({
  programPublicId: uuidSchema,
  workoutClientId: uuidSchema,
  /** `null`: a new workout. */
  workoutPublicId: uuidSchema.nullable(),
  name: workoutNameSchema.or(z.literal('')),
  description: nullableNoteSchema,
  /** In order. */
  items: z.array(workoutDraftItemSchema).max(MAX_WORKOUT_ITEMS),
});
export type WorkoutDraft = z.infer<typeof workoutDraftSchema>;

/** One slot of a weekday: a workout and its optional label. */
const weekSlotSchema = z.object({
  workoutPublicId: uuidSchema,
  label: slotLabelSchema.nullable(),
});

/**
 * A week: for each weekday (0 = Sunday, `WEEKDAYS`), its workouts in the author's order. Every
 * weekday is present; a rest day is `[]`. A workout appears at most once on a day (the writer's
 * check, answered `once_per_day`).
 */
export const weekDaysSchema = z.record(weekdaySchema, z.array(weekSlotSchema));

/** The week editor → `saveWeek`. The full state, in order. */
export const weekDraftSchema = z.object({
  programPublicId: uuidSchema,
  days: weekDaysSchema,
});
export type WeekDraft = z.infer<typeof weekDraftSchema>;

/** The Programs list: each program and the names of the athletes on it. */
export const programListSchema = z.array(
  z.object({
    programPublicId: uuidSchema,
    name: programNameSchema,
    athletes: z.array(athleteLabelSchema).max(MAX_HOUSEHOLD_ATHLETES),
  }),
);
export type ProgramList = z.infer<typeof programListSchema>;

/** The program page, and the data its two dialogs (Put someone on, Copy to…) open with. */
export const programViewSchema = z.object({
  programPublicId: uuidSchema,
  name: programNameSchema,
  /** Who's on it. `lastDay` is set once they were taken off; `alsoOn` names their other programs. */
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
   * already; `keeps` names the programs they are on now, in their own order.
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
      usedOn: z.array(weekdaySchema).max(WEEKDAYS.length),
      /** Where a copied workout came from. The program's name is frozen at copy time. */
      copiedFrom: z.object({ programName: programNameSchema, on: isoDaySchema }).nullable(),
    }),
  ),
  week: weekDaysSchema,
});
export type ProgramView = z.infer<typeof programViewSchema>;

/** Put someone on a program. `from` is today or tomorrow; the action checks it against its own clock. */
export const assignDraftSchema = z.object({
  programPublicId: uuidSchema,
  profilePublicIds: z.array(uuidSchema).min(1).max(MAX_HOUSEHOLD_ATHLETES),
  from: isoDaySchema,
});
export type AssignDraft = z.infer<typeof assignDraftSchema>;

/** Take an athlete off a program, after today. */
export const takeOffSchema = z.object({
  programPublicId: uuidSchema,
  profilePublicId: uuidSchema,
});
export type TakeOff = z.infer<typeof takeOffSchema>;

/** One athlete's programs in the order their day page lists them. The full order, every time. */
export const programOrderSchema = z.object({
  profilePublicId: uuidSchema,
  programPublicIds: z.array(uuidSchema),
});
export type ProgramOrder = z.infer<typeof programOrderSchema>;

/** Copy a workout into a program, optionally onto weekdays. `clientId` is one copy attempt. */
export const copyDraftSchema = z.object({
  clientId: uuidSchema,
  workoutPublicId: uuidSchema,
  toProgramPublicId: uuidSchema,
  weekdays: z.array(weekdaySchema).max(WEEKDAYS.length),
  label: slotLabelSchema.nullable(),
});
export type CopyDraft = z.infer<typeof copyDraftSchema>;
