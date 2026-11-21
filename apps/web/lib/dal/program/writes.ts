import 'server-only';

import {
  copyWorkout,
  createProgram,
  newItem,
  putOn,
  renameProgram,
  reorderPrograms,
  saveWeek,
  saveWorkout,
  takeOff,
} from '@mat-plan/db';
import {
  PROGRAM_REFUSAL,
  type AssignDraft,
  type CopyDraft,
  type CreateProgram,
  type NewItem,
  type ProgramActions,
  type ProgramOrder,
  type ProgramResult,
  type RenameProgram,
  type TakeOff,
  type WeekDraft,
  type WorkoutDraft,
} from '@mat-plan/shared';

import { CATALOG_LIBRARY } from '../catalog-library';
import { db } from '../db';
import { getHouseholdScope } from '../household';
import { quietDbErrors } from '../quiet-db-errors';
import {
  reportAssignMiss,
  reportAthleteMiss,
  reportCopyMiss,
  reportOrderProgramMiss,
  reportProgramMiss,
  reportWeekMiss,
} from './report-miss';

/**
 * The program builder's writes, each through the caller's household (FAM-1 steps 7a-i, 7a-ii and 15),
 * and an athlete's Program order (15c). The actions in `app/programs/actions.ts` and, for the order,
 * `app/p/[profileId]/row-actions.ts` stay thin: entry, parse, one call here, revalidate.
 *
 * - **One exported function per operation**, named apart from lane P's writers they wrap: the
 *   `lib/dal` scope guard reads one declaration as one unit.
 * - **The scope is the caller's**, from `getHouseholdScope()`; none is `not_found`, the contract's
 *   answer for "no such thing here", and the writer is never called.
 * - **The writer is the authority** on every id the input carries (its own scoped reads, in its
 *   transaction); a writer's `not_found` is passed through unchanged.
 * - **A thrown database error carries no data out** (`quietDbErrors`): the runtime log must never
 *   hold a prescription's notes.
 *
 * - **A `not_found` for an id the input carries is reported** (`report-miss.ts`: which program or
 *   workout id missed, once), on that path only. Create and a new item carry no id, so nothing is
 *   reported for them.
 */

/** What a member of the contract answers, read from `ProgramActions` rather than typed again. */
export type ProgramAnswer<K extends keyof ProgramActions> = Awaited<
  ReturnType<NonNullable<ProgramActions[K]>>
>;

const NOT_FOUND = { ok: false, reason: PROGRAM_REFUSAL.not_found } as const;

const isNotFound = (result: ProgramResult<object>) =>
  !result.ok && result.reason === PROGRAM_REFUSAL.not_found;

/** The miss, reported for the ids the input carries, and the contract's one answer for it. */
async function missed(report: () => Promise<void>): Promise<typeof NOT_FOUND> {
  await report();
  return NOT_FOUND;
}

export async function createHouseholdProgram(
  input: CreateProgram,
): Promise<ProgramAnswer<'createProgram'>> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  return quietDbErrors('createProgram', () => createProgram(db, scope, input));
}

export async function renameHouseholdProgram(
  input: RenameProgram,
): Promise<ProgramAnswer<'renameProgram'>> {
  const scope = await getHouseholdScope();
  if (!scope) return missed(() => reportProgramMiss(scope, input));
  const result = await quietDbErrors('renameProgram', () => renameProgram(db, scope, input));
  return isNotFound(result) ? missed(() => reportProgramMiss(scope, input)) : result;
}

export async function saveHouseholdWorkout(
  draft: WorkoutDraft,
): Promise<ProgramAnswer<'saveWorkout'>> {
  const scope = await getHouseholdScope();
  if (!scope) return missed(() => reportProgramMiss(scope, draft));
  const result = await quietDbErrors('saveWorkout', () => saveWorkout(db, scope, draft));
  return isNotFound(result) ? missed(() => reportProgramMiss(scope, draft)) : result;
}

