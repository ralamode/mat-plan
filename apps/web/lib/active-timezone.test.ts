import { beforeEach, describe, expect, it, vi } from 'vitest';

// active-timezone reads the request's `tz` cookie via next/headers — mock it (the server
// seam is tested as a plain fn, per the AGENTS.md testing gotcha). Each test sets the value.
const cookieValue = { current: undefined as string | undefined };
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieValue.current === undefined ? undefined : { value: cookieValue.current }),
  })),
}));

import { DEFAULT_TIME_ZONE } from '@/lib/constants';
import { localDayIso } from '@/lib/date';

import { getActiveLocalDay, getActiveTimeZone } from './active-timezone';

beforeEach(() => {
  cookieValue.current = undefined;
});

describe('getActiveTimeZone', () => {
  it('returns a valid IANA cookie value', async () => {
    cookieValue.current = 'America/New_York';
    expect(await getActiveTimeZone()).toBe('America/New_York');
  });

  it('falls back to the default for a garbage cookie', async () => {
    cookieValue.current = 'Not/AZone';
    expect(await getActiveTimeZone()).toBe(DEFAULT_TIME_ZONE);
  });

  it('falls back to the default for an empty cookie', async () => {
    cookieValue.current = '';
    expect(await getActiveTimeZone()).toBe(DEFAULT_TIME_ZONE);
  });

  it('falls back to the default when the cookie is absent', async () => {
    cookieValue.current = undefined;
    expect(await getActiveTimeZone()).toBe(DEFAULT_TIME_ZONE);
  });
});

describe('getActiveLocalDay', () => {
  it('composes the active tz with localDayIso at the given instant', async () => {
    cookieValue.current = 'America/New_York';
    const now = new Date('2026-07-21T00:30:00Z'); // 20:30 EDT on the 20th
    expect(await getActiveLocalDay(now)).toBe(localDayIso('America/New_York', now));
    expect(await getActiveLocalDay(now)).toBe('2026-07-20');
  });

  it('uses the default tz when no cookie is set', async () => {
    const now = new Date('2026-07-21T00:30:00Z');
    expect(await getActiveLocalDay(now)).toBe(localDayIso(DEFAULT_TIME_ZONE, now));
  });
});
