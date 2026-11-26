'use server';

import * as Sentry from '@sentry/nextjs';
import {
  PROGRAM_REFUSAL,
  programOrderSchema,
  ROW_REFUSAL,
  rowAmendSchema,
  rowRetickSchema,
  rowUntickSchema,
  rowWriteSchema,
  TRANSPORT_REFUSALS,
  type ProgramResult,
  type RowResult,
} from '@mat-plan/shared';
import { refresh } from 'next/cache';
import type { z } from 'zod';

import { enterMutation } from '@/app/p/mutation-entry';
import { getActiveLocalDay } from '@/lib/active-timezone';
import { amendDayRow, logDayRow, retickDayRow, untickDayRow } from '@/lib/dal/day/day';
import { refreshAssignment } from '@/lib/dal/program/revalidate';
import { reorderHouseholdPrograms } from '@/lib/dal/program/writes';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { ROW_WRITE_RATE_LIMIT } from '@/lib/rate-limit';

/**
 * The day page's writes, `DayActions`' five members: four row writes, `logRow`, `untickRow` and
 * `retickRow` (FAM-1 step 12b) and `amendRow` (12d, Change), and the athlete's Program order,
 * `reorderPrograms` (15c; the day page passes it since 15c PR 3).
 * Each action is a PUBLIC endpoint and re-checks the boundary itself (AGENTS.md → Server
 * conventions). The four row writes:
 *
 * 1. Sentry's wrapper, with NO options: headers and form data never reach a captured event.
 * 2. `enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT)`: the session, then the row-write
 *    limiter (D23: a ✓ is one write, and a parent logging two athletes' days passes the default),
 *    refused in the contract's words (`not_found`, `retry`).
 * 3. The contract's own schema. Anything else is `bad_value`, and nothing is read or written.
 * 4. The athlete, through `getProfileByPublicId` (the household's, or `not_found`, reported there).
 * 5. 🔴 **Today is read HERE and nowhere below** (`getActiveLocalDay`, the active-zone day). The DAL
 *    and lane E's writer take it as an argument, and the writer holds `day` to the window (today and
 *    yesterday, never a day after today, D32), so a crafted older or future day answers
 *    `closed_day` whatever the page rendered.
 * 6. One DAL call. On success only, the page the ✓ was sent from is refreshed with Next's `refresh()`
 *    (PERF-3), and the answer is built field by field: never the writer's object as it stands.
 *    `refresh()`, not `revalidatePath`: both put the day page's fresh tree in the ✓'s own response,
 *    so counts, "Done ✓" and Collapse update with the row as before, but `revalidatePath` also
 *    empties the router's prefetch cache, and every link on the page (about 16 requests, each
 *    re-running the session checks) was fetched again after every ✓ (measured on production,
 *    2026-11-26). The other athletes' day pages are dynamic and read anew on navigation.
 *
 * 🔴 **Every one of these is a public endpoint** (AGENTS.md → Server conventions). Since 12c the day
 * page imports this module, which puts the action ids in the build's manifest; from then on Next
 * 16 forwards a POST naming one to it from ANY App Router path, not only the day page's. The
 * checks above, in each action, are the boundary.
 */

const BAD_VALUE = { ok: false, reason: ROW_REFUSAL.bad_value } as const;
const NOT_FOUND = { ok: false, reason: ROW_REFUSAL.not_found } as const;

/**
 * Steps 3 to 6, the same for the four writes; only the schema and the DAL call differ. Steps 1 and 2
 * stay in each action's own body, where the session guard reads them
 * (`app/pages-need-a-session.test.ts`). This is the one place today is read.
 */
async function writeRow<T extends { profilePublicId: string }>(
  schema: z.ZodType<T>,
  input: unknown,
  write: (data: T, today: string) => Promise<RowResult>,
): Promise<RowResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return BAD_VALUE;
  const profile = await getProfileByPublicId(parsed.data.profilePublicId);
  if (!profile) return NOT_FOUND;
  const result = await write(parsed.data, await getActiveLocalDay());
  if (!result.ok) return { ok: false, reason: result.reason };
  // The answer is built field by field, and only a success refreshes the page (PERF-3: `refresh()`,
  // so the router's prefetch cache is kept; see step 6 above).
  refresh();
  return {
    ok: true,
    entryPublicId: result.entryPublicId,
    values: result.values,
    ...(result.hiddenAt === undefined ? {} : { hiddenAt: result.hiddenAt }),
  };
}

export async function logRowAction(input: unknown): Promise<RowResult> {
  return await Sentry.withServerActionInstrumentation(
    'logRowAction',
    async (): Promise<RowResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT);
      if (!entry.ok) return entry;
      return writeRow(rowWriteSchema, input, logDayRow);
    },
  );
}

export async function untickRowAction(input: unknown): Promise<RowResult> {
  return await Sentry.withServerActionInstrumentation(
    'untickRowAction',
    async (): Promise<RowResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT);
      if (!entry.ok) return entry;
      return writeRow(rowUntickSchema, input, untickDayRow);
    },
  );
}

export async function retickRowAction(input: unknown): Promise<RowResult> {
  return await Sentry.withServerActionInstrumentation(
    'retickRowAction',
    async (): Promise<RowResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT);
      if (!entry.ok) return entry;
      return writeRow(rowRetickSchema, input, retickDayRow);
    },
  );
}

export async function amendRowAction(input: unknown): Promise<RowResult> {
  return await Sentry.withServerActionInstrumentation(
    'amendRowAction',
    async (): Promise<RowResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT);
      if (!entry.ok) return entry;
      return writeRow(rowAmendSchema, input, amendDayRow);
    },
  );
}

const INVALID_ORDER = { ok: false, reason: PROGRAM_REFUSAL.invalid } as const;

/**
 * An athlete's Program order (FAM-1 step 15c), `DayActions.reorderPrograms`. Not a row write, so it
 * differs from the four above at each step, and does not use `writeRow`, which speaks `RowResult`:
 *
 * 1. Sentry's wrapper, with NO options.
 * 2. `enterMutation(TRANSPORT_REFUSALS)` with the **default** limiter: a reorder is not a ✓ (D23).
 * 3. `programOrderSchema` (at most `MAX_ORDER_PROGRAMS` ids, each once), else `invalid`, and the
 *    DAL is not called.
 * 4. No `getProfileByPublicId`: the action is household-addressed, as Put on and Take off are, and
 *    lane P's writer is the one check of the athlete (`lockAthletes`: this household's, live, not
 *    archived) and of the list (a permutation of the current programs, else `invalid`).
 * 5. Today is read here, as for the row writes, and handed down.
 * 6. One DAL call. A refusal is returned as it is; on success, the assignment's pages are
 *    revalidated for the PARSED athlete id (the schema hands it back in lower case, never the URL's
 *    segment), and the answer is `{ ok: true }`, built here.
 */
export async function reorderProgramsAction(input: unknown): Promise<ProgramResult> {
  return await Sentry.withServerActionInstrumentation(
    'reorderProgramsAction',
    async (): Promise<ProgramResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = programOrderSchema.safeParse(input);
      if (!parsed.success) return INVALID_ORDER;
      const result = await reorderHouseholdPrograms(parsed.data, await getActiveLocalDay());
      if (!result.ok) return { ok: false, reason: result.reason };
      refreshAssignment([parsed.data.profilePublicId]);
      return { ok: true };
    },
  );
}
