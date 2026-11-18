'use server';

import * as Sentry from '@sentry/nextjs';
import {
  copyDraftSchema,
  createProgramSchema,
  newItemSchema,
  PROGRAM_REFUSAL,
  renameProgramSchema,
  saveWorkoutSchema,
  TRANSPORT_REFUSALS,
  weekDraftSchema,
  weekExceedsDaySlots,
  weekRepeatsAWorkout,
} from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';

import { enterMutation } from '@/app/p/mutation-entry';
import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import {
  copyHouseholdWorkout,
  createHouseholdProgram,
  newHouseholdItem,
  renameHouseholdProgram,
  saveHouseholdWeek,
  saveHouseholdWorkout,
  type ProgramAnswer,
} from '@/lib/dal/program/writes';

/**
 * The program builder's Server Actions (FAM-1 steps 7a-i and 7a-ii): the six required members of
 * `ProgramActions`, assembled in `actions.contract.ts` (a `'use server'` module exports only async
 * functions). Each
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
 * Until 7b, no page imports this module or the object, so no action id is served.
 */

const INVALID = { ok: false, reason: PROGRAM_REFUSAL.invalid } as const;
/**
 * A week that names a workout twice on one day fails the schema, and is `once_per_day`, not
 * `invalid`, whatever else is wrong: the preview's fake and lane P's writer answer the same (C25),
 * and the builder reads it as "this page is stale" (`isStaleWeek`).
 */
const ONCE_PER_DAY = { ok: false, reason: PROGRAM_REFUSAL.once_per_day } as const;
const LIMIT_REACHED = { ok: false, reason: PROGRAM_REFUSAL.limit_reached } as const;

/** The builder's pages: the list, each program and each workout editor live under it. */
function refreshPrograms() {
  revalidatePath(PROGRAMS_PATH, 'layout');
}

export async function createProgramAction(input: unknown): Promise<ProgramAnswer<'createProgram'>> {
  return await Sentry.withServerActionInstrumentation(
    'createProgramAction',
    async (): Promise<ProgramAnswer<'createProgram'>> => {
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

export async function renameProgramAction(input: unknown): Promise<ProgramAnswer<'renameProgram'>> {
  return await Sentry.withServerActionInstrumentation(
    'renameProgramAction',
    async (): Promise<ProgramAnswer<'renameProgram'>> => {
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

export async function saveWorkoutAction(draft: unknown): Promise<ProgramAnswer<'saveWorkout'>> {
  return await Sentry.withServerActionInstrumentation(
    'saveWorkoutAction',
    async (): Promise<ProgramAnswer<'saveWorkout'>> => {
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

export async function saveWeekAction(draft: unknown): Promise<ProgramAnswer<'saveWeek'>> {
  return await Sentry.withServerActionInstrumentation(
    'saveWeekAction',
    async (): Promise<ProgramAnswer<'saveWeek'>> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = weekDraftSchema.safeParse(draft);
      // In the fake's order (C25, C35): a workout twice on a day, then a day past MAX_DAY_SLOTS.
      if (!parsed.success) {
        if (weekRepeatsAWorkout(draft)) return ONCE_PER_DAY;
        return weekExceedsDaySlots(draft) ? LIMIT_REACHED : INVALID;
      }
      const result = await saveHouseholdWeek(parsed.data);
      if (!result.ok) return { ok: false, reason: result.reason };
      refreshPrograms();
      return { ok: true };
    },
  );
}

export async function copyWorkoutAction(draft: unknown): Promise<ProgramAnswer<'copyWorkout'>> {
  return await Sentry.withServerActionInstrumentation(
    'copyWorkoutAction',
    async (): Promise<ProgramAnswer<'copyWorkout'>> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = copyDraftSchema.safeParse(draft);
      if (!parsed.success) return INVALID;
      const result = await copyHouseholdWorkout(parsed.data);
      if (!result.ok) return { ok: false, reason: result.reason };
      refreshPrograms();
      return { ok: true, workoutPublicId: result.workoutPublicId };
    },
  );
}

/**
 * A name that already names an item answers that item (`existed: true`), never a refusal. The
 * picker's pages are revalidated either way: a new item is a new row in every builder page's list.
 */
export async function newItemAction(input: unknown): Promise<ProgramAnswer<'newItem'>> {
  return await Sentry.withServerActionInstrumentation(
    'newItemAction',
    async (): Promise<ProgramAnswer<'newItem'>> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = newItemSchema.safeParse(input);
      if (!parsed.success) return INVALID;
      const result = await newHouseholdItem(parsed.data);
      if (!result.ok) return { ok: false, reason: result.reason };
      refreshPrograms();
      return {
        ok: true,
        itemPublicId: result.itemPublicId,
        name: result.name,
        trackingType: result.trackingType,
        existed: result.existed,
      };
    },
  );
}
