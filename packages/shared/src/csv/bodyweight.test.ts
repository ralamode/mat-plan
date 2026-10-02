import { describe, expect, it } from 'vitest';

import { DEFAULT_BODYWEIGHT_UNIT } from '../bodyweight';
import { BODYWEIGHT_CSV_UNIT, buildBodyweight, type BodyweightRow, LB_PER_KG } from './bodyweight';

const row = (o: Partial<BodyweightRow> = {}): BodyweightRow => ({
  date: '2026-09-30',
  weight: '84.500',
  unit: BODYWEIGHT_CSV_UNIT,
  context: '',
  notes: '',
  ...o,
});
const HEADER = 'date,weight_lb,context,notes\n';
const body = (rows: BodyweightRow[]) => buildBodyweight(rows).slice(HEADER.length);

describe('buildBodyweight — weight_lb holds pounds; kg is converted with the original kept (CSV-1)', () => {
  it('pins the column unit and the exact factor', () => {
    expect(BODYWEIGHT_CSV_UNIT).toBe('lb');
    expect(LB_PER_KG).toBe(2.20462262185);
  });

  it('an lb weigh-in exports byte-identically to before the unit rode the row', () => {
    expect(buildBodyweight([row()])).toBe(`${HEADER}2026-09-30,84.5,,\n`);
  });

  it('a kg weigh-in writes the pounds equivalent and keeps what was logged in notes', () => {
    expect(body([row({ unit: 'kg' })])).toBe('2026-09-30,186.3,,logged 84.5 kg\n');
  });

  it('existing notes are kept, joined with "; "', () => {
    expect(body([row({ unit: 'kg', notes: 'after practice' })])).toBe(
      '2026-09-30,186.3,,after practice; logged 84.5 kg\n',
    );
  });

  it.each([
    ['1', '2.2'], //   2.2046…  rounds down
    ['50', '110.2'], // 110.231… rounds down
    ['50.1', '110.5'], // 110.4515… rounds up across the .x5 line
    ['100', '220.5'], // 220.4622… rounds up
    ['45.36', '100'], // 100.0016… → 100.0 → `100` (a whole number is bare, as for lb)
  ])('rounds %s kg half-up to one decimal → %s', (kg, lb) => {
    expect(body([row({ unit: 'kg', weight: kg })])).toBe(`2026-09-30,${lb},,logged ${kg} kg\n`);
  });

  it('only the kg row in a mixed month is converted', () => {
    expect(
      body([row(), row({ date: '2026-09-29', unit: 'kg' }), row({ date: '2026-09-28' })]),
    ).toBe('2026-09-30,84.5,,\n2026-09-29,186.3,,logged 84.5 kg\n2026-09-28,84.5,,\n');
  });

  it('a unit it has no rule for still throws (a tripwire, not a bare number)', () => {
    expect(() => buildBodyweight([row({ unit: 'stone' })])).toThrow(/logged in 'stone'.*weight_lb/);
  });

  it('the form default is the column unit, so a default weigh-in exports as logged', () => {
    expect(DEFAULT_BODYWEIGHT_UNIT).toBe(BODYWEIGHT_CSV_UNIT);
  });

  it('an empty kg weight stays empty, never "0" lb', () => {
    expect(buildBodyweight([row({ weight: '', unit: 'kg' })])).toBe(`${HEADER}2026-09-30,,,\n`);
  });
});
