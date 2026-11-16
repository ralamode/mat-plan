import { describe, expect, it } from 'vitest';

import { TRACKING_TYPE, TRACKING_TYPES } from '../movements';
import { QUANTITY_SLOT } from '../quantity-slots';
import { quantityCeiling, type Unit } from '../units';

import {
  ENTRY_UNIT_WITHOUT_QUANTITY,
  entryUnitFor,
  fillRowValues,
  prescriptionTarget,
  rowValuesSchema,
  TRACKING_TYPE_FIELDS,
  unitsForTrackingType,
  type PrescribedTarget,
} from './pieces';

/**
 * The row's value rules the writer, the amend and the preview's fake share (FAM-1 contract change
 * C10): what an empty ✓ is filled with, what is refused, what a range means, and which unit an
 * entry stores.
 */
const primary = (unit: Unit, value: number) => ({ slot: QUANTITY_SLOT.primary, unit, value });
const bench = { trackingType: TRACKING_TYPE.weight_reps, unit: 'lb' as const };
const benchTarget: PrescribedTarget = { reps: 8, quantities: [primary('lb', 25)] };

describe('fillRowValues: what a ✓ stores', () => {
  it('an empty ✓ stores the prescription, for every type that has numbers', () => {
    expect(fillRowValues(bench, { quantities: [] }, benchTarget)).toEqual({
      reps: 8,
      quantities: [primary('lb', 25)],
    });
    expect(
      fillRowValues(
        { trackingType: TRACKING_TYPE.reps, unit: null },
        { quantities: [] },
        {
          reps: 12,
          quantities: [],
        },
      ),
    ).toEqual({ reps: 12, quantities: [] });
    expect(
      fillRowValues(
        { trackingType: TRACKING_TYPE.duration, unit: 'min' },
        { quantities: [] },
        {
          reps: null,
          quantities: [primary('min', 5)],
        },
      ),
    ).toEqual({ quantities: [primary('min', 5)] });
    expect(
      fillRowValues(
        { trackingType: TRACKING_TYPE.distance, unit: 'yd' },
        { quantities: [] },
        {
          reps: null,
          quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'yd', value: 40 }],
        },
      ),
    ).toEqual({ quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'yd', value: 40 }] });
  });

  it('a Check stores nothing measured, and refuses a number', () => {
    const check = { trackingType: TRACKING_TYPE.check, unit: null };
    expect(fillRowValues(check, { quantities: [] }, { reps: null, quantities: [] })).toEqual({
      quantities: [],
    });
    expect(fillRowValues(check, { reps: 3, quantities: [] }, null)).toBeNull();
    expect(fillRowValues(check, { quantities: [primary('count', 1)] }, null)).toBeNull();
  });

  it('what was typed wins over the prescription, field by field', () => {
    expect(fillRowValues(bench, { reps: 10, quantities: [] }, benchTarget)).toEqual({
      reps: 10,
      quantities: [primary('lb', 25)],
    });
    expect(fillRowValues(bench, { quantities: [primary('lb', 30)] }, benchTarget)).toEqual({
      reps: 8,
      quantities: [primary('lb', 30)],
    });
  });

  it('a missing number the prescription cannot supply is refused', () => {
    expect(fillRowValues(bench, { quantities: [] }, { reps: null, quantities: [] })).toBeNull();
    // "Log in this unit, no target": the unit is known, the number is not.
    expect(
      fillRowValues(
        bench,
        { reps: 8, quantities: [] },
        {
          reps: 8,
          quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: null }],
        },
      ),
    ).toBeNull();
  });

  it('an amend fills nothing: every number the type has must be given', () => {
    expect(fillRowValues(bench, { reps: 9, quantities: [primary('lb', 30)] }, null)).toEqual({
      reps: 9,
      quantities: [primary('lb', 30)],
    });
    expect(fillRowValues(bench, { reps: 9, quantities: [] }, null)).toBeNull();
    expect(fillRowValues(bench, { quantities: [primary('lb', 30)] }, null)).toBeNull();
  });

  it('a number the type has no field for is refused, never dropped', () => {
    const duration = { trackingType: TRACKING_TYPE.duration, unit: 'min' as const };
    expect(fillRowValues(duration, { reps: 3, quantities: [primary('min', 5)] }, null)).toBeNull();
    expect(
      fillRowValues(
        bench,
        {
          reps: 8,
          quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'yd', value: 40 }],
        },
        benchTarget,
      ),
    ).toBeNull();
  });

  it('a slot named twice is refused, whichever of the two would have been right', () => {
    const twice = { reps: 8, quantities: [primary('lb', 25), primary('lb', 30)] };
    // The schema allows it (it bounds the list's length, not its slots), so the rule must refuse.
    expect(rowValuesSchema.safeParse(twice).success).toBe(true);
    expect(fillRowValues(bench, twice, benchTarget)).toBeNull();
    expect(fillRowValues(bench, twice, null)).toBeNull();
  });

  it('a quantity in another unit than the item logs in is refused', () => {
    expect(
      fillRowValues(bench, { reps: 8, quantities: [primary('kg', 25)] }, benchTarget),
    ).toBeNull();
    // ...and so is a prescription in another unit than the item's, on an empty ✓.
    expect(
      fillRowValues(bench, { quantities: [] }, { reps: 8, quantities: [primary('kg', 25)] }),
    ).toBeNull();
  });

  it('a value over the unit’s ceiling is refused, typed or prescribed; the ceiling itself is not', () => {
    const ceiling = quantityCeiling('lb')!;
    expect(fillRowValues(bench, { reps: 8, quantities: [primary('lb', ceiling)] }, null)).toEqual({
      reps: 8,
      quantities: [primary('lb', ceiling)],
    });
    expect(
      fillRowValues(bench, { reps: 8, quantities: [primary('lb', ceiling + 0.5)] }, null),
    ).toBeNull();
    expect(
      fillRowValues(
        bench,
        { quantities: [] },
        {
          reps: 8,
          quantities: [primary('lb', ceiling + 1)],
        },
      ),
    ).toBeNull();
  });

  it('every unit a type can log in has a ceiling, so none is refused for lacking one', () => {
    for (const type of TRACKING_TYPES) {
      for (const unit of unitsForTrackingType(type)) {
        expect(quantityCeiling(unit), `${type} in ${unit}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('prescriptionTarget: a prescription’s numbers as a row uses them', () => {
  it('reps are a number only when the text is a whole number', () => {
    expect(prescriptionTarget('8', []).reps).toBe(8);
    for (const text of ['8-10', '10 per side', 'AMRAP', '', ' 8', '8.5']) {
      expect(prescriptionTarget(text, []).reps, text).toBeNull();
    }
    expect(prescriptionTarget(null, []).reps).toBeNull();
  });

  it('a single value is the target; "no target" stays null', () => {
    expect(
      prescriptionTarget('8', [
        { slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25, valueMax: null },
      ]),
    ).toEqual({ reps: 8, quantities: [primary('lb', 25)] });
    expect(
      prescriptionTarget(null, [{ slot: QUANTITY_SLOT.primary, unit: 'min', value: null }])
        .quantities,
    ).toEqual([{ slot: QUANTITY_SLOT.primary, unit: 'min', value: null }]);
  });

  it('a range has no number to accept, so an empty ✓ on it asks for one', () => {
    const target = prescriptionTarget('8', [
      { slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25, valueMax: 35 },
    ]);
    expect(target.quantities).toEqual([{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: null }]);
    expect(fillRowValues(bench, { quantities: [] }, target)).toBeNull();
    // A typed number is still stored.
    expect(fillRowValues(bench, { quantities: [primary('lb', 30)] }, target)).toEqual({
      reps: 8,
      quantities: [primary('lb', 30)],
    });
  });

  it('carries only the three fields a target has', () => {
    const [quantity] = prescriptionTarget(null, [
      { slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25, valueMax: null },
    ]).quantities;
    expect(Object.keys(quantity!).sort()).toEqual(['slot', 'unit', 'value']);
  });
});

describe('entryUnitFor: the unit an entry stores (plan §2)', () => {
  it('is the table in the plan, for all seven types', () => {
    expect(entryUnitFor(TRACKING_TYPE.check, null)).toBe('bool');
    expect(entryUnitFor(TRACKING_TYPE.reps, null)).toBe('count');
    expect(entryUnitFor(TRACKING_TYPE.count, 'lb')).toBe('lb');
    expect(entryUnitFor(TRACKING_TYPE.weight_reps, 'kg')).toBe('kg');
    expect(entryUnitFor(TRACKING_TYPE.duration, 'min')).toBe('min');
    expect(entryUnitFor(TRACKING_TYPE.time_sets, 'sec')).toBe('sec');
    expect(entryUnitFor(TRACKING_TYPE.distance, 'yd')).toBe('yd');
  });

  it('the types with a unit of their own are exactly the types with no quantity', () => {
    const withoutQuantity = TRACKING_TYPES.filter((t) => TRACKING_TYPE_FIELDS[t].slot === null);
    expect(Object.keys(ENTRY_UNIT_WITHOUT_QUANTITY).sort()).toEqual([...withoutQuantity].sort());
  });

  it('a Check or Reps item ignores a unit it is handed', () => {
    expect(entryUnitFor(TRACKING_TYPE.check, 'lb')).toBe('bool');
    expect(entryUnitFor(TRACKING_TYPE.reps, 'lb')).toBe('count');
  });

  it('a type with a quantity and no prescribed unit is a caller’s bug, and throws', () => {
    for (const type of TRACKING_TYPES) {
      if (TRACKING_TYPE_FIELDS[type].slot === null) continue;
      expect(() => entryUnitFor(type, null), type).toThrow(/needs the prescribed unit/);
    }
  });
});
