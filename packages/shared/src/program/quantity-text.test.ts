import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CSV_UNIT_SUFFIX, formatNumeric } from '../csv/value';
import { TRACKING_TYPE } from '../movements';
import { QUANTITY_SLOT } from '../quantity-slots';
import { UNIT_CODES, type Unit } from '../units';
import { prescribedText } from './prescribed-text';
import { quantityText } from './quantity-text';

/**
 * The one spelling of a quantity (FAM-1 contract change C1).
 *
 * ⚠️ **These are byte-pins, as `prescribed-text.test.ts`'s are.** `prescribedText` builds on this
 * function and the row writer freezes its text on every logged row.
 */

/**
 * 🔴 **The "before".** What `prescribedText` printed for a Count of each unit on `main` before
 * `quantityText` existed, captured by running it there: every unit code of that day against every
 * number below, 143 strings. Each was the number's text followed by the unit's, so the capture is
 * held as those two lists. Do not "fix" a row to make a test pass: a changed row is a changed byte
 * on every later logged row.
 */
const NUMBER_BEFORE: readonly (readonly [number, string])[] = [
  [0, '0'],
  [1, '1'],
  [7, '7'],
  [30, '30'],
  [400, '400'],
  [1000, '1000'],
  [0.5, '0.5'],
  [2.5, '2.5'],
  [27.5, '27.5'],
  [67.125, '67.125'],
  [99999.999, '99999.999'],
];
const UNIT_BEFORE: Readonly<Record<string, string>> = {
  lb: ' lb',
  kg: ' kg',
  count: '',
  sec: ' s',
  min: ' min',
  bool: ' bool',
  timing: ' timing',
  in: ' in',
  cm: ' cm',
  ft: ' ft',
  m: ' m',
  yd: ' yd',
  mi: ' mi',
};

/** A Count of this quantity: the type whose whole prescription is its one quantity. */
const countOf = (value: number, unit: Unit) =>
  prescribedText({
    trackingType: TRACKING_TYPE.count,
    sets: null,
    targetReps: null,
    quantities: [{ slot: QUANTITY_SLOT.primary, unit, value }],
  });

describe('quantityText: the spelling prescribedText had before it', () => {
  it.each(Object.keys(UNIT_BEFORE))('%s: every captured number, byte for byte', (code) => {
    const unit = code as Unit;
    for (const [value, number] of NUMBER_BEFORE) {
      expect(quantityText(value, unit)).toBe(`${number}${UNIT_BEFORE[code]}`);
    }
  });

  it('holds a captured row for every unit that existed then', () => {
    // The capture is not a sample: no unit code of that day is missing from it.
    for (const code of Object.keys(UNIT_BEFORE)) expect(UNIT_CODES).toContain(code);
    expect(Object.keys(UNIT_BEFORE)).toHaveLength(13);
  });

  it('agrees with the strings prescribed-text.test.ts already pinned', () => {
    // The same literals that file expects of `prescribedText`, where the quantity is the whole text.
    expect(quantityText(10, 'lb')).toBe('10 lb');
    expect(quantityText(5, 'min')).toBe('5 min');
    expect(quantityText(12, 'kg')).toBe('12 kg');
    expect(quantityText(400, 'm')).toBe('400 m');
    expect(quantityText(7, 'count')).toBe('7');
    expect(quantityText(0, 'lb')).toBe('0 lb');
    expect(quantityText(0, 'count')).toBe('0');
    // And where it is a part of the text: `3 × 30 s`, `6 × 40 yd`, `3 × 8 @ 27.5 lb`.
    expect(quantityText(30, 'sec')).toBe('30 s');
    expect(quantityText(40, 'yd')).toBe('40 yd');
    expect(quantityText(27.5, 'lb')).toBe('27.5 lb');
  });

  it('is the rule prescribed-text.ts held privately, for every unit code there is', () => {
    // The removed `withUnit`, verbatim: the CSV's suffix where it has one, else the unit's code,
    // and the plain `count` bare. Run over `UNIT_CODES`, so a unit added later is held to it too.
    const before = (value: number, unit: Unit) =>
      unit === 'count'
        ? formatNumeric(value)
        : `${formatNumeric(value)} ${CSV_UNIT_SUFFIX[unit] || unit}`;
    for (const unit of UNIT_CODES) {
      for (const [value] of NUMBER_BEFORE) {
        expect(quantityText(value, unit)).toBe(before(value, unit));
      }
    }
  });

  it('spells a unit that has no captured row by its code', () => {
    // A unit code added after the capture reads as `mi` does: `3 mi`. Today every code has a row.
    expect(quantityText(3, 'mi')).toBe('3 mi');
    for (const unit of UNIT_CODES.filter((code) => !(code in UNIT_BEFORE))) {
      expect(quantityText(3, unit)).toBe(`3 ${unit}`);
    }
  });
});

