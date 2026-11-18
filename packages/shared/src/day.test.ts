import { describe, expect, it } from 'vitest';

import {
  addDays,
  dayOpenFor,
  localWeekday,
  MONDAY_FIRST,
  WEEKDAYS,
  weekdaySchema,
  inWritableWindow,
  WRITABLE_DAY_RADIUS,
} from './day';

describe('localWeekday (V1-10 — the weekday of a bare calendar date)', () => {
  it.each([
    ['2026-01-04', 0], // Sun
    ['2026-01-05', 1], // Mon
    ['2026-01-06', 2], // Tue
    ['2026-01-07', 3], // Wed
    ['2026-01-08', 4], // Thu
    ['2026-01-09', 5], // Fri
    ['2026-01-10', 6], // Sat
  ])('maps %s → %i', (day, weekday) => {
    expect(localWeekday(day)).toBe(weekday);
  });

  it('does NOT shift west of UTC (the V1-6c off-by-one `new Date(day).getDay()` trap)', () => {
    // Under TZ=America/Los_Angeles, `new Date('2026-01-05').getDay()` is 0 (Sunday) — which would render
    // Monday's program on Sunday and hide it on Monday. The UTC-epoch idiom must stay 1.
    // (Assigning process.env.TZ re-runs tzset in Node, so this really does move the runtime zone.
    // `delete` — not `= undefined` — restores it, or the env carries the literal string "undefined".)
    const priorTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(localWeekday('2026-01-05')).toBe(1);
    } finally {
      if (priorTz === undefined) delete process.env.TZ;
      else process.env.TZ = priorTz;
    }
  });

  it('is unaffected by DST transition days', () => {
    expect(localWeekday('2026-03-08')).toBe(0); // US spring-forward Sunday
    expect(localWeekday('2026-11-01')).toBe(0); // US fall-back Sunday
  });
});

describe('WEEKDAYS (SCHED-1 1a — the origin is `localWeekday`’s: 0 = Sunday)', () => {
  it('pins Sunday to 0, the one day that tells the three weekday conventions apart', () => {
    // Monday–Saturday are 1–6 under ISO numbering too; only a Sunday separates 0 (here), 7 (ISO)
    // and 6 (Monday-first 0–6).
    expect(localWeekday('2026-10-11')).toBe(0);
  });

  it('holds exactly the values `localWeekday` can return, in calendar order from a Sunday', () => {
    const week = WEEKDAYS.map((_, i) => localWeekday(addDays('2026-10-11', i)));
    expect(week).toEqual([...WEEKDAYS]);
  });

  it.each([[-1], [7], [1.5], ['1']])('weekdaySchema rejects %j', (value) => {
    expect(weekdaySchema.safeParse(value).success).toBe(false);
  });

  it('weekdaySchema accepts every member', () => {
    for (const weekday of WEEKDAYS) expect(weekdaySchema.parse(weekday)).toBe(weekday);
  });
});

describe('MONDAY_FIRST (the order a week is shown in)', () => {
  it('pins the order: Monday to Saturday, then Sunday', () => {
    // A contract pin: `ProgramView.workouts[].usedOn` is listed in exactly this order.
    expect(MONDAY_FIRST).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('is WEEKDAYS reordered: the same seven, each once, still in the 0 = Sunday origin', () => {
    expect([...MONDAY_FIRST].sort()).toEqual([...WEEKDAYS]);
    for (const weekday of MONDAY_FIRST) expect(weekdaySchema.parse(weekday)).toBe(weekday);
  });

  it('starts on the weekday of a Monday and ends on the weekday of a Sunday', () => {
    // 2026-10-12 is a Monday. Walking a real week from it gives the same order.
    const week = MONDAY_FIRST.map((_, i) => localWeekday(addDays('2026-10-12', i)));
    expect(week).toEqual([...MONDAY_FIRST]);
    expect(localWeekday('2026-10-18')).toBe(MONDAY_FIRST[6]);
  });

  it('is exported from the root barrel', async () => {
    const barrel = await import('./index');
    expect(barrel.MONDAY_FIRST).toBe(MONDAY_FIRST);
  });
});

describe('inWritableWindow: today and yesterday, never a day after today (FAM-1 D20, D32)', () => {
  const TODAY = '2026-09-30';

  it('accepts today and each of the radius days before it', () => {
    expect(inWritableWindow(TODAY, TODAY)).toBe(true);
    expect(inWritableWindow('2026-09-29', TODAY)).toBe(true);
    expect(WRITABLE_DAY_RADIUS).toBe(1);
  });

  it('refuses the day before yesterday, and anything older', () => {
    expect(inWritableWindow('2026-09-28', TODAY)).toBe(false);
    expect(inWritableWindow('2025-09-30', TODAY)).toBe(false);
  });

  it('refuses tomorrow, which the older forms accept', () => {
    expect(inWritableWindow('2026-10-01', TODAY)).toBe(false);
    expect(inWritableWindow('2026-10-02', TODAY)).toBe(false);
  });

  it('holds across a month and a year boundary', () => {
    expect(inWritableWindow('2026-12-31', '2027-01-01')).toBe(true);
    expect(inWritableWindow('2027-01-01', '2026-12-31')).toBe(false);
    expect(inWritableWindow('2026-02-28', '2026-03-01')).toBe(true);
  });
});

describe('dayOpenFor: the writable window, and never for an archived athlete (C34)', () => {
  const TODAY = '2026-09-30';
  const DAYS = ['2026-09-27', '2026-09-28', '2026-09-29', TODAY, '2026-10-01', '2026-10-02'];

  it('is open today and yesterday for an athlete who is not archived, and on no other day', () => {
    const open = DAYS.filter((day) => dayOpenFor({ archived: false }, day, TODAY));
    expect(open).toEqual(['2026-09-29', TODAY]);
  });

  it('agrees with inWritableWindow on every day, for an athlete who is not archived', () => {
    for (const day of DAYS) {
      expect(dayOpenFor({ archived: false }, day, TODAY)).toBe(inWritableWindow(day, TODAY));
    }
  });

  it('is never open for an archived athlete, today and yesterday included', () => {
    for (const day of DAYS) {
      expect(dayOpenFor({ archived: true }, day, TODAY)).toBe(false);
    }
  });

  it('takes the day before today, in that order: yesterday is open and tomorrow is not', () => {
    // Swapping the two days turns yesterday into tomorrow, so this fails if a caller's order does.
    expect(dayOpenFor({ archived: false }, '2026-09-29', TODAY)).toBe(true);
    expect(dayOpenFor({ archived: false }, TODAY, '2026-09-29')).toBe(false);
  });

  it('is exported from the root barrel', async () => {
    const barrel = await import('./index');
    expect(barrel.dayOpenFor).toBe(dayOpenFor);
  });
});
