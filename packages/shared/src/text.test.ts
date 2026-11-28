import { describe, expect, it } from 'vitest';

import { foldName, freeTextNoteSchema, isBlankEntry } from './text';

/**
 * ⚠️ **Every name below is INVENTED**, chosen for the Unicode property it exercises (a combining
 * mark, the three apostrophes, a compatibility ligature, full-width letters) and not drawn from any
 * real household. Said once, here, so the next personal-data sweep does not have to ask — the repo's
 * FIXTURE convention is role names (`Athlete One`), which `db:verify` and the seed follow; a schema
 * test needs inputs that actually decompose, which role names do not.
 *
 * PROF-1 D11 — the name fold, pinned by the cases that drove each step. Four surfaces will compare
 * names through this (rename a-r, the duplicate warning a-1d, PICK-1, MOV-1), so a change here
 * changes what every one of them calls a duplicate.
 */
describe('foldName', () => {
  it.each([
    ['Zoë', 'zoe', 'a combining mark is stripped after decomposition'],
    ['O’Neil', "o'neil", 'the curly apostrophe people actually type folds to the ASCII one'],
    ["O'Neil", "o'neil", '…and the ASCII one is already the target'],
    ['Oʼneil', "o'neil", 'U+02BC MODIFIER LETTER APOSTROPHE, which iOS inserts, folds too'],
    ['Crème', 'creme', 'a grave accent is a combining mark under NFKD'],
    ['ﬁona', 'fiona', 'a COMPATIBILITY ligature — this is the NFD-vs-NFKD case'],
    ['Ｚｏｅ', 'zoe', 'full-width letters are a compatibility form too'],
    ['  Ada   Mae ', 'ada mae', 'interior whitespace collapses and the ends are trimmed'],
  ])('%s → %s (%s)', (input, expected) => {
    expect(foldName(input)).toBe(expected);
  });

  /**
   * 🔴 The lossy case, asserted rather than left implicit. `athleteNameSchema` rejects such a name at
   * the boundary (see its `refine`), which is the only reason the fold is allowed to answer `''` —
   * a caller that treated `''` as "no duplicate found" would be reading this wrong.
   */
  it('a name of only combining marks folds to the empty string', () => {
    expect(foldName('́̂')).toBe('');
  });

  /** NFD would leave the ligature and the full-width letters distinct; NFKD is what makes them equal. */
  it('folds two names a parent reads as identical to the SAME key', () => {
    expect(foldName('ﬁona')).toBe(foldName('Fiona'));
    expect(foldName('Ｚｏｅ')).toBe(foldName('Zoe'));
    expect(foldName('Zoë')).toBe(foldName('Zoe'));
  });

  /** …and does not collapse two names that really are different. */
  it('keeps distinct names distinct', () => {
    expect(foldName('Ada')).not.toBe(foldName('Adam'));
    expect(foldName('Jo Ann')).not.toBe(foldName('Joann'));
  });
});

describe('isBlankEntry (V1-24 3b-bw; shared with practice at 3b-life)', () => {
  it('is true only for a string that is empty after trim', () => {
    expect(isBlankEntry('')).toBe(true);
    expect(isBlankEntry(' \t')).toBe(true);
    expect(isBlankEntry('0')).toBe(false);
  });

  it('is false for anything that is not a string: no clear by omission', () => {
    for (const v of [null, undefined, 0, new File([], 'x')]) expect(isBlankEntry(v)).toBe(false);
  });
});

// GAP-1 P2-3 — single-line, but commas are fine. Moved from the deleted legacy session-schema test
// (LEGACY-1 C2b), which ran these through its `feel` field.
describe('freeTextNoteSchema', () => {
  it('rejects an INTERIOR newline — it would split the record', () => {
    expect(freeTextNoteSchema.safeParse('felt strong\nback tight').success).toBe(false);
  });

  it('ALLOWS a comma — the contract quotes a comma-bearing note on export instead', () => {
    expect(freeTextNoteSchema.safeParse('felt strong, back tight').success).toBe(true);
  });

  it('still maps a blank/whitespace-only note to undefined (the transform survives the refine)', () => {
    const res = freeTextNoteSchema.safeParse('   ');
    expect(res.success).toBe(true);
    expect(res.success && res.data).toBeUndefined();
  });

  it('trims a LEADING/TRAILING newline rather than rejecting it', () => {
    const res = freeTextNoteSchema.safeParse('\nfelt strong\n');
    expect(res.success).toBe(true);
    expect(res.success && res.data).toBe('felt strong');
  });
});
