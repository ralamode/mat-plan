import { describe, expect, it } from 'vitest';

import { PROFILE_KIND, PROFILE_KIND_LABELS, PROFILE_KINDS } from './enums';
import {
  addAthleteSchema,
  athleteNameSchema,
  PROFILE_NAME_MAX,
  renameAthleteSchema,
} from './profiles';

const PROFILE_ID = '019826b4-0000-7000-8000-0000000000a1';

/**
 * ⚠️ **Every name below is INVENTED** — see `text.test.ts`'s note. They exercise a transform (a
 * collapse, a trim, a combining mark), not a person.
 *
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
    // 🔴 Both found by a review lens, both probed accepted BEFORE the fix.
    ['\u200b', 'a zero-width space only — it would store and render as nothing'],
    ['\u200b\u2060\u00ad', 'format characters only — ZWSP, word joiner, soft hyphen'],
    ['\u0000Ada', 'a NUL byte — `text` rejects it, so this THREW past the typed envelope'],
    ['Ada\u0007', 'any other control character'],
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
  /** A zero-width space INSIDE a real name is still stored — the guard is about names that render
   *  as nothing, not about policing every invisible codepoint in a name a person chose. */
  it('keeps a name that merely CONTAINS a format character', () => {
    expect(athleteNameSchema.safeParse('a\u200bb').success).toBe(true);
  });

  /**
   * 🔴 **A line break in a NAME becomes a space; it is not refused** — and that is the deliberate
   * difference from `freeTextNoteSchema`, which refuses one. That rule is the CSV contract ("a CR/LF
   * splits the RECORD"), and `profiles.name` **never reaches an export** — so there is no record to
   * split, and a spreadsheet paste should produce a usable name rather than an error. What IS
   * refused is a control character that survives the collapse (above): the NUL that makes Postgres
   * throw past the typed envelope.
   */
  it('turns a pasted line break or tab into a space rather than refusing it', () => {
    expect(athleteNameSchema.parse('Ada\nMae')).toBe('Ada Mae');
    expect(athleteNameSchema.parse('Ada\r\nMae')).toBe('Ada Mae');
    expect(athleteNameSchema.parse('Ada\tMae')).toBe('Ada Mae');
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

describe('addAthleteSchema (PROF-1 a-1)', () => {
  const ok = {
    name: 'Ada',
    kind: PROFILE_KIND.kid,
    clientId: '019826b4-0000-7000-8000-00000000f001',
  };

  it('accepts a name, a kind and a client id', () => {
    expect(addAthleteSchema.safeParse(ok).success).toBe(true);
  });

  /**
   * 🔴 **The message is pinned because zod's DEFAULT would leak the schema's vocabulary.**
   * Probed on the pinned zod: `z.enum(PROFILE_KINDS)` with no message emits
   * `Invalid option: expected one of "kid"|"adult"` — the raw values. **`kid` must never reach a
   * screen** _(maintainer, 2026-11-09)_; every surface renders it as "Child". So this asserts the
   * authored string, and the literal belongs on the assertion side exactly once.
   */
  it.each([
    ['a value that is not a kind', { ...ok, kind: 'grown-up' }],
    ['no kind at all', { name: ok.name, clientId: ok.clientId }],
  ])('%s is refused in the PERSON’s words, never the column’s', (_label, body) => {
    const parsed = addAthleteSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    const message = parsed.success ? '' : (parsed.error.flatten().fieldErrors.kind?.[0] ?? '');
    expect(message).toBe('Choose Child or Adult.');
    // The guard on the guard: no stored value may appear in anything a person reads.
    for (const stored of PROFILE_KINDS) expect(message).not.toContain(stored);
  });

  it('refuses a malformed client id — it is a hidden field, so there is nothing to correct', () => {
    const parsed = addAthleteSchema.safeParse({ ...ok, clientId: 'not-a-uuid' });
    expect(parsed.success).toBe(false);
  });

  /** The name rules are `athleteNameSchema`'s and are covered above; this proves add USES them. */
  it('applies the shared name rules rather than its own', () => {
    const parsed = addAthleteSchema.safeParse({ ...ok, name: '   ' });
    expect(parsed.success).toBe(false);
  });
});
