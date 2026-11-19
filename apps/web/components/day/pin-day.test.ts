// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { deviceToday } from '@/lib/date';

import { pinDayBeforeWrite } from './day-screen';

/**
 * The day is pinned in the URL before a write once the device's day has passed the page's (FAM-1
 * 12c), so a ✓ just after midnight re-renders the day it was logged on, not the new today.
 */

const at = (path: string) => window.history.replaceState(null, '', path);
// A page rendered long ago: the device's day is past its today.
const STALE = { day: '2000-01-01', today: '2000-01-01' };

afterEach(() => at('/'));

describe('pinDayBeforeWrite', () => {
  it('pins ?d= on the bare path once the device day is past the page’s today', () => {
    at('/p/abc');
    pinDayBeforeWrite(STALE);
    expect(window.location.search).toBe('?d=2000-01-01');
    expect(window.location.pathname).toBe('/p/abc');
  });

  it('leaves a bare path alone while it is still the page’s today', () => {
    at('/p/abc');
    pinDayBeforeWrite({ day: deviceToday(), today: deviceToday() });
    expect(window.location.search).toBe('');
  });

  it('does not pin when the device is BEHIND the page’s today (a zone the page has not caught)', () => {
    at('/p/abc');
    pinDayBeforeWrite({ day: '2999-01-01', today: '2999-01-01' });
    expect(window.location.search).toBe('');
  });

  it('never moves the day the URL already names', () => {
    at('/p/abc?d=2000-01-01');
    pinDayBeforeWrite(STALE);
    expect(window.location.search).toBe('?d=2000-01-01');
  });

  it('replaces a ?d= the page did not render (malformed, or a future day shown as today)', () => {
    for (const other of ['not-a-date', '2000-01-05']) {
      at(`/p/abc?d=${other}`);
      pinDayBeforeWrite(STALE);
      expect(window.location.search).toBe('?d=2000-01-01');
    }
  });
});
