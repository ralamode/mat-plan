import { describe, expect, it } from 'vitest';

import {
  BODYWEIGHT_BOUNDS,
  BODYWEIGHT_UNITS,
  type BodyweightUnit,
  DEFAULT_BODYWEIGHT_UNIT,
  IMPLAUSIBLE_BODYWEIGHT_MESSAGE,
  logBodyweightSchema,
} from './bodyweight';
import { newId } from './id';

/**
 * V1-24 PR 1a — the plausibility bound. It is what makes a weigh-in with no amend acceptable: a
 * slipped decimal (`845`, `8.45` for `84.5`) is refused before it is saved, because after it is saved
 * nothing in the app can change it.
 */
const LB = DEFAULT_BODYWEIGHT_UNIT;
const KG: BodyweightUnit = 'kg';

const parse = (value: string, unit: string) =>
  logBodyweightSchema.safeParse({ profileId: newId(), value, unit, clientId: newId() });

const valueErrors = (value: string, unit: string) => {
  const r = parse(value, unit);
  return r.success ? [] : (r.error.flatten().fieldErrors.value ?? []);
};

describe('logBodyweightSchema — the plausibility bound (V1-24 PR 1a)', () => {
  it('pins the bound itself (the plan: 20–500 lb, 10–230 kg)', () => {
    expect(BODYWEIGHT_BOUNDS).toEqual({ lb: { min: 20, max: 500 }, kg: { min: 10, max: 230 } });
  });

  // Every unit, both edges, both sides of each edge — generated from the SAME constant the schema
  // reads, so a unit added to BODYWEIGHT_UNITS without a bound fails to type-check, not silently here.
  for (const unit of BODYWEIGHT_UNITS) {
    const { min, max } = BODYWEIGHT_BOUNDS[unit];

    it(`accepts ${unit} at both edges, inclusive (${min} and ${max})`, () => {
      expect(parse(String(min), unit).success).toBe(true);
      expect(parse(String(max), unit).success).toBe(true);
    });

    it(`rejects ${unit} just outside either edge, on the value field, with the decimal-point hint`, () => {
      expect(valueErrors(String(min - 0.1), unit)).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
      expect(valueErrors(String(max + 0.1), unit)).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
    });
  }

  it('refuses the slipped-decimal typos it exists for', () => {
    expect(valueErrors('845', LB)).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
    expect(valueErrors('8.45', LB)).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
    expect(parse('84.5', LB).success).toBe(true);
  });

  it('bounds by the SUBMITTED unit — 300 is a plausible lb and an implausible kg', () => {
    expect(parse('300', LB).success).toBe(true);
    expect(valueErrors('300', KG)).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
  });

  it('still rejects a zero or non-number', () => {
    expect(valueErrors('0', LB)).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
    expect(parse('abc', LB).success).toBe(false);
  });
});
