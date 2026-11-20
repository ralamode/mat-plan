import {
  fillRowValues,
  isPlainDecimal,
  isWholeNumber,
  loggedRowUnit,
  quantityCeiling,
  quantityText,
  repsSchema,
  rowValuesSchema,
  slotQuantity,
  TRACKING_TYPE_FIELDS,
  UNIT_LABELS,
  UNIT_SINGULAR_LABELS,
  type DayItem,
  type RowValues,
  type Unit,
} from '@mat-plan/shared';

import { VALUE_JOINER } from '@/lib/constants';

import { DAY_COPY } from './day-copy';

/**
 * What a day row's fields mean, as pure functions (FAM-1 steps 13 and 13b): read what was typed,
 * say what a row holds, compare two rows. The row hook (`use-row.ts`) and its tests read these;
 * nothing here renders or writes.
 *
 * The fields of each type come from `TRACKING_TYPE_FIELDS` (plan §4 "As built"), never a re-typed
 * table: a row has a **quantity** field where the type has a slot and a **reps** field where it has
 * reps, so a weight × reps set has both, a Reps set has reps only, and a Check has none.
 */

/** The writes a row makes: a ✓, an un-tick, or a Change to a logged row's numbers (13b-ii). */
export type RowWriteKind = 'tick' | 'untick' | 'amend';

/** A row's typed fields. */
export type RowField = 'quantity' | 'reps';
export type RowText = Record<RowField, string>;
export const EMPTY_TEXT: RowText = { quantity: '', reps: '' };

/**
 * The fields a row of this item shows, in the order the table shows them: the load before the reps,
 * as v12's `lb | Reps`.
 */
export function fieldsOf(item: DayItem): RowField[] {
  const { slot, reps } = TRACKING_TYPE_FIELDS[item.trackingType];
  const fields: RowField[] = [];
  if (slot && item.unit) fields.push('quantity');
  if (reps) fields.push('reps');
  return fields;
}

/** The item's prescribed quantity in its type's slot, when it has a number. */
export function targetQuantity(item: DayItem): RowValues['quantities'][number] | null {
  const prescribed = slotQuantity(item, item.target.quantities);
  return prescribed && prescribed.value !== null
    ? { ...prescribed, value: prescribed.value }
    : null;
}

/** What an empty field shows as its placeholder: the prescription's number (plan D13). */
export function placeholderOf(item: DayItem, field: RowField): string | undefined {
  if (field === 'reps') return item.target.reps === null ? undefined : String(item.target.reps);
  const target = targetQuantity(item);
  return target ? String(target.value) : undefined;
}

/** Why a typed value cannot be sent, before any write. */
/** Why one typed number cannot be used (a ✓'s and a Change's alike). */
export type NumberProblem = 'not_a_number' | 'out_of_range' | 'missing';
/** Why a ✓'s typed row cannot be sent: a number's problem, or a load that must be typed (H9). */
export type TypedProblem = NumberProblem | 'other_unit';

/**
 * Whether a row's stored quantity is in another unit than the item logs in now (its prescription's
 * unit was edited after the row was logged). `textOf` leaves such a quantity out of the field.
 */
export function loggedInOtherUnit(item: DayItem, values: RowValues): boolean {
  return otherUnitOf(item, values) !== null;
}

/** The unit that quantity was logged in, or `null` when it is in the item's unit (or absent). */
export function otherUnitOf(item: DayItem, values: RowValues): Unit | null {
  const quantity = slotQuantity(item, values.quantities);
  return quantity && quantity.unit !== item.unit ? quantity.unit : null;
}

/**
 * The one other unit the item's logged rows hold (the page's data), for the note under its heading
 * (#688 follow-up; maintainer, 2026-11-19: once per exercise). `null` when no logged row is in
 * another unit, or when they are in **two** other units (a distance edited twice): one sentence
 * could name only one of them, so each row keeps its own line instead.
 */
export function itemOtherUnit(item: DayItem): Unit | null {
  if (!item.unit) return null;
  const units = new Set(
    item.rows.flatMap((row) => {
      const unit = row.logged ? otherUnitOf(item, row.logged.values) : null;
      return unit ? [unit] : [];
    }),
  );
  return units.size === 1 ? [...units][0]! : null;
}

/** That quantity as the row writes it ("25 lb"), or `null` when it is in the item's unit. */
export function otherUnitLoad(item: DayItem, values: RowValues): string | null {
  const quantity = slotQuantity(item, values.quantities);
  return quantity && otherUnitOf(item, values) !== null
    ? quantityText(quantity.value, quantity.unit)
    : null;
}

