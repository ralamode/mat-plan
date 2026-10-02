import {
  ACTIVITY_TYPE_KEYS,
  DEFAULT_BODYWEIGHT_UNIT,
  DEFAULT_SESSION_TYPE,
  ENTRY_KIND,
  ENTRY_STATUS,
  METRIC_VALUE_TYPE,
  SEED_METRIC_KEYS,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { STRENGTH_COPY } from '@/lib/constants';
import type { EntryDTO } from '@/lib/dal/entries';

import {
  calisthenicsTotals,
  loggedBodyweight,
  loggedMovements,
  movementNames,
  sessionMovements,
  todayRows,
  type SessionRow,
} from './activity-totals';

// Flatten a session's two-level items (V1-8-3d) back to member entries in display order — the
// shipped helper, so the tests and the receipt can't flatten differently.
const members = sessionMovements;

// A calisthenics reading DTO. Rows arrive from the DAL OLDEST-FIRST (asc(createdAt), V1-17); tests
// pass them oldest-first when order matters (e.g. bouts [reading(20), reading(30)] → values [20, 30]).
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
    sessionFeel: null,
    supersetId: null,
    supersetOrder: null,
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
    // The DAL returns OLDEST-FIRST (asc, V1-17); `values` is that order for display ("20, 30").
    const totals = calisthenicsTotals([reading({ value: 20 }), reading({ value: 30 })]);
    expect(totals).toEqual([
      { metricKey: 'pushups', label: 'Push-ups', total: 50, readings: 2, values: [20, 30] },
    ]);
  });

  it('folds the skill step by max, not sum (order-independent under the reversed fold input)', () => {
    const skill = (value: number) =>
      reading({
        metricKey: 'vsit_skill_step',
        metricLabel: 'V-sit skill step',
        aggregation: 'max',
        value,
      });
    // Oldest → newest: 4, 5, 3. `values` mirrors that; `total` is the max (5) regardless of order.
    const totals = calisthenicsTotals([skill(4), skill(5), skill(3)]);
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
    // Two push-up bouts (oldest-first, V1-17) + a one-off habit → 2 rows total, not 3.
    const rows = todayRows([
      reading({ id: 'b1', value: 20 }),
      reading({ id: 'b2', value: 30 }),
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

  it('emits the grouped calisthenics row at the position of the OLDEST bout (performed order)', () => {
    // asc order (V1-17): oldest push-up bout, then the habit, then the newer bout.
    const rows = todayRows([
      reading({ id: 'b1', value: 20 }),
      habit(),
      reading({ id: 'b2', value: 30 }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['calisthenics', 'entry']); // grouped once, at the oldest bout
  });

  it('renders non-calisthenics entries individually and in order', () => {
    const rows = todayRows([habit()]);
    expect(rows).toEqual([{ kind: 'entry', entry: habit() }]);
  });
});

describe('todayRows — strength session grouping (V1-8-3a)', () => {
  // A session movement DTO: kind-NULL, movement-shaped, tagged with a session public id. `id` is the
  // entry's public id (uuidv7 == insertion order); DTOs arrive from the DAL asc(createdAt), asc(id) (V1-17).
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
      sessionDayRole: null,
      sets: [
        {
          publicId: 'set-1',
          idx: 1,
          reps: 5,
          isBodyweight: false,
          isBand: false,
          quantities: [{ slot: 'primary', dimension: 'mass', unit: 'lb', value: 135 }],
          status: 'done',
        },
      ],
      ...o,
    });

  it('movementNames: skipped marked, repeats removed, order kept (V1-24 3a-ii)', () => {
    expect(
      movementNames([
        move({ id: 'a', movementName: 'Back squat' }),
        move({ id: 'b', movementName: 'Rows', status: ENTRY_STATUS.skipped, sets: [] }),
        move({ id: 'c', movementName: 'Back squat' }), // a repeat (a second session)
        move({ id: 'd', movementName: 'Rows' }), // done later: a different fact, kept
      ]),
    ).toBe(`Back squat, Rows ${STRENGTH_COPY.skippedSuffix}, Rows`);
  });

  it('loggedMovements: every movement across sessions, a SKIPPED one marked (V1-24 3a-ii)', () => {
    const rows = todayRows([
      move({ id: 'a', movementName: 'Back squat' }),
      move({ id: 'b', movementName: 'Bench', status: ENTRY_STATUS.skipped, sets: [] }),
      move({ id: 'c', movementName: 'Rows', sessionId: 's2' }),
    ]);
    const sessions = rows.filter((r): r is SessionRow => r.kind === 'session');
    expect(
      loggedMovements(sessions).map(({ entry, skipped }) => [entry.movementName, skipped]),
    ).toEqual([
      ['Back squat', false],
      ['Bench', true],
      ['Rows', false],
    ]);
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
    expect(members(session).map((m) => m.movementName)).toEqual([
      'Back squat',
      'Bench press',
      'Barbell row',
    ]);
  });

  it('gathers a non-contiguous replay-appended member into the SAME block, re-ordered by id', () => {
    // asc order (V1-17): the original session (a, b) is oldest, then a check-in, then the appended 'd'
    // (later created_at) LAST. A contiguous-run collector would split the session in two across the habit.
    const rows = todayRows([
      move({ id: 'a', movementName: 'Back squat' }),
      move({ id: 'b', movementName: 'Bench press' }),
      habit(),
      move({ id: 'd', movementName: 'Deadlift' }), // appended later (newest created_at)
    ]);
    const sessions = rows.filter((r) => r.kind === 'session');
    expect(sessions).toHaveLength(1); // ONE block, not two
    const session = sessions[0] as Extract<(typeof rows)[number], { kind: 'session' }>;
    // Sorted by id asc == insertion order: a, b, then the appended d.
    expect(members(session).map((m) => m.id)).toEqual(['a', 'b', 'd']);
    // The block anchors at the session's OLDEST member ('a') = first-encountered under asc, so it sits
    // ABOVE the later-logged habit — performed order — and the appended 'd' doesn't relocate the block.
    expect(rows.map((r) => r.kind)).toEqual(['session', 'entry']);
  });

  it('keeps a mixed day intact: session block + calisthenics grouping + flat habit', () => {
    const rows = todayRows([
      reading({ id: 'p1', value: 20 }), // push-up bouts (calisthenics), oldest-first (V1-17)
      reading({ id: 'p2', value: 30 }),
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
      sessionDayRole: null,
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
    expect(members(session)).toHaveLength(1);
  });

  it('carries the session feel (V1-8-3b) onto the session row', () => {
    const withFeel = todayRows([move({ id: 'a', sessionFeel: 'strong' })]);
    expect(withFeel[0]).toMatchObject({ kind: 'session', session: { feel: 'strong' } });
    // no feel logged → NULL on the row (not '')
    const noFeel = todayRows([move({ id: 'b' })]);
    expect(noFeel[0]).toMatchObject({ kind: 'session', session: { feel: null } });
  });

  // ── V1-8-3d: superset sub-bracketing ──────────────────────────────────────────
  it('brackets superset members into ONE item at the superset’s earliest position', () => {
    const rows = todayRows([
      move({ id: 'a', movementName: 'Squat' }), // standalone
      move({ id: 'b', movementName: 'Bench', supersetId: 'ss1', supersetOrder: 1 }),
      move({ id: 'c', movementName: 'OHP', supersetId: 'ss1', supersetOrder: 2 }),
    ]);
    const s = rows[0] as SessionRow;
    expect(s.items.map((it) => it.kind)).toEqual(['movement', 'superset']);
    const ss = s.items.find((it) => it.kind === 'superset')!;
    expect(ss.members.map((m) => m.movementName)).toEqual(['Bench', 'OHP']);
    expect(s.movementCount).toBe(3); // count is movements, not items
  });

  it('orders superset members by supersetOrder, not by id', () => {
    const rows = todayRows([
      move({ id: 'a', movementName: 'First', supersetId: 'ss1', supersetOrder: 2 }),
      move({ id: 'b', movementName: 'Second', supersetId: 'ss1', supersetOrder: 1 }),
    ]);
    const ss = (rows[0] as SessionRow).items.find((it) => it.kind === 'superset')!;
    expect(ss.members.map((m) => m.movementName)).toEqual(['Second', 'First']);
  });

  it('renders a soft-deleted superset’s members as standalone (supersetId NULL, order live)', () => {
    // The supersets LEFT JOIN misses → supersetId NULL, but superset_order survives on the entry.
    const rows = todayRows([
      move({ id: 'a', movementName: 'Bench', supersetId: null, supersetOrder: 1 }),
      move({ id: 'b', movementName: 'OHP', supersetId: null, supersetOrder: 2 }),
    ]);
    const s = rows[0] as SessionRow;
    expect(s.items.every((it) => it.kind === 'movement')).toBe(true); // no orphan bracket
    expect(s.items).toHaveLength(2);
  });

  it('renders a superset reduced to a LONE surviving member as standalone, not a 1-member bracket', () => {
    // A member soft-deleted (v1.5-sync / V1-9) drops the group under ≥2 while the survivor keeps its
    // live supersetId — the read path must not bracket a single movement.
    const rows = todayRows([
      move({ id: 'a', movementName: 'Squat' }), // standalone
      move({ id: 'b', movementName: 'Bench', supersetId: 'ss1', supersetOrder: 1 }), // lone survivor
    ]);
    const s = rows[0] as SessionRow;
    expect(s.items.map((it) => it.kind)).toEqual(['movement', 'movement']); // no 'superset' item
    expect(s.movementCount).toBe(2);
  });
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
