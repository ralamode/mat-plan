import { z } from 'zod';

import { isoDaySchema } from '../date';
import { keyBySelf } from '../enums';
import { hiddenAtSchema } from '../hide';
import { uuidSchema } from '../id';
import { movementLabelSchema, trackingTypeSchema } from '../movements';
import { MAX_HOUSEHOLD_ATHLETES } from '../profiles';
import { SLOT_LABEL_MAX } from '../programming';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { unitSchema } from '../units';
import {
  athleteLabelSchema,
  nullableNoteSchema,
  prescribedQuantitiesSchema,
  prescribedTextSchema,
  repsSchema,
  rowValuesSchema,
  setNumberSchema,
  shortTextSchema,
  slotLabelSchema,
  supersetGroupSchema,
  supersetSchema,
  workoutNameSchema,
} from './pieces';
import { programRefSchema } from './program-shapes';

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
   * PREVIOUS: what this athlete last logged for **the same item and the same set number**, on the
   * most recent day before this one that has such a row. It is the item's history, whichever
   * workout or program logged it, and it counts only rows logged in a program (rows with a
   * prescription), never old strength entries.
   *
   * **Tie-break:** when that day holds two such rows (one item in two workouts), the row logged
   * first (the earlier `created_at`, then the lower id).
   *
   * `null` when there is none; always `null` on a day that is not writable (the page shows no
   * "last time" there); and always `null` on a row whose prescription was removed.
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
  /** For display. The numbers a screen works with are `target`. */
  prescribedText: prescribedTextSchema,
  /**
   * The prescribed numbers: what a row's empty fields show as placeholders, and what an empty ✓
   * logs (plan D13). `reps` is the prescription's reps when they are a whole number, else `null`
   * (the row then asks for reps). A quantity's `value: null` means "log in this unit, no target".
   * An item whose prescription was removed has none: `{ reps: null, quantities: [] }`.
   */
  target: z.object({ reps: repsSchema.nullable(), quantities: prescribedQuantitiesSchema }),
  notes: nullableNoteSchema,
  /** The unit the item logs in; `null` for a Check and for Reps. */
  unit: unitSchema.nullable(),
  superset: supersetSchema,
  /**
   * The rows the page shows, in set order. A writable day: every prescribed set, plus any logged
   * beyond them. A closed day, or a workout that left the week: the logged rows only. A future day:
   * none. **An added set is a row only while it is logged**: un-ticked, it is gone from the next
   * read, so the set numbers may have a gap.
   */
  rows: z.array(dayRowSchema).max(MAX_SETS_PER_MOVEMENT),
});

const dayWorkoutSchema = z.object({
  /** Both ids are `null` once the program or the workout is purged; the frozen `name` remains. */
  programPublicId: uuidSchema.nullable(),
  workoutPublicId: uuidSchema.nullable(),
  label: slotLabelSchema,
  name: workoutNameSchema,
  description: nullableNoteSchema,
  /** `false`: logged on this day, but no longer on the week. It shows its logged rows only. */
  scheduled: z.boolean(),
  /**
   * "6 of 10": `done` is the logged rows, `total` the prescribed rows plus any logged beyond them,
   * over the workout's live items. It counts the whole workout even where `items` shows only what
   * was logged, so a closed day can still say how much of the workout was done. Rows logged against
   * a removed prescription are in neither number.
   */
  progress: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }),
  /**
   * In the workout's order, then any item whose prescription was removed. **Where only logged rows
   * show (a closed day, a workout that left the week), an item with no logged row is absent.**
   */
  items: z.array(dayItemSchema),
  /** A superset's rest, keyed by its `group`. Only for a group that has an item in `items`. */
  restAfter: z.record(supersetGroupSchema, shortTextSchema(SLOT_LABEL_MAX)),
});

/**
 * One athlete's day: day resolver + DAL → the day screen.
 *
 * `workouts` is in the page's order: the athlete's program order, then each program's week order
 * (plan D8; a label never sorts), then any workout that left the week. **On a closed day a workout
 * with no logged row is absent**; a writable or future day lists every scheduled workout.
 * Bodyweight, Life and the "Day cleared" banner are not here: they are lane S's own sections,
 * composed beside the day screen.
 */
