import 'server-only';

import {
  programIn,
  programWorkoutIds,
  readProgramList,
  workoutInHousehold,
  type HouseholdScope,
} from '@mat-plan/db';

import { db } from '../db';
import { reportScopeMiss, SCOPE_MISS_ACTION, SCOPE_MISS_KIND } from '../household';
import { listHouseholdAthletes } from '../profiles';

/**
 * Which id missed the caller's household, reported once (ADR 0006 obligation 3; contract change C11).
 * The program DAL calls these ONLY after a writer or a read has already answered "not here", so a
 * request that succeeds never pays for these reads.
 *
 * - **One id at a time, in the writer's order, and only the first miss is reported**: a workout of
 *   a program that is not the household's would otherwise be reported twice.
 * - **With no scope**, the first id (a program's; for Program order, the athlete's) is reported, and
 *   `reportScopeMiss` records it as `no_scope`.
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

/**
 * A workout of a program, probed after its program was found: the household's whichever program
 * it is in (`workoutInHousehold`). A workout of ANOTHER of the household's programs
 * (`/programs/A/workouts/<B's>`) is still the caller's `not_found`, but it names nothing outside the
 * household, so it is not a scope miss and nothing is reported (FAM-1 7b-ii; the 7b plan's Co-out).
 */
const workoutProbe = (scope: HouseholdScope | null, workoutPublicId: string): Probe => ({
  found: async () => !!scope && (await workoutInHousehold(db, scope, workoutPublicId)),
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

/** A program, then (when the input names one) the workout, against the household as a whole. */
export async function reportProgramMiss(
  scope: HouseholdScope | null,
  ids: { programPublicId: string; workoutPublicId?: string | null },
): Promise<void> {
  const { programPublicId, workoutPublicId } = ids;
  await reportFirstMiss(scope, [
    programProbe(scope, programPublicId),
    ...(workoutPublicId ? [workoutProbe(scope, workoutPublicId)] : []),
  ]);
}

/**
 * A week (FAM-1 7a-ii): its program, then each workout it names, distinct, in the draft's order,
 * until the first that is not one of the program's (`saveWeek` answers `not_found` for both).
 *
 * **One read (two queries), however many ids the week names** (FAM-1 6c-ii, a board-granted edit by lane P):
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
    workoutProbe(scope, copy.workoutPublicId),
  ]);
}

const profileMiss = (profilePublicId: string): ScopeMiss => ({
  action: SCOPE_MISS_ACTION.resolveProfile,
  resource: { kind: SCOPE_MISS_KIND.profile, publicId: profilePublicId },
});

/**
 * The athlete ids, in the input's order, sharing **one read for every id and no new query**: the
 * household's athletes, archived ones included (`listHouseholdAthletes`, the request's cached read).
 * An archived athlete of this household is found, so it is not reported: the writer's `not_found`
 * for them names nothing outside the household. Read once, on the first athlete probe; with no
 * scope, `found` is never called.
 */
function athleteProbes(scope: HouseholdScope | null, profilePublicIds: readonly string[]): Probe[] {
  let known: Promise<ReadonlySet<string>> | undefined;
  const athletes = () =>
    (known ??= listHouseholdAthletes().then((rows) => new Set(rows.map((row) => row.id))));
  return profilePublicIds.map((id): Probe => ({
    found: async () => !!scope && (await athletes()).has(id),
    miss: profileMiss(id),
  }));
}

/**
 * A Put on or a Take off (FAM-1 step 15), in the writers' order: the program (`lockProgram`), then
 * each athlete id in the input's order, until the first the household does not have
 * (`athleteProbes`). Nor is an athlete who is simply not on the program reported, for Take off.
 */
export async function reportAssignMiss(
  scope: HouseholdScope | null,
  assign: { programPublicId: string; profilePublicIds: readonly string[] },
): Promise<void> {
  await reportFirstMiss(scope, [
    programProbe(scope, assign.programPublicId),
    ...athleteProbes(scope, assign.profilePublicIds),
  ]);
}

/**
 * A Program order (FAM-1 step 15c): the athlete alone, the one id `reorderPrograms` answers
 * `not_found` for (`lockAthletes`). A program id the household does not have is the writer's
 * `invalid`, not a miss, so no program is probed. The same probe as Put on's (`athleteProbes`): an
 * archived athlete of this household is found, so the writer's `not_found` for them reports nothing.
 */
export async function reportAthleteMiss(
  scope: HouseholdScope | null,
  profilePublicId: string,
): Promise<void> {
  await reportFirstMiss(scope, athleteProbes(scope, [profilePublicId]));
}

/**
 * A Program order the writer refused as `invalid` (FAM-1 15c): each program id it names, distinct, in
 * the order's order, until the first that is not one of this household's live programs. `invalid`
 * is also the writer's answer for a stale list (a put on, a take off, midnight), so an id that is
 * one of the household's live programs reports nothing: only one that names something outside it is a scope miss.
 *
 * **One read of the household's Programs list, however many ids the order names** (at most
 * `MAX_ORDER_PROGRAMS`): `readProgramList`, the same scoped read the Programs page makes. That is
 * 2 + one query per live athlete (≤ 27 at `MAX_HOUSEHOLD_ATHLETES`), on a refusal only; a one-query
 * id lookup beside `programIn` is owed (tech-debt). Read once on the
 * first probe, each id looked up in its set. The caller has a scope here: with none, the DAL answers
 * `not_found` and reports the athlete before the writer runs.
 */
export async function reportOrderProgramMiss(
  scope: HouseholdScope,
  programPublicIds: readonly string[],
  today: string,
): Promise<void> {
  let known: Promise<ReadonlySet<string>> | undefined;
  const programs = () =>
    (known ??= readProgramList(db, scope, today).then(
      (list) => new Set(list.map((program) => program.programPublicId)),
    ));
  await reportFirstMiss(
    scope,
    [...new Set(programPublicIds)].map((id): Probe => ({
      found: async () => (await programs()).has(id),
      miss: programMiss(id),
    })),
  );
}
