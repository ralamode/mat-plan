import { describe, expect, it } from 'vitest';

import { BODYWEIGHT_UNITS } from './bodyweight';
import { buildBodyweight } from './csv/bodyweight';
import { CSV_UNIT_SUFFIX, EXPORTABLE_UNITS } from './csv/value';
import { TRACKING_TYPE, TRACKING_TYPES } from './movements';
import { TRACKING_TYPE_FIELDS, unitsForTrackingType } from './program/pieces';
import { prescribedText } from './program/prescribed-text';
import { QUANTITY_SLOT, QUANTITY_SLOT_ROWS, slotAcceptsDimension } from './quantity-slots';
import {
  isPlainDecimal,
  isWholeNumber,
  UNIT_CODES,
  unitsOfDimension,
  MASS_QUANTITY_CEILING,
  MAX_REPS_PER_SET,
  MAX_STORABLE_QUANTITY,
  PLAIN_DECIMAL,
  QUANTITY_DECIMALS,
  UNIT_LABELS,
  quantityCeiling,
  UNIT_DIMENSION,
  UNIT_DIMENSION_BY_CODE,
  UNIT_SINGULAR_LABELS,
} from './units';

/** Every unit a tracking type offers: what the workout editor and the day page can put in a row. */
const OFFERED_UNITS = [...new Set(TRACKING_TYPES.flatMap(unitsForTrackingType))];

/**
 * The bodyweight CSV's link. The strength chain this file used to hold (the legacy form's units ⊆
 * its schema's ⊆ the export's) went with that form's schema (LEGACY-1 C2b); that every unit a
 * tracking type offers reaches the export is `csv/strength-log-types.test.ts`'s job.
 */
describe('every bodyweight unit is exportable', () => {
  // The bodyweight CSV is a SECOND export path with its own per-unit rule, and `EXPORTABLE_UNITS`
  // (the strength-load spelling, `85kg`) is no spelling for the `weight_lb` column. Without this
  // link, a third bodyweight unit passes every other check and then throws inside `buildBodyweight`
  // at export time -- 500-ing the profile's whole export history, which is the failure CSV-1's own
  // review rejected. Fail here instead, where it costs a test run.
  it.each(BODYWEIGHT_UNITS)('the bodyweight export can write %s', (unit) => {
    expect(() =>
      buildBodyweight([{ date: '2026-09-30', weight: '50', unit, context: '', notes: '' }]),
    ).not.toThrow();
  });
});

describe('the units with no CSV load spelling', () => {
  // The one literal pin of this set (AGENTS.md → constants). A new unit code lands in exactly one of
  // the two lists, and this says which. A Count's number is written in `reps`, never as a load.
  it('are exactly bool, count and timing', () => {
    expect(UNIT_CODES.filter((u) => !EXPORTABLE_UNITS.includes(u)).sort()).toEqual([
      'bool',
      'count',
      'timing',
    ]);
  });
});

/**
 * V1-30b-ii — the per-unit stored-value ceiling. This is the guard `units.ts` cites: a caller treats
 * a MISSING cap as "refuse", and this is what keeps that branch unreachable rather than load-bearing.
 */
describe('MAX_QUANTITY_BY_UNIT / quantityCeiling', () => {
  it.each(OFFERED_UNITS)('%s has a ceiling that fits numeric(8,3)', (u) => {
    const cap = quantityCeiling(u);
    expect(cap, `no ceiling declared for ${u}`).toBeDefined();
    expect(cap!).toBeLessThanOrEqual(MAX_STORABLE_QUANTITY);
    expect(cap!).toBeGreaterThan(0);
  });

  it('the two mass units share ONE ceiling', () => {
    // `verify/day.ts` refuses a ✓ one past it; re-typing the number there is how the two would
    // disagree with nothing red.
    expect(quantityCeiling('lb')).toBe(MASS_QUANTITY_CEILING);
    expect(quantityCeiling('kg')).toBe(MASS_QUANTITY_CEILING);
  });
});

