import { describe, expect, it } from 'vitest';

import { dayPageFlags, isWritableDay, resolveViewedDay, WRITABLE_DAY_RADIUS } from './declared-day';

// ── V1-15: which day the PAGE renders ──────────────────────────────────────────────────────────
describe('resolveViewedDay', () => {
  const TODAY = '2026-09-30';
  const FLOOR = '2026-09-01';

  it('renders today when `?d=` is absent', () => {
    expect(resolveViewedDay(undefined, TODAY, FLOOR)).toBe(TODAY);
  });

  it('renders a valid past day', () => {
    expect(resolveViewedDay('2026-09-29', TODAY, FLOOR)).toBe('2026-09-29');
  });

  // A stale or hand-edited URL should land somewhere usable — there is no resource to "not find",
  // since every date is a legal day and most simply have nothing logged.
  it('renders TODAY for a malformed value rather than 404ing', () => {
    for (const bad of ['', 'yesterday', '09292026', '2026-13-45', '2026-09-3']) {
      expect(resolveViewedDay(bad, TODAY, FLOOR)).toBe(TODAY);
    }
  });

  // THE stale-tab case: a page open across midnight must not render a day that has not happened.
  it('clamps the future to today', () => {
    expect(resolveViewedDay('2026-10-05', TODAY, FLOOR)).toBe(TODAY);
  });

  it('floors at the profile’s first day, so `‹` cannot walk into 2019', () => {
    expect(resolveViewedDay('2019-01-01', TODAY, FLOOR)).toBe(FLOOR);
    expect(resolveViewedDay(FLOOR, TODAY, FLOOR)).toBe(FLOOR); // the floor itself is reachable
  });

  // THE floor bug: a profile created TODAY would otherwise clamp yesterday away — while the server
  // still accepts a write for it. The UI must never be stricter than the endpoint it fronts.
  it('never floors later than the earliest WRITABLE day, even on a brand-new profile', () => {
    const YESTERDAY = '2026-09-29';
    expect(resolveViewedDay(YESTERDAY, TODAY, /* created today */ TODAY)).toBe(YESTERDAY);
    expect(isWritableDay(YESTERDAY, TODAY)).toBe(true); // …and it is genuinely writable
  });
});

describe('isWritableDay — the UI must mirror the server, never exceed it', () => {
  const TODAY = '2026-09-30';

  // This is the bound `resolveDeclaredDay` enforces. If the UI were stricter, yesterday would lose
  // its forms while the endpoint still accepted the write — which is exactly how Ray's 09/29 session,
  // logged from a stale tab on 09/30, succeeded.
  it('accepts today and ±1 day', () => {
    expect(isWritableDay(TODAY, TODAY)).toBe(true);
    expect(isWritableDay('2026-09-29', TODAY)).toBe(true);
    expect(isWritableDay('2026-10-01', TODAY)).toBe(true);
  });

  it('refuses day −2 and beyond', () => {
    expect(isWritableDay('2026-09-28', TODAY)).toBe(false);
    expect(isWritableDay('2026-09-01', TODAY)).toBe(false);
  });

  it('uses the SAME radius the server does', () => {
    expect(WRITABLE_DAY_RADIUS).toBe(1);
  });
});

// ── V1-24 3b-page: what the day page may offer ─────────────────────────────────────────────────
describe('dayPageFlags', () => {
  const TODAY = '2026-09-30';
  const YESTERDAY = '2026-09-29';
  const OLDER = '2026-09-28';

  it('today and yesterday: log, Change, no notice', () => {
    for (const day of [TODAY, YESTERDAY]) {
      expect(dayPageFlags(day, TODAY, false)).toEqual({
        closedDay: false,
        writable: true,
        amendable: true,
        showClosedNotice: false,
      });
    }
  });

  it('a day before yesterday is read-only: no log, no Change, and the notice', () => {
    expect(dayPageFlags(OLDER, TODAY, false)).toEqual({
      closedDay: true,
      writable: false,
      amendable: false,
      showClosedNotice: true,
    });
  });

  it('archived on today: no log, but Change stays, and no read-only notice', () => {
    expect(dayPageFlags(TODAY, TODAY, true)).toEqual({
      closedDay: false,
      writable: false,
      amendable: true,
      showClosedNotice: false,
    });
  });

  it('archived on an older day: nothing, and still no read-only notice (it would be false)', () => {
    expect(dayPageFlags(OLDER, TODAY, true)).toEqual({
      closedDay: true,
      writable: false,
      amendable: false,
      showClosedNotice: false,
    });
  });
});
