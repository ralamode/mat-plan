import { PROGRAM_REFUSAL } from '@mat-plan/shared';
import { heavyADraft } from '@mat-plan/shared/program/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', () => ({ db: { the: 'db' } }));
vi.mock('../household', () => ({ getHouseholdScope: vi.fn() }));
vi.mock('@mat-plan/db', () => ({
  createProgram: vi.fn(async () => ({ ok: true, programPublicId: PROGRAM_ID })),
  renameProgram: vi.fn(async () => ({ ok: true })),
  saveWorkout: vi.fn(async () => ({ ok: true, workoutPublicId: WORKOUT_ID })),
  readWorkoutDraft: vi.fn(async () => null),
  saveWeek: vi.fn(async () => ({ ok: true })),
  copyWorkout: vi.fn(async () => ({ ok: true, workoutPublicId: WORKOUT_ID })),
  newItem: vi.fn(async () => ({
    ok: true,
    itemPublicId: WORKOUT_ID,
    name: 'Bear crawl',
    trackingType: 'reps',
    existed: false,
  })),
}));
// Which id missed is `report-miss.test.ts`'s; here, only WHEN the DAL asks, and with which ids.
vi.mock('./report-miss', () => ({
  reportProgramMiss: vi.fn(async () => {}),
  reportWeekMiss: vi.fn(async () => {}),
  reportCopyMiss: vi.fn(async () => {}),
}));

import {
  copyWorkout,
  createProgram,
  newItem,
  readWorkoutDraft,
  renameProgram,
  saveWeek,
  saveWorkout,
} from '@mat-plan/db';
import { emptyWeek, TRACKING_TYPE } from '@mat-plan/shared';

import { db } from '../db';
import { getHouseholdScope } from '../household';
import { DbWriteError } from '../quiet-db-errors';
import { getWorkoutDraft } from './reads';
import { reportCopyMiss, reportProgramMiss, reportWeekMiss } from './report-miss';
import {
  copyHouseholdWorkout,
  createHouseholdProgram,
  newHouseholdItem,
  renameHouseholdProgram,
  saveHouseholdWeek,
  saveHouseholdWorkout,
} from './writes';

const PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a1';
const WORKOUT_ID = '019826b4-0000-7000-8000-0000000000b1';
const CLIENT_ID = '019826b4-0000-7000-8000-0000000000c1';
const SCOPE = { householdId: 7 } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHouseholdScope).mockResolvedValue(SCOPE);
});

