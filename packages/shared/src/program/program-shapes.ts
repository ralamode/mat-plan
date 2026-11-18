import { z } from 'zod';

import { isoDaySchema } from '../date';
import { WEEKDAYS, weekdaySchema, type Weekday } from '../day';
import { movementNameKey } from '../movement-search';
import { movementLabelSchema, movementNameSchema, trackingTypeSchema } from '../movements';
import { MAX_HOUSEHOLD_ATHLETES } from '../profiles';
import { MAX_WORKOUT_ITEMS } from '../programming';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { hasControlChar } from '../text';
import {
  athleteLabelSchema,
  fillRowValues,
  hasSetRows,
  itemUnit,
  lowerCaseUuidSchema,
  TRACKING_TYPE_FIELDS,
  nullableNoteSchema,
  prescribedQuantitiesSchema,
  prescribedTarget,
  programNameSchema,
  slotQuantity,
  unitsForTrackingType,
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

/**
 * No two the same. Used where the plan says "once" or "the full order".
 *
 * On a list of ids it compares what `lowerCaseUuidSchema` handed back, so two ids that differ only
 * in case are the same id here, as they are to Postgres (contract change C25).
 */
const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;

/**
 * One item on a workout card. `itemName` and `trackingType` are display: the writer re-reads both
 * from the item the id names.
 *
 * Which fields a type uses is `TRACKING_TYPE_FIELDS` (`./pieces`): `sets` for the set-based types,
 * `targetReps` where a row has reps, one quantity in the type's slot. This schema does not enforce
 * the pairing: `saveWorkoutSchema` enforces the `sets` half on save, and the writer the rest, and
 * answers `invalid`.
 */
export const workoutDraftItemSchema = z.object({
  /**
   * The card's identity, stable across saves and reorders (ADR 0007 Amendment 3, plan D19). **The
   * editor mints it**: one per card when the card is added, and a new one when a card's item is
   * swapped. The writer matches rows by it, and refuses (`invalid`) an id it already knows under a
   * different item.
   */
  prescriptionClientId: lowerCaseUuidSchema,
  itemPublicId: lowerCaseUuidSchema,
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
  programPublicId: lowerCaseUuidSchema,
  /** Minted by the editor when the workout is new; one save attempt replays under it. */
  workoutClientId: lowerCaseUuidSchema,
  /** `null`: a new workout. */
  workoutPublicId: lowerCaseUuidSchema.nullable(),
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

/**
 * `saveWorkout`'s input: the same draft, held to three rules a loaded draft is not.
 *
 * - **A name.** An empty name is refused here.
 * - **The sets rule.** Each item's `sets` is a whole number from 1 to `MAX_SETS_PER_MOVEMENT` when
 *   its tracking type is logged set by set (`TRACKING_TYPE_FIELDS[type].sets`: Reps, Weight × reps,
 *   Time per set, Distance), and `null` when it is not (Check, Count, Duration). A set-based item
 *   with no set count, or a set count on an item that has one row, is refused, with the issue on
 *   that item's `sets` (`['items', index, 'sets']`).
 * - **The unit rule** (contract change C16). An item whose tracking type has a quantity
 *   (`TRACKING_TYPE_FIELDS[type].slot`) logs in a unit: `itemUnit` must find one. A Duration and a
 *   Time per set have a fixed unit, so they pass with no quantity. A Count, a Weight × reps and a
 *   Distance take theirs from the prescription, so each carries a quantity in its type's slot,
 *   with a target or with `value: null` ("log in this unit, no target", plan D2). One with none is
 *   refused, with the issue on that item's `quantities` (`['items', index, 'quantities']`): the row
 *   writer could store no ✓ for it, because `fillRowValues` refuses every number without a unit.
 *   **And the quantity in the type's slot, when there is one, is in a unit the type logs in**
 *   (`unitsForTrackingType`, what the editor's unit select offers; plan D27): a Count in `bool`
 *   stores no ✓, and a Duration prescribed in seconds refuses an empty ✓, since it logs in minutes.
 *   **And a target, when there is one, is a number an empty ✓ can store**: the rule asks
 *   `fillRowValues` itself, which refuses a value over its unit's ceiling (`quantityCeiling`).
 *
 * `workoutDraftSchema` stays tolerant of all three, because the editor loads a draft mid-edit: a card
 * whose type was just chosen has no set count and no unit yet. The rule is checked against the `trackingType`
 * the draft carries, which is display; the writer still re-reads the item's real type and answers
 * `invalid` if the two disagree.
 */
export const saveWorkoutSchema = workoutDraftSchema
  .extend({ name: workoutNameSchema })
  .superRefine((draft, ctx) => {
    draft.items.forEach((item, index) => {
      const setBased = hasSetRows(item.trackingType);
      if (setBased !== (item.sets !== null)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'sets'],
          message: setBased
            ? 'an item logged set by set needs a set count'
            : 'an item logged as one row has no set count',
        });
      }
      // C16. A type with a quantity logs in a unit: its own fixed one (a Duration is minutes) or the
      // one its prescription names in that slot, target or no target. `itemUnit` is the lookup the
      // row writer and the day's read make; with none, `fillRowValues` refuses every number, so
      // the item could be saved and never logged.
      const fields = TRACKING_TYPE_FIELDS[item.trackingType];
      if (fields.slot === null) return;
      const prescribed = slotQuantity(item, item.quantities);
      const unit = itemUnit(item.trackingType, item.quantities);
      if (unit === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'quantities'],
          message: 'an item with a quantity names its unit, even with no target',
        });
      } else if (
        prescribed !== null &&
        !unitsForTrackingType(item.trackingType).includes(prescribed.unit)
      ) {
        // The same end by another road: a Count in `bool` stores no ✓ at all, and a Duration
        // prescribed in seconds refuses an empty ✓, because the item logs in minutes.
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'quantities'],
          message: "an item's quantity is in a unit its type logs in",
        });
      } else if (
        prescribed !== null &&
        prescribed.value !== null &&
        // The writer's own function, asked the writer's own question: would an empty ✓ on this
        // target be stored? Reps are supplied where the type has them, so only the quantity is
        // judged (a target over its unit's ceiling, today); reps text that is not a whole number
        // is legal, and the row then asks for the reps.
        fillRowValues(
          { trackingType: item.trackingType, unit },
          fields.reps ? { reps: 1, quantities: [] } : { quantities: [] },
          prescribedTarget(null, [prescribed]),
        ) === null
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'quantities'],
          message: "an item's target is a number an empty ✓ can store",
        });
      }
    });
  });

