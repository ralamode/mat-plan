import 'server-only';

import { createProgram, renameProgram, saveWorkout, type HouseholdScope } from '@mat-plan/db';
import {
  PROGRAM_REFUSAL,
  type CreateProgram,
  type ProgramResult,
  type RenameProgram,
  type WorkoutDraft,
} from '@mat-plan/shared';

import { db } from '../db';
import { getHouseholdScope } from '../household';
import { quietDbErrors } from './quiet-db-errors';
import { reportProgramMiss } from './resolve';

/**
 * The program builder's writes, each through the caller's household (FAM-1 step 7a-i). The actions
 * in `app/programs/actions.ts` stay thin: entry, parse, one call here, revalidate.
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
 * - **A `not_found` for an id the input carries is reported** (`reportProgramMiss`: which program
 *   or workout id missed, once), on that path only. Create carries no id, so nothing is reported.
 */

const NOT_FOUND = { ok: false, reason: PROGRAM_REFUSAL.not_found } as const;

const isNotFound = (result: ProgramResult<object>) =>
  !result.ok && result.reason === PROGRAM_REFUSAL.not_found;

/** The miss, reported for the ids the input carries, and the contract's one answer for it. */
async function missed(
  scope: HouseholdScope | null,
  ids: Parameters<typeof reportProgramMiss>[1],
): Promise<typeof NOT_FOUND> {
  await reportProgramMiss(scope, ids);
  return NOT_FOUND;
}

export async function createHouseholdProgram(
  input: CreateProgram,
): Promise<ProgramResult<{ programPublicId: string }>> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  return quietDbErrors('createProgram', () => createProgram(db, scope, input));
}

export async function renameHouseholdProgram(input: RenameProgram): Promise<ProgramResult> {
  const scope = await getHouseholdScope();
  if (!scope) return missed(scope, input);
  const result = await quietDbErrors('renameProgram', () => renameProgram(db, scope, input));
  return isNotFound(result) ? missed(scope, input) : result;
}

export async function saveHouseholdWorkout(
  draft: WorkoutDraft,
): Promise<ProgramResult<{ workoutPublicId: string }>> {
  const scope = await getHouseholdScope();
  if (!scope) return missed(scope, draft);
  const result = await quietDbErrors('saveWorkout', () => saveWorkout(db, scope, draft));
  return isNotFound(result) ? missed(scope, draft) : result;
}
