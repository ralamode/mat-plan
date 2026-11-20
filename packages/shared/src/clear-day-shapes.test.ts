import { describe, expect, it } from 'vitest';

import {
  CLEAR_DAY_CONFIRM_MAX,
  CLEAR_DAY_CONFIRM_WORD,
  DAY_CLEAR_REFUSAL,
  DAY_CLEAR_REFUSALS,
  clearDayResultSchema,
  clearDaySchema,
  clearEventSchema,
  restoreClearResultSchema,
  restoreClearSchema,
} from './clear-day-shapes';
import { TRANSPORT_REFUSALS } from './program/actions';
import { ROW_REFUSAL, ROW_REFUSALS } from './program/day-shapes';

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

describe('DAY_CLEAR_REFUSALS', () => {
  it('is a subset of the row contract’s words, so the day screen speaks one vocabulary', () => {
    for (const reason of DAY_CLEAR_REFUSALS) expect(ROW_REFUSALS).toContain(reason);
  });

  it('can carry every transport refusal (enterMutation’s answers)', () => {
    for (const reason of Object.values(TRANSPORT_REFUSALS)) {
      expect(DAY_CLEAR_REFUSALS).toContain(reason);
    }
  });
});

describe('restoreClearResultSchema', () => {
  it.each([
    { ok: true, restored: 2, keptHidden: 0 },
    { ok: true, restored: 1, keptHidden: 1 },
    { ok: true, restored: 0, keptHidden: 2 },
    { ok: true, restored: 0, keptHidden: 0 },
    { ok: false, reason: DAY_CLEAR_REFUSAL.closed_day },
  ])('parses %o', (result) => {
    expect(restoreClearResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    { ok: true },
    { ok: true, restored: -1, keptHidden: 0 },
    { ok: false, reason: ROW_REFUSAL.slot_taken },
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

describe('clearDaySchema', () => {
  const clear = { profilePublicId: ID, day: '2026-11-17' };

  it('pins the confirm word (a contract test: the dialog and the server read this one const)', () => {
    expect(CLEAR_DAY_CONFIRM_WORD).toBe('delete');
  });

  it.each(['delete', 'Delete ', '  DELETE'])(
    'takes %j: case and surrounding spaces ignored',
    (confirm) => {
      expect(clearDaySchema.parse({ ...clear, confirm })).toEqual({
        ...clear,
        confirm: CLEAR_DAY_CONFIRM_WORD,
      });
    },
  );

  it.each(['del', '', 'delete it', 'deleted'])('refuses %j', (confirm) => {
    expect(clearDaySchema.safeParse({ ...clear, confirm }).success).toBe(false);
  });

  it('refuses a missing confirm word', () => {
    expect(clearDaySchema.safeParse(clear).success).toBe(false);
  });

  it('takes a padded word of exactly the bound, and refuses one character more (before the trim)', () => {
    const pad = (n: number) => `${' '.repeat(n)}${CLEAR_DAY_CONFIRM_WORD}`;
    const fits = pad(CLEAR_DAY_CONFIRM_MAX - CLEAR_DAY_CONFIRM_WORD.length);
    expect(fits).toHaveLength(CLEAR_DAY_CONFIRM_MAX);
    expect(clearDaySchema.safeParse({ ...clear, confirm: fits }).success).toBe(true);
    const over = pad(CLEAR_DAY_CONFIRM_MAX - CLEAR_DAY_CONFIRM_WORD.length + 1);
    expect(clearDaySchema.safeParse({ ...clear, confirm: over }).success).toBe(false);
  });

  it('carries no token and no entry id: the server finds the day’s entries itself', () => {
    expect(Object.keys(clearDaySchema.shape).sort()).toEqual(['confirm', 'day', 'profilePublicId']);
  });
});

describe('clearDayResultSchema', () => {
  it.each([
    { ok: true, count: 3 },
    { ok: true, count: 0 },
    { ok: false, reason: DAY_CLEAR_REFUSAL.closed_day },
  ])('parses %o', (result) => {
    expect(clearDayResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([{ ok: true }, { ok: true, count: -1 }, { ok: false, reason: ROW_REFUSAL.slot_taken }])(
    'refuses %o',
    (result) => {
      expect(clearDayResultSchema.safeParse(result).success).toBe(false);
    },
  );
});
