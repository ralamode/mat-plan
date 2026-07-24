import type { WeeklyAdherenceRow } from '@mat-plan/db';
import { METRIC_AGGREGATION, METRIC_KEYS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { toAdherence, toAdherenceList } from './adherence';

/** Build a raw adherence row (drizzle returns numerics/aggregates as strings; MAX of ∅ is null). */
function row(over: Partial<WeeklyAdherenceRow>): WeeklyAdherenceRow {
  return {
    metricKey: METRIC_KEYS.pushups,
    label: 'Push-ups',
    aggregation: METRIC_AGGREGATION.sum,
    target: '45.000',
    actualSum: '50',
    actualMax: '30',
    ...over,
  } as WeeklyAdherenceRow;
}

describe('toAdherence', () => {
  it('picks the SUM column for a sum metric', () => {
    expect(toAdherence(row({ aggregation: METRIC_AGGREGATION.sum }))).toEqual({
      metricKey: METRIC_KEYS.pushups,
      label: 'Push-ups',
      actual: 50,
      target: 45,
    });
  });

  it('picks the MAX column for a max metric (never the wrong column)', () => {
    const dto = toAdherence(
      row({
        metricKey: METRIC_KEYS.vsit_skill_step,
        aggregation: METRIC_AGGREGATION.max,
        actualSum: '12',
        actualMax: '5',
      }),
    );
    expect(dto.actual).toBe(5);
  });

  it('coerces a NULL actual (un-logged target this week) to 0', () => {
    expect(toAdherence(row({ actualSum: null, actualMax: null })).actual).toBe(0);
  });

  it('coerces the numeric(8,3) target string', () => {
    expect(toAdherence(row({ target: '12.000' })).target).toBe(12);
  });

  it('throws on a non-{sum,max} aggregation rather than silently reading the wrong column', () => {
    expect(() => toAdherence(row({ aggregation: METRIC_AGGREGATION.avg }))).toThrow();
  });
});

describe('toAdherenceList', () => {
  it('orders by the calisthenics display order regardless of row order', () => {
    const rows = [
      row({ metricKey: METRIC_KEYS.vsit_skill_step, aggregation: METRIC_AGGREGATION.max }),
      row({ metricKey: METRIC_KEYS.pushups }),
      row({ metricKey: METRIC_KEYS.pullups }),
    ];
    expect(toAdherenceList(rows).map((d) => d.metricKey)).toEqual([
      METRIC_KEYS.pushups,
      METRIC_KEYS.pullups,
      METRIC_KEYS.vsit_skill_step,
    ]);
  });

  it('drops a degenerate target <= 0 (progress max=0 is indeterminate)', () => {
    const rows = [row({ metricKey: METRIC_KEYS.pushups, target: '0' })];
    expect(toAdherenceList(rows)).toEqual([]);
  });
});
