import 'server-only';

import { prescriptionLiveIn, workoutInHousehold, type HouseholdScope } from '@mat-plan/db';
import type { RowWrite } from '@mat-plan/shared';

import { db } from '../db';
import { reportScopeMiss, SCOPE_MISS_ACTION, SCOPE_MISS_KIND } from '../household';

/**
 * Which id of a ✓ missed the caller's household, reported once (ADR 0006 obligation 3; contract
 * change C11; plan row 12b). The day DAL calls it ONLY after the row writer has answered
 * `not_found`, so a ✓ that saves never pays for these reads.
 *
 * - **The workout first, then the prescription, and only the first miss** (board, 2026-11-17), as
 *   `reportProgramMiss` does: a prescription of a workout that is not the household's would
 *   otherwise be reported twice. The reads are lane P's `workoutInHousehold` (#545) and lane E's
 *   `prescriptionLiveIn` (#527).
 * - **Found** means the miss was something else (the athlete is not on that program that day, a
 *   foreign held `clientId`): nothing is reported, since the id named nothing outside the household.
 *   `reportScopeMiss` itself tells `cross_household` from `unknown_resource`.
 * - The profile is not checked here: the action resolved it with `getProfileByPublicId`, which
 *   reports its own miss. Un-tick and re-tick carry only an entry id, which is not a scope-miss
 *   kind, so they never call this.
 * - **It never throws.** A failed check reports nothing, and the caller still answers `not_found`.
 */
export async function reportRowMiss(
  scope: HouseholdScope,
  write: Pick<RowWrite, 'workoutPublicId' | 'prescriptionPublicId'>,
): Promise<void> {
  try {
    if (!(await workoutInHousehold(db, scope, write.workoutPublicId))) {
      await reportScopeMiss({
        action: SCOPE_MISS_ACTION.resolveWorkout,
        resource: { kind: SCOPE_MISS_KIND.workout, publicId: write.workoutPublicId },
      });
      return;
    }
    if (!(await prescriptionLiveIn(db, scope, write.prescriptionPublicId))) {
      await reportScopeMiss({
        action: SCOPE_MISS_ACTION.resolvePrescription,
        resource: { kind: SCOPE_MISS_KIND.prescription, publicId: write.prescriptionPublicId },
      });
    }
  } catch {
    // Telemetry never changes the answer: a failed check leaves the caller's `not_found` as it was,
    // as `reportScopeMiss` does for its own probe. Nothing of the error is logged.
  }
}
