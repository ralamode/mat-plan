import { describe, expect, it } from 'vitest';

import { buildCheckins, CHECKINS_HEADER, type CheckinsRow, minutesToHhMm } from './checkins';

const HEADER = `${CHECKINS_HEADER.join(',')}\n`;
const row = (o: Partial<CheckinsRow> = {}): CheckinsRow => ({
  date: '2026-11-16',
  activity: 'wrestling_practice',
  metric: 'practice_minutes',
  valueNum: '90',
  valueText: null,
  unit: 'min',
  notes: null,
  ...o,
});
const body = (rows: CheckinsRow[]) => buildCheckins(rows).slice(HEADER.length);

describe('buildCheckins — one row per logged check-in (FAM-1 14b)', () => {
  it('pins the long-format header (the maintainer, Q2)', () => {
    expect(buildCheckins([])).toBe('date,activity,metric,value,unit,notes\n');
  });

  it('writes practice minutes with the activity and metric as tokens', () => {
    expect(body([row()])).toBe('2026-11-16,wrestling-practice,practice-minutes,90,min,\n');
  });

  it('tells calisthenics’ metrics apart', () => {
    expect(
      body([
        row({ activity: 'calisthenics', metric: 'pushups', valueNum: '25', unit: 'count' }),
        row({ activity: 'calisthenics', metric: 'pullups', valueNum: '6', unit: 'count' }),
      ]),
    ).toBe('2026-11-16,calisthenics,pushups,25,count,\n2026-11-16,calisthenics,pullups,6,count,\n');
  });

  it('writes a habit done as its stored 1 with unit bool, and a bare habit with no metric', () => {
    expect(
      body([row({ activity: 'rice_bucket', metric: null, valueNum: '1', unit: 'bool' })]),
    ).toBe('2026-11-16,rice-bucket,,1,bool,\n');
  });

  it('writes Wake (timing, minutes since local midnight) as HH:MM', () => {
    expect(body([row({ activity: 'wake', metric: null, valueNum: '412', unit: 'timing' })])).toBe(
      '2026-11-16,wake,,06:52,timing,\n',
    );
  });

  it('quotes a note the RFC 4180 way', () => {
    expect(body([row({ notes: 'tired, short' })])).toBe(
      '2026-11-16,wrestling-practice,practice-minutes,90,min,"tired, short"\n',
    );
  });

  it('falls back to value_text, then empty', () => {
    expect(body([row({ valueNum: null, valueText: 'easy' }), row({ valueNum: null })])).toBe(
      '2026-11-16,wrestling-practice,practice-minutes,easy,min,\n' +
        '2026-11-16,wrestling-practice,practice-minutes,,min,\n',
    );
  });
});

describe('minutesToHhMm — a clock, or the raw number when it is not one', () => {
  it.each([
    ['0', '00:00'],
    ['412', '06:52'],
    ['1439', '23:59'],
    ['1440', '1440'],
    ['412.5', '412.5'],
  ])('%s → %s', (raw, written) => {
    expect(minutesToHhMm(raw)).toBe(written);
  });
});
