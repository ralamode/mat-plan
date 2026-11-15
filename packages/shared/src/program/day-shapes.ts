import { z } from 'zod';

import { isoDaySchema } from '../date';
import { keyBySelf } from '../enums';
import { hiddenAtSchema } from '../hide';
import { uuidSchema } from '../id';
import { movementLabelSchema, trackingTypeSchema } from '../movements';
import { MAX_HOUSEHOLD_ATHLETES } from '../profiles';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { unitSchema } from '../units';
import {
  athleteLabelSchema,
  nullableNoteSchema,
  prescribedTextSchema,
  programNameSchema,
  rowValuesSchema,
  setNumberSchema,
  slotLabelSchema,
  supersetSchema,
  workoutNameSchema,
} from './pieces';

/**
 * The day page's shapes (FAM-1 plan §4): the day's workouts as the page shows them, and the row
 * writes. Lane C's screen and lane E's resolver and writers meet here.
 */

/**
 * Whether the athlete is on a program on the viewed day: `yes`; `not-this-day` (they are on one now,
 * but were not on this day: "Not on a program on this day"); `never` ("Not on a program yet").
 */
export const ON_PROGRAM_STATES = ['yes', 'not-this-day', 'never'] as const;
export type OnProgram = (typeof ON_PROGRAM_STATES)[number];
export const onProgramSchema = z.enum(ON_PROGRAM_STATES);
export const ON_PROGRAM = keyBySelf(ON_PROGRAM_STATES);

/** One row of an item: a set, or the single row of a Check, Count or Duration. */
const dayRowSchema = z.object({
  set: setNumberSchema,
  /**
   * The same item and set number on the most recent earlier day, from rows logged in a program.
   * `null` when there is none, and always `null` on a row whose prescription was removed.
   */
  previous: rowValuesSchema.nullable(),
  /** `prescribedText` here is what the row was logged against, frozen (plan D7). */
  logged: z
    .object({
      entryPublicId: uuidSchema,
      values: rowValuesSchema,
      prescribedText: prescribedTextSchema,
    })
    .nullable(),
});

const dayItemSchema = z.object({
  /** `null`: a logged row whose prescription has since been removed. Such an item has no `notes`. */
  prescriptionPublicId: uuidSchema.nullable(),
  itemPublicId: uuidSchema,
  name: movementLabelSchema,
  trackingType: trackingTypeSchema,
  prescribedText: prescribedTextSchema,
  notes: nullableNoteSchema,
  /** The unit the item logs in; `null` for a Check and for Reps. */
  unit: unitSchema.nullable(),
  superset: supersetSchema,
  /**
   * The rows the page shows. A writable day: every prescribed set, plus any logged beyond them. A
   * closed day: the logged rows only. A future day: none.
   */
  rows: z.array(dayRowSchema).max(MAX_SETS_PER_MOVEMENT),
});

const dayWorkoutSchema = z.object({
  /** Both ids are `null` once the program or the workout is purged; the frozen `name` remains. */
  programPublicId: uuidSchema.nullable(),
  workoutPublicId: uuidSchema.nullable(),
  label: slotLabelSchema.nullable(),
  name: workoutNameSchema,
  description: nullableNoteSchema,
  /** `false`: logged on this day, but no longer on the week. It shows its logged rows only. */
  scheduled: z.boolean(),
  items: z.array(dayItemSchema),
  /** A superset's rest, keyed by its `group`. */
  restAfter: z.record(slotLabelSchema, slotLabelSchema),
});

/**
 * One athlete's day: day resolver + DAL → the day screen.
 *
 * `workouts` is in the page's order: the athlete's program order, then each program's week order
 * (plan D8; a label never sorts), then any workout that left the week. Bodyweight, Life and the "Day
 * cleared" banner are not here: they are lane S's own sections, composed beside the day screen.
 */
export const dayPlanSchema = z.object({
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  /** Set by the DAL. `writable` is today or yesterday only (plan D32). */
  writable: z.boolean(),
  future: z.boolean(),
  /** The household's live athletes, for the switcher. */
  athletes: z
    .array(z.object({ profilePublicId: uuidSchema, name: athleteLabelSchema }))
    .max(MAX_HOUSEHOLD_ATHLETES),
  onProgram: onProgramSchema,
  /** Look-ahead goes forward only while the athlete is on a program the next day. */
  canGoForward: z.boolean(),
  /** The programs the athlete is on this day. `order` is the 0-based place in their own order. */
  programs: z.array(
    z.object({
      programPublicId: uuidSchema,
      name: programNameSchema,
      order: z.number().int().min(0),
    }),
  ),
  workouts: z.array(dayWorkoutSchema),
});
export type DayPlan = z.infer<typeof dayPlanSchema>;

/**
 * ✓ on a row. **`clientId` is one ✓ attempt**: a retry reuses it; a ✓ after an un-tick mints a new
 * one, because the old one answers `own_hidden` forever.
 */
export const rowWriteSchema = z.object({
  clientId: uuidSchema,
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  workoutPublicId: uuidSchema,
  prescriptionPublicId: uuidSchema,
  set: setNumberSchema,
  values: rowValuesSchema,
});
export type RowWrite = z.infer<typeof rowWriteSchema>;

/** Un-tick: hides the entry, and answers with its `hiddenAt` token. */
export const rowUntickSchema = z.object({
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  entryPublicId: uuidSchema,
});
export type RowUntick = z.infer<typeof rowUntickSchema>;

/** Re-tick in the same page visit: restores the entry hidden under this token. */
export const rowRetickSchema = z.object({
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  entryPublicId: uuidSchema,
  hiddenAt: hiddenAtSchema,
});
export type RowRetick = z.infer<typeof rowRetickSchema>;

/** Change a logged row's numbers in place. The writable window is taken from the entry's own day. */
export const rowAmendSchema = z.object({
  profilePublicId: uuidSchema,
  entryPublicId: uuidSchema,
  values: rowValuesSchema,
});
export type RowAmend = z.infer<typeof rowAmendSchema>;

/** Why a row write did not happen. Typed, never thrown. */
export const ROW_REFUSALS = [
  'program_changed',
  'not_scheduled',
  'closed_day',
  'bad_value',
  'slot_taken',
  'own_hidden',
  'retry',
] as const;
export type RowRefusal = (typeof ROW_REFUSALS)[number];
export const rowRefusalSchema = z.enum(ROW_REFUSALS);
export const ROW_REFUSAL = keyBySelf(ROW_REFUSALS);

/** What every row write resolves to. `hiddenAt` is set by an un-tick. */
export const rowResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    entryPublicId: uuidSchema,
    hiddenAt: hiddenAtSchema.optional(),
  }),
  z.object({ ok: z.literal(false), reason: rowRefusalSchema }),
]);
export type RowResult = z.infer<typeof rowResultSchema>;