describe('quantityText and prescribedText: one spelling', () => {
  it('is what prescribedText writes for a Count of each unit', () => {
    for (const unit of UNIT_CODES) {
      for (const [value] of NUMBER_BEFORE) {
        expect(countOf(value, unit)).toBe(quantityText(value, unit));
      }
    }
  });

  it('is the load and the per-set part of a longer prescription', () => {
    const load = { slot: QUANTITY_SLOT.primary, unit: 'kg', value: 62.5 } as const;
    expect(
      prescribedText({
        trackingType: TRACKING_TYPE.weight_reps,
        sets: 5,
        targetReps: '5',
        quantities: [load],
      }),
    ).toBe(`5 × 5 @ ${quantityText(62.5, 'kg')}`);
    const hold = { slot: QUANTITY_SLOT.primary, unit: 'sec', value: 45 } as const;
    expect(
      prescribedText({
        trackingType: TRACKING_TYPE.time_sets,
        sets: 3,
        targetReps: null,
        quantities: [hold],
      }),
    ).toBe(`3 × ${quantityText(45, 'sec')}`);
  });
});

/** `packages/shared/src`. */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_DIR = `${resolve(SRC, 'csv')}${sep}`;

/** Comments out, so a path a docblock mentions is not read as an import. */
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** The source file a relative specifier names. Throws on one it cannot find, so no import is skipped. */
function sourceOf(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const found = [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(existsSync);
  if (!found) throw new Error(`import scan: cannot resolve '${specifier}' from ${from}`);
  return found;
}

/**
 * Every first-party module `entry` reaches, itself included: each relative `import`, `export … from`
 * and `import()`, followed to the end. Type-only imports count too, which over-reports, the safe
 * direction for a "never reaches" check.
 */
function reachedFrom(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, specifier] of code(file).matchAll(
      /\b(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g,
    )) {
      visit(sourceOf(file, specifier));
    }
  };
  visit(entry);
  return [...seen];
}

const inCsv = (file: string) => file.startsWith(CSV_DIR);

describe('quantityText is client-safe', () => {
  it('reaches nothing under csv/, through anything it imports', () => {
    const reached = reachedFrom(resolve(SRC, 'program/quantity-text.ts'));
    expect(reached.filter(inCsv)).toEqual([]);
    // Not a vacuous pass: the scan did follow its imports.
    expect(reached).toContain(resolve(SRC, 'quantity-spelling.ts'));
    expect(reached).toContain(resolve(SRC, 'units.ts'));
  });

  it('is scanned by something that does see a csv/ import', () => {
    // The control: `prescribedText` builds on the CSV's renderer, and the same scan says so.
    const reached = reachedFrom(resolve(SRC, 'program/prescribed-text.ts'));
    expect(reached).toContain(resolve(SRC, 'csv/prescribed.ts'));
  });

  it('is exported from the root barrel, whose whole graph stays out of csv/', async () => {
    const barrel = await import('../index');
    expect(barrel.quantityText).toBe(quantityText);
    expect('prescribedText' in barrel).toBe(false);
    expect(reachedFrom(resolve(SRC, 'index.ts')).filter(inCsv)).toEqual([]);
  });

  it('leaves the CSV its own primitives, unchanged', async () => {
    // `formatNumeric` moved to `quantity-spelling.ts`; `csv/value.ts` re-exports the same function,
    // and the suffix map still holds the corpus's `s`. `apps/web/lib/csv/strength-log.test.ts` holds
    // the full set of pins, and passes untouched.
    const spelling = await import('../quantity-spelling');
    const csv = await import('../csv/index');
    expect(csv.formatNumeric).toBe(spelling.formatNumeric);
    expect(CSV_UNIT_SUFFIX.sec).toBe('s');
    expect(csv.formatQuantity('20.000', 'sec', 'a hold')).toBe('20s');
    expect(csv.formatQuantity('67.500', 'lb', 'a load')).toBe('67.5');
  });
});