describe('the program DAL (FAM-1 7a-i)', () => {
  it('each write goes through the caller’s own household scope, with the parsed input', async () => {
    const input = { clientId: CLIENT_ID, name: 'Strength' };
    await createHouseholdProgram(input);
    expect(vi.mocked(createProgram).mock.calls[0]![0]).toBe(db);
    expect(vi.mocked(createProgram).mock.calls[0]![1]).toBe(SCOPE);
    expect(vi.mocked(createProgram).mock.calls[0]![2]).toBe(input);
    await renameHouseholdProgram({ programPublicId: PROGRAM_ID, name: 'A' });
    expect(vi.mocked(renameProgram).mock.calls[0]![1]).toBe(SCOPE);
    await saveHouseholdWorkout(heavyADraft);
    expect(vi.mocked(saveWorkout).mock.calls[0]![1]).toBe(SCOPE);
  });

  it('no household is not_found, and no writer runs', async () => {
    vi.mocked(getHouseholdScope).mockResolvedValue(null);
    expect(await saveHouseholdWorkout(heavyADraft)).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.not_found,
    });
    expect(await createHouseholdProgram({ clientId: CLIENT_ID, name: 'A' })).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.not_found,
    });
    const rename = { programPublicId: PROGRAM_ID, name: 'A' };
    expect(await renameHouseholdProgram(rename)).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.not_found,
    });
    expect(saveWorkout).not.toHaveBeenCalled();
    expect(createProgram).not.toHaveBeenCalled();
    expect(renameProgram).not.toHaveBeenCalled();
    // Save and rename carry ids, so their misses are reported with no scope; create carries none.
    expect(vi.mocked(reportProgramMiss).mock.calls).toEqual([
      [null, heavyADraft],
      [null, rename],
    ]);
  });

  it('a writer’s not_found reports which id missed, once, and is still not_found', async () => {
    const notFound = { ok: false, reason: PROGRAM_REFUSAL.not_found } as const;
    vi.mocked(saveWorkout).mockResolvedValueOnce(notFound);
    expect(await saveHouseholdWorkout(heavyADraft)).toEqual(notFound);
    vi.mocked(renameProgram).mockResolvedValueOnce(notFound);
    const rename = { programPublicId: PROGRAM_ID, name: 'A' };
    expect(await renameHouseholdProgram(rename)).toEqual(notFound);
    expect(vi.mocked(reportProgramMiss).mock.calls).toEqual([
      [SCOPE, heavyADraft],
      [SCOPE, rename],
    ]);
  });

  it('a success, or any other refusal, reports nothing', async () => {
    await saveHouseholdWorkout(heavyADraft);
    vi.mocked(renameProgram).mockResolvedValueOnce({
      ok: false,
      reason: PROGRAM_REFUSAL.name_taken,
    });
    await renameHouseholdProgram({ programPublicId: PROGRAM_ID, name: 'A' });
    vi.mocked(createProgram).mockResolvedValueOnce({
      ok: false,
      reason: PROGRAM_REFUSAL.not_found,
    });
    await createHouseholdProgram({ clientId: CLIENT_ID, name: 'A' });
    expect(reportProgramMiss).not.toHaveBeenCalled();
  });

  it('a writer’s refusal comes back unchanged', async () => {
    vi.mocked(renameProgram).mockResolvedValueOnce({
      ok: false,
      reason: PROGRAM_REFUSAL.name_taken,
    });
    expect(await renameHouseholdProgram({ programPublicId: PROGRAM_ID, name: 'A' })).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.name_taken,
    });
  });

  it('a writer that throws is rethrown without its data (the runtime log)', async () => {
    vi.mocked(saveWorkout).mockRejectedValueOnce(
      Object.assign(new Error('Failed query: insert …\nparams: knee sore'), { code: '57014' }),
    );
    const thrown = await saveHouseholdWorkout(heavyADraft).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DbWriteError);
    expect(String(thrown)).not.toContain('knee sore');
  });

  it('the editor’s read: a non-uuid id is null with no query; else through the scope', async () => {
    expect(await getWorkoutDraft('not-a-uuid', WORKOUT_ID)).toBeNull();
    expect(await getWorkoutDraft(PROGRAM_ID, '7')).toBeNull();
    expect(readWorkoutDraft).not.toHaveBeenCalled();
    expect(getHouseholdScope).not.toHaveBeenCalled();
    // Not a uuid is not a probe of an id: nothing is reported.
    expect(reportProgramMiss).not.toHaveBeenCalled();
    await getWorkoutDraft(PROGRAM_ID, WORKOUT_ID);
    expect(vi.mocked(readWorkoutDraft).mock.calls[0]).toEqual([
      db,
      SCOPE,
      { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID },
    ]);
    // The read found nothing (the mock's null): the miss is reported with the route's ids.
    expect(vi.mocked(reportProgramMiss).mock.calls).toEqual([
      [SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID }],
    ]);
  });

  it('the editor’s read that finds the workout reports nothing', async () => {
    vi.mocked(readWorkoutDraft).mockResolvedValueOnce(heavyADraft);
    expect(await getWorkoutDraft(PROGRAM_ID, WORKOUT_ID)).toBe(heavyADraft);
    expect(reportProgramMiss).not.toHaveBeenCalled();
  });

  it('the editor’s read with no household is null, with no query, and the miss reported', async () => {
    vi.mocked(getHouseholdScope).mockResolvedValue(null);
    expect(await getWorkoutDraft(PROGRAM_ID, WORKOUT_ID)).toBeNull();
    expect(readWorkoutDraft).not.toHaveBeenCalled();
    expect(vi.mocked(reportProgramMiss).mock.calls).toEqual([
      [null, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID }],
    ]);
  });
});

