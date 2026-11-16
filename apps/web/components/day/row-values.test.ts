import { QUANTITY_SLOT, quantityCeiling, UNIT_CODES, type DayItem } from '@mat-plan/shared';
import { everyTypeOnce } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { fieldText, formatRowValues, readTyped, sameValues, textOf } from './row-values';

const primary = QUANTITY_SLOT.primary;
/** A row's fields with only the quantity typed. */
const q = (quantity: string) => ({ quantity, reps: '' });

const item = (name: string): DayItem => {
  const found = everyTypeOnce.workouts[0]!.items.find((i) => i.name === name);
  if (!found) throw new Error(`no item ${name}`);
  return found;
};
const splits = item('Splits stretch'); // duration, 5 min
const grip = item('Grip: rice bucket'); // check
const noTarget: DayItem = { ...splits, target: { reps: null, quantities: [] } };

describe('readTyped', () => {
  it('an empty field sends nothing and shows the prescription (plan D13)', () => {
    expect(readTyped(splits, q('  '))).toEqual({
      ok: true,
      values: { quantities: [] },
      shown: { quantities: [{ slot: primary, unit: 'min', value: 5 }] },
      empty: true,
    });
  });

  it('an empty field with no prescribed number asks for one', () => {
    expect(readTyped(noTarget, q(''))).toEqual({
      ok: false,
      problem: 'missing',
      field: 'quantity',
    });
  });

  it('a Check sends nothing, whatever the text', () => {
    expect(readTyped(grip, q('x'))).toMatchObject({ ok: true, values: { quantities: [] } });
  });

  it.each(['-5', '1e3', '0x10', '5 min', '.', '5..5', '5.', '5.1234'])(
    'refuses %s as not a number',
    (text) => {
      expect(readTyped(splits, q(text))).toEqual({
        ok: false,
        problem: 'not_a_number',
        field: 'quantity',
      });
    },
  );

  it('refuses a number past the unit’s ceiling, and takes the ceiling itself', () => {
    expect(readTyped(splits, q('1441'))).toEqual({
      ok: false,
      problem: 'out_of_range',
      field: 'quantity',
    });
    expect(readTyped(splits, q('1440'))).toMatchObject({ ok: true, empty: false });
  });

  it('refuses any typed number in a unit with no declared ceiling (`quantityCeiling`’s rule)', () => {
    // Whichever unit has no ceiling today (step 3 gave `count` one): found, not named.
    const uncapped = UNIT_CODES.find((unit) => quantityCeiling(unit) === undefined);
    expect(uncapped, 'every unit has a ceiling now: this test has nothing to hold').toBeDefined();
    const noCeiling: DayItem = { ...item('Vest weight'), unit: uncapped! };
    expect(readTyped(noCeiling, q('3'))).toEqual({
      ok: false,
      problem: 'out_of_range',
      field: 'quantity',
    });
  });

  it.each([
    ['7', 7],
    [' 7.5 ', 7.5],
    ['.5', 0.5],
    ['5.125', 5.125],
    ['0', 0],
  ])('reads %s as %d in the item’s unit', (text, value) => {
    expect(readTyped(splits, q(text))).toMatchObject({
      ok: true,
      values: { quantities: [{ slot: primary, unit: 'min', value }] },
      empty: false,
    });
  });
});

describe('readTyped on a set with reps', () => {
  const bench = item('DB bench press'); // weight × reps, 4 × 8 @ 25 lb
  const pushUps = item('Push-ups'); // reps, 3 × 15

  it('both fields empty: sends nothing, shows the prescription’s load and whole reps', () => {
    expect(readTyped(bench, { quantity: '', reps: '' })).toEqual({
      ok: true,
      values: { quantities: [] },
      shown: { quantities: [{ slot: primary, unit: 'lb', value: 25 }], reps: 8 },
      empty: true,
    });
  });

  it('typed reps and an empty load: sends the reps, the writer fills the load', () => {
    expect(readTyped(bench, { quantity: '', reps: '6' })).toMatchObject({
      ok: true,
      values: { quantities: [], reps: 6 },
      shown: { quantities: [{ value: 25 }], reps: 6 },
      empty: false,
    });
  });

  it.each(['6.5', '-6', '6 reps', '1e1'])('refuses %s as reps, by the reps field', (reps) => {
    expect(readTyped(pushUps, { quantity: '', reps })).toEqual({
      ok: false,
      problem: 'not_a_number',
      field: 'reps',
    });
  });

  it('refuses reps past the strength set’s limit', () => {
    expect(readTyped(pushUps, { quantity: '', reps: '1001' })).toMatchObject({
      ok: false,
      problem: 'out_of_range',
      field: 'reps',
    });
  });

  it('empty reps where the prescription’s are not whole asks for them', () => {
    const perSide: DayItem = { ...pushUps, target: { ...pushUps.target, reps: null } };
    expect(readTyped(perSide, { quantity: '', reps: '' })).toEqual({
      ok: false,
      problem: 'missing',
      field: 'reps',
    });
  });

  it('a set’s values as text, and a field’s text', () => {
    const set = { quantities: [{ slot: primary, unit: 'lb' as const, value: 22.5 }], reps: 10 };
    expect(formatRowValues(set)).toBe('22.5 lb × 10');
    expect(formatRowValues({ quantities: [], reps: 15 })).toBe('15');
    expect(fieldText(bench, set, 'quantity')).toBe('22.5 lb');
    expect(fieldText(bench, set, 'reps')).toBe('10');
    expect(textOf(bench, set)).toEqual({ quantity: '22.5', reps: '10' });
  });

  it('a seconds quantity is spelled as the prescription spells it', () => {
    expect(formatRowValues({ quantities: [{ slot: primary, unit: 'sec', value: 30 }] })).toBe(
      '30 s',
    );
  });
});

describe('sameValues, textOf and formatRowValues', () => {
  const five = { quantities: [{ slot: primary, unit: 'min' as const, value: 5 }] };

  it('5 and 5.0 are one value', () => {
    const typed = readTyped(splits, q('5.0'));
    expect(typed.ok && sameValues(typed.values, five)).toBe(true);
    expect(sameValues(five, { quantities: [] })).toBe(false);
  });

  it('a row’s values as field text and as display text', () => {
    expect(textOf(splits, five)).toEqual(q('5'));
    expect(textOf(grip, { quantities: [] })).toEqual(q(''));
    expect(formatRowValues(five)).toBe('5 min');
    expect(formatRowValues({ quantities: [{ slot: primary, unit: 'count', value: 12 }] })).toBe(
      '12',
    );
  });
});