/**
 * V1-30b-ii — the history line spells the LENGTH codes. The map's key set IS
 * `unitsOfDimension(length)`: `formatValueUnit` uses PRESENCE here as the "spell this out" predicate,
 * so a sixth length code without an entry would render `3 mi` beside `30 inches` with nothing red.
 */
describe('UNIT_SINGULAR_LABELS', () => {
  it.each([...unitsOfDimension(UNIT_DIMENSION.length)])('%s has a singular', (u) => {
    expect(UNIT_SINGULAR_LABELS[u]).toBeTruthy();
  });

  it('spells NO unit outside the length dimension — mass and time stay codes', () => {
    for (const u of UNIT_CODES) {
      if (UNIT_DIMENSION_BY_CODE[u] === UNIT_DIMENSION.length) continue;
      expect(UNIT_SINGULAR_LABELS[u], `${u} must stay a code`).toBeNull();
    }
  });

  it('the plural is UNIT_LABELS, not a second hand-typed list', () => {
    // Only the irregular singular is new data; English cannot derive `foot` from `feet`.
    expect(UNIT_LABELS.ft.toLowerCase()).toBe('feet');
    expect(UNIT_LABELS.in.toLowerCase()).toBe('inches');
  });
});

/**
 * FAM-1 step 3 — the reference data the seven tracking types need (plan §2, "Reference data owed by
 * step 3"). These replace three of lane A's lines in `program/owed.test.ts`.
 */
describe('FAM-1 step 3: every tracking type is storable', () => {
  // Without a cap, a quantity in that unit is REFUSED (quantityCeiling's contract), so a Count in
  // `count` would be unloggable. The cap for every offered unit is the MAX_QUANTITY_BY_UNIT case
  // above.

  it('(primary, count) and a ceiling for count exist, so a Count in count is storable', () => {
    expect(TRACKING_TYPE_FIELDS[TRACKING_TYPE.count].slot).toBe(QUANTITY_SLOT.primary);
    expect(unitsForTrackingType(TRACKING_TYPE.count)).toContain('count');
    expect(slotAcceptsDimension(QUANTITY_SLOT.primary, UNIT_DIMENSION.count)).toBe(true);
    expect(QUANTITY_SLOT_ROWS).toContainEqual({
      code: QUANTITY_SLOT.primary,
      dimension: UNIT_DIMENSION.count,
    });
    expect(quantityCeiling('count')).toBe(MAX_REPS_PER_SET);
  });

  // Every pair a type can prescribe is a seeded slot pair, so the composite FK never refuses one.
  it.each([...TRACKING_TYPES])('%s: each unit it offers is legal in its slot', (type) => {
    const { slot } = TRACKING_TYPE_FIELDS[type];
    for (const u of unitsForTrackingType(type)) {
      expect(slot && slotAcceptsDimension(slot, UNIT_DIMENSION_BY_CODE[u])).toBe(true);
    }
  });

  it('a distance in mi renders once mi is a unit', () => {
    expect(unitsForTrackingType(TRACKING_TYPE.distance)).toContain('mi');
    expect(
      prescribedText({
        trackingType: TRACKING_TYPE.distance,
        sets: null,
        targetReps: null,
        quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'mi', value: 2 }],
      }),
    ).toBe('2 mi');
    expect(CSV_UNIT_SUFFIX.mi).toBe('mi');
    expect(UNIT_SINGULAR_LABELS.mi).toBe('mile');
  });
});

