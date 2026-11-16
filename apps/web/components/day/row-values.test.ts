import { QUANTITY_SLOT, quantityCeiling, UNIT_CODES, type DayItem } from '@mat-plan/shared';
import { everyTypeOnce } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import {
  canChangeValues,
  changedText,
  fieldText,
  formatRowValues,
  readAmend,
  readTyped,
  sameValues,
  textOf,
} from './row-values';

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
    expect(fieldText(bench, set, 'quantity')).toBe('22.5');
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

describe('readAmend (Change, 13b-ii)', () => {
  const bench: DayItem = {
    ...splits,
    name: 'DB bench press',
    trackingType: 'weight_reps',
    unit: 'lb',
    target: { reps: 8, quantities: [{ slot: primary, unit: 'lb', value: 25 }] },
  };
  const logged = { quantities: [{ slot: primary, unit: 'lb' as const, value: 27.5 }], reps: 8 };

  it('sends every number, the typed ones and the rest as logged', () => {
    expect(readAmend(bench, { quantity: '30', reps: '8' }, logged)).toEqual({
      send: { quantities: [{ slot: primary, unit: 'lb', value: 30 }], reps: 8 },
      kept: [],
    });
  });

  it('a blank keeps its own logged number, never the prescription, and the other field is sent', () => {
    expect(readAmend(bench, { quantity: '30', reps: '' }, logged)).toEqual({
      send: { quantities: [{ slot: primary, unit: 'lb', value: 30 }], reps: 8 },
      kept: [{ field: 'reps', problem: 'missing', typed: '' }],
    });
  });

  it('nothing to send when no number moved, or none could be read', () => {
    expect(readAmend(bench, { quantity: '27.50', reps: '8' }, logged).send).toBeNull();
    expect(readAmend(bench, { quantity: 'x', reps: '8.5' }, logged)).toEqual({
      send: null,
      kept: [
        { field: 'quantity', problem: 'not_a_number', typed: 'x' },
        { field: 'reps', problem: 'not_a_number', typed: '8.5' },
      ],
    });
  });

  it('🔴 never sends what the amend writer refuses, whoever calls it: a number the type has no field for', () => {
    // A second quantity, in a slot weight × reps does not have: readAmend carries the row's other
    // quantities over untouched, so only the writer's rule stops it going out.
    const extra = {
      quantities: [
        ...logged.quantities,
        { slot: QUANTITY_SLOT.distance, unit: 'yd' as const, value: 40 },
      ],
      reps: 8,
    };
    expect(readAmend(bench, { quantity: '30', reps: '8' }, extra).send).toBeNull();
  });

  it('a load over the unit’s ceiling is kept, not sent', () => {
    const over = String(quantityCeiling('lb')! + 1);
    expect(readAmend(bench, { quantity: over, reps: '8' }, logged)).toEqual({
      send: null,
      kept: [{ field: 'quantity', problem: 'out_of_range', typed: over }],
    });
  });

  it('🔴 a row logged in another unit cannot be changed in place', () => {
    expect(canChangeValues(bench, logged)).toBe(true);
    expect(canChangeValues({ ...bench, unit: 'kg' }, logged)).toBe(false);
    expect(canChangeValues(grip, { quantities: [] })).toBe(false);
    // Logged as reps only, on what is now weight × reps: no load to send.
    expect(canChangeValues(bench, { quantities: [], reps: 8 })).toBe(false);
    // Logged as another type (reps on what is now a Duration): no numbers it no longer has.
    expect(
      canChangeValues(splits, {
        quantities: logged.quantities.map((q) => ({ ...q, unit: 'min' as const })),
        reps: 8,
      }),
    ).toBe(false);
  });

  it('the Changed line prints only what moved', () => {
    const to = { ...logged, quantities: [{ ...logged.quantities[0]!, value: 30 }] };
    expect(changedText(bench, logged, to)).toEqual({ from: '27.5 lb', to: '30 lb' });
    expect(changedText(bench, logged, { ...logged, reps: 6 })).toEqual({ from: '8', to: '6 reps' });
    expect(changedText(bench, logged, { ...to, reps: 6 })).toEqual({
      from: '27.5 lb × 8',
      to: '30 lb × 6',
    });
  });
});
