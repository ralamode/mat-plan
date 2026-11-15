import { describe, expect, it } from 'vitest';

import { addDays, localWeekday, WEEKDAYS, weekdaySchema } from './day';

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