/**
 * What a ✓ sends, from the row's fields (plan D13).
 *
 * - An empty field where the prescription has a number is left out, and the writer logs the
 *   prescription's; `shown` is what the row displays meanwhile, with that number filled in.
 *   Reps are filled only when the prescription's are whole (`target.reps`).
 * - An empty field where it has none: `missing`, by that field.
 * - A Check: always `{ quantities: [] }`.
 *
 * `empty` is true when nothing was typed in any field.
 *
 * 🔴 **`fillQuantity: false`: an empty load is `other_unit`, never the prescription's** (FAM-1
 * 12d-ii; H9, maintainer, 2026-11-18). For a row un-ticked this visit whose load was logged in
 * another unit: its field opens blank (`textOf`), and a ✓ with only the reps fixed would otherwise
 * store the prescription's load, in the new unit, for what was lifted in the old one.
 */
export function readTyped(
  item: DayItem,
  text: RowText,
  { fillQuantity = true }: { fillQuantity?: boolean } = {},
):
  | { ok: true; values: RowValues; shown: RowValues; empty: boolean }
  | { ok: false; problem: TypedProblem; field: RowField } {
  const values: RowValues = { quantities: [] };
  const fields = fieldsOf(item);
  for (const field of fields) {
    const typed = text[field].trim();
    if (typed === '') {
      // Named here, in field order, so the field marked is the one the prescription cannot fill
      // (a load of 25 lb with a range of reps asks for the reps, not the load).
      if (field !== 'reps' && !fillQuantity) return { ok: false, problem: 'other_unit', field };
      const fillable = field === 'reps' ? item.target.reps !== null : targetQuantity(item) !== null;
      if (!fillable) return { ok: false, problem: 'missing', field };
      continue;
    }
    const read = readNumber(item, field, typed);
    if (!read.ok) return { ok: false, problem: read.problem, field };
    if (field === 'reps') {
      values.reps = read.value;
      continue;
    }
    const { slot } = TRACKING_TYPE_FIELDS[item.trackingType];
    if (slot && item.unit) values.quantities.push({ slot, unit: item.unit, value: read.value });
  }
  const first = fields[0] ?? 'quantity';
  if (!rowValuesSchema.safeParse(values).success) {
    return { ok: false, problem: 'out_of_range', field: first };
  }
  // What the ✓ will store, by the writer's own rule (contract C10's `fillRowValues`): the typed
  // numbers, and the prescription's where a field was left empty. A refusal past the checks above
  // (a target in another unit than the item's) names the first field.
  const shown = fillRowValues(item, values, item.target);
  if (!shown) return { ok: false, problem: 'out_of_range', field: first };
  return { ok: true, values, shown, empty: fields.every((field) => text[field].trim() === '') };
}

/** Two rows' fields hold the same text. */
export function sameText(a: RowText, b: RowText): boolean {
  return a.quantity === b.quantity && a.reps === b.reps;
}

/** Two rows hold the same numbers: `5` and `5.0` are one value. Order of quantities is ignored. */
export function sameValues(a: RowValues, b: RowValues): boolean {
  if (a.reps !== b.reps || a.quantities.length !== b.quantities.length) return false;
  return a.quantities.every((q) =>
    b.quantities.some((p) => p.slot === q.slot && p.unit === q.unit && p.value === q.value),
  );
}

/**
 * The fields' text for a row's values: what an un-ticked row keeps in its fields.
 *
 * 🔴 **A quantity logged in another unit than the item's is left out**, never put in the field: the
 * field is in the item's unit, so `27.5` logged in lb would be sent as 27.5 kg on the next ✓ (a load
 * in the wrong unit is an injury risk). An untouched field still re-ticks, which restores the entry
 * as it was logged.
 */
export function textOf(item: DayItem, values: RowValues): RowText {
  const quantity = slotQuantity(item, values.quantities);
  return {
    quantity: quantity && !loggedInOtherUnit(item, values) ? String(quantity.value) : '',
    reps: values.reps === undefined ? '' : String(values.reps),
  };
}

/**
 * One field of a row's values, as its column shows it: the bare number (`27.5`, `30`, `8`), since
 * the column's header names the unit; **with its unit when it was logged in another one** (the
 * item's unit changed since, D7), so `27.5 lb` never reads as kg. `''` when absent.
 */