describe('PLAIN_DECIMAL / isPlainDecimal: a quantity as a person types it', () => {
  it('pins the pattern, byte for byte', () => {
    // A contract pin. The day page and the workout editor each held this exact pattern before it
    // was shared (FAM-1 contract change C2); their swap to this one must change nothing.
    expect(QUANTITY_DECIMALS).toBe(3);
    expect(PLAIN_DECIMAL.source).toBe(String.raw`^(\d+(\.\d{1,3})?|\.\d{1,3})$`);
    expect(PLAIN_DECIMAL.flags).toBe('');
  });

  it.each(['5', '5.5', '.5', '0', '0.5', '0.125', '12345.678', '99999.999', '007', '.001'])(
    'accepts %j',
    (text) => {
      expect(isPlainDecimal(text)).toBe(true);
      // What it accepts, `Number()` reads as a finite number that is not negative.
      expect(Number.isFinite(Number(text))).toBe(true);
      expect(Number(text)).toBeGreaterThanOrEqual(0);
    },
  );

  it.each([
    ['-5', 'a sign'],
    ['+5', 'a sign'],
    ['1e3', 'an exponent'],
    ['0x10', 'hex'],
    ['5.', 'a point with nothing after it'],
    ['.', 'a point alone'],
    ['5 min', 'a unit'],
    ['5 lb', 'a unit'],
    ['5.1234', 'a fourth decimal place'],
    ['.1234', 'a fourth decimal place'],
    ['5,5', 'a comma'],
    ['1,000', 'a thousands separator'],
    ['5.5.5', 'two points'],
    ['', 'nothing'],
    [' ', 'a space'],
    [' 5', 'a leading space (trim first)'],
    ['5 ', 'a trailing space (trim first)'],
    ['5\n', 'a trailing newline'],
    ['Infinity', 'a word Number() accepts'],
    ['NaN', 'a word'],
    ['５', 'a full-width digit'],
  ])('refuses %j: %s', (text) => {
    expect(isPlainDecimal(text)).toBe(false);
  });

  it('refuses forms Number() would accept or half-accept', () => {
    // Why this is a pattern and not `!isNaN(Number(text))`: each of these is a number to `Number()`.
    for (const text of ['-5', '1e3', '0x10', '5.', '', ' 5 ', 'Infinity']) {
      expect(Number.isNaN(Number(text))).toBe(false);
      expect(isPlainDecimal(text)).toBe(false);
    }
  });

  it('follows QUANTITY_DECIMALS: that many places and no more', () => {
    expect(isPlainDecimal(`1.${'1'.repeat(QUANTITY_DECIMALS)}`)).toBe(true);
    expect(isPlainDecimal(`1.${'1'.repeat(QUANTITY_DECIMALS + 1)}`)).toBe(false);
    expect(isPlainDecimal(`.${'1'.repeat(QUANTITY_DECIMALS + 1)}`)).toBe(false);
  });

  it('is the shape only: it sets no ceiling, and keeps no state between calls', () => {
    // A value past every ceiling still has the shape; the ceiling is `quantityCeiling`'s check.
    expect(isPlainDecimal(String(MAX_STORABLE_QUANTITY * 10))).toBe(true);
    expect([1, 2, 3].map(() => isPlainDecimal('5.5'))).toEqual([true, true, true]);
    expect([1, 2, 3].map(() => PLAIN_DECIMAL.test('5.5'))).toEqual([true, true, true]);
  });

  it('is exported from the root barrel', async () => {
    const barrel = await import('./index');
    expect(barrel.PLAIN_DECIMAL).toBe(PLAIN_DECIMAL);
    expect(barrel.isPlainDecimal).toBe(isPlainDecimal);
  });
});

describe('isWholeNumber: reps as a person types them', () => {
  it.each(['8', '12', '007', '0', '1000'])('accepts %s', (text) => {
    expect(isWholeNumber(text)).toBe(true);
  });
  it.each([
    '',
    ' ',
    '8.0',
    '8.',
    '.8',
    '-8',
    '+8',
    '1e2',
    '0x10',
    '8 reps',
    ' 8',
    '8 ',
    '8\n',
    '٨',
    '８',
  ])('refuses %j', (text) => {
    expect(isWholeNumber(text)).toBe(false);
  });
});
