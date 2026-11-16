import {
  isPlainDecimal,
  quantityCeiling,
  quantityText,
  repsSchema,
  rowValuesSchema,
  slotQuantity,
  TRACKING_TYPE_FIELDS,
  UNIT_LABELS,
  type DayItem,
  type RowValues,
  type Unit,
} from '@mat-plan/shared';

import { VALUE_JOINER } from '@/lib/constants';

/**
 * What a day row's fields mean, as pure functions (FAM-1 steps 13 and 13b): read what was typed,
 * say what a row holds, compare two rows. The row hook (`use-row.ts`) and its tests read these;
 * nothing here renders or writes.
 *
 * The fields of each type come from `TRACKING_TYPE_FIELDS` (plan §4 "As built"), never a re-typed
 * table: a row has a **quantity** field where the type has a slot and a **reps** field where it has
 * reps, so a weight × reps set has both, a Reps set has reps only, and a Check has none.
 */

/** The two writes a row makes: a ✓, or an un-tick. */
export type RowWriteKind = 'tick' | 'untick';

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

/** A whole number of reps, as typed: digits only (`8`, not `8.0` or `8 reps`). */
const WHOLE = /^\d+$/;

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
      if (!WHOLE.test(typed)) return { ok: false, problem: 'not_a_number', field };
      const reps = repsSchema.safeParse(Number(typed));
      if (!reps.success) return { ok: false, problem: 'out_of_range', field };
      values.reps = shown.reps = reps.data;
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
    if (!isPlainDecimal(typed)) return { ok: false, problem: 'not_a_number', field };
    const value = Number(typed);
    // A unit with no declared ceiling refuses (`quantityCeiling`'s rule): no bound is not "no cap".
    const ceiling = quantityCeiling(item.unit);
    if (ceiling === undefined || value > ceiling) {
      return { ok: false, problem: 'out_of_range', field };
    }
    const quantity = { slot, unit: item.unit, value };
    values.quantities.push(quantity);
    shown.quantities.push(quantity);
  }
  if (!rowValuesSchema.safeParse(values).success) {
    return { ok: false, problem: 'out_of_range', field: fieldsOf(item)[0] ?? 'quantity' };
  }
  return { ok: true, values, shown, empty };
}

/** Two rows hold the same numbers: `5` and `5.0` are one value. Order of quantities is ignored. */
export function sameValues(a: RowValues, b: RowValues): boolean {
  if (a.reps !== b.reps || a.quantities.length !== b.quantities.length) return false;
  return a.quantities.every((q) =>
    b.quantities.some((p) => p.slot === q.slot && p.unit === q.unit && p.value === q.value),
  );
}

/** The fields' text for a row's values: what an un-ticked row keeps in its fields. */
export function textOf(item: DayItem, values: RowValues): RowText {
  const quantity = slotQuantity(item, values.quantities);
  return {
    quantity: quantity ? String(quantity.value) : '',
    reps: values.reps === undefined ? '' : String(values.reps),
  };
}

/** One field of a row's values, as display text: `20 lb`, `30 s`, `8`; `''` when absent. */
export function fieldText(item: DayItem, values: RowValues, field: RowField): string {
  if (field === 'reps') return values.reps === undefined ? '' : String(values.reps);
  const quantity = slotQuantity(item, values.quantities);
  return quantity ? quantityText(quantity.value, quantity.unit) : '';
}

/**
 * A row's values as text, in the prescription's spelling (`quantityText`): `5 min`, `30 s`,
 * `20 lb × 6`, `15`, or `''` for a Check. Also PREVIOUS's text.
 */
export function formatRowValues(values: RowValues): string {
  const quantities = values.quantities.map((q) => quantityText(q.value, q.unit));
  if (values.reps === undefined) return quantities.join(VALUE_JOINER);
  return quantities.length
    ? `${quantities.join(VALUE_JOINER)} × ${values.reps}`
    : String(values.reps);
}

/** The visible label beside a field: the unit's code, none for a plain count. */
export function unitSuffix(unit: Unit): string {
  return unit === 'count' ? '' : unit;
}

/** The unit as a screen reader should say it: `pounds`, not `lb`; `inches`, not `in`. */
export function unitSpoken(unit: Unit): string {
  return unit === 'count' ? '' : UNIT_LABELS[unit].toLowerCase();
}