export function fieldText(item: DayItem, values: RowValues, field: RowField): string {
  if (field === 'reps') return values.reps === undefined ? '' : String(values.reps);
  const quantity = slotQuantity(item, values.quantities);
  if (!quantity) return '';
  return otherUnitLoad(item, values) ?? String(quantity.value);
}

/**
 * A row's values as parts: the quantities, then the reps as `× 6` where there is a quantity before
 * them. Each part is unbreakable text, so Previous wraps between them and never inside one.
 */
export function valueParts(values: RowValues): string[] {
  const quantities = values.quantities.map((q) => quantityText(q.value, q.unit));
  const parts = quantities.length ? [quantities.join(VALUE_JOINER)] : [];
  if (values.reps !== undefined) {
    parts.push(parts.length ? `× ${values.reps}` : String(values.reps));
  }
  return parts;
}

/**
 * A row's values as text, in the prescription's spelling (`quantityText`): `5 min`, `30 s`,
 * `20 lb × 6`, `15`, or `''` for a Check. Also PREVIOUS's text.
 */
export function formatRowValues(values: RowValues): string {
  return valueParts(values).join(' ');
}

/** The visible label beside a field: the unit's code, none for a plain count. */
export function unitSuffix(unit: Unit): string {
  return unit === 'count' ? '' : unit;
}

/** The unit as a screen reader should say it: `pounds`, not `lb`; `inches`, not `in`. */
export function unitSpoken(unit: Unit): string {
  return unit === 'count' ? '' : UNIT_LABELS[unit].toLowerCase();
}

/** Why a changed field kept its logged number (13b-ii): blank, not a number, or out of range. */
export type KeptField = { field: RowField; problem: NumberProblem; typed: string };

/**
 * One typed number, for a ✓ (`readTyped`) and a Change (`readAmend`) alike: whole digits for reps
 * (`8`, not `8.0` or `8 reps`), a plain decimal under the unit's ceiling for a quantity.
 */
function readNumber(
  item: DayItem,
  field: RowField,
  typed: string,
): { ok: true; value: number } | { ok: false; problem: NumberProblem } {
  if (typed === '') return { ok: false, problem: 'missing' };
  if (field === 'reps') {
    if (!isWholeNumber(typed)) return { ok: false, problem: 'not_a_number' };
    const reps = repsSchema.safeParse(Number(typed));
    return reps.success ? { ok: true, value: reps.data } : { ok: false, problem: 'out_of_range' };
  }
  if (!isPlainDecimal(typed)) return { ok: false, problem: 'not_a_number' };
  const value = Number(typed);
  // A unit with no declared ceiling refuses (`quantityCeiling`'s rule): no bound is not "no cap".
  const ceiling = item.unit ? quantityCeiling(item.unit) : undefined;
  if (ceiling === undefined || value > ceiling) return { ok: false, problem: 'out_of_range' };
  return { ok: true, value };
}

/**
 * The fields of a logged row that a Change may edit in place (13b-ii; 12d-iii, Form 1): **all of
 * them**, or **the reps only** for a weight × reps row whose load was logged in another unit than
 * the item's, or **none**.
 *
 * 🔴 **A load logged in another unit is never a field** (D44, Form 1; maintainer, 2026-11-18). The
 * field would show and send the item's current unit, so `27.5 lb` on an item now in kg would go out
 * as 27.5 kg. The load stays text in its own unit (`fieldText`) and is sent back unchanged; only the
 * reps can be typed. The writer judges a Change in the unit the row was LOGGED in (`loggedRowUnit`,
 * contract change C28), and so does `readAmend`.
 *
 * Otherwise the amend writer's own rule (`fillRowValues` with no target, C10): the row holds exactly
 * the numbers the item's type has, in its unit and under its ceiling. A row logged as another type,
 * without a number the type now has, or over a ceiling lowered since, stays text, and a distance or
 * count row logged in another unit has no reps to offer, so it stays text too.
 */
export function changeableFields(item: DayItem, logged: RowValues): RowField[] {
  const fields = fieldsOf(item);
  if (fields.length === 0) return [];
  if (fillRowValues(item, logged, null) !== null) return fields;
  if (!loggedInOtherUnit(item, logged) || !fields.includes('reps')) return [];
  return fillRowValues(inLoggedUnit(item, logged), logged, null) !== null ? ['reps'] : [];
}

