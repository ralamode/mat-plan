'use server';

import * as Sentry from '@sentry/nextjs';
import {
  ROW_REFUSAL,
  rowRetickSchema,
  rowUntickSchema,
  rowWriteSchema,
  TRANSPORT_REFUSALS,
  type RowResult,
} from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';

import { enterMutation } from '@/app/p/mutation-entry';
import { getActiveLocalDay } from '@/lib/active-timezone';
import { athletePath } from '@/lib/constants';
import { logDayRow, retickDayRow, untickDayRow } from '@/lib/dal/day/day';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { ROW_WRITE_RATE_LIMIT } from '@/lib/rate-limit';

/**
 * The day page's row writes (FAM-1 step 12b): three of `DayActions`' members, `logRow`, `untickRow`
 * and `retickRow`. `amendRow` (12d) and `reorderPrograms` (15c) are not here yet, so the screen
 * keeps their controls hidden. Each action is a PUBLIC endpoint and re-checks the boundary itself
 * (AGENTS.md → Server conventions):
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
 * 6. One DAL call. On success only, the athlete's day page is revalidated, and the answer is built
 *    field by field: never the writer's object as it stands.
 *
 * Until 12c mounts the day screen, no page imports this module, so no action id is served.
 */

const BAD_VALUE = { ok: false, reason: ROW_REFUSAL.bad_value } as const;
const NOT_FOUND = { ok: false, reason: ROW_REFUSAL.not_found } as const;

/** A writer's answer as the contract's, one field at a time; a success revalidates the day page. */
function answer(result: RowResult, profilePublicId: string): RowResult {
  if (!result.ok) return { ok: false, reason: result.reason };
  revalidatePath(athletePath(profilePublicId));
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
      const parsed = rowWriteSchema.safeParse(input);
      if (!parsed.success) return BAD_VALUE;
      const profile = await getProfileByPublicId(parsed.data.profilePublicId);
      if (!profile) return NOT_FOUND;
      const result = await logDayRow(parsed.data, await getActiveLocalDay());
      return answer(result, profile.id);
    },
  );
}

export async function untickRowAction(input: unknown): Promise<RowResult> {
  return await Sentry.withServerActionInstrumentation(
    'untickRowAction',
    async (): Promise<RowResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT);
      if (!entry.ok) return entry;
      const parsed = rowUntickSchema.safeParse(input);
      if (!parsed.success) return BAD_VALUE;
      const profile = await getProfileByPublicId(parsed.data.profilePublicId);
      if (!profile) return NOT_FOUND;
      const result = await untickDayRow(parsed.data, await getActiveLocalDay());
      return answer(result, profile.id);
    },
  );
}

export async function retickRowAction(input: unknown): Promise<RowResult> {
  return await Sentry.withServerActionInstrumentation(
    'retickRowAction',
    async (): Promise<RowResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS, ROW_WRITE_RATE_LIMIT);
      if (!entry.ok) return entry;
      const parsed = rowRetickSchema.safeParse(input);
      if (!parsed.success) return BAD_VALUE;
      const profile = await getProfileByPublicId(parsed.data.profilePublicId);
      if (!profile) return NOT_FOUND;
      const result = await retickDayRow(parsed.data, await getActiveLocalDay());
      return answer(result, profile.id);
    },
  );
}
