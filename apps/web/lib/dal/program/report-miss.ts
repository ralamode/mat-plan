import 'server-only';

import {
  programIn,
  programWorkoutIds,
  workoutIn,
  workoutInHousehold,
  type HouseholdScope,
} from '@mat-plan/db';

import { db } from '../db';
import { reportScopeMiss, SCOPE_MISS_ACTION, SCOPE_MISS_KIND } from '../household';

/**
 * Which id missed the caller's household, reported once (ADR 0006 obligation 3; contract change C11).
 * The program DAL calls these ONLY after a writer or a read has already answered "not here", so a
 * request that succeeds never pays for these reads.
 *
 * - **One id at a time, in the writer's order, and only the first miss is reported**: a workout of
 *   a program that is not the household's would otherwise be reported twice.
 * - **With no scope**, the first id (always a program's) is reported, and `reportScopeMiss` records
 *   it as `no_scope`.
 * - **All found** means the miss was something else (an item, a stale workout list): nothing is
 *   reported, since no id named something outside the household.
 * - The ids have already parsed as uuids (the contract's schemas, or the read's own check).
 * - **It never throws.** A failed check reports nothing, and the caller still answers `not_found`.
 */

type ScopeMiss = Parameters<typeof reportScopeMiss>[0];
/** One id to check: whether the household has it, and what to report when it does not. */
type Probe = { readonly found: () => Promise<boolean>; readonly miss: ScopeMiss };

const programMiss = (programPublicId: string): ScopeMiss => ({
  action: SCOPE_MISS_ACTION.resolveProgram,
  resource: { kind: SCOPE_MISS_KIND.program, publicId: programPublicId },
});

/** Each probe takes the caller's scope; with none, `reportFirstMiss` never calls `found`. */
const programProbe = (scope: HouseholdScope | null, programPublicId: string): Probe => ({
  found: async () => !!scope && (await programIn(db, scope, programPublicId)),
  miss: programMiss(programPublicId),
});

const workoutMiss = (workoutPublicId: string): ScopeMiss => ({
  action: SCOPE_MISS_ACTION.resolveWorkout,
  resource: { kind: SCOPE_MISS_KIND.workout, publicId: workoutPublicId },
});

/** A workout of a program. */
const workoutProbe = (
  scope: HouseholdScope | null,
  programPublicId: string,
  workoutPublicId: string,
): Probe => ({
  found: async () => !!scope && (await workoutIn(db, scope, programPublicId, workoutPublicId)),
  miss: workoutMiss(workoutPublicId),
});

/** Reports the first probe the household does not have; with no scope, the first probe. */
async function reportFirstMiss(
  scope: HouseholdScope | null,
  probes: readonly Probe[],
): Promise<void> {
  try {
    for (const probe of probes) {
      if (!scope || !(await probe.found())) {
        await reportScopeMiss(probe.miss);
        return;
      }
    }
  } catch {
    // Telemetry never changes the answer: a failed check leaves the caller's `not_found` as it was,
    // as `reportScopeMiss` does for its own probe. Nothing of the error is logged.
  }
}

/** A program, then (when the input names one) its workout. */
export async function reportProgramMiss(
  scope: HouseholdScope | null,
  ids: { programPublicId: string; workoutPublicId?: string | null },
): Promise<void> {
  const { programPublicId, workoutPublicId } = ids;
  await reportFirstMiss(scope, [
    programProbe(scope, programPublicId),
    ...(workoutPublicId ? [workoutProbe(scope, programPublicId, workoutPublicId)] : []),
  ]);
}

/**
 * A week (FAM-1 7a-ii): its program, then each workout it names, distinct, in the draft's order,
 * until the first that is not one of the program's (`saveWeek` answers `not_found` for both).
 *
 * **One query, however many ids the week names** (FAM-1 6c-ii, a board-granted edit by lane P):
 * `programWorkoutIds` answers the program's live workout ids, or `null` when the program is not the
 * household's, and each id is looked up in that set. So no id goes unchecked, and a long week costs
 * no more than a short one.
 */
export async function reportWeekMiss(
  scope: HouseholdScope | null,
  week: { programPublicId: string; workoutPublicIds: readonly string[] },
): Promise<void> {
  const { programPublicId } = week;
  let known: Promise<ReadonlySet<string> | null> | undefined;
  // Read once, on the first probe that needs it; with no scope, `found` is never called.
  const workoutsOfProgram = () =>
    (known ??= scope ? programWorkoutIds(db, scope, programPublicId) : Promise.resolve(null));
  await reportFirstMiss(scope, [
    { found: async () => (await workoutsOfProgram()) !== null, miss: programMiss(programPublicId) },
    ...[...new Set(week.workoutPublicIds)].map((id): Probe => ({
      found: async () => (await workoutsOfProgram())?.has(id) ?? false,
      miss: workoutMiss(id),
    })),
  ]);
}

/**
 * A copy (FAM-1 7a-ii), in `copyWorkout`'s own order: the TARGET program first (it is locked
 * first), then the SOURCE workout, by its id alone, since `CopyDraft` names the workout and not its
 * program (lane P's `workoutInHousehold`).
 */
export async function reportCopyMiss(
  scope: HouseholdScope | null,
  copy: { toProgramPublicId: string; workoutPublicId: string },
): Promise<void> {
  await reportFirstMiss(scope, [
    programProbe(scope, copy.toProgramPublicId),
    {
      found: async () => !!scope && (await workoutInHousehold(db, scope, copy.workoutPublicId)),
      miss: workoutMiss(copy.workoutPublicId),
    },
  ]);
}
