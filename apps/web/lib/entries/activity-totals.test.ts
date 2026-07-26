import { ACTIVITY_TYPE_KEYS, DEFAULT_SESSION_TYPE, ENTRY_STATUS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import type { EntryDTO } from '@/lib/dal/entries';

import { calisthenicsTotals, todayRows } from './activity-totals';

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
    sessionId: null,
    sessionType: null,
    sets: [],
    ...overrides,
  };
}

// A one-off habit row (kind-NULL, neither-source), used across the todayRows suites.
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

describe('calisthenicsTotals', () => {
  it('sums a metric across the day, counts the bouts, lists them oldest-first', () => {
    // Passed newest-first (desc); `values` comes back oldest-first for display ("20, 30").
    const totals = calisthenicsTotals([reading({ value: 30 }), reading({ value: 20 })]);
    expect(totals).toEqual([
      { metricKey: 'pushups', label: 'Push-ups', total: 50, readings: 2, values: [20, 30] },
    ]);
  });

  it('folds the skill step by max, not sum', () => {
    const skill = (value: number) =>
      reading({
        metricKey: 'vsit_skill_step',
        metricLabel: 'V-sit skill step',
        aggregation: 'max',
        value,
      });
    const totals = calisthenicsTotals([skill(3), skill(5), skill(4)]);
    expect(totals).toEqual([
      {
        metricKey: 'vsit_skill_step',
        label: 'V-sit skill step',
        total: 5,
        readings: 3,
        values: [4, 5, 3],
      },
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
    expect(totals).toEqual([
      { metricKey: 'pushups', label: 'Push-ups', total: 20, readings: 1, values: [20] },
    ]);
  });

  it('skips null values and non-done readings', () => {
    const totals = calisthenicsTotals([
      reading({ value: 20 }),
      reading({ value: null }),
      reading({ value: 15, status: ENTRY_STATUS.skipped }),
    ]);
    expect(totals).toEqual([
      { metricKey: 'pushups', label: 'Push-ups', total: 20, readings: 1, values: [20] },
    ]);
  });

  it('returns [] when there are no calisthenics readings', () => {
    expect(calisthenicsTotals([])).toEqual([]);
  });
});

describe('todayRows — the "Logged entries" list composition (V1-6a)', () => {
  it('groups N calisthenics bouts of one exercise into ONE row, not N', () => {
    // Two push-up bouts (desc) + a one-off habit → 2 rows total, not 3.
    const rows = todayRows([
      reading({ id: 'b2', value: 30 }),
      reading({ id: 'b1', value: 20 }),
      habit(),
    ]);
    expect(rows).toHaveLength(2);
    const calis = rows.find((r) => r.kind === 'calisthenics');
    expect(calis).toEqual({
      kind: 'calisthenics',
      total: { metricKey: 'pushups', label: 'Push-ups', total: 50, readings: 2, values: [20, 30] },
    });
    expect(rows.filter((r) => r.kind === 'entry')).toHaveLength(1); // the habit, individually
  });

  it('emits the grouped calisthenics row at the position of the newest bout', () => {
    // desc order: newest push-up bout, then the habit, then the older bout.
    const rows = todayRows([
      reading({ id: 'b2', value: 30 }),
      habit(),
      reading({ id: 'b1', value: 20 }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['calisthenics', 'entry']); // grouped once, at the top
  });

  it('renders non-calisthenics entries individually and in order', () => {
    const rows = todayRows([habit()]);
    expect(rows).toEqual([{ kind: 'entry', entry: habit() }]);
  });
});

describe('todayRows — strength session grouping (V1-8-3a)', () => {
  // A session movement DTO: kind-NULL, movement-shaped, tagged with a session public id. `id` is the
  // entry's public id (uuidv7 == insertion order); DTOs arrive from the DAL desc(createdAt), asc(id).
  const move = (o: Partial<EntryDTO>): EntryDTO =>
    reading({
      activityKey: ACTIVITY_TYPE_KEYS.sc_lift,
      activityLabel: 'S&C lift',
      metricKey: null,
      metricLabel: null,
      aggregation: null,
      unit: 'lb',
      value: null,
      movementName: 'Back squat',
      sessionId: 's1',
      sessionType: DEFAULT_SESSION_TYPE,
      sets: [{ idx: 1, reps: 5, weight: 135, weightLabel: null }],
      ...o,
    });

  it('collapses a 3-movement session into ONE block, movements in insertion order', () => {
    // One tx → shared created_at → DAL returns them id-asc (a, b, c) contiguously.
    const rows = todayRows([
      move({ id: 'a', movementName: 'Back squat' }),
      move({ id: 'b', movementName: 'Bench press' }),
      move({ id: 'c', movementName: 'Barbell row' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'session',
      session: { id: 's1', type: DEFAULT_SESSION_TYPE },
    });
    const session = rows[0] as Extract<(typeof rows)[number], { kind: 'session' }>;
    expect(session.movements.map((m) => m.movementName)).toEqual([
      'Back squat',
      'Bench press',
      'Barbell row',
    ]);
  });

  it('gathers a non-contiguous replay-appended member into the SAME block, re-ordered by id', () => {
    // The appended movement 'd' has a later created_at → appears first in the desc list, and a check-in
    // sits between it and the original block. A contiguous-run collector would split the session in two.
    const rows = todayRows([
      move({ id: 'd', movementName: 'Deadlift' }), // appended later (newest)
      habit(),
      move({ id: 'a', movementName: 'Back squat' }),
      move({ id: 'b', movementName: 'Bench press' }),
    ]);
    const sessions = rows.filter((r) => r.kind === 'session');
    expect(sessions).toHaveLength(1); // ONE block, not two
    const session = sessions[0] as Extract<(typeof rows)[number], { kind: 'session' }>;
    // Sorted by id asc == insertion order: a, b, then the appended d.
    expect(session.movements.map((m) => m.id)).toEqual(['a', 'b', 'd']);
    // The block anchors at the session's OLDEST member ('a'), so it stays BELOW the later-logged habit
    // (which is newer than 'a') rather than jumping to the top at the appended 'd' — no relocation.
    expect(rows.map((r) => r.kind)).toEqual(['entry', 'session']);
  });

  it('keeps a mixed day intact: session block + calisthenics grouping + flat habit', () => {
    const rows = todayRows([
      reading({ id: 'p2', value: 30 }), // push-up bouts (calisthenics)
      reading({ id: 'p1', value: 20 }),
      move({ id: 'a', movementName: 'Back squat' }),
      move({ id: 'b', movementName: 'Bench press' }),
      habit(),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['calisthenics', 'session', 'entry']);
    const calis = rows.find((r) => r.kind === 'calisthenics');
    expect(calis).toMatchObject({ total: { total: 50, readings: 2, values: [20, 30] } });
  });

  it('renders legacy / soft-deleted-session strength (sessionId NULL) as flat individual rows', () => {
    // A soft-deleted session fails the LEFT JOIN → its members carry sessionId NULL → flat, not dropped.
    const legacy = move({
      id: 'x',
      sessionId: null,
      sessionType: null,
      movementName: 'Front squat',
    });
    const rows = todayRows([legacy]);
    expect(rows).toEqual([{ kind: 'entry', entry: legacy }]);
  });

  it('renders a 1-movement session as a block (always a block, no N=1 fallback)', () => {
    const rows = todayRows([move({ id: 'a' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('session');
    const session = rows[0] as Extract<(typeof rows)[number], { kind: 'session' }>;
    expect(session.movements).toHaveLength(1);
  });
});
