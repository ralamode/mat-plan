'use server';

import * as Sentry from '@sentry/nextjs';
import {
  createProgramSchema,
  PROGRAM_REFUSAL,
  renameProgramSchema,
  saveWorkoutSchema,
  TRANSPORT_REFUSALS,
  type ProgramResult,
} from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';

import { enterMutation } from '@/app/p/mutation-entry';
import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import {
  createHouseholdProgram,
  renameHouseholdProgram,
  saveHouseholdWorkout,
} from '@/lib/dal/program/writes';

/**
 * The program builder's Server Actions (FAM-1 step 7a-i): three of `ProgramActions`' members. Each
 * is a PUBLIC endpoint, so each re-checks the boundary itself (AGENTS.md → Server conventions):
 *
 * 1. Sentry's wrapper, with NO options: headers and form data never reach a captured event (pinned
 *    by `app/pages-need-a-session.test.ts`).
 * 2. `enterMutation(TRANSPORT_REFUSALS)`: the session, then the limiter, refused in the contract's
 *    words (`not_found`, `retry`).
 * 3. The contract's own schema; anything else is `invalid`, and the DAL is not called.
 * 4. One DAL call, through the caller's household (`lib/dal/program/writes.ts`).
 * 5. On success only, the builder's pages are revalidated, and the answer is built field by field:
 *    never the writer's object as it stands, so a field a writer adds later does not reach the
 *    client by accident.
 *
 * Nothing assembles a `ProgramActions` object until all six members exist (7a-ii): a route passes
 * the real actions it has, never a mix (`packages/shared/src/program/actions.ts`). Until 7b, no page
 * imports this module, so no action id is served.
 */

const INVALID = { ok: false, reason: PROGRAM_REFUSAL.invalid } as const;

/** The builder's pages: the list, each program and each workout editor live under it. */
function refreshPrograms() {
  revalidatePath(PROGRAMS_PATH, 'layout');
}

export async function createProgramAction(
  input: unknown,
): Promise<ProgramResult<{ programPublicId: string }>> {
  return await Sentry.withServerActionInstrumentation(
    'createProgramAction',
    async (): Promise<ProgramResult<{ programPublicId: string }>> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = createProgramSchema.safeParse(input);
      if (!parsed.success) return INVALID;
      const result = await createHouseholdProgram(parsed.data);
      if (!result.ok) return { ok: false, reason: result.reason };
      refreshPrograms();
      return { ok: true, programPublicId: result.programPublicId };
    },
  );
}

export async function renameProgramAction(input: unknown): Promise<ProgramResult> {
  return await Sentry.withServerActionInstrumentation(
    'renameProgramAction',
    async (): Promise<ProgramResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = renameProgramSchema.safeParse(input);
      if (!parsed.success) return INVALID;
      const result = await renameHouseholdProgram(parsed.data);
      if (!result.ok) return { ok: false, reason: result.reason };
      refreshPrograms();
      return { ok: true };
    },
  );
}

export async function saveWorkoutAction(
  draft: unknown,
): Promise<ProgramResult<{ workoutPublicId: string }>> {
  return await Sentry.withServerActionInstrumentation(
    'saveWorkoutAction',
    async (): Promise<ProgramResult<{ workoutPublicId: string }>> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = saveWorkoutSchema.safeParse(draft);
      if (!parsed.success) return INVALID;
      const result = await saveHouseholdWorkout(parsed.data);
      if (!result.ok) return { ok: false, reason: result.reason };
      refreshPrograms();
      return { ok: true, workoutPublicId: result.workoutPublicId };
    },
  );
}
