import { describe, expect, it } from 'vitest';

import { foldName } from './text';

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
