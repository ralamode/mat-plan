import { DAY_ROLES, DAY_ROLE_TO_SESSION_TYPE } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { DAY_ROLE_BY_WEEKDAY, resolveDayRole } from './day-role-schedule';

// V1-10 slice 2 — the weekday → day_role stopgap schedule (Ray's Mon/Wed/Fri split). Pure, so the whole
// week is a fast unit test; the DB read it feeds is proven separately by `db:verify`.

describe('resolveDayRole — Ray’s Mon/Wed/Fri split', () => {
  it.each([
    ['2026-01-05', 'strength_a'], // Mon
    ['2026-01-07', 'strength_b'], // Wed
    ['2026-01-09', 'strength_c'], // Fri
  ])('programs a strength day on %s → %s', (day, role) => {
    expect(resolveDayRole(day)).toBe(role);
  });

  it.each([
    ['2026-01-04'], // Sun
    ['2026-01-06'], // Tue
    ['2026-01-08'], // Thu
    ['2026-01-10'], // Sat
  ])('programs nothing on %s (rest / unmodelled conditioning)', (day) => {
    expect(resolveDayRole(day)).toBeNull();
  });

  it('uses the local calendar date, not the runtime zone (no V1-6c off-by-one)', () => {
    // A Monday must resolve to Strength A even when the process zone is west of UTC — the trap that
    // `new Date(day).getDay()` would fall into, shifting the whole week back a day.
    const priorTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(resolveDayRole('2026-01-05')).toBe('strength_a');
      expect(resolveDayRole('2026-01-04')).toBeNull();
    } finally {
      if (priorTz === undefined) delete process.env.TZ;
      else process.env.TZ = priorTz;
    }
  });
});

describe('DAY_ROLE_BY_WEEKDAY — a valid, complete schedule', () => {
  it('covers all seven weekdays', () => {
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      expect(DAY_ROLE_BY_WEEKDAY).toHaveProperty(String(weekday));
    }
  });

  it('only ever names a real day role', () => {
    for (const role of Object.values(DAY_ROLE_BY_WEEKDAY)) {
      if (role !== null) expect(DAY_ROLES).toContain(role);
    }
  });

  it('only programs STRENGTH day roles (a conditioning role has no prescriptions yet)', () => {
    for (const role of Object.values(DAY_ROLE_BY_WEEKDAY)) {
      if (role !== null) expect(DAY_ROLE_TO_SESSION_TYPE[role]).toBe('strength');
    }
  });
});