export const dayPlanSchema = z.object({
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  /** The athlete's today, set by the DAL, so the screen can say Today, Yesterday or Tomorrow. */
  today: isoDaySchema,
  /** Set by the DAL. `writable` is today or yesterday only; a future day never is (plan D32). */
  writable: z.boolean(),
  future: z.boolean(),
  /** The household's live athletes, for the switcher. */
  athletes: z
    .array(z.object({ profilePublicId: uuidSchema, name: athleteLabelSchema }))
    .max(MAX_HOUSEHOLD_ATHLETES),
  onProgram: onProgramSchema,
  /** Look-ahead goes forward only while the athlete is on a program the next day. */
  canGoForward: z.boolean(),
  /**
   * The athlete's CURRENT programs, in their own order: every program they are on now or start
   * later, whatever the viewed day. This is the list the Program order dialog shows and
   * `ProgramOrder` must be a permutation of.
   */
  currentPrograms: z.array(programRefSchema),
  /**
   * The programs the athlete is on THIS day, in the order the page lists them. `order` is the
   * program's index in `currentPrograms`; `null` for a program they have since come off, which
   * sorts after the current ones.
   */
  programs: z.array(programRefSchema.extend({ order: z.number().int().min(0).nullable() })),
  workouts: z.array(dayWorkoutSchema),
});
export type DayPlan = z.infer<typeof dayPlanSchema>;

/**
 * The parts of a day, by name: one of `DayPlan.workouts`, one of its `items`, one of an item's
 * `rows`. Derived from the schemas above, so they are `DayPlan['workouts'][number]` and so on;
 * import these rather than re-deriving them.
 */
export type DayWorkout = z.infer<typeof dayWorkoutSchema>;
export type DayItem = z.infer<typeof dayItemSchema>;
export type DayRow = z.infer<typeof dayRowSchema>;

/**
 * ✓ on a row. **`clientId` is one ✓ attempt**: a retry reuses it; a ✓ after an un-tick mints a new
 * one, because the old one answers `own_hidden` forever.
 *
 * **`values` holds what was typed. An absent `reps`, or a slot with no quantity, means "the
 * prescription's"** (plan D13): the writer fills it from the row's prescription, and answers
 * `bad_value` where the prescription has no number to give. So an empty ✓ on a prescribed row sends
 * `{ quantities: [] }`, and the result's `values` says what was written.
 *
 * **`set` is a prescribed set, or an added one: at most ONE past the highest set the item shows.** A
 * set further on would need a row nobody logged, and the read lists an added set only while it is
 * logged (`dayItemSchema.rows`), so the writer answers it `bad_value`. An un-ticked added set leaves
 * a gap in the numbers; that number may be logged again. Only a type with set rows
 * (`hasSetRows`) has a set past 1.
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

/**
 * Un-tick: hides the entry, and answers with its `hiddenAt` token. `day` is the entry's day; the
 * writer holds it to the writable window, so a crafted request for an older or a future day answers
 * `closed_day`, and one naming an entry that is not this athlete's on that day answers `not_found`.
 */
export const rowUntickSchema = z.object({
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  entryPublicId: uuidSchema,
});
export type RowUntick = z.infer<typeof rowUntickSchema>;

/** Re-tick in the same page visit: restores the entry hidden under this token. Bounded as un-tick is. */
export const rowRetickSchema = z.object({
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  entryPublicId: uuidSchema,
  hiddenAt: hiddenAtSchema,
});
export type RowRetick = z.infer<typeof rowRetickSchema>;

/**
 * Change a logged row's numbers in place. The writable window is taken from the entry's own day.
 *
 * **`values` holds every number the row's tracking type has** (`TRACKING_TYPE_FIELDS`): the reps
 * where the type has reps, and the one quantity in the type's slot, in the unit the item logs in.
 * Unlike `RowWrite`, nothing is filled in from the prescription: a field left out is a blank, and a
 * blank answers `bad_value` and keeps the number that is there (plan §8, "Change keeps the old
 * number if the new one is blank or not a number").
 *
 * ⚠️ **The writer enforces this, not the schema.** Which fields are required depends on the item's
 * tracking type, and this input names an entry, not an item: only the writer, which reads the
 * entry, knows the type. The schema checks that each number given is a number in range.
 */
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
  'not_found',
  'retry',
] as const;
export type RowRefusal = (typeof ROW_REFUSALS)[number];
export const rowRefusalSchema = z.enum(ROW_REFUSALS);
export const ROW_REFUSAL = keyBySelf(ROW_REFUSALS);

/**
 * What every row write resolves to. `values` is the row as it is now stored, with the prescription's
 * numbers filled in where the write left them out. `hiddenAt` is set by an un-tick.
 */
export const rowResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    entryPublicId: uuidSchema,
    values: rowValuesSchema,
    hiddenAt: hiddenAtSchema.optional(),
  }),
  z.object({ ok: z.literal(false), reason: rowRefusalSchema }),
]);
export type RowResult = z.infer<typeof rowResultSchema>;
