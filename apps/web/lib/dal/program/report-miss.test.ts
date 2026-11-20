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
  // "Not THIS program's workout" by default, so a probe by program (rather than by household)
  // would report the other-program case below.
  workoutIn: vi.fn(async () => false),
  workoutInHousehold: vi.fn(async () => true),
  programWorkoutIds: vi.fn(async () => new Set<string>()),
  // Which of the given ids are the household's live programs: the one read a Program order's probes
  // share (15c), one query for every id.
  programIdsIn: vi.fn(
    async (_db: unknown, _scope: unknown, ids: readonly string[]) =>
      new Set(ids.filter((id) => id === PROGRAM_ID || id === OTHER_PROGRAM_ID)),
  ),
}));
// The household's athletes, archived ones included: the one read the athlete probes share.
vi.mock('../profiles', () => ({
  listHouseholdAthletes: vi.fn(async () => [
    { id: ATHLETE_ID, archived: false },
    { id: ARCHIVED_ID, archived: true },
  ]),
}));

import { programIdsIn, programIn, programWorkoutIds, workoutInHousehold } from '@mat-plan/db';

import { db } from '../db';
import { reportScopeMiss, SCOPE_MISS_ACTION, SCOPE_MISS_KIND } from '../household';
import { listHouseholdAthletes } from '../profiles';
import {
  reportAssignMiss,
  reportAthleteMiss,
  reportCopyMiss,
  reportOrderProgramMiss,
  reportProgramMiss,
  reportWeekMiss,
} from './report-miss';

const PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a1';
const OTHER_PROGRAM_ID = '019826b4-0000-7000-8000-0000000000a2';
const FOREIGN_PROGRAM_ID = '019826b4-0000-7000-8000-0000000000af';
const WORKOUT_ID = '019826b4-0000-7000-8000-0000000000b1';
const SCOPE = { householdId: 7 } as never;
const ATHLETE_ID = '019826b4-0000-7000-8000-000000000001';
const ARCHIVED_ID = '019826b4-0000-7000-8000-000000000003';
const FOREIGN_ID = '019826b4-0000-7000-8000-0000000000f1';
const OTHER_FOREIGN_ID = '019826b4-0000-7000-8000-0000000000f2';

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
    expect(workoutInHousehold).not.toHaveBeenCalled();
  });

  it('the household’s program with a workout that is not the household’s reports the workout', async () => {
    vi.mocked(workoutInHousehold).mockResolvedValueOnce(false);
    await reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID });
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[workoutMiss]]);
    expect(vi.mocked(workoutInHousehold).mock.calls).toEqual([[db, SCOPE, WORKOUT_ID]]);
  });

  it('🔴 a workout of ANOTHER of the household’s programs is not a scope miss: nothing is reported (7b-ii)', async () => {
    // `/programs/A/workouts/<B's>`: the read missed, and both ids are the household's own. The
    // probe asks the household as a whole, so a probe of "this program's workout" would report it.
    await reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID });
    expect(vi.mocked(workoutInHousehold).mock.calls).toEqual([[db, SCOPE, WORKOUT_ID]]);
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('both found: the miss was something else (an item), and nothing is reported', async () => {
    await reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID });
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('a new workout (no id yet) reads only the program', async () => {
    await reportProgramMiss(SCOPE, { programPublicId: PROGRAM_ID, workoutPublicId: null });
    expect(workoutInHousehold).not.toHaveBeenCalled();
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('no scope: the program id is reported (as no_scope, by reportScopeMiss) and nothing is read', async () => {
    await reportProgramMiss(null, { programPublicId: PROGRAM_ID, workoutPublicId: WORKOUT_ID });
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(programIn).not.toHaveBeenCalled();
    expect(workoutInHousehold).not.toHaveBeenCalled();
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

describe('a Put on or a Take off (FAM-1 15): the program, then the first athlete id the household lacks', () => {
  const profileMiss = (publicId: string) => ({
    action: SCOPE_MISS_ACTION.resolveProfile,
    resource: { kind: SCOPE_MISS_KIND.profile, publicId },
  });
  const assign = (...profilePublicIds: string[]) => ({
    programPublicId: PROGRAM_ID,
    profilePublicIds,
  });

  it('🔴 a foreign athlete id on the household’s program is reported once, the first in input order', async () => {
    await reportAssignMiss(SCOPE, assign(ATHLETE_ID, FOREIGN_ID, OTHER_FOREIGN_ID));
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[profileMiss(FOREIGN_ID)]]);
    // One read of the household's athletes, however many ids.
    expect(listHouseholdAthletes).toHaveBeenCalledTimes(1);
  });

  it('a program that is not the household’s is reported, and no athlete is read', async () => {
    vi.mocked(programIn).mockResolvedValueOnce(false);
    await reportAssignMiss(SCOPE, assign(FOREIGN_ID));
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(listHouseholdAthletes).not.toHaveBeenCalled();
  });

  it('an archived athlete of this household is found: nothing is reported', async () => {
    await reportAssignMiss(SCOPE, assign(ARCHIVED_ID, ATHLETE_ID));
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('no scope: the program is reported and nothing is read', async () => {
    await reportAssignMiss(null, assign(FOREIGN_ID));
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMiss]]);
    expect(programIn).not.toHaveBeenCalled();
    expect(listHouseholdAthletes).not.toHaveBeenCalled();
  });

  it('a failed read reports nothing, and does not throw', async () => {
    vi.mocked(listHouseholdAthletes).mockRejectedValueOnce(new Error('connection reset'));
    await expect(reportAssignMiss(SCOPE, assign(FOREIGN_ID))).resolves.toBeUndefined();
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });
});

describe('a Program order (FAM-1 15c): the athlete alone', () => {
  const profileMiss = (publicId: string) => ({
    action: SCOPE_MISS_ACTION.resolveProfile,
    resource: { kind: SCOPE_MISS_KIND.profile, publicId },
  });

  it('🔴 a foreign athlete id is reported once, and no program is probed', async () => {
    await reportAthleteMiss(SCOPE, FOREIGN_ID);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[profileMiss(FOREIGN_ID)]]);
    expect(listHouseholdAthletes).toHaveBeenCalledTimes(1);
    expect(programIn).not.toHaveBeenCalled();
  });

  it('an archived athlete of this household is found: nothing is reported', async () => {
    await reportAthleteMiss(SCOPE, ARCHIVED_ID);
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('a live athlete of this household is found: nothing is reported', async () => {
    await reportAthleteMiss(SCOPE, ATHLETE_ID);
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('no scope: the athlete is reported (as no_scope, by reportScopeMiss) and nothing is read', async () => {
    await reportAthleteMiss(null, ATHLETE_ID);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[profileMiss(ATHLETE_ID)]]);
    expect(listHouseholdAthletes).not.toHaveBeenCalled();
  });

  it('a failed read reports nothing, and does not throw', async () => {
    vi.mocked(listHouseholdAthletes).mockRejectedValueOnce(new Error('connection reset'));
    await expect(reportAthleteMiss(SCOPE, FOREIGN_ID)).resolves.toBeUndefined();
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });
});

describe('a Program order refused as invalid (FAM-1 15c): the first program id the household lacks', () => {
  const programMissOf = (publicId: string) => ({
    action: SCOPE_MISS_ACTION.resolveProgram,
    resource: { kind: SCOPE_MISS_KIND.program, publicId },
  });

  it('🔴 another household’s program in the order is reported once, with ONE query for every id', async () => {
    const order = [PROGRAM_ID, FOREIGN_PROGRAM_ID, OTHER_PROGRAM_ID, FOREIGN_PROGRAM_ID];
    await reportOrderProgramMiss(SCOPE, order);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([[programMissOf(FOREIGN_PROGRAM_ID)]]);
    expect(vi.mocked(programIdsIn).mock.calls).toEqual([[db, SCOPE, order]]);
    expect(programIn).not.toHaveBeenCalled();
  });

  it('a stale order of the household’s own programs (one left out) reports nothing', async () => {
    await reportOrderProgramMiss(SCOPE, [OTHER_PROGRAM_ID]);
    expect(reportScopeMiss).not.toHaveBeenCalled();
    expect(programIdsIn).toHaveBeenCalledTimes(1);
  });

  it('a failed read reports nothing, and does not throw', async () => {
    vi.mocked(programIdsIn).mockRejectedValueOnce(new Error('connection reset'));
    await expect(reportOrderProgramMiss(SCOPE, [FOREIGN_PROGRAM_ID])).resolves.toBeUndefined();
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });
});
