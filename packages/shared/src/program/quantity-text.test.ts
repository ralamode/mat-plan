import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { reachedFrom, specifiersOf, SRC } from '../test-support/source-graph';
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

const CSV_DIR = `${resolve(SRC, 'csv')}${sep}`;

const inCsv = (file: string) => file.startsWith(CSV_DIR);

/**
 * 🔴 **The packages client-safe contract code may name, in full.** `zod` is all `quantityText`
 * reaches (through `units.ts`); the root barrel adds `uuid`. Both run in a browser. A new name here
 * is a decision: a `node:` builtin, `server-only` or this package's own `/csv` subpath must never
 * be added to make a test pass.
 */
const QUANTITY_TEXT_PACKAGES = ['zod'];
const ROOT_BARREL_PACKAGES = ['uuid', 'zod'];

describe('quantityText is client-safe', () => {
  it('reaches nothing under csv/, through anything it imports', () => {
    const { files } = reachedFrom(resolve(SRC, 'program/quantity-text.ts'));
    expect(files.filter(inCsv)).toEqual([]);
    // Not a vacuous pass: the scan did follow its imports.
    expect(files).toContain(resolve(SRC, 'quantity-spelling.ts'));
    expect(files).toContain(resolve(SRC, 'units.ts'));
  });

  it('names no package but zod, through anything it imports', () => {
    // A bare specifier is the route a relative-path scan cannot see: `@mat-plan/shared/csv` is
    // `csv/` by another name, and `node:fs` or `server-only` breaks a client bundle outright.
    const { packages } = reachedFrom(resolve(SRC, 'program/quantity-text.ts'));
    expect(packages).toEqual(QUANTITY_TEXT_PACKAGES);
  });

  it('builds on a module that imports nothing at all', () => {
    // `quantity-spelling.ts` is read by the CSV and by client code: no relative import, no package.
    expect(specifiersOf(resolve(SRC, 'quantity-spelling.ts'))).toEqual([]);
    expect(specifiersOf(resolve(SRC, 'program/quantity-text.ts')).sort()).toEqual([
      '../quantity-spelling',
      '../units',
    ]);
  });

  it('is scanned by something that does see a csv/ import', () => {
    // The control: `prescribedText` builds on the CSV's renderer, and the same scan says so.
    const { files } = reachedFrom(resolve(SRC, 'program/prescribed-text.ts'));
    expect(files).toContain(resolve(SRC, 'csv/prescribed.ts'));
  });

  it('is scanned by something that does see a planted package, however it is imported', () => {
    // The control for bare specifiers: a module two steps from the entry names a Node builtin, this
    // package's own csv subpath, and a marker package, in each form an import can take. The scan
    // must report every one, and the allowlist must refuse every one.
    const dir = mkdtempSync(join(tmpdir(), 'quantity-text-scan-'));
    try {
      writeFileSync(join(dir, 'entry.ts'), `export * from './middle';\n`);
      writeFileSync(
        join(dir, 'middle.ts'),
        [
          `import type { Unit } from 'zod';`,
          `import {`,
          `  leaf,`,
          `} from './leaf';`,
          `export const middle = (u: Unit) => leaf(u);`,
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'leaf.ts'),
        [
          `import 'server-only';`,
          `import { readFileSync } from 'node:fs';`,
          `export { formatQuantity } from '@mat-plan/shared/csv';`,
          `const lazy = () => import('node:path');`,
          `const old = require("node:os");`,
          `// import { never } from 'a-comment-is-not-an-import';`,
          `export const leaf = (u: unknown) => [u, readFileSync, lazy, old];`,
        ].join('\n'),
      );
      const { files, packages } = reachedFrom(join(dir, 'entry.ts'));
      expect(files).toHaveLength(3);
      expect(packages).toEqual([
        '@mat-plan/shared/csv',
        'node:fs',
        'node:os',
        'node:path',
        'server-only',
        'zod',
      ]);
      expect(packages.filter((name) => !QUANTITY_TEXT_PACKAGES.includes(name))).toEqual([
        '@mat-plan/shared/csv',
        'node:fs',
        'node:os',
        'node:path',
        'server-only',
      ]);
      expect(packages).not.toEqual(QUANTITY_TEXT_PACKAGES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is exported from the root barrel, whose whole graph stays out of csv/', async () => {
    const barrel = await import('../index');
    expect(barrel.quantityText).toBe(quantityText);
    expect('prescribedText' in barrel).toBe(false);
    const { files, packages } = reachedFrom(resolve(SRC, 'index.ts'));
    expect(files.filter(inCsv)).toEqual([]);
    expect(packages).toEqual(ROOT_BARREL_PACKAGES);
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
