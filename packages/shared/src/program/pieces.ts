import { z } from 'zod';

import { matchMovementOptions, type MatchableMovement } from '../movement-search';
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
import { foldName, FREE_TEXT_NOTE_MAX, freeTextNoteSchema, hasControlChar } from '../text';
import {
  isWholeNumber,
  MAX_STORABLE_QUANTITY,
  quantityCeiling,
  type Unit,
  UNIT_DIMENSION,
  type UnitDimension,
  unitSchema,
  unitsOfDimension,
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
 * A required name must fold to something (`foldName`): a name made only of zero-width or format
 * characters (zero-width spaces and joiners, direction marks, variation selectors), or only of
 * combining marks, is one character long, so `min(1)` takes it, and it would show as a blank line
 * in every list. Found by FAM-1 step 6a's review; contract change C12.
 *
 * ⚠️ Not a promise that a name can be seen. A few characters that draw as blank are letters or
 * symbols to Unicode and still pass: the braille blank (U+2800), the Hangul fillers (U+3164,
 * U+115F, U+1160, U+FFA0) and the object replacement character (U+FFFC). Closing those means
 * stripping them in `foldName`, which every name in the app shares, so it is not done here.
 */
const SOMETHING_TO_READ = 'a name needs more than invisible characters';

/**
 * A short text a person typed on one line: trimmed, 1..`max` characters, no control characters,
 * and not made only of zero-width, format or combining characters (`SOMETHING_TO_READ`).
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
    .refine((v) => !hasControlChar(v), ONE_LINE)
    .refine((v) => foldName(v) !== '', SOMETHING_TO_READ);
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
 * line, no control characters, at most `FREE_TEXT_NOTE_MAX`; plan D4) with "nothing" spelled `null`, because the contract's
 * shapes are read as well as written and a read has no absent keys. Blank is `null`.
 */
export const nullableNoteSchema = freeTextNoteSchema
  .unwrap()
  // `freeTextNoteSchema` refuses a line break only (its CSV rule). A NUL or another control
  // character would reach Postgres, which refuses it, and the action would throw instead of
  // answering `invalid`; so the contract refuses those here, as `shortTextSchema` does.
  .refine((v) => v === undefined || !hasControlChar(v), ONE_LINE)
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
  if (targetReps === null || !isWholeNumber(targetReps)) return null;
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
 * A2, as in the prototype. `supersetLabels` below is that rule; a screen calls it and writes none.
 */
export const supersetSchema = z
  .object({
    group: supersetGroupSchema,
    order: z.number().int().min(1).max(MAX_WORKOUT_ITEMS),
  })
  .nullable();
export type Superset = z.infer<typeof supersetSchema>;

/** The `n`th superset letter, from 0: A … Z, then AA, AB … (as spreadsheet columns are named). */
function supersetLetter(n: number): string {
  let letters = '';
  for (let rest = n; rest >= 0; rest = Math.floor(rest / 26) - 1) {
    letters = String.fromCharCode(65 + (rest % 26)) + letters;
  }
  return letters;
}

/**
 * The label each item shows for its superset (`A1`, `A2`, `B1`), in the items' order: a parallel
 * array, `null` for an item on its own. The rule above, once, for the editor and the day page.
 *
 * - **The letter is ordinal**: A for the first group to appear among `items`, B for the next. The
 *   `group` key is opaque and never shown, so a group keyed `b` reads A when no group comes before
 *   it.
 * - **The number is the item's place among that group's items in `items`**, counted from 1. It is
 *   NOT `superset.order`: where a day shows only some of a group (a closed day lists logged items
 *   only), the one item shown reads `A1` even if its `order` is 2.
 * - Pass the items a screen SHOWS, in the order it shows them: the labels are of that list.
 *
 * Total, and it never throws. It labels what it is given and does not judge it: a group of one
 * reads `A1`, and a group whose items are not neighbours keeps one letter. After Z the letters go
 * on as AA, AB. A saved workout cannot get there (`MAX_WORKOUT_ITEMS` is 30, and a group has at
 * least two items, so at most 15 groups); only a draft with more than 26 groups of one can.
 */
export function supersetLabels(items: readonly { superset: Superset }[]): (string | null)[] {
  const letters = new Map<string, string>();
  const places = new Map<string, number>();
  return items.map(({ superset }) => {
    if (!superset) return null;
    const { group } = superset;
    if (!letters.has(group)) letters.set(group, supersetLetter(letters.size));
    const place = (places.get(group) ?? 0) + 1;
    places.set(group, place);
    return `${letters.get(group)}${place}`;
  });
}

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

/**
 * The tracking type's quantity out of a list of quantities: the one in the type's slot
 * (`TRACKING_TYPE_FIELDS[type].slot`), or `null` when the list has none or the type holds none (a
 * Check, Reps).
 *
 * One lookup for a prescription's quantities, a row's logged values and a row's PREVIOUS: the
 * prescribed text, the fakes and the day screen all read it. It takes anything that carries a
 * `trackingType` (a `DayItem`, a `WorkoutDraftItem`), so a caller passes the item it has.
 *
 * It returns the quantity as it is: a prescribed one may still have `value: null` ("log in this
 * unit, no target").
 */
export function slotQuantity<Q extends { slot: string }>(
  of: { trackingType: TrackingType },
  quantities: readonly Q[],
): Q | null {
  const { slot } = TRACKING_TYPE_FIELDS[of.trackingType];
  return quantities.find((q) => q.slot === slot) ?? null;
}

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

/**
 * The item a typed name already names, or `undefined`: **the one definition of "this item exists"
 * for `newItem`**. The preview's fake reads it, and the real writer will (plan step 6a).
 *
 * It is the picker's own rule (`matchMovementOptions`), not a second one: the name's key equals an
 * item's key (`movementNameKey`: `push ups`, `Push-Ups` and `pushups` are one item), or equals the
 * key of one of an item's aliases (`RDL`, `rdl`). Those are exactly the two cases in which the
 * picker withholds "add as new", so the server and the picker cannot disagree about a duplicate.
 *
 * When more than one item qualifies (a household item named `RDL` made before this rule, beside
 * the catalog's Romanian Deadlift), the first in the picker's order is the answer: a catalog item
 * before a household one, then by name. 🔴 **So `isCatalog` is required here**, where the picker's
 * own type leaves it optional: an option list passed without it would compile and silently pick by
 * name alone, and the server would then select a different item than the picker offers. A caller
 * holding `MovementOptionDTO`s maps `owner === 'catalog'` to it, as the picker does.
 *
 * ⚠️ `options` must be every item the household can pick, with each catalog item's `aliases`. An
 * item left out can be duplicated; an alias left out is not honoured.
 *
 * ⚠️ A name whose key is empty (`S`, `s s`: the fold drops a lone `s`) matches nothing, here and in
 * the picker. `newItemSchema` refuses such a name, so `newItem` never reaches this with one.
 */
export function existingItem<T extends MatchableMovement & { readonly isCatalog: boolean }>(
  options: readonly T[],
  name: string,
): T | undefined {
  const { matches, exact, aliasHit } = matchMovementOptions(options, name);
  return exact || aliasHit !== null ? matches[0] : undefined;
}

/** The prescribed numbers of one item, as a `DayItem` carries them in `target`. */
export type PrescribedTarget = {
  reps: number | null;
  quantities: z.infer<typeof prescribedQuantitiesSchema>;
};

/**
 * A prescription's numbers as a row can use them: the one way `DayItem.target` is built (contract
 * change C10). The day's read builds each item's `target` with it and the row writer builds the
 * target an empty ✓ is filled from, so the placeholder a row shows and the number an empty ✓
 * stores cannot differ.
 *
 * - `reps` is the prescription's reps when they are a whole number (`wholeReps`), else `null`: the
 *   row then asks for reps.
 * - **A range has no number to accept.** A quantity whose `valueMax` is set becomes `value: null`,
 *   the same as "log in this unit, no target": the row shows no number and an empty ✓ answers
 *   `bad_value`. Any `valueMax` makes it a range, one equal to `value` included: the rule reads the
 *   column, not the arithmetic. No FAM-1 screen can write a range (`saveWorkoutSchema` holds one value); the rule
 *   is here so a row that has one is not logged at its low end without anyone typing it.
 *
 * Numbers, not the database's numeric strings: the caller converts.
 */
export function prescribedTarget(
  targetReps: string | null,
  quantities: readonly {
    slot: QuantitySlot;
    unit: Unit;
    value: number | null;
    valueMax?: number | null;
  }[],
): PrescribedTarget {
  return {
    reps: wholeReps(targetReps),
    quantities: quantities.map(({ slot, unit, value, valueMax }) => ({
      slot,
      unit,
      value: valueMax === null || valueMax === undefined ? value : null,
    })),
  };
}

/**
 * What a row stores, for an item of this type: **the one value-fill rule** (contract change C10),
 * for the row writer, the amend writer and the preview's fake. `null` means `bad_value`.
 *
 * The reps where the type has them and the one quantity in the type's slot, each as typed, else
 * from `target` (plan D13: an empty ✓ on a prescribed row logs the prescription). An amend passes
 * `target: null`, so nothing is filled and a field left out is refused.
 *
 * Refused, never dropped or repaired:
 * - a number the type has no field for (reps on a Duration, a distance on a weight);
 * - **a slot named twice** in what was typed (which of the two to keep is not ours to choose);
 * - a number that is missing and that `target` cannot supply;
 * - a quantity in another unit than the item logs in (`item.unit`);
 * - **a value over the unit's ceiling** (`quantityCeiling`), or in a unit that has none.
 *
 * It does not check that `typed` is well formed: parse with `rowWriteSchema` or `rowAmendSchema`
 * first (reps and each value are then numbers in the storable range).
 */
export function fillRowValues(
  item: { trackingType: TrackingType; unit: Unit | null },
  typed: RowValues,
  target: PrescribedTarget | null,
): RowValues | null {
  const fields = TRACKING_TYPE_FIELDS[item.trackingType];
  if (typed.reps !== undefined && !fields.reps) return null;
  if (typed.quantities.some((q) => q.slot !== fields.slot)) return null;
  if (typed.quantities.length > 1) return null; // every one is in the type's slot: a repeat
  const values: RowValues = { quantities: [] };
  if (fields.reps) {
    const reps = typed.reps ?? target?.reps ?? null;
    if (reps === null) return null;
    values.reps = reps;
  }
  if (fields.slot) {
    const prescribed = target ? slotQuantity(item, target.quantities) : null;
    const quantity =
      slotQuantity(item, typed.quantities) ??
      (prescribed && prescribed.value !== null ? { ...prescribed, value: prescribed.value } : null);
    if (!quantity || quantity.unit !== item.unit) return null;
    // ⚠️ `undefined` is "no ceiling known", which refuses: `n > undefined` is false in JS.
    const ceiling = quantityCeiling(quantity.unit);
    if (ceiling === undefined || quantity.value > ceiling) return null;
    values.quantities.push(quantity);
  }
  return values;
}

/**
 * The unit an item logs in, which is `DayItem.unit`: `null` for a type with no quantity (a Check,
 * Reps); the type's fixed unit where it has one (a Duration is minutes, Time per set seconds); else
 * the unit its prescription names in the type's slot, or `null` when the prescription has no
 * quantity there.
 *
 * **One definition for the day's read and the row writer** (contract change C13, from step 11b's
 * review). `fillRowValues` refuses a quantity in another unit than the item's, so if the page's
 * `DayItem.unit` and the writer's idea of the unit ever differed, a correctly typed number would
 * answer `bad_value`.
 *
 * The fixed unit comes first, as in `entryUnitFor`: a Duration is minutes whatever its
 * prescription row says.
 *
 * ⚠️ **For an item with a live prescription only.** An item whose prescription was removed
 * (`prescriptionPublicId: null`) has no quantities to read, and its `DayItem.unit` is the unit its
 * logged entry was stored in; the day's read takes it from the entry, not from here.
 * ⚠️ `null` for a type whose unit comes from the prescription (a Count, Weight × reps, Distance)
 * means the prescription names no unit in that slot. No ✓ can then be stored (`fillRowValues`
 * refuses every quantity), so the workout writer must not save such a prescription.
 */
export function itemUnit(
  trackingType: TrackingType,
  quantities: readonly { slot: QuantitySlot; unit: Unit }[],
): Unit | null {
  const { slot, unit } = TRACKING_TYPE_FIELDS[trackingType];
  if (slot === null) return null;
  return unit ?? slotQuantity({ trackingType }, quantities)?.unit ?? null;
}

/**
 * The unit an entry is stored under when its type has no quantity of its own (plan §2, the
 * `entries.unit` column of the seven types): a Check is done or not, Reps are a count.
 */
export const ENTRY_UNIT_WITHOUT_QUANTITY = {
  check: 'bool',
  reps: 'count',
} as const satisfies Partial<Record<TrackingType, Unit>>;

/**
 * The unit a logged row's entry stores (`entries.unit`), as plan §2's table has it: `bool` for a
 * Check and `count` for Reps; the type's fixed unit where it has one (`min` for a Duration, `sec`
 * for Time per set: `TRACKING_TYPE_FIELDS[type].unit`); else the unit the item is prescribed in.
 * One rule for the row writer and for the export (contract change C10).
 *
 * A type whose unit is fixed ignores the unit it is handed, so the answer is the table's whatever
 * the caller passes. It throws for a type whose unit comes from the prescription when none is
 * given: that is a caller's bug (every such item has a unit, `DayItem.unit`), not something to
 * answer a person with.
 */
export function entryUnitFor(trackingType: TrackingType, prescribedUnit: Unit | null): Unit {
  if (Object.hasOwn(ENTRY_UNIT_WITHOUT_QUANTITY, trackingType)) {
    return ENTRY_UNIT_WITHOUT_QUANTITY[trackingType as keyof typeof ENTRY_UNIT_WITHOUT_QUANTITY];
  }
  const fixed = TRACKING_TYPE_FIELDS[trackingType].unit;
  if (fixed) return fixed;
  if (prescribedUnit === null) {
    throw new Error(
      `a ${trackingType} item has a quantity, so its entry needs the prescribed unit`,
    );
  }
  return prescribedUnit;
}
