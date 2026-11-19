import { describe, expect, it } from 'vitest';

import { TRACKING_TYPE, TRACKING_TYPES } from '../movements';
import { QUANTITY_SLOT } from '../quantity-slots';
import { quantityCeiling, type Unit } from '../units';

import { DAY_PLAN_FIXTURES } from './fixtures';
import {
  ENTRY_UNIT_WITHOUT_QUANTITY,
  entryUnitFor,
  fillRowValues,
  itemUnit,
  loggedRowUnit,
  prescribedTarget,
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

describe('prescribedTarget: a prescription’s numbers as a row uses them', () => {
  it('reps are a number only when the text is a whole number', () => {
    expect(prescribedTarget('8', []).reps).toBe(8);
    for (const text of ['8-10', '10 per side', 'AMRAP', '', ' 8', '8.5']) {
      expect(prescribedTarget(text, []).reps, text).toBeNull();
    }
    expect(prescribedTarget(null, []).reps).toBeNull();
  });

  it('a single value is the target; "no target" stays null', () => {
    expect(
      prescribedTarget('8', [
        { slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25, valueMax: null },
      ]),
    ).toEqual({ reps: 8, quantities: [primary('lb', 25)] });
    expect(
      prescribedTarget(null, [{ slot: QUANTITY_SLOT.primary, unit: 'min', value: null }])
        .quantities,
    ).toEqual([{ slot: QUANTITY_SLOT.primary, unit: 'min', value: null }]);
  });

  it('a range has no number to accept, so an empty ✓ on it asks for one', () => {
    const target = prescribedTarget('8', [
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
    const [quantity] = prescribedTarget(null, [
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

  it('a type whose unit is fixed ignores a unit it is handed', () => {
    expect(entryUnitFor(TRACKING_TYPE.check, 'lb')).toBe('bool');
    expect(entryUnitFor(TRACKING_TYPE.reps, 'lb')).toBe('count');
    // A Duration is always minutes and Time per set always seconds, whatever the caller passes.
    expect(entryUnitFor(TRACKING_TYPE.duration, 'sec')).toBe('min');
    expect(entryUnitFor(TRACKING_TYPE.time_sets, 'min')).toBe('sec');
    expect(entryUnitFor(TRACKING_TYPE.duration, null)).toBe('min');
    for (const type of TRACKING_TYPES) {
      const { unit } = TRACKING_TYPE_FIELDS[type];
      if (unit) expect(entryUnitFor(type, 'lb'), type).toBe(unit);
    }
  });

  it('a type whose unit comes from the prescription, given none, is a caller’s bug and throws', () => {
    const fromThePrescription = TRACKING_TYPES.filter(
      (t) => TRACKING_TYPE_FIELDS[t].slot !== null && TRACKING_TYPE_FIELDS[t].unit === null,
    );
    expect(fromThePrescription.length).toBeGreaterThan(0);
    for (const type of fromThePrescription) {
      expect(() => entryUnitFor(type, null), type).toThrow(/needs the prescribed unit/);
    }
  });

  it('a degenerate range is still a range', () => {
    expect(
      prescribedTarget('8', [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25, valueMax: 25 }])
        .quantities[0]?.value,
    ).toBeNull();
  });
});

describe('itemUnit: the unit an item logs in (`DayItem.unit`)', () => {
  const lbs = [primary('lb', 25)];

  it('is null for a type with no quantity, whatever it is handed', () => {
    expect(itemUnit(TRACKING_TYPE.check, [])).toBeNull();
    expect(itemUnit(TRACKING_TYPE.reps, lbs)).toBeNull();
  });

  it('is the type’s fixed unit, whatever the prescription row says', () => {
    expect(itemUnit(TRACKING_TYPE.duration, [])).toBe('min');
    expect(itemUnit(TRACKING_TYPE.duration, [primary('sec', 30)])).toBe('min');
    expect(itemUnit(TRACKING_TYPE.time_sets, [primary('min', 1)])).toBe('sec');
  });

  it('is the prescription’s unit in the type’s own slot, else null', () => {
    expect(itemUnit(TRACKING_TYPE.weight_reps, lbs)).toBe('lb');
    expect(itemUnit(TRACKING_TYPE.count, [primary('kg', 10)])).toBe('kg');
    expect(itemUnit(TRACKING_TYPE.distance, [{ slot: QUANTITY_SLOT.distance, unit: 'yd' }])).toBe(
      'yd',
    );
    // A quantity in another slot is not this type's.
    expect(itemUnit(TRACKING_TYPE.distance, lbs)).toBeNull();
    expect(itemUnit(TRACKING_TYPE.weight_reps, [])).toBeNull();
  });

  it('agrees with `entryUnitFor` wherever the item has a unit', () => {
    for (const type of TRACKING_TYPES) {
      for (const unit of unitsForTrackingType(type)) {
        const slot = TRACKING_TYPE_FIELDS[type].slot!;
        const logsIn = itemUnit(type, [{ slot, unit }]);
        expect(logsIn, `${type} in ${unit}`).not.toBeNull();
        expect(entryUnitFor(type, logsIn), `${type} in ${unit}`).toBe(logsIn);
      }
    }
  });

  it('is what every day fixture’s item carries', () => {
    let checked = 0;
    for (const plan of Object.values(DAY_PLAN_FIXTURES)) {
      for (const item of plan.workouts.flatMap((w) => w.items)) {
        // An item whose prescription was removed keeps the unit it was logged in, and has no
        // target to derive it from.
        if (item.prescriptionPublicId === null) continue;
        expect(item.unit, `${plan.day} ${item.name}`).toBe(
          itemUnit(item.trackingType, item.target.quantities),
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('loggedRowUnit: the unit an amend is judged in (C28)', () => {
  const logged = { reps: 5, quantities: [primary('lb', 30)] };

  it('is the stored quantity’s unit in the type’s slot', () => {
    expect(loggedRowUnit(TRACKING_TYPE.weight_reps, logged)).toBe('lb');
    expect(loggedRowUnit(TRACKING_TYPE.duration, { quantities: [primary('min', 20)] })).toBe('min');
  });

  it('is null for a type with no quantity, whatever the row holds', () => {
    for (const type of TRACKING_TYPES.filter((t) => !TRACKING_TYPE_FIELDS[t].slot)) {
      expect(loggedRowUnit(type, logged), type).toBeNull();
    }
    expect(TRACKING_TYPES.some((t) => !TRACKING_TYPE_FIELDS[t].slot)).toBe(true);
  });

  it('is null for a row with no quantity in the slot its type has', () => {
    expect(loggedRowUnit(TRACKING_TYPE.weight_reps, { reps: 5, quantities: [] })).toBeNull();
  });

  it('🔴 reads the type’s own slot, never whichever quantity comes first', () => {
    // Every type with a quantity names one slot; a row may hold a quantity in another.
    const slots = Object.values(QUANTITY_SLOT);
    let checked = 0;
    for (const type of TRACKING_TYPES) {
      const { slot } = TRACKING_TYPE_FIELDS[type];
      const [unit] = unitsForTrackingType(type);
      const elsewhere = slots.find((other) => other !== slot);
      if (!slot || !unit || !elsewhere) continue;
      const other = { slot: elsewhere, unit: 'lb' as const, value: 1 };
      const own = { slot, unit, value: 2 };
      expect(loggedRowUnit(type, { quantities: [other] }), type).toBeNull();
      expect(loggedRowUnit(type, { quantities: [other, own] }), type).toBe(unit);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('🔴 is null for a unit the type cannot be in, so the fake stores no such row', () => {
    // A row logged when the item was another type: a Duration holding pounds, seconds in minutes.
    const lbOnADuration = { quantities: [primary('lb', 30)] };
    expect(loggedRowUnit(TRACKING_TYPE.duration, lbOnADuration)).toBeNull();
    expect(loggedRowUnit(TRACKING_TYPE.time_sets, { quantities: [primary('min', 2)] })).toBeNull();
    const stored = {
      trackingType: TRACKING_TYPE.duration,
      unit: loggedRowUnit(TRACKING_TYPE.duration, lbOnADuration),
    };
    expect(fillRowValues(stored, { quantities: [primary('lb', 40)] }, null)).toBeNull();
    expect(fillRowValues(stored, { quantities: [primary('min', 40)] }, null)).toBeNull();
    // Every unit a type may be in is one it can be changed in.
    for (const type of TRACKING_TYPES.filter((t) => TRACKING_TYPE_FIELDS[t].slot)) {
      for (const unit of unitsForTrackingType(type)) {
        const slot = TRACKING_TYPE_FIELDS[type].slot!;
        expect(loggedRowUnit(type, { quantities: [{ slot, unit, value: 1 }] }), type).toBe(unit);
      }
    }
  });

  it('🔴 a row logged in lb is changed in lb after its item moved to kg, and never in kg', () => {
    const stored = {
      trackingType: TRACKING_TYPE.weight_reps,
      unit: loggedRowUnit(TRACKING_TYPE.weight_reps, logged),
    };
    const inLb = { reps: 6, quantities: [primary('lb', 35)] };
    const inKg = { reps: 6, quantities: [primary('kg', 16)] };
    expect(fillRowValues(stored, inLb, null)).toEqual(inLb);
    expect(fillRowValues(stored, inKg, null)).toBeNull();
    // Judged against the item as it reads now, the answers would be the other way round: the kg
    // number accepted onto a row stored in lb.
    const now = { ...bench, unit: 'kg' as const };
    expect(fillRowValues(now, inKg, null)).toEqual(inKg);
    expect(fillRowValues(now, inLb, null)).toBeNull();
  });

  it('is the item’s own unit for every logged row the fixtures hold, but where a unit was edited', () => {
    // One fixture describes a unit edited after logging (`unit-edited-after-logging`): there the
    // rows logged before the edit are in pounds under an item that now reads kg. Everywhere else
    // the two agree.
    let checked = 0;
    const edited: string[] = [];
    for (const [name, plan] of Object.entries(DAY_PLAN_FIXTURES)) {
      for (const item of plan.workouts.flatMap((w) => w.items)) {
        for (const row of item.rows) {
          if (!row.logged || !TRACKING_TYPE_FIELDS[item.trackingType].slot) continue;
          if (row.logged.values.quantities.length === 0) continue;
          const unit = loggedRowUnit(item.trackingType, row.logged.values);
          if (name === 'unit-edited-after-logging' && unit !== item.unit) {
            expect([unit, item.unit], item.name).toEqual(['lb', 'kg']);
            edited.push(`${item.name} ${row.set}`);
            continue;
          }
          expect(unit, `${name}: ${item.name}`).toBe(item.unit);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(edited).toEqual(['Vest weight 1', 'DB bench press 1', 'DB bench press 2']);
  });

  it('🔴 judges a Change on the fixture’s lb rows in lb, though their items read kg', () => {
    const plan = DAY_PLAN_FIXTURES['unit-edited-after-logging'];
    const onDay = plan.workouts
      .flatMap((w) => w.items)
      .find((item) => item.name === 'DB bench press')!;
    const [first] = onDay.rows;
    expect(onDay.unit).toBe('kg');
    const stored = {
      trackingType: onDay.trackingType,
      unit: loggedRowUnit(onDay.trackingType, first!.logged!.values),
    };
    const inLb = { reps: 8, quantities: [primary('lb', 30)] };
    const inKg = { reps: 8, quantities: [primary('kg', 14)] };
    expect(fillRowValues(stored, inLb, null)).toEqual(inLb);
    expect(fillRowValues(stored, inKg, null)).toBeNull();
    // A new ✓ on an unlogged set is not a Change: it is in the item's unit, from its target.
    expect(fillRowValues(onDay, { quantities: [] }, onDay.target)).toEqual({
      reps: 8,
      quantities: [primary('kg', 12.5)],
    });
  });
});
