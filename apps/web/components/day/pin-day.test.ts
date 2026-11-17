// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { localDayIso } from '@/lib/date';

import { pinDayBeforeWrite } from './day-screen';

/**
 * The day is pinned in the URL before a write once the device's day has passed the page's (FAM-1
 * 12c), so a ✓ just after midnight re-renders the day it was logged on, not the new today.
 */

const deviceToday = () => localDayIso(Intl.DateTimeFormat().resolvedOptions().timeZone);
const at = (path: string) => window.history.replaceState(null, '', path);

afterEach(() => at('/'));

describe('pinDayBeforeWrite', () => {
  it('pins ?d= on the bare path once the device day is past the page’s today', () => {
    at('/p/abc');
    pinDayBeforeWrite({ day: '2031-03-04', today: '2031-03-04' });
    expect(window.location.search).toBe('?d=2031-03-04');
    expect(window.location.pathname).toBe('/p/abc');
  });

  it('leaves a bare path alone while it is still the page’s today', () => {
    at('/p/abc');
    pinDayBeforeWrite({ day: deviceToday(), today: deviceToday() });
    expect(window.location.search).toBe('');
  });

  it('never moves a day the URL already names', () => {
    at('/p/abc?d=2031-03-03');
    pinDayBeforeWrite({ day: '2031-03-03', today: '2031-03-04' });
    expect(window.location.search).toBe('?d=2031-03-03');
  });
});
