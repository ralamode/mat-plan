import { ACTIVITY_TYPE_KEYS, PROFILE_KIND, ROW_REFUSAL } from '@mat-plan/shared';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';
import { CATALOG_FIXTURE } from '@mat-plan/shared/catalog/fixture';
import { DAY_PLAN_FIXTURES } from '@mat-plan/shared/program/fixtures';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', () => ({ db: { the: 'db' } }));
// CAT-3 K29: the library in effect, set per test (under vitest the real `lib/env.ts` would pick the
// test library, since DATABASE_URL is local). The name-to-list map has its own test.
const library = vi.hoisted(() => ({ entries: undefined as unknown }));
vi.mock('../catalog-library', async () => {
  const { CATALOG_MOVEMENTS: real } = await import('@mat-plan/shared/catalog/data');
  library.entries = real;
  return {
    get CATALOG_LIBRARY() {
      return library.entries;
    },
  };
});
vi.mock('../household', () => ({ getHouseholdScope: vi.fn() }));
vi.mock('../catalog', () => ({ getActivityTypeIdByKey: vi.fn(async () => ACTIVITY_TYPE_ID) }));
vi.mock('../profiles', () => ({ listProfiles: vi.fn(async () => ATHLETES) }));
// Which id missed is `report-miss.test.ts`'s; here, only WHEN the DAL asks, and with which ids.
vi.mock('./report-miss', () => ({ reportRowMiss: vi.fn(async () => {}) }));
vi.mock('@mat-plan/db', () => ({
  resolveDayPlan: vi.fn(async () => RESOLVED),
  logRow: vi.fn(async () => LOGGED),
  untickRow: vi.fn(async () => ({ ...LOGGED, hiddenAt: HIDDEN_AT })),
  retickRow: vi.fn(async () => LOGGED),
  amendRow: vi.fn(async () => LOGGED),
}));

import { amendRow, logRow, resolveDayPlan, retickRow, untickRow } from '@mat-plan/db';

import { getActivityTypeIdByKey } from '../catalog';
import { db } from '../db';
import { getHouseholdScope } from '../household';
import { DbWriteError } from '../quiet-db-errors';
import { amendDayRow, getDayPlan, logDayRow, retickDayRow, untickDayRow } from './day';
import { reportRowMiss } from './report-miss';

/**
 * The day DAL (FAM-1 steps 12b and 12d). Lane E's resolver and writers are mocked: what they decide (the
 * window, an archived athlete, the schedule, a replay) is proven by `db:verify` (`verify/day.ts`)
 * and the resolver's own tests. Here: the scope is the caller's, `today` is the argument handed in
 * and never a clock, `athletes` is added, an answer passes through as it is, and a thrown database
 * error carries no data out.
 */

const fixture = DAY_PLAN_FIXTURES['today-two-programs'];
const { athletes: _fixtureAthletes, ...RESOLVED } = fixture;
const SCOPE = { householdId: 7 } as never;
const ACTIVITY_TYPE_ID = 42;
const PROFILE_ID = fixture.profilePublicId;
const ENTRY_ID = '019826b4-0000-7000-8000-0000000000e1';
const HIDDEN_AT = '2026-11-17T18:30:00.000000Z';
const LOGGED = { ok: true, entryPublicId: ENTRY_ID, values: { reps: 5, quantities: [] } } as const;
// A day far from the real clock, so a DAL that read one would hand the writer a different day.
const TODAY = '2031-03-04';
// The row's day differs from today, so a DAL that handed the writer `day` as `today` is caught.
const YESTERDAY = '2031-03-03';
const ATHLETES = [
  { id: PROFILE_ID, name: 'Athlete One', kind: PROFILE_KIND.kid, avatar: null },
  {
    id: '019826b4-0000-7000-8000-000000000002',
    name: 'Athlete Two',
    kind: PROFILE_KIND.kid,
    avatar: null,
  },
];

