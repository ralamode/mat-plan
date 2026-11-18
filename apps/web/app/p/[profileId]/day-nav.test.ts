import { describe, expect, it } from 'vitest';

import { dayLine, dayNavBounds } from './day-nav';

/** The day navigation's reach and its date line (FAM-1 12c: look-ahead, v12's day label). */

const TODAY = '2026-11-18'; // a Wednesday
const FLOOR = '2026-09-01';
const bounds = (day: string, canGoForward: boolean) =>
  dayNavBounds({ day, today: TODAY, floor: FLOOR, canGoForward });

describe('dayNavBounds', () => {
  it('with no program tomorrow, today is the forward bound, as before 12c', () => {
    const b = bounds(TODAY, false);
    expect(b.canGoForward).toBe(false);
    expect(b.reachable('2026-11-19')).toBe(false);
    expect(b.canGoBack).toBe(true);
  });

  it('on a program tomorrow, the arrow and the strip both reach tomorrow, and no further', () => {
    const b = bounds(TODAY, true);
    expect(b.canGoForward).toBe(true);
    expect(b.reachable('2026-11-19')).toBe(true);
    expect(b.reachable('2026-11-20')).toBe(false);
  });

  it('viewing a future day: the days back to today stay reachable, and one more while on a program', () => {
    const on = bounds('2026-11-20', true);
    for (const d of [TODAY, '2026-11-19', '2026-11-20', '2026-11-21'])
      expect(on.reachable(d)).toBe(true);
    expect(on.reachable('2026-11-22')).toBe(false);
    const off = bounds('2026-11-20', false);
    expect(off.canGoForward).toBe(false);
    expect(off.reachable('2026-11-20')).toBe(true); // the viewed day always carries aria-current
  });

  it('never past today + LOOK_AHEAD_DAYS, on a program every day (maintainer, 2026-11-17)', () => {
    const five = bounds('2026-11-23', true); // today + 5
    expect(five.canGoForward).toBe(true);
    const six = bounds('2026-11-24', true); // today + 6
    expect(six.canGoForward).toBe(false);
    expect(six.reachable('2026-11-25')).toBe(false);
    expect(bounds(TODAY, true).reachable('2026-11-24')).toBe(false); // only a day at a time
  });

  it('a past day reaches forward to today only, whatever tomorrow holds', () => {
    const b = bounds('2026-11-10', true);
    expect(b.reachable(TODAY)).toBe(true);
    expect(b.reachable('2026-11-19')).toBe(false);
  });

  it('back stops at the floor, and never later than yesterday', () => {
    expect(
      dayNavBounds({ day: FLOOR, today: TODAY, floor: FLOOR, canGoForward: false }).canGoBack,
    ).toBe(false);
    const newProfile = dayNavBounds({
      day: TODAY,
      today: TODAY,
      floor: TODAY,
      canGoForward: false,
    });
    expect(newProfile.canGoBack).toBe(true); // yesterday is writable, so it is reachable
    expect(newProfile.reachable('2026-11-16')).toBe(false);
  });
});

describe('dayLine', () => {
  it('names today, yesterday and tomorrow, as v12 does', () => {
    expect(dayLine(TODAY, TODAY)).toBe('Today · Wednesday, November 18, 2026');
    expect(dayLine('2026-11-17', TODAY)).toBe('Yesterday · Tue, Nov 17');
    expect(dayLine('2026-11-19', TODAY)).toBe('Tomorrow · Thu, Nov 19');
    expect(dayLine('2026-11-10', TODAY)).toBe('Tue, Nov 10');
  });
});
