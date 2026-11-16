import { describe, expect, it } from 'vitest';

import { lastTimeWhen } from './last-time';

describe('lastTimeWhen — the day on "Last time" (V1-24 3b-bw, plan W1)', () => {
  it('names no day when the weigh-in was the day before', () => {
    expect(lastTimeWhen('2026-11-15', '2026-11-14')).toBeNull();
  });

  it('names the weekday from two to six days back', () => {
    expect(lastTimeWhen('2026-11-15', '2026-11-13')).toBe('Fri');
    expect(lastTimeWhen('2026-11-15', '2026-11-09')).toBe('Mon');
  });

  it('names the date from a week back', () => {
    expect(lastTimeWhen('2026-11-15', '2026-11-08')).toBe('Nov 8');
    expect(lastTimeWhen('2026-11-15', '2026-01-03')).toBe('Jan 3');
  });
});
