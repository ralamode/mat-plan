import 'server-only';

import { readWorkoutDraft } from '@mat-plan/db';
import { uuidSchema, type WorkoutDraft } from '@mat-plan/shared';

import { db } from '../db';
import { getHouseholdScope } from '../household';
import { reportProgramMiss } from './resolve';

/**
 * The program builder's reads, each through the caller's household (FAM-1 step 7a-i; the program
 * list and a program's page come with their pages at 7b).
 *
 * A route's ids are the URL's: one that is not a uuid is "no such workout" (`null`, the page's
 * 404), never a query, which Postgres would refuse with an error page instead.
 *
 * A uuid that names nothing in the household is reported, once (`reportProgramMiss`), and is `null`.
 */
export async function getWorkoutDraft(
  programPublicId: string,
  workoutPublicId: string,
): Promise<WorkoutDraft | null> {
  if (!uuidSchema.safeParse(programPublicId).success) return null;
  if (!uuidSchema.safeParse(workoutPublicId).success) return null;
  const scope = await getHouseholdScope();
  const draft = scope && (await readWorkoutDraft(db, scope, { programPublicId, workoutPublicId }));
  if (!draft) await reportProgramMiss(scope, { programPublicId, workoutPublicId });
  return draft ?? null;
}
