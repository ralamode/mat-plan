import 'server-only';

import { programIn, workoutIn, type HouseholdScope } from '@mat-plan/db';

import { db } from '../db';
import { reportScopeMiss, SCOPE_MISS_ACTION, SCOPE_MISS_KIND } from '../household';

/**
 * Which id missed the caller's household, reported once (ADR 0006 obligation 3; contract change C11).
 * The program DAL calls it ONLY after a writer or a read has already answered "not here", so a
 * request that succeeds never pays for these reads.
 *
 * - **The program first, then the workout**, and only the first miss is reported: a workout of a
 *   program that is not the household's would otherwise be reported twice.
 * - **With no scope**, the program id is reported, and `reportScopeMiss` records it as `no_scope`.
 * - **Both found** means the miss was something else (an item, a stale workout list): nothing is
 *   reported, since neither id named something outside the household.
 * - The ids have already parsed as uuids (the contract's schemas, or the read's own check).
 */
export async function reportProgramMiss(
  scope: HouseholdScope | null,
  ids: { programPublicId: string; workoutPublicId?: string | null },
): Promise<void> {
  const { programPublicId, workoutPublicId } = ids;
  if (!scope || !(await programIn(db, scope, programPublicId))) {
    await reportScopeMiss({
      action: SCOPE_MISS_ACTION.resolveProgram,
      resource: { kind: SCOPE_MISS_KIND.program, publicId: programPublicId },
    });
    return;
  }
  if (workoutPublicId && !(await workoutIn(db, scope, programPublicId, workoutPublicId))) {
    await reportScopeMiss({
      action: SCOPE_MISS_ACTION.resolveWorkout,
      resource: { kind: SCOPE_MISS_KIND.workout, publicId: workoutPublicId },
    });
  }
}