/** A week's workouts, every day's, in the draft's order: what `reportWeekMiss` walks. */
const weekWorkoutIds = (draft: WeekDraft) =>
  Object.values(draft.days).flatMap((slots) => (slots ?? []).map((slot) => slot.workoutPublicId));

export async function saveHouseholdWeek(draft: WeekDraft): Promise<ProgramAnswer<'saveWeek'>> {
  const scope = await getHouseholdScope();
  const week = { programPublicId: draft.programPublicId, workoutPublicIds: weekWorkoutIds(draft) };
  if (!scope) return missed(() => reportWeekMiss(scope, week));
  const result = await quietDbErrors('saveWeek', () => saveWeek(db, scope, draft));
  return isNotFound(result) ? missed(() => reportWeekMiss(scope, week)) : result;
}

export async function copyHouseholdWorkout(
  draft: CopyDraft,
): Promise<ProgramAnswer<'copyWorkout'>> {
  const scope = await getHouseholdScope();
  if (!scope) return missed(() => reportCopyMiss(scope, draft));
  const result = await quietDbErrors('copyWorkout', () => copyWorkout(db, scope, draft));
  return isNotFound(result) ? missed(() => reportCopyMiss(scope, draft)) : result;
}

/** A new item carries no id: nothing to report (as create). */
export async function newHouseholdItem(input: NewItem): Promise<ProgramAnswer<'newItem'>> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  // The same library the picker's read gets (`picker.ts`), so they match the same aliases (K23).
  return quietDbErrors('newItem', () => newItem(db, scope, input, CATALOG_LIBRARY));
}

/**
 * Put on and Take off (FAM-1 step 15). `today` is the household's today, which the action resolves
 * (`getActiveLocalDay`); lane P's writer holds `from` to today or tomorrow, the one check of it.
 * A `not_found` reports the program, then the first athlete id the household does not have.
 */
export async function putOnHouseholdProgram(
  draft: AssignDraft,
  today: string,
): Promise<ProgramAnswer<'putOn'>> {
  const scope = await getHouseholdScope();
  if (!scope) return missed(() => reportAssignMiss(scope, draft));
  const result = await quietDbErrors('putOn', () => putOn(db, scope, draft, today));
  return isNotFound(result) ? missed(() => reportAssignMiss(scope, draft)) : result;
}

export async function takeOffHouseholdProgram(
  input: TakeOff,
  today: string,
): Promise<ProgramAnswer<'takeOff'>> {
  const scope = await getHouseholdScope();
  const ids = { programPublicId: input.programPublicId, profilePublicIds: [input.profilePublicId] };
  if (!scope) return missed(() => reportAssignMiss(scope, ids));
  const result = await quietDbErrors('takeOff', () => takeOff(db, scope, input, today));
  return isNotFound(result) ? missed(() => reportAssignMiss(scope, ids)) : result;
}

/**
 * An athlete's Program order (FAM-1 step 15c), `DayActions.reorderPrograms`: shaped as Put on and
 * Take off, with `today` from the action. Lane P's writer is the one check of the athlete
 * (`lockAthletes`: this household's, live, not archived) and of the list (a permutation of the
 * athlete's current programs, else `invalid`). A `not_found` reports the athlete id, the one id it
 * answers `not_found` for. An `invalid` reports the first program id that is not this household's
 * (`reportOrderProgramMiss`, one query for every id); a stale list of the household's live
 * programs reports nothing. Either way the answer is the writer's.
 */
export async function reorderHouseholdPrograms(
  input: ProgramOrder,
  today: string,
): Promise<ProgramResult> {
  const scope = await getHouseholdScope();
  const report = () => reportAthleteMiss(scope, input.profilePublicId);
  if (!scope) return missed(report);
  const result = await quietDbErrors('reorderPrograms', () =>
    reorderPrograms(db, scope, input, today),
  );
  if (isNotFound(result)) return missed(report);
  if (!result.ok && result.reason === PROGRAM_REFUSAL.invalid) {
    await reportOrderProgramMiss(scope, input.programPublicIds);
  }
  return result;
}