const write = {
  clientId: '019826b4-0000-7000-8000-0000000000c1',
  profilePublicId: PROFILE_ID,
  day: YESTERDAY,
  workoutPublicId: '019826b4-0000-7000-8000-0000000000b1',
  prescriptionPublicId: '019826b4-0000-7000-8000-0000000000d1',
  set: 1,
  values: { reps: 5, quantities: [] },
};
const untick = { profilePublicId: PROFILE_ID, day: YESTERDAY, entryPublicId: ENTRY_ID };
const retick = { ...untick, hiddenAt: HIDDEN_AT };
const amend = {
  profilePublicId: PROFILE_ID,
  entryPublicId: ENTRY_ID,
  values: { reps: 6, quantities: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHouseholdScope).mockResolvedValue(SCOPE);
  library.entries = CATALOG_MOVEMENTS;
});

describe('getDayPlan (FAM-1 12b)', () => {
  it('CAT-3 K29: on a fixtures database the day reads its labels from the test library', async () => {
    library.entries = CATALOG_FIXTURE;
    await getDayPlan({ profilePublicId: PROFILE_ID, day: YESTERDAY, today: TODAY });
    expect(vi.mocked(resolveDayPlan).mock.calls[0]?.[1]).toMatchObject({
      catalog: CATALOG_FIXTURE,
    });
  });

  it('resolves through the caller’s scope with the day and today handed in, and adds athletes', async () => {
    const plan = await getDayPlan({ profilePublicId: PROFILE_ID, day: YESTERDAY, today: TODAY });
    expect(resolveDayPlan).toHaveBeenCalledWith(db, {
      scope: SCOPE,
      profilePublicId: PROFILE_ID,
      day: YESTERDAY,
      today: TODAY,
      // C32: the real library, read by slug for a day item's coach label.
      catalog: CATALOG_MOVEMENTS,
    });
    expect(plan).toEqual({
      ...RESOLVED,
      athletes: ATHLETES.map((a) => ({ profilePublicId: a.id, name: a.name })),
    });
  });

  it('the resolver’s writable, future and canGoForward reach the plan unchanged', async () => {
    const flags = { writable: false, future: true, canGoForward: false };
    vi.mocked(resolveDayPlan).mockResolvedValueOnce({ ...RESOLVED, ...flags } as never);
    expect(
      await getDayPlan({ profilePublicId: PROFILE_ID, day: YESTERDAY, today: TODAY }),
    ).toMatchObject(flags);
  });

  it('an athlete the resolver does not find, no household, a non-uuid id or a non-day: null', async () => {
    vi.mocked(resolveDayPlan).mockResolvedValueOnce(null);
    expect(
      await getDayPlan({ profilePublicId: PROFILE_ID, day: YESTERDAY, today: TODAY }),
    ).toBeNull();

    vi.mocked(getHouseholdScope).mockResolvedValueOnce(null);
    expect(
      await getDayPlan({ profilePublicId: PROFILE_ID, day: YESTERDAY, today: TODAY }),
    ).toBeNull();
    expect(await getDayPlan({ profilePublicId: 'x', day: YESTERDAY, today: TODAY })).toBeNull();
    expect(
      await getDayPlan({ profilePublicId: PROFILE_ID, day: '2031-02-30', today: TODAY }),
    ).toBeNull();
    expect(
      await getDayPlan({ profilePublicId: PROFILE_ID, day: YESTERDAY, today: 'tomorrow' }),
    ).toBeNull();
    expect(resolveDayPlan).toHaveBeenCalledTimes(1);
  });
});

