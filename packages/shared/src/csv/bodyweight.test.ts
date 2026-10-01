import { describe, expect, it } from 'vitest';

import { DEFAULT_BODYWEIGHT_UNIT } from '../bodyweight';
import { BODYWEIGHT_CSV_UNIT, buildBodyweight, type BodyweightRow } from './bodyweight';

const row = (o: Partial<BodyweightRow> = {}): BodyweightRow => ({
  date: '2026-09-30',
  weight: '84.500',
  unit: BODYWEIGHT_CSV_UNIT,
  context: '',
  notes: '',
  ...o,
});

describe('buildBodyweight — the weight_lb column holds pounds only (CSV-1)', () => {
  it('pins the column unit to the legacy header', () => {
    expect(BODYWEIGHT_CSV_UNIT).toBe('lb');
  });

  it('an lb weigh-in exports byte-identically to before the unit rode the row', () => {
    expect(buildBodyweight([row()])).toBe('date,weight_lb,context,notes\n2026-09-30,84.5,,\n');
  });

  it('REFUSES a kg weigh-in rather than writing it bare (it would read as pounds)', () => {
    expect(() => buildBodyweight([row({ unit: 'kg' })])).toThrow(/logged in 'kg'.*weight_lb/);
  });

  it('refuses even when only one row of several is kg', () => {
    expect(() =>
      buildBodyweight([
        row(),
        row({ date: '2026-09-29', unit: 'kg' }),
        row({ date: '2026-09-28' }),
      ]),
    ).toThrow(/2026-09-29/);
  });

  it('the form default is the exportable unit, so a default weigh-in always exports', () => {
    expect(DEFAULT_BODYWEIGHT_UNIT).toBe(BODYWEIGHT_CSV_UNIT);
  });
});
