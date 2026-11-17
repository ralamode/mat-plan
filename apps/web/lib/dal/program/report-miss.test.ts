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
}));

import { programIn, workoutIn } from '@mat-plan/db';

import { db } from '../db';
import { reportScopeMiss, SCOPE_MISS_ACTION, SCOPE_MISS_KIND } from '../household';
import { reportProgramMiss } from './report-miss';

const PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a1';
const WORKOUT_ID = '019826b4-0000-7000-8000-0000000000b1';
const SCOPE = { householdId: 7 } as never;

const programMiss = {
  action: SCOPE_MISS_ACTION.resolveProgram,
  resource: { kind: SCOPE_MISS_KIND.program, publicId: PROGRAM_ID },
};
const workoutMiss = {
  action: SCOPE_MISS_ACTION.resolveWorkout,
  resource: { kind: SCOPE_MISS_KIND.workout, publicId: WORKOUT_ID },
};

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