/**
 * **How much one household may make** (contract change C35; maintainer, 2026-11-18: "Approve 500 /
 * 50 / 30"). Generous for any family; they stop a runaway script or a bug from filling the
 * database. A write that would pass one answers `limit_reached` and writes nothing.
 *
 * - `MAX_HOUSEHOLD_ITEMS`: the household's own items (movements it made with "+ New item"). The
 *   library's movements do not count.
 * - `MAX_PROGRAM_WORKOUTS`: the workouts of one program, a saved new one and a copy alike.
 * - `MAX_DAY_SLOTS`: the workouts on one weekday of one program's week. `weekDaysSchema` holds it,
 *   so a week past it fails the parse: `weekExceedsDaySlots` tells that from any other failure.
 *
 * **What a cap never refuses:** an edit of a workout that exists, a replay of a create (the same
 * client id answers as the first call did), and `newItem` for a name that already names an item
 * (it selects that item, C8). **For a create the cap is judged before the name**, so a full
 * program says so and nobody renames a workout only to be told the program is full.
 */
export const MAX_HOUSEHOLD_ITEMS = 500;
export const MAX_PROGRAM_WORKOUTS = 50;
export const MAX_DAY_SLOTS = 30;

/** One slot of a weekday: a workout and its optional label. */
const weekSlotSchema = z.object({
  workoutPublicId: lowerCaseUuidSchema,
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
  z
    .array(weekSlotSchema)
    .max(MAX_DAY_SLOTS)
    .refine((slots) => distinct(slots.map((slot) => slot.workoutPublicId)), {
      message: 'a workout runs at most once a day',
    }),
);

/** The week editor → `saveWeek`. The full state, in order. */
export const weekDraftSchema = z.object({
  programPublicId: lowerCaseUuidSchema,
  days: weekDaysSchema,
});
export type WeekDraft = z.infer<typeof weekDraftSchema>;

/**
 * A week with nothing on any day: every weekday present, each `[]` (contract change C26).
 *
 * With no type argument it is a `WeekDraft['days']`, the starting point for a week read or a week
 * editor to fill. **A new object and new arrays on every call**, so a caller may push into it.
 * The type argument is for a week of something other than `WeekDraft`'s slots (the fixtures'
 * prototype world has one).
 */
export function emptyWeek<Slot = WeekDraft['days'][Weekday][number]>(): Record<Weekday, Slot[]> {
  // Written out, so the compiler holds it to every weekday; `shapes.test.ts` holds it to `WEEKDAYS`.
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

/**
 * Whether a week names one workout twice on a day: the question `saveWeek` asks of a draft
 * `weekDraftSchema` REFUSED, to answer `once_per_day` in place of `invalid` (contract change C25).
 *
 * It reads the raw input, because a refused parse hands back no value, so it takes anything and
 * folds the case itself: two slots are the same workout when their `workoutPublicId`s are uuids
 * that differ at most in case. A slot with no id, or with one that is not a uuid, is never a
 * repeat. Any repeat counts, whatever else is wrong with the draft.
 *
 * One definition for the fake and for 6b's writer, so the two answer the same refusal.
 */
/**
 * Whether a week draft has a weekday with more than `MAX_DAY_SLOTS` workouts, which is why its
 * parse failed and why the write answers `limit_reached` and not `invalid` (C35). It reads the raw
 * input, as `weekRepeatsAWorkout` does and for the same reason. **A repeat wins**: a week that
 * names a workout twice on a day is `once_per_day` whatever else is wrong, so ask that first.
 *
 * One definition for the fake, the writer and the action, so the three answer alike.
 */
export function weekExceedsDaySlots(draft: unknown): boolean {
  const days: unknown = (draft as { days?: unknown } | null | undefined)?.days;
  if (!days || typeof days !== 'object') return false;
  return Object.values(days).some((slots) => Array.isArray(slots) && slots.length > MAX_DAY_SLOTS);
}

export function weekRepeatsAWorkout(draft: unknown): boolean {
  const days: unknown = (draft as { days?: unknown } | null | undefined)?.days;
  if (!days || typeof days !== 'object') return false;
  return Object.values(days).some((slots) => {
    if (!Array.isArray(slots)) return false;
    const ids = slots.flatMap((slot: unknown) => {
      const id = lowerCaseUuidSchema.safeParse(
        (slot as { workoutPublicId?: unknown } | null | undefined)?.workoutPublicId,
      );
      return id.success ? [id.data] : [];
    });
    return !distinct(ids);
  });
}

/** A program, by id and name: one entry of a list a person picks from. */
export const programRefSchema = z.object({
  programPublicId: lowerCaseUuidSchema,
  name: programNameSchema,
});

/** The Programs list: each program, in the household's order, and the athletes on it. */
export const programListSchema = z.array(
  programRefSchema.extend({
    athletes: z.array(athleteLabelSchema).max(MAX_HOUSEHOLD_ATHLETES),
  }),
);
export type ProgramList = z.infer<typeof programListSchema>;
/** One program of the Programs list: what a screen is handed when it is given a single entry. */
export type ProgramListEntry = ProgramList[number];

/** The program page, and the data its two dialogs (Put someone on, Copy to…) open with. */
export const programViewSchema = z
  .object({
    programPublicId: lowerCaseUuidSchema,
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
        profilePublicId: lowerCaseUuidSchema,
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
        profilePublicId: lowerCaseUuidSchema,
        name: athleteLabelSchema,
        on: z.boolean(),
        keeps: z.array(programNameSchema),
      }),
    ),
    workouts: z.array(
      z.object({
        workoutPublicId: lowerCaseUuidSchema,
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
 * One rule, three readers: the page's "since" or "starts" wording, the first half of what Take off
 * does (someone who has not started simply leaves), and the preview's fake. Both days are
 * `isoDaySchema` text, which sorts as the calendar does.
 *
 * ⚠️ **"Started" does not by itself mean Take off keeps them through today.** A start dated today
 * with nothing logged under it is undone by Take off as well (`takeOffSchema`); read what Take off
 * did from its answer, not from this.
 */
export function hasStarted(athlete: { since: string }, today: string): boolean {
  return athlete.since <= today;
}

/**
 * `createProgram`'s input. **A program is created by naming it**: there is no unnamed program on the
 * server. `clientId` is one create attempt; a retry reuses it.
 */
export const createProgramSchema = z.object({
  clientId: lowerCaseUuidSchema,
  name: programNameSchema,
});
export type CreateProgram = z.infer<typeof createProgramSchema>;

/** `renameProgram`'s input. */
export const renameProgramSchema = z.object({
  programPublicId: lowerCaseUuidSchema,
  name: programNameSchema,
});
export type RenameProgram = z.infer<typeof renameProgramSchema>;

/**
 * `newItem`'s input: a name a person typed (`movementNameSchema`'s rules) and its type.
 *
 * `movementNameSchema` refuses a comma and a line break but not the other control characters, and a
 * NUL that reaches Postgres makes the action throw instead of answering `invalid`; so this refuses
 * them too (`control-chars.test.ts` holds every typed text in the write schemas to that).
 *
 * **A name must have a key** (`movementNameKey`, the "same movement" rule): `S` and `s s` have a
 * letter, so `movementNameSchema` takes them, but the fold drops a lone `s` and their key is empty.
 * A name with no key can be matched to no item (`existingItem`), so nothing in this contract would
 * stop it being added twice; it answers `invalid` instead (contract change C8).
 */
/**
 * What `newItemSchema` says about a name, where `movementNameSchema`'s own messages do not cover
 * it. A form shows a schema's message under the field, so these are sentences for a person.
 */
export const NEW_ITEM_NAME_MESSAGES = {
  /**
   * The name has no key: nothing the "same movement" rule can match on. Only a name made of the
   * letter `s` alone reaches this (`S`, `s s`); a name with no letter is refused earlier by
   * `movementNameSchema`. So the sentence must not ask for a letter: the person typed one.
   * Wording chosen by the maintainer, 2026-11-16.
   */
  noKey: 'Give the item a longer name.',
} as const;

export const newItemSchema = z.object({
  name: movementNameSchema
    .refine((v) => !hasControlChar(v), { message: 'a name has no control characters' })
    .refine((v) => movementNameKey(v) !== '', { message: NEW_ITEM_NAME_MESSAGES.noKey }),
  trackingType: trackingTypeSchema,
});
export type NewItem = z.infer<typeof newItemSchema>;

/**
 * Put someone on a program. `from` is today or tomorrow; the action checks it against its own clock.
 *
 * **Someone already on it is skipped, with one exception: an athlete whose last day is today**
 * (Take off was tapped). Putting them on undoes the Take off: their last day is cleared and they
 * stay on with no gap, one stretch, whatever `from` says (maintainer, 2026-11-16). So the dialog
 * lists such an athlete as available, marked "last day today"; it finds them by joining
 * `candidates` (where they are still `on`) with `athletes` (where `lastDay` is set).
 */
export const assignDraftSchema = z.object({
  programPublicId: lowerCaseUuidSchema,
  profilePublicIds: z
    .array(lowerCaseUuidSchema)
    .min(1)
    .max(MAX_HOUSEHOLD_ATHLETES)
    .refine(distinct),
  from: isoDaySchema,
});
export type AssignDraft = z.infer<typeof assignDraftSchema>;

/**
 * Take an athlete off a program. What it does depends on where their start stands:
 *
 * - **Not started** (`since` after today): the start is removed. They were never on it.
 * - **Started today, nothing logged under it yet**: the start is removed too, as if Put on had not
 *   been tapped (maintainer, 2026-11-16: a same-day Put on is undoable). "Nothing logged" means no
 *   live row of that athlete today in a workout of this program; a row ticked and un-ticked does
 *   not count.
 * - **Otherwise**: they stay on through today, and today is their last day.
 *
 * The answer says which: `lastDay` is today, or `null` when the start was removed.
 */
export const takeOffSchema = z.object({
  programPublicId: lowerCaseUuidSchema,
  profilePublicId: lowerCaseUuidSchema,
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
  profilePublicId: lowerCaseUuidSchema,
  programPublicIds: z.array(lowerCaseUuidSchema).min(1).refine(distinct, {
    message: 'each program once',
  }),
});
export type ProgramOrder = z.infer<typeof programOrderSchema>;

/**
 * Copy a workout into a program, optionally onto weekdays. `clientId` is one copy attempt.
 *
 * **`name` is the copy's name, when the person gave one** (maintainer, 2026-11-16). A copy into the
 * workout's own program always needs a different name, so the dialog shows a Name field there,
 * prefilled with `copyName(name)` (`./pieces`: the name and " (copy)", cut to fit). Left out, the
 * copy takes that default in its own program and the workout's own name in another.
 * ⚠️ Unlike the contract's other optional texts, a blank `name` is NOT "left out": it is `invalid`.
 * A Name field the person emptied must not quietly fall back to the default; leave the key out to
 * ask for the default. **A name already used in the program it is copied
 * into answers `name_taken`, in any program** (maintainer, 2026-11-16: never two workouts with one
 * name). The dialog then shows the Name field, prefilled with the name and " (copy)", and the
 * person copies again; it needs no list of the other program's workouts to do that.
 */
export const copyDraftSchema = z.object({
  clientId: lowerCaseUuidSchema,
  workoutPublicId: lowerCaseUuidSchema,
  toProgramPublicId: lowerCaseUuidSchema,
  name: workoutNameSchema.optional(),
  weekdays: z.array(weekdaySchema).max(WEEKDAYS.length).refine(distinct),
  label: slotLabelSchema,
});
export type CopyDraft = z.infer<typeof copyDraftSchema>;
