import { describe, expect, it } from 'vitest';

import { formatPrescription, toProgramDay } from './program-day';

// V1-10 slice 2 — the pure shaping behind the "Today's program" card. The SQL is proven by `db:verify`
// (it runs the shipped `programDayRows`); these cover the two decisions that live in app code.

const row = {
  idx: 0,
  movementName: 'Front Squat',
  sets: 5,
  targetReps: '5',
  load: '60',
  reps: null as string | null,
};

describe('toProgramDay — per-kid reps precedence', () => {
  it('falls back to the prescription’s shared target_reps when the kid has no override', () => {
    expect(toProgramDay([row])[0].targetReps).toBe('5');
  });

  it('prefers the kid’s own reps override (Scarlett deviates on the pull-up)', () => {
    const overridden = { ...row, targetReps: '4-5', reps: '5, last AMRAP' };
    expect(toProgramDay([overridden])[0].targetReps).toBe('5, last AMRAP');
  });

  it('respects an authored EMPTY override rather than falling back (`??`, not `||`)', () => {
    expect(toProgramDay([{ ...row, reps: '' }])[0].targetReps).toBe('');
  });

  it('passes the load through verbatim, and a target-less kid’s NULL load stays null', () => {
    expect(toProgramDay([{ ...row, load: 'BW +5-10' }])[0].load).toBe('BW +5-10');
    expect(toProgramDay([{ ...row, load: null }])[0].load).toBeNull();
  });

  it('carries `idx` through as the row’s stable identity, preserving order', () => {
    const shaped = toProgramDay([row, { ...row, idx: 1, movementName: 'Back Squat' }]);
    expect(shaped.map((r) => r.idx)).toEqual([0, 1]);
  });

  it('maps an empty result to an empty list (a rest day renders no card)', () => {
    expect(toProgramDay([])).toEqual([]);
  });
});

describe('formatPrescription', () => {
  it('names the SETS so it can’t be misread as the logged `reps × weight` grammar', () => {
    expect(formatPrescription({ sets: 4, targetReps: '3' })).toBe('4 sets × 3');
    expect(formatPrescription({ sets: 1, targetReps: '5' })).toBe('1 set × 5');
  });

  it('keeps verbatim rep text intact — never parsed to a number', () => {
    expect(formatPrescription({ sets: 4, targetReps: '40 yd, to grip failure' })).toBe(
      '4 sets × 40 yd, to grip failure',
    );
    expect(formatPrescription({ sets: 3, targetReps: '8-10, last set to failure' })).toBe(
      '3 sets × 8-10, last set to failure',
    );
  });

  it('degrades to whichever half is authored (both columns are nullable)', () => {
    expect(formatPrescription({ sets: 4, targetReps: null })).toBe('4 sets');
    expect(formatPrescription({ sets: null, targetReps: 'AMRAP' })).toBe('AMRAP');
    expect(formatPrescription({ sets: null, targetReps: null })).toBe('');
  });
});
