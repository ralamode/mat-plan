import 'server-only';

import { cache } from 'react';

import { readWorkoutDraft } from '@mat-plan/db';
import { uuidSchema, type WorkoutDraft } from '@mat-plan/shared';

import { db } from '../db';
import { getHouseholdScope } from '../household';
import { quietDbErrors } from '../quiet-db-errors';
import { reportProgramMiss } from './report-miss';

/**
 * The program builder's reads, each through the caller's household (FAM-1 step 7a-i; the program
 * list and a program's page come with their pages at 7b).
 *
 * A route's ids are the URL's: one that is not a uuid is "no such workout" (`null`, the page's
 * 404) and is not reported as a scope miss, since it names nothing (`readWorkoutDraft` refuses it
 * too). `cache()`d, as `getProfileByPublicId` is, so a page and its metadata read it, and report a
 * miss, once per request.
 *
 * A uuid that names nothing in the household is reported, once (`reportProgramMiss`), and is `null`.
 * The read goes through `quietDbErrors`, as the writes do: a failed query's parameters stay out of
 * the runtime log (plan row 7a-i).
 */
export const getWorkoutDraft = cache(async function getWorkoutDraft(
  programPublicId: string,
  workoutPublicId: string,
): Promise<WorkoutDraft | null> {
  if (!uuidSchema.safeParse(programPublicId).success) return null;
  if (!uuidSchema.safeParse(workoutPublicId).success) return null;
  const scope = await getHouseholdScope();
  const draft =
    scope &&
    (await quietDbErrors('readWorkoutDraft', () =>
      readWorkoutDraft(db, scope, { programPublicId, workoutPublicId }),
    ));
  if (!draft) await reportProgramMiss(scope, { programPublicId, workoutPublicId });
  return draft ?? null;
});
