import { describe, expect, it } from 'vitest';

import { formatDayLong, isIanaTimeZone, localDayIso, localWeekStartIso } from './date';

// V1-6c. Offsets: PDT=UTC-7, PST=UTC-8, EDT=UTC-4, MST(Arizona)=UTC-7 year-round,
// HST(Hawaii)=UTC-10 year-round. Pacific local midnight 2026-07-24 00:00 PDT = 2026-07-24T07:00Z.
const LA = 'America/Los_Angeles';

describe('localDayIso', () => {
  it('keeps Monday all day in Pacific — no 4–5pm flip to Tuesday (the headline bug)', () => {
    // Mon 2026-07-20 17:30 PDT. Old todayIso() (UTC) would return the 21st (Tue).
    const at = new Date('2026-07-21T00:30:00Z');
    expect(localDayIso(LA, at)).toBe('2026-07-20');
    expect(at.toISOString().slice(0, 10)).toBe('2026-07-21'); // the UTC bug, pinned
  });

  it('rolls exactly at LOCAL midnight, not UTC midnight', () => {
    // Pacific local midnight = 07:00Z (PDT). Just before/after.
    expect(localDayIso(LA, new Date('2026-07-24T06:59:00Z'))).toBe('2026-07-23');
    expect(localDayIso(LA, new Date('2026-07-24T07:01:00Z'))).toBe('2026-07-24');
  });

  it('handles UTC-already-tomorrow-but-local-not', () => {
    const at = new Date('2026-07-24T06:59:00Z');
    expect(at.toISOString().slice(0, 10)).toBe('2026-07-24'); // UTC says the 24th
    expect(localDayIso(LA, at)).toBe('2026-07-23'); // Pacific is still the 23rd
  });

  it('computes Eastern independently of Pacific', () => {
    // 2026-07-21T00:30Z = 20:30 EDT on the 20th.
    expect(localDayIso('America/New_York', new Date('2026-07-21T00:30:00Z'))).toBe('2026-07-20');
  });

  it('respects Arizona (no DST) — distinct from Pacific in winter', () => {
    const at = new Date('2026-01-15T07:30:00Z'); // 00:30 MST (AZ, UTC-7) vs 23:30 PST (prev day)
    expect(localDayIso('America/Phoenix', at)).toBe('2026-01-15');
    expect(localDayIso(LA, at)).toBe('2026-01-14');
  });

  it('respects Hawaii (no DST, UTC-10)', () => {
    const at = new Date('2026-07-24T07:30:00Z'); // 21:30 HST on the 23rd
    expect(localDayIso('Pacific/Honolulu', at)).toBe('2026-07-23');
    expect(localDayIso(LA, at)).toBe('2026-07-24');
  });

  it('handles DST spring-forward (2026-03-08, local midnight = 08:00Z as PST→PDT)', () => {
    expect(localDayIso(LA, new Date('2026-03-08T07:59:00Z'))).toBe('2026-03-07');
    expect(localDayIso(LA, new Date('2026-03-08T08:01:00Z'))).toBe('2026-03-08');
  });

  it('handles DST fall-back (2026-11-01, local midnight = 07:00Z as PDT→PST)', () => {
    expect(localDayIso(LA, new Date('2026-11-01T06:59:00Z'))).toBe('2026-10-31');
    expect(localDayIso(LA, new Date('2026-11-01T07:01:00Z'))).toBe('2026-11-01');
  });
});

describe('isIanaTimeZone', () => {
  it.each(['America/Los_Angeles', 'UTC', 'America/New_York', 'Pacific/Honolulu'])(
    'accepts a real IANA zone (%s)',
    (tz) => expect(isIanaTimeZone(tz)).toBe(true),
  );

  it.each(['Not/AZone', 'foo', '', null, undefined])('rejects a bad value (%s)', (tz) =>
    expect(isIanaTimeZone(tz)).toBe(false),
  );
});

describe('localWeekStartIso (ISO-week Monday)', () => {
  it('returns the same day for a Monday', () => {
    expect(localWeekStartIso('2026-01-05')).toBe('2026-01-05'); // Mon (the b-1 fixture week)
  });

  it('maps a Sunday to the PRIOR Monday, not the next', () => {
    expect(localWeekStartIso('2026-01-11')).toBe('2026-01-05'); // Sun → prior Mon
  });

  it.each([
    ['2026-01-06', '2026-01-05'], // Tue
    ['2026-01-08', '2026-01-05'], // Thu
    ['2026-01-10', '2026-01-05'], // Sat
  ])('maps a mid-week day (%s) to its Monday', (day, monday) => {
    expect(localWeekStartIso(day)).toBe(monday);
  });

  it('crosses a month boundary correctly', () => {
    expect(localWeekStartIso('2026-01-01')).toBe('2025-12-29'); // Thu Jan 1 → Mon Dec 29 (prev month/year)
  });

  it('is unaffected by DST weekends (UTC-epoch math applies no offset)', () => {
    // 2026-03-08 (US spring-forward Sunday) → prior Mon 2026-03-02.
    expect(localWeekStartIso('2026-03-08')).toBe('2026-03-02');
    // 2026-11-01 (US fall-back Sunday) → prior Mon 2026-10-26.
    expect(localWeekStartIso('2026-11-01')).toBe('2026-10-26');
  });
});

describe('formatDayLong', () => {
  it('renders a long, human date from a calendar date (tz-invariant, no timeZone param)', () => {
    expect(formatDayLong('2026-07-24')).toBe('Friday, July 24, 2026');
  });

  it('agrees with localDayIso — date & weekday come from the same value (crit 3)', () => {
    // The header weekday is formatDayLong(day), and day = localDayIso(tz) → they can't split.
    const day = localDayIso(LA, new Date('2026-07-21T00:30:00Z')); // Mon 2026-07-20 PDT
    expect(formatDayLong(day)).toBe('Monday, July 20, 2026');
  });
});
