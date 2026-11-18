import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', () => ({ db: { the: 'db' } }));
// A PARTIAL mock: the action and kind constants are the real ones; only the report is replaced.
vi.mock('../household', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../household')>()),
  reportScopeMiss: vi.fn(async () => {}),
}));
vi.mock('@mat-plan/db', () => ({
  programIn: vi.fn(async () => true),
  workoutIn: vi.fn(async () => true),
  workoutInHousehold: vi.fn(async () => true),
  programWorkoutIds: vi.fn(async () => new Set<string>()),
}));

import { programIn, programWorkoutIds, workoutIn, workoutInHousehold } from '@mat-plan/db';

import { db } from '../db';
import { reportScopeMiss, SCOPE_MISS_ACTION, SCOPE_MISS_KIND } from '../household';
import { reportCopyMiss, reportProgramMiss, reportWeekMiss } from './report-miss';

const PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a1';
const WORKOUT_ID = '019826b4-0000-7000-8000-0000000000b1';
const SCOPE = { householdId: 7 } as never;

const programMiss = {
  action: SCOPE_MISS_ACTION.resolveProgram,
  resource: { kind: SCOPE_MISS_KIND.program, publicId: PROGRAM_ID },
};
const missOf = (publicId: string) => ({
  action: SCOPE_MISS_ACTION.resolveWorkout,
  resource: { kind: SCOPE_MISS_KIND.workout, publicId },
});
const workoutMiss = missOf(WORKOUT_ID);

beforeEach(() => vi.clearAllMocks());

describe('which program id missed the household (FAM-1 7a-i, C11)', () => {
  it('a program that is not the household’s is reported once, and its workout is not read', async () => {
    vi.mocked(programIn).mockResolvedValueOnce(false);
    await reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID });
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(vi.mocked(programIn).mock.calls).toEqual([[db, SCOPE, PROGRAM_ID]]);
    expect(workoutIn).not.toHaveBeenCalled();
  });

  it('the household’s program with a workout that is not its own reports the workout', async () => {
    vi.mocked(workoutIn).mockResolvedValueOnce(false);
    await reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID });
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[workoutMiss]]);
    expect(vi.mocked(workoutIn).mock.calls).toEqual([[db, SCOPE, PROGRAM_ID, WORKOUT_ID]]);
  });

  it('both found: the miss was something else (an item), and nothing is reported', async () => {
    await reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID });
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('a new workout (no id yet) reads only the program', async () => {
    await reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: null });
    expect(workoutIn).not.toHaveBeenCalled();
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('no scope: the program id is reported (as no_scope, by reportScopeMiss) and nothing is read', async () => {
    await reportProgramMiss(null, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID });
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(programIn).not.toHaveBeenCalled();
    expect(workoutIn).not.toHaveBeenCalled();
  });

  it('a failed check never throws: nothing is reported, and the caller keeps its answer', async () => {
    vi.mocked(programIn).mockRejectedValueOnce(new Error('canceling statement due to timeout'));
    await expect(
      reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID }),
    ).resolves.toBeUndefined();
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });
});

const OTHER_WORKOUT = '019826b4-0000-7000-8000-0000000000b2';

describe('a week (FAM-1 7a-ii): its program, then the first workout it names that is not the program’s', () => {
  const known = (...ids: string[]) =>
    vi.mocked(programWorkoutIds).mockResolvedValueOnce(new Set(ids));

  it('the program missing is reported, and no workout is looked up', async () => {
    vi.mocked(programWorkoutIds).mockResolvedValueOnce(null);
    await reportWeekMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicIds: [WORKOUT_ID] });
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(vi.mocked(programWorkoutIds).mock.calls).toEqual([[db, SCOPE, PROGRAM_ID]]);
  });

  it('🔴 a foreign workout on any day is reported: the first one, once, with ONE read of the program', async () => {
    known(WORKOUT_ID);
    await reportWeekMiss(SCOPE, {
      programPublicId: PROGRAM_ID,
      workoutPublicIds: [WORKOUT_ID, WORKOUT_ID, OTHER_WORKOUT],
    });
    expect(vi.mocked(programWorkoutIds).mock.calls).toEqual([[db, SCOPE, PROGRAM_ID]]);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[missOf(OTHER_WORKOUT)]]);
  });

  it('🔴 checks every id, however many: a foreign id after sixty of the program’s own is reported (6c-ii)', async () => {
    const ids = Array.from(
      { length: 60 },
      (_, i) => `019826b4-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    known(...ids);
    await reportWeekMiss(SCOPE, {
      programPublicId: PROGRAM_ID,
      workoutPublicIds: [...ids, ...ids, OTHER_WORKOUT],
    });
    expect(vi.mocked(programWorkoutIds)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[missOf(OTHER_WORKOUT)]]);
  });

  it('every id the program has: nothing is reported', async () => {
    known(WORKOUT_ID, OTHER_WORKOUT);
    await reportWeekMiss(SCOPE, {
      programPublicId: PROGRAM_ID,
      workoutPublicIds: [OTHER_WORKOUT, WORKOUT_ID],
    });
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('with no scope, the program is reported and nothing is read', async () => {
    await reportWeekMiss(null, { programPublicId: PROGRAM_ID, workoutPublicIds: [WORKOUT_ID] });
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(programWorkoutIds).not.toHaveBeenCalled();
  });

  it('a failed read reports nothing, and does not throw', async () => {
    vi.mocked(programWorkoutIds).mockRejectedValueOnce(
      new Error('canceling statement due to timeout'),
    );
    await expect(
      reportWeekMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicIds: [WORKOUT_ID] }),
    ).resolves.toBeUndefined();
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });
});

describe('a copy (FAM-1 7a-ii): the target program, then the source workout by its id alone', () => {
  const copy = { toProgramPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID };

  it('a target that is not the household’s is reported, and the source is not read', async () => {
    vi.mocked(programIn).mockResolvedValueOnce(false);
    await reportCopyMiss(SCOPE, copy);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(workoutInHousehold).not.toHaveBeenCalled();
  });

  it('a source workout that is not the household’s is reported', async () => {
    vi.mocked(workoutInHousehold).mockResolvedValueOnce(false);
    await reportCopyMiss(SCOPE, copy);
    expect(vi.mocked(workoutInHousehold).mock.calls).toEqual([[db, SCOPE, WORKOUT_ID]]);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[workoutMiss]]);
  });

  it('both found (a replay of a removed copy, a name taken): nothing is reported', async () => {
    await reportCopyMiss(SCOPE, copy);
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('no scope: the target is reported, nothing is read', async () => {
    await reportCopyMiss(null, copy);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(programIn).not.toHaveBeenCalled();
  });

  it('a check that throws never throws out: nothing is reported', async () => {
    vi.mocked(workoutInHousehold).mockRejectedValueOnce(new Error('connection reset'));
    await expect(reportCopyMiss(SCOPE, copy)).resolves.toBeUndefined();
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });
});
