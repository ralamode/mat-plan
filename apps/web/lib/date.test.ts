import { describe, expect, it } from 'vitest';

import { formatDayLong, todayIso } from './date';

describe('todayIso', () => {
  it('formats an injected date as YYYY-MM-DD (UTC)', () => {
    expect(todayIso(new Date('2026-07-20T14:30:00Z'))).toBe('2026-07-20');
  });

  it('uses the UTC day near a midnight boundary', () => {
    // 23:30 UTC is still the 20th in UTC (would be the 21st in a +2h zone).
    expect(todayIso(new Date('2026-07-20T23:30:00Z'))).toBe('2026-07-20');
  });
});

describe('formatDayLong', () => {
  it('renders a long, human date in UTC', () => {
    expect(formatDayLong('2026-07-20')).toBe('Monday, July 20, 2026');
  });
});
