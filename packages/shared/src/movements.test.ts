import { describe, expect, it } from 'vitest';

import {
  MOVEMENT_NAME_MAX,
  MOVEMENT_NAME_MESSAGES,
  movementLabelSchema,
  movementNameSchema,
} from './movements';

/**
 * The movement-name rules, beside the schemas that hold them. Moved here from the deleted legacy
 * session-schema test (LEGACY-1 C2b), which asserted them through `logStrengthSessionSchema`; the
 * same cases now run on the two live schemas: `movementNameSchema` (a TYPED name) and
 * `movementLabelSchema` (a name the database supplied).
 */

/** Every message the parse produced, flattened. */
const messagesOf = (name: unknown): string[] => {
  const res = movementNameSchema.safeParse(name);
  return res.success ? [] : res.error.issues.map((i) => i.message);
};

describe('MOVEMENT_NAME_MAX', () => {
  // ⚠️ The CONTRACT test that pins the const's value, exactly once (AGENTS.md → constants): the
  // literal belongs on the assertion side here, or the test is tautological. Everything else below
  // asserts through MOVEMENT_NAME_MESSAGES / MOVEMENT_NAME_MAX.
  it('pins MOVEMENT_NAME_MAX at 100 — the number the inline .max(100) used to carry', () => {
    expect(MOVEMENT_NAME_MAX).toBe(100);
  });
});

describe('movementNameSchema — a TYPED name earns the typed-name rules (PICK-1 PR 2)', () => {
  it('accepts a real movement name, trimmed', () => {
    expect(movementNameSchema.parse('  Back Squat  ')).toBe('Back Squat');
  });

  it.each([
    ['a,b', MOVEMENT_NAME_MESSAGES.commaOrLineBreak],
    ['Bench\npress', MOVEMENT_NAME_MESSAGES.commaOrLineBreak],
    ['🙂', MOVEMENT_NAME_MESSAGES.noLetter],
    ['  ', MOVEMENT_NAME_MESSAGES.missing],
    ['a'.repeat(MOVEMENT_NAME_MAX + 1), MOVEMENT_NAME_MESSAGES.tooLong],
  ])('refuses %j with the named message', (name, message) => {
    expect(messagesOf(name)).toContain(message);
  });

  it.each(['🙂', '123', '---', '   .   '])('refuses %j — no letter', (name) => {
    expect(messagesOf(name)).toContain(MOVEMENT_NAME_MESSAGES.noLetter);
  });

  it('accepts a non-Latin name — the rule is \\p{L}, not [a-z]', () => {
    expect(movementNameSchema.safeParse('приседания').success).toBe(true);
  });

  it('accepts a digit-bearing name with a letter, and a straight quote', () => {
    expect(movementNameSchema.safeParse('30" Box Jump').success).toBe(true);
  });

  it('reports BOTH rules for a name that breaks both — one message per fault', () => {
    const msgs = messagesOf('1,2');
    expect(msgs).toContain(MOVEMENT_NAME_MESSAGES.commaOrLineBreak);
    expect(msgs).toContain(MOVEMENT_NAME_MESSAGES.noLetter);
  });

  // 🔴 `toEqual`, not `toContain`, and that is the whole point of this test. A blank name is the
  // most common error a spare card on a gym floor produces, and PICK-1 PR 2's first draft answered
  // it with TWO messages — `missing` plus `noLetter`, because a zod `.min()` failure does not abort
  // the refinements after it. `typedMovementNameIssues` now skips `noLetter` for an empty value.
  it('refuses a blank name with EXACTLY one message', () => {
    expect(messagesOf('  ')).toEqual([MOVEMENT_NAME_MESSAGES.missing]);
  });

  // ⚠️ **One fault, one message — but NOT because zod skips the refinement.** A `.min()`/`.max()`
  // failure is non-aborting, so the typed-name rules DO run on an over-long name. This one earns one
  // message only because a letters-only name breaks no typed-name rule; the case after it is the
  // proof.
  it('refuses an over-long name with exactly that one message', () => {
    expect(messagesOf('a'.repeat(MOVEMENT_NAME_MAX + 1))).toEqual([MOVEMENT_NAME_MESSAGES.tooLong]);
  });

  it('reports BOTH faults for a name that is too long AND has a comma', () => {
    const msgs = messagesOf('a,'.repeat(MOVEMENT_NAME_MAX));
    expect(msgs).toContain(MOVEMENT_NAME_MESSAGES.tooLong);
    expect(msgs).toContain(MOVEMENT_NAME_MESSAGES.commaOrLineBreak);
  });

  it('accepts exactly MOVEMENT_NAME_MAX characters', () => {
    expect(movementNameSchema.safeParse('a'.repeat(MOVEMENT_NAME_MAX)).success).toBe(true);
  });
});

describe('movementLabelSchema — a name the DATABASE supplied does not (correctness S1)', () => {
  // 🔴 A label read from a `movements` row must never be refused for a rule the household cannot
  // fix by editing it. Only the label shape applies.
  it.each([
    ['a comma', 'Bench, close grip'],
    ['a line break', 'Bench\npress'],
    ['no letter', '🙂'],
  ])('accepts a label with %s', (_why, name) => {
    expect(movementLabelSchema.safeParse(name).success).toBe(true);
  });

  it('still refuses a blank or over-long label, with the same messages', () => {
    const issues = (v: string) => {
      const res = movementLabelSchema.safeParse(v);
      return res.success ? [] : res.error.issues.map((i) => i.message);
    };
    expect(issues('  ')).toEqual([MOVEMENT_NAME_MESSAGES.missing]);
    expect(issues('a'.repeat(MOVEMENT_NAME_MAX + 1))).toEqual([MOVEMENT_NAME_MESSAGES.tooLong]);
  });
});