describe('the row writes (FAM-1 12b; Change, 12d)', () => {
  it('each write goes through the caller’s scope with today handed in, and answers as the writer did', async () => {
    expect(await logDayRow(write, TODAY)).toEqual(LOGGED);
    expect(getActivityTypeIdByKey).toHaveBeenCalledWith(ACTIVITY_TYPE_KEYS.workout_item);
    expect(logRow).toHaveBeenCalledWith(db, {
      scope: SCOPE,
      today: TODAY,
      activityTypeId: ACTIVITY_TYPE_ID,
      write,
    });

    expect(await untickDayRow(untick, TODAY)).toEqual({ ...LOGGED, hiddenAt: HIDDEN_AT });
    expect(untickRow).toHaveBeenCalledWith(db, { scope: SCOPE, today: TODAY, input: untick });

    expect(await retickDayRow(retick, TODAY)).toEqual(LOGGED);
    expect(retickRow).toHaveBeenCalledWith(db, { scope: SCOPE, today: TODAY, input: retick });

    expect(await amendDayRow(amend, TODAY)).toEqual(LOGGED);
    expect(amendRow).toHaveBeenCalledWith(db, { scope: SCOPE, today: TODAY, input: amend });
  });

  it.each([
    ROW_REFUSAL.closed_day,
    ROW_REFUSAL.not_found,
    ROW_REFUSAL.slot_taken,
    ROW_REFUSAL.not_scheduled,
  ])('a writer’s %s is passed through as it is', async (reason) => {
    const refused = { ok: false, reason } as const;
    vi.mocked(logRow).mockResolvedValueOnce(refused);
    vi.mocked(untickRow).mockResolvedValueOnce(refused);
    vi.mocked(retickRow).mockResolvedValueOnce(refused);
    vi.mocked(amendRow).mockResolvedValueOnce(refused);
    expect(await logDayRow(write, TODAY)).toEqual(refused);
    expect(await untickDayRow(untick, TODAY)).toEqual(refused);
    expect(await retickDayRow(retick, TODAY)).toEqual(refused);
    expect(await amendDayRow(amend, TODAY)).toEqual(refused);
  });

  it('a ✓ the writer answers not_found asks which id missed, with the scope and the write; nothing else does', async () => {
    const notFound = { ok: false, reason: ROW_REFUSAL.not_found } as const;
    vi.mocked(logRow).mockResolvedValueOnce(notFound);
    expect(await logDayRow(write, TODAY)).toEqual(notFound);
    expect(vi.mocked(reportRowMiss).mock.calls).toEqual([[SCOPE, write]]);

    vi.mocked(reportRowMiss).mockClear();
    vi.mocked(logRow).mockResolvedValueOnce({ ok: false, reason: ROW_REFUSAL.slot_taken });
    await logDayRow(write, TODAY);
    await logDayRow(write, TODAY);
    vi.mocked(untickRow).mockResolvedValueOnce(notFound);
    vi.mocked(retickRow).mockResolvedValueOnce(notFound);
    vi.mocked(amendRow).mockResolvedValueOnce(notFound);
    await untickDayRow(untick, TODAY);
    await retickDayRow(retick, TODAY);
    // A Change carries only an entry id, as un-tick does: answered, not reported.
    expect(await amendDayRow(amend, TODAY)).toEqual(notFound);
    expect(reportRowMiss).not.toHaveBeenCalled();
  });

  it('no household is not_found, and no writer runs', async () => {
    vi.mocked(getHouseholdScope).mockResolvedValue(null);
    const notFound = { ok: false, reason: ROW_REFUSAL.not_found };
    expect(await logDayRow(write, TODAY)).toEqual(notFound);
    expect(await untickDayRow(untick, TODAY)).toEqual(notFound);
    expect(await retickDayRow(retick, TODAY)).toEqual(notFound);
    expect(await amendDayRow(amend, TODAY)).toEqual(notFound);
    expect(logRow).not.toHaveBeenCalled();
    expect(untickRow).not.toHaveBeenCalled();
    expect(retickRow).not.toHaveBeenCalled();
    expect(amendRow).not.toHaveBeenCalled();
  });

  it('a thrown database error leaves without the logged numbers', async () => {
    const leak = 'reps 5, knee sore';
    const failed = () =>
      new DrizzleQueryError(
        'insert into "entry_sets" ("note") values ($1)',
        [leak],
        new Error(leak),
      );
    vi.mocked(logRow).mockRejectedValueOnce(failed());
    vi.mocked(untickRow).mockRejectedValueOnce(failed());
    vi.mocked(retickRow).mockRejectedValueOnce(failed());
    vi.mocked(amendRow).mockRejectedValueOnce(failed());
    for (const call of [
      () => logDayRow(write, TODAY),
      () => untickDayRow(untick, TODAY),
      () => retickDayRow(retick, TODAY),
      () => amendDayRow(amend, TODAY),
    ]) {
      const thrown = await call().catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(DbWriteError);
      expect(String((thrown as Error).stack)).not.toContain(leak);
      expect((thrown as Error).message).not.toContain(leak);
    }
  });
});
