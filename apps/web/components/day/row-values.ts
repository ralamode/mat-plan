import {
  MAX_STORABLE_QUANTITY,
  quantityCeiling,
  rowValuesSchema,
  TRACKING_TYPE_FIELDS,
  type DayPlan,
  type RowValues,
  type Unit,
} from '@mat-plan/shared';

import { formatValueUnit } from '@/lib/entries/format-value-unit';

/**
 * What a day row's fields mean, as pure functions (FAM-1 step 13): read what was typed, say what a
 * row holds, compare two rows. The row hook (`use-row.ts`) and its tests read these; nothing here
 * renders or writes.
 *
 * The fields of each type come from `TRACKING_TYPE_FIELDS` (plan §4 "As built"), never a re-typed
 * table.
 */

export type DayItem = DayPlan['workouts'][number]['items'][number];

/** The item's prescribed quantity in its type's slot, when it has a number. */
export function targetQuantity(item: DayItem): RowValues['quantities'][number] | null {
  const { slot } = TRACKING_TYPE_FIELDS[item.trackingType];
  const prescribed = item.target.quantities.find((q) => q.slot === slot);
  return prescribed && prescribed.value !== null
    ? { ...prescribed, value: prescribed.value }
    : null;
}

/** Whether a row of this item has a number to type. A Check has none. */
export function hasQuantityField(item: DayItem): boolean {
  return TRACKING_TYPE_FIELDS[item.trackingType].slot !== null && item.unit !== null;
}

/** Why a typed value cannot be sent, before any write. */
export type TypedProblem = 'not_a_number' | 'out_of_range' | 'missing';

/**
 * A plain decimal: `5`, `5.5`, `.5`. Not `-5`, `1e3`, `0x10` or `5 min`, which `Number()` would
 * accept or half-accept (the prototype's `isNaN(+typed)` let `-5` and `1e9` through).
 */
const PLAIN_DECIMAL = /^(\d+(\.\d*)?|\.\d+)$/;

/**
 * What a ✓ on a single row sends, from the field's text (plan D13).
 *
 * - Empty, where the prescription has a number: `{ quantities: [] }`, and the writer logs the
 *   prescription. `empty: true` says so, and `shown` is what the row displays meanwhile.
 * - Empty, where it has none: `missing`; the field asks for a number.
 * - A Check: always `{ quantities: [] }`.
 */
export function readTyped(
  item: DayItem,
  text: string,
):
  | { ok: true; values: RowValues; shown: RowValues; empty: boolean }
  | { ok: false; problem: TypedProblem } {
  const none: RowValues = { quantities: [] };
  const { slot } = TRACKING_TYPE_FIELDS[item.trackingType];
  if (!slot || !item.unit) return { ok: true, values: none, shown: none, empty: true };

  const typed = text.trim();
  if (typed === '') {
    const target = targetQuantity(item);
    if (!target) return { ok: false, problem: 'missing' };
    return { ok: true, values: none, shown: { quantities: [target] }, empty: true };
  }
  if (!PLAIN_DECIMAL.test(typed)) return { ok: false, problem: 'not_a_number' };
  const value = Number(typed);
  if (value > (quantityCeiling(item.unit) ?? MAX_STORABLE_QUANTITY)) {
    return { ok: false, problem: 'out_of_range' };
  }
  const values: RowValues = { quantities: [{ slot, unit: item.unit, value }] };
  if (!rowValuesSchema.safeParse(values).success) return { ok: false, problem: 'out_of_range' };
  return { ok: true, values, shown: values, empty: false };
}

/** Two rows hold the same numbers: `5` and `5.0` are one value. Order of quantities is ignored. */
export function sameValues(a: RowValues, b: RowValues): boolean {
  if (a.reps !== b.reps || a.quantities.length !== b.quantities.length) return false;
  return a.quantities.every((q) =>
    b.quantities.some((p) => p.slot === q.slot && p.unit === q.unit && p.value === q.value),
  );
}

/** The field's text for a row's values: what an un-ticked row keeps in its field. */
export function textOf(item: DayItem, values: RowValues): string {
  const { slot } = TRACKING_TYPE_FIELDS[item.trackingType];
  const quantity = values.quantities.find((q) => q.slot === slot);
  return quantity ? String(quantity.value) : '';
}

/** A value with its unit, for display. A plain count is the bare number. */
export function formatQuantity(value: number, unit: Unit): string {
  return unit === 'count' ? String(value) : formatValueUnit(value, unit);
}

/** A row's values as text: `5 min`, `10 lb`, or `''` for a Check. */
export function formatRowValues(values: RowValues): string {
  return values.quantities.map((q) => formatQuantity(q.value, q.unit)).join(', ');
}

/** The label beside a field: the unit's code, none for a plain count. */
export function unitSuffix(unit: Unit): string {
  return unit === 'count' ? '' : unit;
}
