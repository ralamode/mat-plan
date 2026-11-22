import {
  ACTIVITY_TYPE_KEYS,
  DEFAULT_BODYWEIGHT_UNIT,
  ENTRY_KIND,
  ENTRY_STATUS,
  METRIC_VALUE_TYPE,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import type { EntryDTO } from '@/lib/dal/entries';

import { loggedBodyweight, loggedLifeActivities } from './activity-totals';

// A calisthenics reading DTO, the base the other rows override. Rows arrive from the DAL
// OLDEST-FIRST (asc(createdAt), V1-17); tests pass them oldest-first when order matters.
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
    sessionId: null,
    sessionType: null,
    sessionDayRole: null,
    supersetId: null,
    supersetOrder: null,
    sets: [],
    ...overrides,
  };
}

// A one-off habit row (kind-NULL, neither-source): a day entry that is not a weigh-in.
const habit = (): EntryDTO =>
  reading({
    id: 'habit',
    activityKey: ACTIVITY_TYPE_KEYS.rice_bucket,
    activityLabel: 'Rice bucket',
    metricKey: null,
    value: 1,
    aggregation: null,
    unit: 'bool',
  });

// V1-24 PR 1a — a weigh-in row, as `listEntriesForDay` returns it.
const weighIn = (overrides: Partial<EntryDTO> = {}): EntryDTO =>
  reading({
    id: 'bw',
    metricKey: SEED_METRIC_KEYS.bodyweight,
    metricLabel: 'Bodyweight',
    valueType: METRIC_VALUE_TYPE.number,
    aggregation: null,
    activityKey: ACTIVITY_TYPE_KEYS.weigh_in,
    activityLabel: 'Weigh-in',
    unit: DEFAULT_BODYWEIGHT_UNIT,
    value: 84.5,
    ...overrides,
  });

describe('loggedBodyweight (V1-24 PR 1a)', () => {
  it('returns [] when the day has no weigh-in', () => {
    expect(loggedBodyweight([])).toEqual([]);
    expect(loggedBodyweight([habit(), reading({ value: 20 })])).toEqual([]);
  });

  it('returns the entry id, value and unit — the id is what PR 1b will amend by', () => {
    expect(loggedBodyweight([weighIn({ id: 'bw-1' })])).toEqual([
      { entryId: 'bw-1', value: 84.5, unit: DEFAULT_BODYWEIGHT_UNIT },
    ]);
  });

  it('keys on metric_key, not the legacy `kind`', () => {
    // `entries.kind` is scheduled for deletion, so a row carrying only the legacy discriminant must
    // NOT be picked up — and, more importantly, a modern row that lacks it must still be found.
    expect(loggedBodyweight([weighIn({ kind: null })])).toHaveLength(1);
    expect(
      loggedBodyweight([reading({ kind: ENTRY_KIND.bodyweight, metricKey: 'pushups' })]),
    ).toEqual([]);
  });

  it('skips a non-done row — the amend refuses it, so a Change control there could only fail', () => {
    expect(loggedBodyweight([weighIn({ status: ENTRY_STATUS.skipped })])).toEqual([]);
  });

  /**
   * ⚠️ A day can hold MORE than one weigh-in until PR 1d's unique index lands — prod has such days,
   * and a two-phone race can still make one. The receipt must show them ALL: collapsing to one would
   * render a clean receipt over a day whose export carries two weights.
   */
  it('returns EVERY live row on a duplicated day, oldest first, in the DAL order', () => {
    const rows = loggedBodyweight([
      weighIn({ id: 'first', value: 84.5 }),
      habit(),
      weighIn({ id: 'second', value: 845 }),
    ]);
    expect(rows).toEqual([
      { entryId: 'first', value: 84.5, unit: DEFAULT_BODYWEIGHT_UNIT },
      { entryId: 'second', value: 845, unit: DEFAULT_BODYWEIGHT_UNIT },
    ]);
  });

  /**
   * A partially-written row has nothing to show, so it must not suppress the form — otherwise the
   * athlete is left with neither a value nor a way to enter one.
   */
  it('ignores a value-less row rather than rendering an empty receipt', () => {
    expect(loggedBodyweight([weighIn({ value: null })])).toEqual([]);
    expect(
      loggedBodyweight([weighIn({ value: null }), weighIn({ id: 'real', value: 70 })]),
    ).toEqual([{ entryId: 'real', value: 70, unit: DEFAULT_BODYWEIGHT_UNIT }]);
  });
});

describe('loggedLifeActivities (V1-24 3b-page)', () => {
  const PRACTICE = ACTIVITY_TYPE_KEYS.wrestling_practice;
  const life = (id: string, activityKey: string | null, value: number | null = 90): EntryDTO =>
    reading({ id, activityKey, value, unit: 'min', metricKey: null });

  it('keeps only the asked-for keys, in the order the DAL returned them', () => {
    const rows = [
      life('a', PRACTICE, 90),
      life('b', null),
      life('c', ACTIVITY_TYPE_KEYS.wake, 412),
      life('d', PRACTICE, 45),
    ];
    expect(loggedLifeActivities(rows, [PRACTICE])).toEqual([
      { entryId: 'a', activityKey: PRACTICE, value: 90, unit: 'min' },
      { entryId: 'd', activityKey: PRACTICE, value: 45, unit: 'min' },
    ]);
  });

  it('returns nothing when no keys are asked for', () => {
    expect(loggedLifeActivities([life('a', PRACTICE)], [])).toEqual([]);
  });
});
