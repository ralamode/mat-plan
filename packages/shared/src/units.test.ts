import { describe, expect, it } from 'vitest';

import { BODYWEIGHT_UNITS, DEFAULT_BODYWEIGHT_UNIT } from './bodyweight';
import { buildBodyweight } from './csv/bodyweight';
import { EXPORTABLE_UNITS } from './csv/value';
import { sessionMovementSchema } from './strength-session';
import {
  isLoggableUnit,
  LOGGABLE_DIMENSION_NOUNS,
  LOGGABLE_DIMENSIONS,
  LOGGABLE_UNITS,
  loggableUnitsOf,
  UNIT_CODES,
  unitsOfDimension,
  MASS_QUANTITY_CEILING,
  MAX_STORABLE_QUANTITY,
  UNIT_LABELS,
  quantityCeiling,
  UNIT_DIMENSION,
  UNIT_DIMENSION_BY_CODE,
  UNIT_SINGULAR_LABELS,
} from './units';

/**
 * **The chain (V1-30): every unit the form can put in state is one the server accepts, and every unit
 * the server accepts is one the export can write.**
 *
 * Each link is "true by construction" in its own file; this checks them against each other
 * (docs/plans/v1-30-loggable-units.md). It runs the WIRED field (`sessionMovementSchema.shape.unit`,
 * what the action actually validates with), not a helper, so reverting the field to
 * `z.enum(BODYWEIGHT_UNITS)` turns it red.
 */
describe('offerable ⊆ accepted ⊆ exportable', () => {
  const wiredUnit = sessionMovementSchema.shape.unit;

  // Every way a unit reaches the form's movement state: the Unit select (per dimension), the
  // household default, and the bodyweight units the default is drawn from. A catalog default is
  // filtered through `isLoggableUnit` in the scaffold, so it is already one of these.
  const offerable = [
    ...new Set([
      ...LOGGABLE_DIMENSIONS.flatMap(loggableUnitsOf),
      DEFAULT_BODYWEIGHT_UNIT,
      ...BODYWEIGHT_UNITS,
    ]),
  ];

  // Independent of the server's enum: every dimension the Measuring select offers must have units,
  // or the form shows "Time" with an empty Unit select (loggableUnitsOf filters through the schema).
  it.each(LOGGABLE_DIMENSIONS)('the form offers every %s unit', (d) => {
    expect(loggableUnitsOf(d)).toEqual(unitsOfDimension(d));
    expect(loggableUnitsOf(d).length).toBeGreaterThan(0);
  });

  it.each(offerable)('the server accepts %s', (unit) => {
    expect(wiredUnit.safeParse(unit).success).toBe(true);
  });

  it.each(wiredUnit.options)('the export can write %s', (unit) => {
    expect(EXPORTABLE_UNITS).toContain(unit);
  });

  // The bodyweight CSV is a SECOND export path with its own per-unit rule, and `EXPORTABLE_UNITS`
  // (the strength-load spelling, `85kg`) is no spelling for the `weight_lb` column. Without this
  // link, a third bodyweight unit passes every check above and then throws inside `buildBodyweight`
  // at export time -- 500-ing the profile's whole export history, which is the failure CSV-1's own
  // review rejected. Fail here instead, where it costs a test run.
  it.each(BODYWEIGHT_UNITS)('the bodyweight export can write %s', (unit) => {
    expect(() =>
      buildBodyweight([{ date: '2026-09-30', weight: '50', unit, context: '', notes: '' }]),
    ).not.toThrow();
  });
});

describe('the units no form offers', () => {
  const NON_LOGGABLE = UNIT_CODES.filter((u) => !isLoggableUnit(u));

  // The one literal pin of this set (AGENTS.md → constants). A new unit code lands in exactly one of
  // the two lists, and this says which.
  it('are exactly bool, count and timing', () => {
    expect([...NON_LOGGABLE].sort()).toEqual(['bool', 'count', 'timing']);
  });

  it.each(NON_LOGGABLE)('%s is refused by the server and has no CSV spelling', (unit) => {
    expect(sessionMovementSchema.shape.unit.safeParse(unit).success).toBe(false);
    expect(EXPORTABLE_UNITS).not.toContain(unit);
  });
});

describe('copy for every loggable dimension', () => {
  it.each(LOGGABLE_DIMENSIONS)('%s has a noun for error messages', (d) => {
    expect(LOGGABLE_DIMENSION_NOUNS[d]).toBeTruthy();
  });
});

/**
 * V1-30b-ii — the per-unit stored-value ceiling. This is the guard `units.ts` and
 * `strength-session.ts` both cite: the refine treats a MISSING cap as "refuse", and this is what keeps
 * that branch unreachable rather than load-bearing.
 */
describe('MAX_QUANTITY_BY_UNIT / quantityCeiling', () => {
  it.each([...LOGGABLE_UNITS])('%s has a ceiling that fits numeric(8,3)', (u) => {
    const cap = quantityCeiling(u);
    expect(cap, `no ceiling declared for ${u}`).toBeDefined();
    expect(cap!).toBeLessThanOrEqual(MAX_STORABLE_QUANTITY);
    expect(cap!).toBeGreaterThan(0);
  });

  it('the two mass units share ONE ceiling, so the log and edit paths cannot drift', () => {
    // `numericSetSchema.max()` (the edit path) reads the same const; re-typing it there is how the
    // two paths would disagree with nothing red.
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
