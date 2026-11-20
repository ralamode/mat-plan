import {
  ACTIVITY_TYPE_KEYS,
  DEFAULT_BODYWEIGHT_UNIT,
  ENTRY_STATUS,
  PRACTICE_UNIT,
  SEED_METRIC_KEYS,
  type DayPlan,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import type { EntryDTO } from '@/lib/dal/entries';

import { clearDaySummary } from './clear-summary';

const id = (n: number) => `019826b4-0000-7000-8000-${String(n).padStart(12, '0')}`;

function entry(n: number, overrides: Partial<EntryDTO> = {}): EntryDTO {
  return {
    id: id(n),
    kind: null,
    unit: 'count',
    movementName: null,
    value: 1,
    status: ENTRY_STATUS.done,
    notes: null,
    metricKey: null,
    metricLabel: null,
    valueType: null,
    aggregation: null,
    activityKey: null,
    activityLabel: null,
    sessionId: null,
    sessionType: null,
    sessionDayRole: null,
    sessionFeel: null,
    supersetId: null,
    supersetOrder: null,
    sets: [],
    ...overrides,
  };
}
const weighIn = (n: number) =>
  entry(n, { metricKey: SEED_METRIC_KEYS.bodyweight, value: 112.4, unit: DEFAULT_BODYWEIGHT_UNIT });
const practice = (n: number) =>
  entry(n, {
    activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice,
    value: 90,
    unit: PRACTICE_UNIT,
  });

/** A plan with only what the summary reads: each workout's name and its rows' logged ids. */
function plan(workouts: { name: string; logged: (number | null)[][] }[]): DayPlan {
  return {
    workouts: workouts.map((w) => ({
      name: w.name,
      items: w.logged.map((rows) => ({
        rows: rows.map((n) => ({ logged: n === null ? null : { entryPublicId: id(n) } })),
      })),
    })),
  } as unknown as DayPlan;
}

describe('clearDaySummary (V1-9b B2-ii)', () => {
  it('names each workout with its logged rows, then weigh-ins, practices and the rest', () => {
    const entries = [entry(1), entry(2), entry(3), weighIn(4), practice(5), entry(6)];
    const summary = clearDaySummary(
      plan([
        {
          name: 'Heavy A',
          logged: [
            [1, 2],
            [3, null],
          ],
        },
        { name: 'Light B', logged: [[null]] },
      ]),
      entries,
    );
    expect(summary).toEqual({
      workouts: [{ name: 'Heavy A', count: 3 }],
      weighIns: 1,
      practices: 1,
      other: 1,
      total: 6,
    });
  });

  it('a plan row whose entry is not live counts nowhere', () => {
    const summary = clearDaySummary(plan([{ name: 'Heavy A', logged: [[1, 99]] }]), [entry(1)]);
    expect(summary.workouts).toEqual([{ name: 'Heavy A', count: 1 }]);
    expect(summary.total).toBe(1);
  });

  it('an entry the plan does not place (the resolver dropped it) is other: counted, never named', () => {
    const summary = clearDaySummary(plan([]), [entry(7)]);
    expect(summary).toMatchObject({ workouts: [], other: 1, total: 1 });
  });

  it('a row shown in two places is counted once', () => {
    const summary = clearDaySummary(
      plan([
        { name: 'Heavy A', logged: [[1]] },
        { name: 'Heavy A again', logged: [[1]] },
      ]),
      [entry(1)],
    );
    expect(summary.workouts).toEqual([{ name: 'Heavy A', count: 1 }]);
  });

  it.each([
    ['an empty day', [], []],
    ['only program rows', [{ name: 'W', logged: [[1, 2]] }], [entry(1), entry(2)]],
    ['a mixed day', [{ name: 'W', logged: [[1]] }], [entry(1), weighIn(2), practice(3), entry(4)]],
    ['rows the plan does not hold', [{ name: 'W', logged: [[9]] }], [weighIn(1), entry(2)]],
  ] as const)('%s: the buckets always sum to the live entries', (_label, workouts, entries) => {
    const s = clearDaySummary(plan(workouts as never), entries as unknown as EntryDTO[]);
    const named = s.workouts.reduce((sum, w) => sum + w.count, 0);
    expect(named + s.weighIns + s.practices + s.other).toBe(entries.length);
    expect(s.total).toBe(entries.length);
  });
});
