import 'server-only';

import { createProgram, renameProgram, saveWorkout } from '@mat-plan/db';
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
 * ⚠️ The miss-path report (ADR 0006: which program or workout id missed, through `reportScopeMiss`)
 * is added once this branch has contract change C11 and lane P's scoped existence reads.
 */

const NOT_FOUND = { ok: false, reason: PROGRAM_REFUSAL.not_found } as const;

export async function createHouseholdProgram(
  input: CreateProgram,
): Promise<ProgramResult<{ programPublicId: string }>> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  return quietDbErrors('createProgram', () => createProgram(db, scope, input));
}

export async function renameHouseholdProgram(input: RenameProgram): Promise<ProgramResult> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  return quietDbErrors('renameProgram', () => renameProgram(db, scope, input));
}

export async function saveHouseholdWorkout(
  draft: WorkoutDraft,
): Promise<ProgramResult<{ workoutPublicId: string }>> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  return quietDbErrors('saveWorkout', () => saveWorkout(db, scope, draft));
}