/** The item as the amend writer judges this row: in the unit the row was logged in (C28). */
function inLoggedUnit(item: DayItem, logged: RowValues): DayItem {
  return { ...item, unit: loggedRowUnit(item.trackingType, logged) ?? item.unit };
}

/**
 * What a Change sends (13b-ii; plan §8, "Change keeps the old number if the new one is blank or not a
 * number"). Unlike `readTyped`, **nothing comes from the prescription**: every field is the typed
 * number or, when that is blank, not a number or out of range, **its own logged number**, and the
 * other fields are still sent. `send` is `null` when no number differs from the logged row.
 *
 * Every other quantity the row holds is sent unchanged, so a Change touches only the fields shown
 * (`fields`, from `changeableFields`): a reps-only Change sends the load as it was logged, in its own
 * unit, and is judged in that unit, as the writer judges it (C28).
 */
export function readAmend(
  item: DayItem,
  text: RowText,
  logged: RowValues,
  fields: readonly RowField[] = fieldsOf(item),
): { send: RowValues | null; kept: KeptField[] } {
  const kept: KeptField[] = [];
  const { slot } = TRACKING_TYPE_FIELDS[item.trackingType];
  let quantities = logged.quantities;
  let reps = logged.reps;
  for (const field of fields) {
    const typed = text[field].trim();
    const read = readNumber(item, field, typed);
    if (!read.ok) {
      kept.push({ field, problem: read.problem, typed });
      continue;
    }
    if (field === 'reps') {
      reps = read.value;
      continue;
    }
    if (!slot || !item.unit) continue;
    const quantity = { slot, unit: item.unit, value: read.value };
    quantities = quantities.some((q) => q.slot === slot)
      ? quantities.map((q) => (q.slot === slot ? quantity : q))
      : [...quantities, quantity];
  }
  const values: RowValues = reps === undefined ? { quantities } : { quantities, reps };
  if (sameValues(values, logged) || !rowValuesSchema.safeParse(values).success) {
    return { send: null, kept };
  }
  // Checked by the amend writer's rule before it is sent, so the screen never sends what it refuses:
  // in the item's unit when the load is a field, in the logged unit when it is not.
  const judged = fields.includes('quantity') ? item : inLoggedUnit(item, logged);
  const send = fillRowValues(judged, values, null);
  return { send, kept };
}

/** One field of a row's values as words on the screen: `25 lb`, `8 reps`, `30 s`. */
export function fieldValueText(item: DayItem, values: RowValues, field: RowField): string {
  if (field === 'reps') return values.reps === undefined ? '' : DAY_COPY.repsCount(values.reps);
  const quantity = slotQuantity(item, values.quantities);
  return quantity ? quantityText(quantity.value, quantity.unit) : '';
}

/**
 * A row's values as a status line says them: `25 lb × 8`, and a reps-only row as `8 reps` (a bare
 * `8` in a sentence says nothing).
 */
export function valuesText(values: RowValues): string {
  if (values.quantities.length === 0 && values.reps !== undefined) {
    return DAY_COPY.repsCount(values.reps);
  }
  return formatRowValues(values);
}

/**
 * The part of a row that a Change changed, before and after, as the "Changed … → …" line prints it:
 * only the numbers that moved, so a long load and reps still fit beside Undo at 360px.
 */
export function changedText(
  item: DayItem,
  from: RowValues,
  to: RowValues,
): { from: string; to: string } {
  const moved = fieldsOf(item).filter(
    (field) => fieldValueText(item, from, field) !== fieldValueText(item, to, field),
  );
  if (moved.length === 1 && moved[0] === 'reps') {
    return { from: String(from.reps ?? ''), to: DAY_COPY.repsCount(to.reps ?? 0) };
  }
  if (moved.length === 1) {
    return {
      from: fieldValueText(item, from, 'quantity'),
      to: fieldValueText(item, to, 'quantity'),
    };
  }
  return { from: valuesText(from), to: valuesText(to) };
}

/** A row's values as a screen reader should hear them: `25 pounds, 8 reps`, never `lb × 8`. */
export function spokenValues(values: RowValues): string {
  const parts = values.quantities.map((q) => {
    if (q.unit === 'count') return String(q.value);
    const singular = q.value === 1 ? UNIT_SINGULAR_LABELS[q.unit] : null;
    return `${q.value} ${singular ?? unitSpoken(q.unit)}`;
  });
  if (values.reps !== undefined) parts.push(DAY_COPY.repsCount(values.reps));
  return parts.join(', ');
}
