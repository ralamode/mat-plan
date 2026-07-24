import { ACTIVITY_TYPE_KEYS, ENTRY_STATUS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import type { EntryDTO } from '@/lib/dal/entries';

import { calisthenicsTotals } from './activity-totals';

// A calisthenics reading DTO. Rows arrive from the DAL desc(createdAt); tests pass them
// newest-first when order matters.
function reading(overrides: Partial<EntryDTO>): EntryDTO {
  return {
    id: 'e',
    kind: null,
    unit: 'count',
    movementName: null,
    value: 0,
    status: ENTRY_STATUS.done,
    notes: null,
    metricKey: 'pushups',
    metricLabel: 'Push-ups',
    valueType: 'count',
    aggregation: 'sum',
    activityKey: ACTIVITY_TYPE_KEYS.calisthenics,
    activityLabel: 'Calisthenics',
    sets: [],
    ...overrides,
  };
}

describe('calisthenicsTotals', () => {
  it('sums a metric across the day and counts the bouts (the paper tally)', () => {
    const totals = calisthenicsTotals([reading({ value: 30 }), reading({ value: 20 })]);
    expect(totals).toEqual([{ metricKey: 'pushups', label: 'Push-ups', total: 50, readings: 2 }]);
  });

  it('folds the skill step by max, not sum', () => {
    const totals = calisthenicsTotals([
      reading({
        metricKey: 'vsit_skill_step',
        metricLabel: 'V-sit skill step',
        aggregation: 'max',
        value: 3,
      }),
      reading({
        metricKey: 'vsit_skill_step',
        metricLabel: 'V-sit skill step',
        aggregation: 'max',
        value: 5,
      }),
      reading({
        metricKey: 'vsit_skill_step',
        metricLabel: 'V-sit skill step',
        aggregation: 'max',
        value: 4,
      }),
    ]);
    expect(totals).toEqual([
      { metricKey: 'vsit_skill_step', label: 'V-sit skill step', total: 5, readings: 3 },
    ]);
  });

  it('orders output by ACTIVITY_METRIC_MAP.calisthenics (pushups, pullups, vsit_crunch, vsit_skill_step)', () => {
    const totals = calisthenicsTotals([
      reading({ metricKey: 'vsit_crunch', metricLabel: 'V-sit crunches', value: 10 }),
      reading({ metricKey: 'pullups', metricLabel: 'Pull-ups', value: 5 }),
      reading({ metricKey: 'pushups', metricLabel: 'Push-ups', value: 20 }),
    ]);
    expect(totals.map((t) => t.metricKey)).toEqual(['pushups', 'pullups', 'vsit_crunch']);
  });

  it('ignores rows from other activities (a brush_teeth shot is not a calisthenics total)', () => {
    const totals = calisthenicsTotals([
      reading({ value: 20 }),
      reading({
        activityKey: ACTIVITY_TYPE_KEYS.brush_teeth,
        metricKey: 'shot',
        metricLabel: 'Shot',
        value: 99,
      }),
    ]);
    expect(totals).toEqual([{ metricKey: 'pushups', label: 'Push-ups', total: 20, readings: 1 }]);
  });

  it('skips null values and non-done readings', () => {
    const totals = calisthenicsTotals([
      reading({ value: 20 }),
      reading({ value: null }),
      reading({ value: 15, status: ENTRY_STATUS.skipped }),
    ]);
    expect(totals).toEqual([{ metricKey: 'pushups', label: 'Push-ups', total: 20, readings: 1 }]);
  });

  it('returns [] when there are no calisthenics readings', () => {
    expect(calisthenicsTotals([])).toEqual([]);
  });
});