describe('the program DAL (FAM-1 7a-ii): week, copy, new item', () => {
  const OTHER = '019826b4-0000-7000-8000-0000000000b2';
  const week = () => ({
    programPublicId: PROGRAM_ID,
    days: {
      ...emptyWeek(),
      1: [{ workoutPublicId: WORKOUT_ID, label: null }],
      4: [{ workoutPublicId: OTHER, label: 'Long' }],
    },
  });
  const copy = () => ({
    clientId: CLIENT_ID,
    workoutPublicId: WORKOUT_ID,
    toProgramPublicId: PROGRAM_ID,
    weekdays: [],
    label: null,
  });
  const NOT_FOUND = { ok: false, reason: PROGRAM_REFUSAL.not_found } as const;

  it('each goes through the caller’s scope, with the parsed input', async () => {
    await saveHouseholdWeek(week());
    expect(vi.mocked(saveWeek).mock.calls[0]).toEqual([db, SCOPE, week()]);
    await copyHouseholdWorkout(copy());
    expect(vi.mocked(copyWorkout).mock.calls[0]).toEqual([db, SCOPE, copy()]);
    const item = { name: 'Bear crawl', trackingType: TRACKING_TYPE.reps };
    await newHouseholdItem(item);
    expect(vi.mocked(newItem).mock.calls[0]).toEqual([db, SCOPE, item]);
    expect(reportWeekMiss).not.toHaveBeenCalled();
    expect(reportCopyMiss).not.toHaveBeenCalled();
  });

  it('a week’s not_found reports its program and every workout it names, in order', async () => {
    vi.mocked(saveWeek).mockResolvedValueOnce(NOT_FOUND);
    expect(await saveHouseholdWeek(week())).toEqual(NOT_FOUND);
    expect(vi.mocked(reportWeekMiss).mock.calls).toEqual([
      [SCOPE, { programPublicId: PROGRAM_ID, workoutPublicIds: [WORKOUT_ID, OTHER] }],
    ]);
  });

  it('a copy’s not_found reports the target and the source', async () => {
    vi.mocked(copyWorkout).mockResolvedValueOnce(NOT_FOUND);
    expect(await copyHouseholdWorkout(copy())).toEqual(NOT_FOUND);
    expect(vi.mocked(reportCopyMiss).mock.calls).toEqual([[SCOPE, copy()]]);
  });

  it('another refusal passes through, and nothing is reported', async () => {
    vi.mocked(copyWorkout).mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.name_taken });
    expect(await copyHouseholdWorkout(copy())).toEqual({
      ok: false,
      reason: PROGRAM_REFUSAL.name_taken,
    });
    expect(reportCopyMiss).not.toHaveBeenCalled();
  });

  it('no scope: not_found, the writer never called; week and copy report, a new item has no id', async () => {
    vi.mocked(getHouseholdScope).mockResolvedValue(null);
    expect(await saveHouseholdWeek(week())).toEqual(NOT_FOUND);
    expect(await copyHouseholdWorkout(copy())).toEqual(NOT_FOUND);
    expect(
      await newHouseholdItem({ name: 'Bear crawl', trackingType: TRACKING_TYPE.reps }),
    ).toEqual(NOT_FOUND);
    expect(saveWeek).not.toHaveBeenCalled();
    expect(copyWorkout).not.toHaveBeenCalled();
    expect(newItem).not.toHaveBeenCalled();
    expect(vi.mocked(reportWeekMiss).mock.calls[0]![0]).toBeNull();
    expect(vi.mocked(reportCopyMiss).mock.calls[0]![0]).toBeNull();
  });

  it('a thrown database error leaves as a DbWriteError, carrying none of the input', async () => {
    vi.mocked(newItem).mockRejectedValueOnce(new Error('insert failed: Bear crawl'));
    const thrown = await newHouseholdItem({
      name: 'Bear crawl',
      trackingType: TRACKING_TYPE.reps,
    }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(DbWriteError);
    expect(String((thrown as Error).message)).not.toContain('Bear crawl');
  });
});
