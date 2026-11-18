import { describe, expect, it } from 'vitest';

import { hiddenAtSchema } from './hide';

describe('hiddenAtSchema (the hide token)', () => {
  it('takes a token as hiddenAtText prints it, and keeps all six digits as typed', () => {
    const token = '2026-11-17T18:04:05.123456Z';
    expect(hiddenAtSchema.parse(token)).toBe(token);
  });

  it('refuses a token through a Date (three digits) and one with seven', () => {
    expect(hiddenAtSchema.safeParse('2026-11-17T18:04:05.123Z').success).toBe(false);
    expect(hiddenAtSchema.safeParse('2026-11-17T18:04:05.1234567Z').success).toBe(false);
  });

  // The right format, but no real instant: Postgres' `::timestamptz` cast would throw (22008), so a
  // crafted one would reach error.tsx instead of answering bad_value (#547's review).
  it.each([
    ['30 February', '2026-02-30T00:00:00.000000Z'],
    ['month 13', '2026-13-01T00:00:00.000000Z'],
    ['hour 24', '2026-11-17T24:00:00.000000Z'],
    ['second 60', '2026-11-17T18:04:60.000000Z'],
    ['year 0000', '0000-01-01T00:00:00.000000Z'],
  ])('refuses %s', (_label, token) => {
    expect(hiddenAtSchema.safeParse(token).success).toBe(false);
  });

  it('takes the last instant of a leap day and of a year', () => {
    expect(hiddenAtSchema.safeParse('2028-02-29T23:59:59.999999Z').success).toBe(true);
    expect(hiddenAtSchema.safeParse('2026-12-31T23:59:59.999999Z').success).toBe(true);
    expect(hiddenAtSchema.safeParse('0001-01-01T00:00:00.000000Z').success).toBe(true);
  });
});
