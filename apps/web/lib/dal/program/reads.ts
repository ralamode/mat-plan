import 'server-only';

import { cache } from 'react';

import {
  readProgramList,
  readProgramsByAthlete,
  readProgramView,
  readWorkoutDraft,
  type AthleteProgram,
} from '@mat-plan/db';
import {
  uuidSchema,
  type ProgramList,
  type ProgramListEntry,
  type ProgramView,
  type WorkoutDraft,
} from '@mat-plan/shared';

import { db } from '../db';
import { getHouseholdScope } from '../household';
import { quietDbErrors } from '../quiet-db-errors';
import { reportProgramMiss } from './report-miss';

/**
 * The program builder's reads, each through the caller's household (FAM-1 step 7a-i; the Programs
 * list and a program's page since 7b-i).
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

/**
 * The Programs list (FAM-1 7b-i), as of the household's `today`, which the route resolves (only a
 * route reads the tz cookie). `null` with no household: the page sends that caller Home, which says
 * so (`NoHouseholdState`). No id names anything here, so a missing scope reports nothing.
 *
 * A primitive argument, because `cache()` compares its arguments by identity.
 */
export const getProgramList = cache(async function getProgramList(
  today: string,
): Promise<ProgramList | null> {
  const scope = await getHouseholdScope();
  if (!scope) return null;
  return quietDbErrors('readProgramList', () => readProgramList(db, scope, today));
});

/**
 * A program's page (FAM-1 7b-i), in `getWorkoutDraft`'s order: a non-uuid id is `null` with no
 * report; no household, or a program the household does not have, is `null` and reported once (with
 * no scope, as `no_scope`). `today` and `tz` are the route's. Primitive arguments, because `cache()`
 * compares by identity: an object literal would run the read, and report its miss, twice.
 */
export const getProgramView = cache(async function getProgramView(
  programPublicId: string,
  today: string,
  tz: string,
): Promise<ProgramView | null> {
  if (!uuidSchema.safeParse(programPublicId).success) return null;
  const scope = await getHouseholdScope();
  const view =
    scope &&
    (await quietDbErrors('readProgramView', () =>
      readProgramView(db, scope, programPublicId, { today, tz }),
    ));
  if (!view) await reportProgramMiss(scope, { programPublicId });
  return view ?? null;
});

/**
 * One program's entry of the Programs list, for a workout page's back link and "Used by …" (FAM-1
 * 7b-ii; the 7b plan, reuse S5: found in `getProgramList`, not by a second read). The ids are
 * compared lower-cased, because a route's id is the URL's spelling and the list's is lower-case.
 * A non-uuid id is `null` with no report; no household, or a program the household does not have,
 * is `null` and reported once (with no scope, as `no_scope`). `today` is the route's.
 */
export const getProgramEntry = cache(async function getProgramEntry(
  programPublicId: string,
  today: string,
): Promise<ProgramListEntry | null> {
  if (!uuidSchema.safeParse(programPublicId).success) return null;
  const id = programPublicId.toLowerCase();
  const entry = (await getProgramList(today))?.find((program) => program.programPublicId === id);
  if (!entry) await reportProgramMiss(await getHouseholdScope(), { programPublicId });
  return entry ?? null;
});

/** A program an athlete is on, as Home's tile names it: id, name and the first day it applies. */
export type AthleteProgramDTO = AthleteProgram;

/**
 * Each live, not archived athlete's programs, by their public id, as of the household's `today`
 * (FAM-1 15 PR 3, Home's tiles): ONE read for the whole page, not one per tile. An athlete on no
 * program maps to `[]`; an archived athlete is not a key, as Home shows them no tile. `null` with no
 * household: Home shows its no-household state and asks for nothing. No id names anything, so a
 * missing scope reports nothing. A primitive argument, because `cache()` compares by identity.
 */
export const getProgramsByAthlete = cache(async function getProgramsByAthlete(
  today: string,
): Promise<ReadonlyMap<string, readonly AthleteProgramDTO[]> | null> {
  const scope = await getHouseholdScope();
  if (!scope) return null;
  return quietDbErrors('readProgramsByAthlete', () => readProgramsByAthlete(db, scope, today));
});
