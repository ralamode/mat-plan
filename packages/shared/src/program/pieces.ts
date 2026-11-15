import { z } from 'zod';

import { TRACKING_TYPE, type TrackingType } from '../movements';
import { PROFILE_NAME_MAX } from '../profiles';
import {
  MAX_WORKOUT_ITEMS,
  PROGRAM_NAME_MAX,
  SLOT_LABEL_MAX,
  WORKOUT_NAME_MAX,
} from '../programming';
import { QUANTITY_SLOT_CODES, quantitySlotSchema } from '../quantity-slots';
import { numericSetSchema } from '../strength';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { FREE_TEXT_NOTE_MAX, freeTextNoteSchema, hasControlChar } from '../text';
import { MAX_STORABLE_QUANTITY, unitSchema } from '../units';

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
    .refine((v) => !hasControlChar(v), 'one line of text, with no control characters');
}

export const programNameSchema = shortTextSchema(PROGRAM_NAME_MAX);
export const workoutNameSchema = shortTextSchema(WORKOUT_NAME_MAX);
/** A week slot's label, a superset's group name, and a group's "rest after" (plan §4). */
export const slotLabelSchema = shortTextSchema(SLOT_LABEL_MAX);
/** An athlete's name as the database holds it: a label on a read, so only its length is checked. */
export const athleteLabelSchema = z.string().min(1).max(PROFILE_NAME_MAX);

/**
 * A workout's description, or an item's instructions: `freeTextNoteSchema`'s rules (trimmed, one
 * line, at most `FREE_TEXT_NOTE_MAX`; plan D4) with "nothing" spelled `null`, because the contract's
 * shapes are read as well as written and a read has no absent keys.
 */
export const nullableNoteSchema = freeTextNoteSchema
  .unwrap()
  .nullable()
  .transform((v) => v ?? null);

/**
 * The text a prescription renders to (`prescribedText` in `./prescribed-text`), live on an item and
 * frozen on a logged row. `''` is a real value: a Check has no prescribed numbers.
 */
export const prescribedTextSchema = z.string().max(FREE_TEXT_NOTE_MAX);

/** A set's number, 1-based. Sets per item share the strength form's limit (plan D5). */
export const setNumberSchema = z.number().int().min(1).max(MAX_SETS_PER_MOVEMENT);

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
 *
 * `reps` reuses the strength set's rule (a whole number, 1..1000), so the two cannot drift.
 */
export const rowValuesSchema = z.object({
  reps: numericSetSchema.shape.reps.optional(),
  quantities: z.array(loggedQuantitySchema).max(MAX_QUANTITIES),
});
export type RowValues = z.infer<typeof rowValuesSchema>;

/**
 * An item's place in a superset, or `null` for an item on its own. One name everywhere: the editor,
 * the writers and the day page all say `{ group, order }`.
 *
 * `group` names the superset inside its workout and keys the day page's `restAfter`. `order` is the
 * item's 1-based position in the group, as `supersetOrder` is in the strength session.
 */
export const supersetSchema = z
  .object({
    group: slotLabelSchema,
    order: z.number().int().min(1).max(MAX_WORKOUT_ITEMS),
  })
  .nullable();
export type Superset = z.infer<typeof supersetSchema>;

/**
 * The types logged set by set, with "+ Add set" (plan §2, the Rows column). The others are one row.
 * Here because the day page, the day resolver and the prescribed text all ask the same question.
 */
export const SET_TRACKING_TYPES = [
  TRACKING_TYPE.reps,
  TRACKING_TYPE.weight_reps,
  TRACKING_TYPE.time_sets,
  TRACKING_TYPE.distance,
] as const satisfies readonly TrackingType[];

export function hasSetRows(type: TrackingType): boolean {
  return (SET_TRACKING_TYPES as readonly TrackingType[]).includes(type);
}
