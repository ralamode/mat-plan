import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', () => ({ db: { the: 'db' } }));
// A PARTIAL mock: the action and kind constants are the real ones; only the report is replaced.
vi.mock('../household', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../household')>()),
  reportScopeMiss: vi.fn(async () => {}),
}));
vi.mock('@mat-plan/db', () => ({
  prescriptionLiveIn: vi.fn(async () => true),
  workoutInHousehold: vi.fn(async () => true),
}));

import { prescriptionLiveIn, workoutInHousehold } from '@mat-plan/db';

import { db } from '../db';
import { reportScopeMiss, SCOPE_MISS_ACTION, SCOPE_MISS_KIND } from '../household';
import { reportRowMiss } from './report-miss';

/** Which id of a ✓ missed the household (FAM-1 12b, C11). The probe's outcome is `household.ts`'s. */

const WORKOUT_ID = '019826b4-0000-7000-8000-0000000000b1';
const PRESCRIPTION_ID = '019826b4-0000-7000-8000-0000000000d1';
const SCOPE = { householdId: 7 } as never;
const ids = { workoutPublicId: WORKOUT_ID, prescriptionPublicId: PRESCRIPTION_ID };

beforeEach(() => vi.clearAllMocks());

describe('reportRowMiss (FAM-1 12b)', () => {
  it("a workout that is not the household's is reported once, as a workout, and the prescription is not read", async () => {
    vi.mocked(workoutInHousehold).mockResolvedValueOnce(false);
    await reportRowMiss(SCOPE, ids);
    expect(workoutInHousehold).toHaveBeenCalledWith(db, SCOPE, WORKOUT_ID);
    expect(prescriptionLiveIn).not.toHaveBeenCalled();
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([
      [
        {
          action: SCOPE_MISS_ACTION.resolveWorkout,
          resource: { kind: SCOPE_MISS_KIND.workout, publicId: WORKOUT_ID },
        },
      ],
    ]);
  });

  it("the household's workout with a prescription that is not live: the prescription is reported once", async () => {
    vi.mocked(prescriptionLiveIn).mockResolvedValueOnce(false);
    await reportRowMiss(SCOPE, ids);
    expect(workoutInHousehold).toHaveBeenCalledWith(db, SCOPE, WORKOUT_ID);
    expect(prescriptionLiveIn).toHaveBeenCalledWith(db, SCOPE, PRESCRIPTION_ID);
    expect(vi.mocked(reportScopeMiss).mock.calls).toEqual([
      [
        {
          action: SCOPE_MISS_ACTION.resolvePrescription,
          resource: { kind: SCOPE_MISS_KIND.prescription, publicId: PRESCRIPTION_ID },
        },
      ],
    ]);
  });

  it("both ids the household's is no probe: nothing is reported", async () => {
    await reportRowMiss(SCOPE, ids);
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });

  it('never throws: a failed check reports nothing', async () => {
    for (const read of [workoutInHousehold, prescriptionLiveIn]) {
      vi.mocked(read).mockRejectedValueOnce(new Error('connection reset'));
      await expect(reportRowMiss(SCOPE, ids)).resolves.toBeUndefined();
    }
    expect(reportScopeMiss).not.toHaveBeenCalled();
  });
});
