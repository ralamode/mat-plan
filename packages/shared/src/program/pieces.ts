import { z } from 'zod';

import { TRACKING_TYPES, type TrackingType } from '../movements';
import { PROFILE_NAME_MAX } from '../profiles';
import {
  MAX_WORKOUT_ITEMS,
  PROGRAM_NAME_MAX,
  SLOT_LABEL_MAX,
  TARGET_REPS_MAX,
  WORKOUT_NAME_MAX,
} from '../programming';
import {
  QUANTITY_SLOT,
  QUANTITY_SLOT_CODES,
  quantitySlotSchema,
  type QuantitySlot,
} from '../quantity-slots';
import { numericSetSchema } from '../strength';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { FREE_TEXT_NOTE_MAX, freeTextNoteSchema, hasControlChar } from '../text';
import {
  MAX_STORABLE_QUANTITY,
  UNIT_DIMENSION,
  unitSchema,
  unitsOfDimension,
  type Unit,
  type UnitDimension,
} from '../units';

/**
 * FAM-1's contract, chunk 0a: the pieces every shape in this directory is built from
 * ([plan §4](../../../../docs/plans/fam-1-family-program.md)).
 *
 * The contract is what two lanes must agree on before either exists: the builder and the program
 * writers, the day page and the day writers. **A shape change after chunk 0 goes through the contract
 * owner**, and the lanes reading it wait.
 *
 * Every id is a public id (`uuidSchema`), every day is `isoDaySchema`, and every string is bounded by
 * a named limit. The bounds here are structural (what can be stored); what is plausible or allowed
 * for a given item (a unit's ceiling, a type's fields) is the writers' check, answered as a typed
 * refusal.
 */

const ONE_LINE = 'one line of text, with no control characters';

/**
 * A short text a person typed on one line: trimmed, 1..`max` characters, no control characters.
 *
 * The control-character rule is the one `athleteNameSchema` documents: a NUL passes every length
 * check, reaches Postgres, and `text` rejects it, so the action throws instead of answering.
 */
export function shortTextSchema(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !hasControlChar(v), ONE_LINE);
}

/**
 * The same text where it is optional: `null`, or a blank string, parses to `null`.
 *
 * **Every optional text in the contract is blank-tolerant in this one way** (a label, the reps, a
 * rest, the instructions, a description), so a form can post an empty field as it is and a fake and
 * a real action agree about what "left empty" means.
 */
export function optionalTextSchema(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((v) => !hasControlChar(v), ONE_LINE)
    .nullable()
    .transform((v) => v || null);
}

export const programNameSchema = shortTextSchema(PROGRAM_NAME_MAX);
export const workoutNameSchema = shortTextSchema(WORKOUT_NAME_MAX);
/** A superset's group key: required wherever there is a superset. */
export const supersetGroupSchema = shortTextSchema(SLOT_LABEL_MAX);
/** A week slot's label, or a superset's "rest after" (plan §4). Optional: blank is `null`. */
export const slotLabelSchema = optionalTextSchema(SLOT_LABEL_MAX);
/** A prescription's reps, as text. Optional: blank is `null`. */
export const targetRepsSchema = optionalTextSchema(TARGET_REPS_MAX);
/** An athlete's name as the database holds it: a label on a read, so only its length is checked. */
export const athleteLabelSchema = z.string().min(1).max(PROFILE_NAME_MAX);

/**
 * A workout's description, or an item's instructions: `freeTextNoteSchema`'s rules (trimmed, one
 * line, at most `FREE_TEXT_NOTE_MAX`; plan D4) with "nothing" spelled `null`, because the contract's
 * shapes are read as well as written and a read has no absent keys. Blank is `null`.
 */
export const nullableNoteSchema = freeTextNoteSchema
  .unwrap()
  .nullable()
  .transform((v) => v ?? null);

/**
 * The text a prescription renders to (`prescribedText`, the `./prescribed-text` subpath), live on an
 * item and frozen on a logged row. `''` is a real value: a Check has no prescribed numbers.
 */
export const prescribedTextSchema = z.string().max(FREE_TEXT_NOTE_MAX);

/** A set's number, 1-based. Sets per item share the strength form's limit (plan D5). */
export const setNumberSchema = z.number().int().min(1).max(MAX_SETS_PER_MOVEMENT);

/**
 * A rep count: the strength set's rule (a whole number, 1..1000), read from its one definition.
 * That definition coerces, because it reads a form; this is typed data, so a real number is required
 * first and `true` or `'8'` is refused.
 */
export const repsSchema = z
  .number()
  .refine((v) => numericSetSchema.shape.reps.safeParse(v).success, 'a whole number of reps');

/**
 * A prescription's reps as a number, when they are a whole number in range; else `null`.
 *
 * Reps are text (`10 per side` is legal), and an empty ✓ copies them only when they are a whole
 * number (plan D13). This is that rule, once: the day resolver fills `DayPlan`'s `target.reps` with
 * it and the row writer fills an absent `reps` with it.
 */
export function wholeReps(targetReps: string | null): number | null {
  if (targetReps === null || !/^\d+$/.test(targetReps)) return null;
  const parsed = repsSchema.safeParse(Number(targetReps));
  return parsed.success ? parsed.data : null;
}

