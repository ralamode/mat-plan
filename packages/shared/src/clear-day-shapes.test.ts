import { describe, expect, it } from 'vitest';

import {
  RESTORE_CLEAR_REFUSALS,
  clearEventSchema,
  restoreClearResultSchema,
  restoreClearSchema,
} from './clear-day-shapes';
import { TRANSPORT_REFUSALS } from './program/actions';
import { ROW_REFUSALS } from './program/day-shapes';

// A clear's token, as `hiddenAtText` prints `deleted_at`: microseconds, always six digits.
const TOKEN = '2026-11-17T18:04:05.123456Z';
const ID = '01970000-0000-7000-8000-000000000001';

const input = { profilePublicId: ID, day: '2026-11-17', hiddenAt: TOKEN };

describe('restoreClearSchema', () => {
  it('takes an athlete, a day and the clear’s six-digit token', () => {
    expect(restoreClearSchema.parse(input)).toEqual(input);
  });

  it('lower-cases the athlete’s id, as every id in the row contract is (C25)', () => {
    expect(restoreClearSchema.parse({ ...input, profilePublicId: ID.toUpperCase() })).toEqual(
      input,
    );
  });

  it('refuses a token through a Date (milliseconds) and a malformed day', () => {
    expect(
      restoreClearSchema.safeParse({ ...input, hiddenAt: '2026-11-17T18:04:05.123Z' }).success,
    ).toBe(false);
    expect(restoreClearSchema.safeParse({ ...input, day: '17/11/2026' }).success).toBe(false);
  });

  it.each(['2026-02-30T00:00:00.000000Z', '2026-11-17T24:00:00.000000Z'])(
    'refuses %s: the right format, but no real instant (Postgres would throw on the cast)',
    (hiddenAt) => {
      expect(restoreClearSchema.safeParse({ ...input, hiddenAt }).success).toBe(false);
    },
  );

  it('keeps a real instant’s six digits as typed (no Date round trip)', () => {
    expect(restoreClearSchema.parse(input).hiddenAt).toBe(TOKEN);
  });

  it('carries no entry id: the server finds the clear’s entries itself', () => {
    expect(Object.keys(restoreClearSchema.shape).sort()).toEqual([
      'day',
      'hiddenAt',
      'profilePublicId',
    ]);
  });
});

describe('RESTORE_CLEAR_REFUSALS', () => {
  it('is a subset of the row contract’s words, so the day screen speaks one vocabulary', () => {
    for (const reason of RESTORE_CLEAR_REFUSALS) expect(ROW_REFUSALS).toContain(reason);
  });

  it('can carry every transport refusal (enterMutation’s answers)', () => {
    for (const reason of Object.values(TRANSPORT_REFUSALS)) {
      expect(RESTORE_CLEAR_REFUSALS).toContain(reason);
    }
  });
});

describe('restoreClearResultSchema', () => {
  it.each([
    { ok: true, restored: 2, keptHidden: 0 },
    { ok: true, restored: 1, keptHidden: 1 },
    { ok: true, restored: 0, keptHidden: 2 },
    { ok: true, restored: 0, keptHidden: 0 },
    { ok: false, reason: 'closed_day' },
  ])('parses %o', (result) => {
    expect(restoreClearResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    { ok: true },
    { ok: true, restored: -1, keptHidden: 0 },
    { ok: false, reason: 'slot_taken' },
  ])('refuses %o', (result) => {
    expect(restoreClearResultSchema.safeParse(result).success).toBe(false);
  });
});

describe('clearEventSchema', () => {
  it('is a token and a positive count', () => {
    expect(clearEventSchema.safeParse({ hiddenAt: TOKEN, count: 2 }).success).toBe(true);
    expect(clearEventSchema.safeParse({ hiddenAt: TOKEN, count: 0 }).success).toBe(false);
  });
});
