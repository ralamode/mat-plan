import { QUANTITY_SLOT } from '@mat-plan/shared';
import { everyTypeOnce } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { formatRowValues, readTyped, sameValues, textOf, type DayItem } from './row-values';

const primary = QUANTITY_SLOT.primary;

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
    expect(readTyped(splits, '  ')).toEqual({
      ok: true,
      values: { quantities: [] },
      shown: { quantities: [{ slot: primary, unit: 'min', value: 5 }] },
      empty: true,
    });
  });

  it('an empty field with no prescribed number asks for one', () => {
    expect(readTyped(noTarget, '')).toEqual({ ok: false, problem: 'missing' });
  });

  it('a Check sends nothing, whatever the text', () => {
    expect(readTyped(grip, 'x')).toMatchObject({ ok: true, values: { quantities: [] } });
  });

  it.each(['-5', '1e3', '0x10', '5 min', '.', '5..5', '5.', '5.1234'])(
    'refuses %s as not a number',
    (text) => {
      expect(readTyped(splits, text)).toEqual({ ok: false, problem: 'not_a_number' });
    },
  );

  it('refuses a number past the unit’s ceiling, and takes the ceiling itself', () => {
    expect(readTyped(splits, '1441')).toEqual({ ok: false, problem: 'out_of_range' });
    expect(readTyped(splits, '1440')).toMatchObject({ ok: true, empty: false });
  });

  it('refuses any typed number in a unit with no declared ceiling (`quantityCeiling`’s rule)', () => {
    const plainCount: DayItem = { ...item('Vest weight'), unit: 'count' };
    expect(readTyped(plainCount, '3')).toEqual({ ok: false, problem: 'out_of_range' });
  });

  it.each([
    ['7', 7],
    [' 7.5 ', 7.5],
    ['.5', 0.5],
    ['5.125', 5.125],
    ['0', 0],
  ])('reads %s as %d in the item’s unit', (text, value) => {
    expect(readTyped(splits, text)).toMatchObject({
      ok: true,
      values: { quantities: [{ slot: primary, unit: 'min', value }] },
      empty: false,
    });
  });
});

describe('sameValues, textOf and formatRowValues', () => {
  const five = { quantities: [{ slot: primary, unit: 'min' as const, value: 5 }] };

  it('5 and 5.0 are one value', () => {
    const typed = readTyped(splits, '5.0');
    expect(typed.ok && sameValues(typed.values, five)).toBe(true);
    expect(sameValues(five, { quantities: [] })).toBe(false);
  });

  it('a row’s values as field text and as display text', () => {
    expect(textOf(splits, five)).toBe('5');
    expect(textOf(grip, { quantities: [] })).toBe('');
    expect(formatRowValues(five)).toBe('5 min');
    expect(formatRowValues({ quantities: [{ slot: primary, unit: 'count', value: 12 }] })).toBe(
      '12',
    );
  });
});