/** A quantity's magnitude: what `numeric(8,3)` can store. A unit's own ceiling is the writer's check. */
const quantityValueSchema = z.number().min(0).max(MAX_STORABLE_QUANTITY);

const loggedQuantitySchema = z.object({
  slot: quantitySlotSchema,
  unit: unitSchema,
  value: quantityValueSchema,
});

/** A prescribed quantity. `value: null` means "log in this unit, no target" (plan D2). */
export const prescribedQuantitySchema = z.object({
  slot: quantitySlotSchema,
  unit: unitSchema,
  value: quantityValueSchema.nullable(),
});

/** At most one quantity per slot; the writers refuse a repeated slot. */
const MAX_QUANTITIES = QUANTITY_SLOT_CODES.length;
export const prescribedQuantitiesSchema = z.array(prescribedQuantitySchema).max(MAX_QUANTITIES);

/**
 * What one logged row holds (plan §2, "One logged row"): reps where the type has them, and the
 * quantities. A Check row is `{ quantities: [] }`: done, with nothing measured.
 */
export const rowValuesSchema = z.object({
  reps: repsSchema.optional(),
  quantities: z.array(loggedQuantitySchema).max(MAX_QUANTITIES),
});
export type RowValues = z.infer<typeof rowValuesSchema>;

/**
 * An item's place in a superset, or `null` for an item on its own. One name everywhere: the editor,
 * the writers and the day page all say `{ group, order }`.
 *
 * **`group` is an opaque key**, unique inside its workout. It keys the day page's `restAfter` and is
 * never shown. `order` is the item's 1-based position in the group, as `supersetOrder` is in the
 * strength session.
 *
 * **The letters a screen shows (A1, A2, B1) are ordinal, not the key**: the letter is the order in
 * which each group first appears among the items shown, and the number is the item's position among
 * that group's items shown. So when group `a` is gone and group `b` remains, `b`'s items read A1 and
 * A2, as in the prototype.
 */
export const supersetSchema = z
  .object({
    group: supersetGroupSchema,
    order: z.number().int().min(1).max(MAX_WORKOUT_ITEMS),
  })
  .nullable();
export type Superset = z.infer<typeof supersetSchema>;

/**
 * Plan §2's table as data: for each tracking type, the fields its prescription has and the one
 * quantity a row of it holds. The editor's fields, the writers' pairing check, the day page's inputs
 * and the prescribed text all read this record, so none restates the table.
 *
 * - `sets`: prescribed and logged set by set, with "+ Add set". Otherwise the item is one row.
 * - `reps`: a row holds a rep count, and the prescription has `targetReps`.
 * - `slot`: the slot of the type's quantity, or `null` for none.
 * - `dimensions`: the dimensions that quantity's unit may have. Empty for none.
 * - `unit`: the unit, where the type fixes it; `null` where the prescription names it.
 *
 * ⚠️ A Count takes any measuring unit, and that needs `(primary, count)` in the quantity slots'
 * dimensions and a ceiling for `count`, both of which FAM-1 step 3 adds. `mi` arrives there too.
 */
export const TRACKING_TYPE_FIELDS: Record<
  TrackingType,
  {
    readonly sets: boolean;
    readonly reps: boolean;
    readonly slot: QuantitySlot | null;
    readonly dimensions: readonly UnitDimension[];
    readonly unit: Unit | null;
  }
> = {
  check: { sets: false, reps: false, slot: null, dimensions: [], unit: null },
  count: {
    sets: false,
    reps: false,
    slot: QUANTITY_SLOT.primary,
    dimensions: [
      UNIT_DIMENSION.mass,
      UNIT_DIMENSION.length,
      UNIT_DIMENSION.time,
      UNIT_DIMENSION.count,
    ],
    unit: null,
  },
  reps: { sets: true, reps: true, slot: null, dimensions: [], unit: null },
  weight_reps: {
    sets: true,
    reps: true,
    slot: QUANTITY_SLOT.primary,
    dimensions: [UNIT_DIMENSION.mass],
    unit: null,
  },
  duration: {
    sets: false,
    reps: false,
    slot: QUANTITY_SLOT.primary,
    dimensions: [UNIT_DIMENSION.time],
    unit: 'min',
  },
  time_sets: {
    sets: true,
    reps: false,
    slot: QUANTITY_SLOT.primary,
    dimensions: [UNIT_DIMENSION.time],
    unit: 'sec',
  },
  distance: {
    sets: true,
    reps: false,
    slot: QUANTITY_SLOT.distance,
    dimensions: [UNIT_DIMENSION.length],
    unit: null,
  },
};

/** The units a type's quantity may be in: what the editor's unit select offers (plan D27). */
export function unitsForTrackingType(type: TrackingType): Unit[] {
  const { unit, dimensions } = TRACKING_TYPE_FIELDS[type];
  return unit ? [unit] : dimensions.flatMap(unitsOfDimension);
}

/** The types logged set by set, derived from the record above. */
export const SET_TRACKING_TYPES = TRACKING_TYPES.filter((type) => TRACKING_TYPE_FIELDS[type].sets);

export function hasSetRows(type: TrackingType): boolean {
  return TRACKING_TYPE_FIELDS[type].sets;
}
