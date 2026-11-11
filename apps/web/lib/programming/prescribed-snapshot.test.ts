import { describe, expect, it } from 'vitest';

import { prescribedKey, resolvePrescribed, rolesNeedingLiveMatch } from './prescribed-snapshot';

const row = (over = {}) => ({
  prescribedSnapshot: null as string | null,
  dayRole: 'strength_a' as string | null,
  movementId: 7 as number | null,
  ...over,
});

const live = (entries: [string, string | null][]) => new Map(entries);

describe('resolvePrescribed — the frozen value wins', () => {
  it('uses the snapshot and never consults the live program', () => {
    const map = live([[prescribedKey('strength_a', 7), '9xnewer @ 999']]);
    expect(resolvePrescribed(row({ prescribedSnapshot: '3x10 @ 45' }), map)).toBe('3x10 @ 45');
  });

  /**
   * 🔴 **The single most dangerous line in this chunk.** An `open()` prescription freezes as `''` —
   * 11 of the 13 seeded — and `||` in place of `??` sends every one of those rows back to TODAY's
   * program. That is precisely the defect the snapshot exists to close, and it is invisible
   * end-to-end: a re-derived row emits identical bytes until something edits the program, and then
   * it silently rewrites history.
   */
  it('keeps a frozen empty string frozen, rather than re-deriving it', () => {
    const map = live([[prescribedKey('strength_a', 7), '3x10 @ 45']]);
    expect(resolvePrescribed(row({ prescribedSnapshot: '' }), map)).toBe('');
  });

  it('falls back to the live match only when the snapshot is NULL', () => {
    const map = live([[prescribedKey('strength_a', 7), '3x10 @ 45']]);
    expect(resolvePrescribed(row(), map)).toBe('3x10 @ 45');
  });

  it("emits '' when the live match is ambiguous", () => {
    const map = live([[prescribedKey('strength_a', 7), null]]);
    expect(resolvePrescribed(row(), map)).toBe('');
  });

  it("emits '' when nothing matches at all", () => {
    expect(resolvePrescribed(row(), live([]))).toBe('');
    expect(resolvePrescribed(row(), null)).toBe('');
  });
});

describe('rolesNeedingLiveMatch', () => {
  it('asks for the program only for rows that were never snapshotted', () => {
    const roles = rolesNeedingLiveMatch([
      row({ prescribedSnapshot: null, dayRole: 'strength_a' }),
      row({ prescribedSnapshot: '3x10', dayRole: 'strength_b' }),
    ]);
    expect([...roles]).toEqual(['strength_a']);
  });

  it('does NOT ask for the program because a frozen value is empty', () => {
    // Same defect as `||`, one layer up: `''` is an answer, so the row needs no live read.
    expect(rolesNeedingLiveMatch([row({ prescribedSnapshot: '' })]).size).toBe(0);
  });

  it('skips a row with no day role, which can have no live match', () => {
    expect(rolesNeedingLiveMatch([row({ dayRole: null })]).size).toBe(0);
  });

  it('returns an empty set once every row is frozen — the post-backfill steady state', () => {
    expect(rolesNeedingLiveMatch([row({ prescribedSnapshot: '3x10' })]).size).toBe(0);
  });
});
