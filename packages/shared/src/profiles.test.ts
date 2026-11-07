import { describe, expect, it } from 'vitest';

import { PROFILE_KIND_LABELS, PROFILE_KINDS } from './enums';
import { athleteNameSchema, PROFILE_NAME_MAX, renameAthleteSchema } from './profiles';

const PROFILE_ID = '019826b4-0000-7000-8000-0000000000a1';

/**
 * PROF-1 a-r — the name boundary. Every case here is one a crafted body or a real parent can produce,
 * and the transform cases pin what gets STORED, not just what is accepted.
 */
describe('athleteNameSchema — what is stored', () => {
  it.each([
    ['  Ada  ', 'Ada', 'the ends are trimmed'],
    ['a   b', 'a b', 'interior whitespace collapses, so the stored name matches the folded one'],
    ['Ada\tMae', 'Ada Mae', 'a tab is whitespace too'],
    ['Zoë', 'Zoë', 'the accent is KEPT — folding is for comparison, never for storage'],
  ])('%s is stored as %s (%s)', (input, stored) => {
    expect(athleteNameSchema.parse(input)).toBe(stored);
  });

  it('accepts exactly the cap', () => {
    const atCap = 'a'.repeat(PROFILE_NAME_MAX);
    expect(athleteNameSchema.parse(atCap)).toBe(atCap);
  });
});

describe('athleteNameSchema — what is refused', () => {
  /**
   * 🔴 **Exactly ONE message per failure, not merely "at least one".** A whitespace-only name failed
   * both the length check and the fold check — `.refine` does not abort the chain — so the form,
   * which joins a field's messages, rendered **"Enter a name. Enter a name."** on screen. A test
   * asserting `length > 0` stayed green through all of it; a SCREENSHOT caught it. This is why the
   * schema uses `superRefine`.
   */
  it.each([
    ['', 'blank'],
    ['   ', 'whitespace only — trims to blank'],
    ['\u0301\u0302', "combining marks only: it would store, render as nothing, and fold to ''"],
    ['a'.repeat(PROFILE_NAME_MAX + 1), 'one over the cap'],
    ['Ada\nMae', 'an interior line break'],
  ])('refuses %j (%s), with exactly one message', (input) => {
    const parsed = athleteNameSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toHaveLength(1);
  });

  it('refuses one character over the cap, measured AFTER collapsing', () => {
    expect(athleteNameSchema.safeParse('a'.repeat(PROFILE_NAME_MAX + 1)).success).toBe(false);
    // …and whitespace cannot buy length: 40 letters plus spaces collapses to 40, so it passes.
    expect(athleteNameSchema.safeParse(`  ${'a'.repeat(PROFILE_NAME_MAX)}  `).success).toBe(true);
  });

  /**
   * An interior CR/LF only reaches here from a crafted body — a text input strips them on paste — so
   * this is the trust-boundary half, the same guard `freeTextNoteSchema` makes for `notes`.
   */
  it('refuses an interior line break', () => {
    expect(athleteNameSchema.safeParse('Ada\nMae').success).toBe(false);
    expect(athleteNameSchema.safeParse('Ada\r\nMae').success).toBe(false);
  });
});

describe('renameAthleteSchema', () => {
  it('accepts a profile id and a name', () => {
    expect(renameAthleteSchema.parse({ profileId: PROFILE_ID, name: '  Ada  ' })).toEqual({
      profileId: PROFILE_ID,
      name: 'Ada',
    });
  });

  it('refuses a non-uuid profile id', () => {
    expect(renameAthleteSchema.safeParse({ profileId: 'new', name: 'Ada' }).success).toBe(false);
  });

  /**
   * 🔴 The rename body carries NO `kind`, and that is the decision of 2026-11-07, not an omission —
   * so it is asserted. `kind` arriving in the body must be ignored rather than applied: a form that
   * started sending it would otherwise silently begin flipping a kid to an adult, which is the exact
   * write this chunk was cut to not perform.
   */
  it('ignores a kind in the body — rename cannot change what an athlete is', () => {
    const parsed = renameAthleteSchema.parse({
      profileId: PROFILE_ID,
      name: 'Ada',
      kind: 'adult',
    });
    expect(parsed).not.toHaveProperty('kind');
  });
});

describe('PROFILE_KIND_LABELS', () => {
  /** Criterion 9's own words: Child / Adult, with `kid` / `adult` still stored. */
  it('labels every stored kind, and the pair is the published copy', () => {
    for (const kind of PROFILE_KINDS) expect(PROFILE_KIND_LABELS[kind]).toBeTruthy();
    expect(PROFILE_KIND_LABELS.kid).toBe('Child');
    expect(PROFILE_KIND_LABELS.adult).toBe('Adult');
  });

  /** No extra keys: a label for a kind that cannot be stored is a surface nothing reaches. */
  it('has an entry per kind and no others', () => {
    expect(Object.keys(PROFILE_KIND_LABELS).sort()).toEqual([...PROFILE_KINDS].sort());
  });
});
