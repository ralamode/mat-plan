import {
  isPlainDecimal,
  isWholeNumber,
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
export type TypedProblem = 'not_a_number' | 'out_of_range' | 'missing';

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
 */
export function readTyped(
  item: DayItem,
  text: RowText,
):
  | { ok: true; values: RowValues; shown: RowValues; empty: boolean }
  | { ok: false; problem: TypedProblem; field: RowField } {
  const values: RowValues = { quantities: [] };
  const shown: RowValues = { quantities: [] };
  let empty = true;

  for (const field of fieldsOf(item)) {
    const typed = text[field].trim();
    if (field === 'reps') {
      if (typed === '') {
        if (item.target.reps === null) return { ok: false, problem: 'missing', field };
        shown.reps = item.target.reps;
        continue;
      }
      empty = false;
      const reps = readNumber(item, field, typed);
      if (!reps.ok) return { ok: false, problem: reps.problem, field };
      values.reps = shown.reps = reps.value;
      continue;
    }
    const { slot } = TRACKING_TYPE_FIELDS[item.trackingType];
    if (!slot || !item.unit) continue;
    if (typed === '') {
      const target = targetQuantity(item);
      if (!target) return { ok: false, problem: 'missing', field };
      shown.quantities.push(target);
      continue;
    }
    empty = false;
    const read = readNumber(item, field, typed);
    if (!read.ok) return { ok: false, problem: read.problem, field };
    const quantity = { slot, unit: item.unit, value: read.value };
    values.quantities.push(quantity);
    shown.quantities.push(quantity);
  }
  if (!rowValuesSchema.safeParse(values).success) {
    return { ok: false, problem: 'out_of_range', field: fieldsOf(item)[0] ?? 'quantity' };
  }
  return { ok: true, values, shown, empty };
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
    quantity: quantity && quantity.unit === item.unit ? String(quantity.value) : '',
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
  return quantity.unit === item.unit
    ? String(quantity.value)
    : quantityText(quantity.value, quantity.unit);
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
export type KeptField = { field: RowField; problem: TypedProblem; typed: string };

/**
 * One typed number, for a ✓ (`readTyped`) and a Change (`readAmend`) alike: whole digits for reps
 * (`8`, not `8.0` or `8 reps`), a plain decimal under the unit's ceiling for a quantity.
 */
function readNumber(
  item: DayItem,
  field: RowField,
  typed: string,
): { ok: true; value: number } | { ok: false; problem: TypedProblem } {
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
 * Whether a logged row's numbers can be changed in place: 🔴 **never when its quantity was logged in
 * another unit than the item's** (13b-ii). A Change is sent in the item's unit (`rowAmendSchema`), so
 * a `27.5 lb` row on an item now in kg would go out as 27.5 kg; even a reps-only change has to send
 * the quantity. The row stays text, and un-tick then a new ✓ is the way to change it.
 */
export function canChangeValues(item: DayItem, logged: RowValues): boolean {
  if (fieldsOf(item).length === 0) return false;
  const quantity = slotQuantity(item, logged.quantities);
  return !quantity || quantity.unit === item.unit;
}

/**
 * What a Change sends (13b-ii; plan §8, "Change keeps the old number if the new one is blank or not a
 * number"). Unlike `readTyped`, **nothing comes from the prescription**: every field is the typed
 * number or, when that is blank, not a number or out of range, **its own logged number**, and the
 * other fields are still sent. `send` is `null` when no number differs from the logged row.
 *
 * Every other quantity the row holds is sent unchanged, so a Change touches only the fields shown.
 */
export function readAmend(
  item: DayItem,
  text: RowText,
  logged: RowValues,
): { send: RowValues | null; kept: KeptField[] } {
  const kept: KeptField[] = [];
  const { slot } = TRACKING_TYPE_FIELDS[item.trackingType];
  let quantities = logged.quantities;
  let reps = logged.reps;
  for (const field of fieldsOf(item)) {
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
  return { send: values, kept };
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
