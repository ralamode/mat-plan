import { isBlankEntry } from './text';
import { describe, expect, it } from 'vitest';

import {
  BODYWEIGHT_BOUNDS,
  BODYWEIGHT_CONTEXTS,
  BODYWEIGHT_UNITS,
  DEFAULT_BODYWEIGHT_CONTEXT,
  DEFAULT_BODYWEIGHT_UNIT,
  IMPLAUSIBLE_BODYWEIGHT_MESSAGE,
  editBodyweightSchema,
  logBodyweightSchema,
  type BodyweightUnit,
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
    expect(valueErrors('abc', LB)).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
  });
});

describe('editBodyweightSchema (V1-24 PR 1b)', () => {
  const valid = {
    profileId: '019826b4-0000-7000-8000-000000000001',
    entryId: '019826b4-0000-7000-8000-0000000000aa',
    // FormData only ever carries strings, and since 3b-bw the field is text, so the schema takes text.
    value: '85.2',
    unit: 'lb',
    seenValue: '84.5',
  };

  it('accepts a plausible correction', () => {
    expect(editBodyweightSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * ⚠️ THE regression test for the restructure. The amend is the one path that writes a *corrected*
   * weight, so a version of it that skipped the bound would be a brand-new way to write the `845`
   * the bound exists to stop — and the plan accepted a no-amend 1a precisely because it was there.
   *
   * It is a real risk, not a theoretical one: the draft plan reached for `logBodyweightSchema.pick()`,
   * which would have silently dropped the refinement even if zod had allowed it (it does not — see
   * the module docblock).
   */
  it('rejects an implausible weight, exactly as the log path does', () => {
    const tooBig = editBodyweightSchema.safeParse({ ...valid, value: '845' });
    expect(tooBig.success).toBe(false);
    expect(tooBig.error!.flatten().fieldErrors.value).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);

    expect(editBodyweightSchema.safeParse({ ...valid, value: '8.45' }).success).toBe(false);
  });

  it('applies the bound of the submitted unit', () => {
    // 450 is inside the lb bound (≤ 500) and outside the kg bound (≤ 230).
    expect(editBodyweightSchema.safeParse({ ...valid, value: '450', unit: 'lb' }).success).toBe(
      true,
    );
    expect(editBodyweightSchema.safeParse({ ...valid, value: '450', unit: 'kg' }).success).toBe(
      false,
    );
  });

  it('requires the ids and the seen value', () => {
    for (const key of ['profileId', 'entryId', 'seenValue'] as const) {
      const { [key]: _dropped, ...rest } = valid;
      expect(editBodyweightSchema.safeParse(rest).success).toBe(false);
    }
  });

  it('coerces the form’s strings', () => {
    const parsed = editBodyweightSchema.safeParse({ ...valid, value: '85.2', seenValue: '84.5' });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.value).toBe(85.2);
    expect(parsed.data!.seenValue).toBe(84.5);
  });

  // V1-24 3b-bw (plan W7): a blank Save clears the weigh-in.
  it('reads a field that is empty after trim as a clear (null)', () => {
    for (const blank of ['', '  ']) {
      const parsed = editBodyweightSchema.safeParse({ ...valid, value: blank });
      expect(parsed.success).toBe(true);
      expect(parsed.data!.value).toBeNull();
    }
  });

  it('refuses an ABSENT value, a null and a File — a clear is only ever a typed empty field', () => {
    const { value: _dropped, ...absent } = valid;
    expect(editBodyweightSchema.safeParse(absent).success).toBe(false);
    expect(editBodyweightSchema.safeParse({ ...valid, value: null }).success).toBe(false);
    expect(editBodyweightSchema.safeParse({ ...valid, value: new File([], 'x') }).success).toBe(
      false,
    );
  });

  it('refuses text that is not a weight, with the bound’s own copy', () => {
    for (const bad of ['84..5', 'abc', '1e2', '0x50', '-85', '84.5555']) {
      const r = editBodyweightSchema.safeParse({ ...valid, value: bad });
      expect(r.success, bad).toBe(false);
      expect(r.error!.flatten().fieldErrors.value, bad).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
    }
  });
});

describe('both schemas read a typed weight the same way (V1-24 3b-bw, plan W3)', () => {
  it('takes one comma as the decimal point', () => {
    const parsed = logBodyweightSchema.safeParse({
      profileId: newId(),
      value: '84,5',
      unit: LB,
      clientId: newId(),
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.value).toBe(84.5);
  });

  it('refuses text that is not a weight on the log path, with the bound’s own copy', () => {
    for (const bad of ['84..5', 'abc', '1e2', '0x50', '', '84.5555']) {
      expect(valueErrors(bad, LB), bad).toEqual([IMPLAUSIBLE_BODYWEIGHT_MESSAGE]);
    }
  });

  it('isBlankEntry is true only for a string that is empty after trim', () => {
    expect(isBlankEntry('')).toBe(true);
    expect(isBlankEntry(' \t')).toBe(true);
    expect(isBlankEntry('0')).toBe(false);
    expect(isBlankEntry(null)).toBe(false);
    expect(isBlankEntry(undefined)).toBe(false);
  });
});

// Contract pin: `uq_entries_profile_day_bodyweight` (migration 0012) keys on
// `coalesce(context, 'morning')` with the value as a SQL literal. If the default slot ever changes,
// NULL and the default stop being the same slot — change the index in the same PR.
describe('the default weigh-in slot (V1-24 PR 1d)', () => {
  it("is 'morning', the literal the unique index coalesces NULL to", () => {
    expect(DEFAULT_BODYWEIGHT_CONTEXT).toBe('morning');
    expect(BODYWEIGHT_CONTEXTS).toContain(DEFAULT_BODYWEIGHT_CONTEXT);
  });
});
