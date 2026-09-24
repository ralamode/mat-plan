import { describe, expect, it } from 'vitest';

import { resolveDayRole } from './day-role-schedule';

/**
 * The youth daily A/B rotation (2026-09-24).
 *
 * ⚠️ These pin a DECISION, not just behaviour. The program spec says the letter must come from the
 * count of COMPLETED SESSIONS, and warns that a calendar-derived letter doubles up box jumps after a
 * missed day. Ray accepted that deliberately — the motivation model is streak and consistency. So a
 * future reader who "fixes" the calendar rotation will turn these red, which is the point.
 */
describe('resolveDayRole — every calendar day is A or B', () => {
  it('anchors 2026-09-24 — the day the kids moved off paper — as a B day', () => {
    expect(resolveDayRole('2026-09-24')).toBe('strength_b');
  });

  it('alternates on consecutive days', () => {
    const days = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'];
    expect(days.map(resolveDayRole)).toEqual([
      'strength_b',
      'strength_a',
      'strength_b',
      'strength_a',
      'strength_b',
    ]);
  });

  // THE reason this is date parity and not a weekday map: seven is odd, so a weekday map repeats a
  // letter across every Saturday→Sunday boundary.
  it('alternates ACROSS a week boundary', () => {
    expect(resolveDayRole('2026-09-26')).not.toBe(resolveDayRole('2026-09-27')); // Sat → Sun
  });

  it('never returns null — the program runs every day, with no rest day', () => {
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 8, 24) + i * 86_400_000).toISOString().slice(0, 10);
      expect(['strength_a', 'strength_b']).toContain(resolveDayRole(d));
    }
  });

  // The V1-6c off-by-one trap: `new Date("2026-07-30").getDay()` parses as UTC midnight and reports
  // in the runtime's zone, which west of UTC is the PREVIOUS day. The epoch-day parse avoids it.
  it('does not shift west of UTC', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    expect(resolveDayRole('2026-09-24')).toBe('strength_b');
    process.env.TZ = before;
  });

  it('alternates correctly across a month and a year boundary', () => {
    expect(resolveDayRole('2026-09-30')).not.toBe(resolveDayRole('2026-10-01'));
    expect(resolveDayRole('2026-12-31')).not.toBe(resolveDayRole('2027-01-01'));
  });
});
