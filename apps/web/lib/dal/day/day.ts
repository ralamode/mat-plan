import 'server-only';

import { logRow, resolveDayPlan, retickRow, untickRow } from '@mat-plan/db';
import {
  ACTIVITY_TYPE_KEYS,
  ROW_REFUSAL,
  isoDaySchema,
  uuidSchema,
  type DayPlan,
  type RowResult,
  type RowRetick,
  type RowUntick,
  type RowWrite,
} from '@mat-plan/shared';

import { getActivityTypeIdByKey } from '../catalog';
import { db } from '../db';
import { getHouseholdScope } from '../household';
import { listProfiles } from '../profiles';
import { quietDbErrors } from '../quiet-db-errors';
import { reportRowMiss } from './report-miss';

/**
 * The day page's data access (FAM-1 step 12b; [guide](../../../../../docs/features/day-page.md)):
 * the athlete's `DayPlan`, and the three row writes the day screen makes.
 *
 * - 🔴 **`today` is an argument, never read here.** The action (or, at 12c, the page) reads the
 *   time zone and passes its active-zone day. Nothing at or below this file reads a cookie or a
 *   clock, so a test passes fixed days.
 * - **The scope is the caller's**, from `getHouseholdScope()`. None means `not_found` (a write) or
 *   `null` (the read), and lane E's writer or resolver is never called.
 * - **Lane E's writers and resolver are the authority** on every id the input carries: the window,
 *   an archived athlete, the schedule and the slot are all theirs (`packages/db/src/writers/day/`,
 *   `queries/day/`). A writer's answer is passed through as it is.
 * - **A thrown database error carries no data out** (`quietDbErrors`): a logged number or a
 *   prescription's notes never reach the runtime log.
 */

const NOT_FOUND = { ok: false, reason: ROW_REFUSAL.not_found } as const;

/**
 * The athlete's day, with `athletes` added: the household's live athletes, not archived, for the
 * switcher. `writable`, `future` and `canGoForward` are the resolver's (contract change C17).
 * `null` when the athlete is not in the caller's household, or the id is not a uuid or a day is
 * not a day (no query).
 */
export async function getDayPlan(args: {
  profilePublicId: string;
  day: string;
  today: string;
}): Promise<DayPlan | null> {
  if (!uuidSchema.safeParse(args.profilePublicId).success) return null;
  if (!isoDaySchema.safeParse(args.day).success || !isoDaySchema.safeParse(args.today).success)
    return null;
  const scope = await getHouseholdScope();
  if (!scope) return null;
  const plan = await resolveDayPlan(db, { scope, ...args });
  if (!plan) return null;
  const athletes = (await listProfiles()).map((a) => ({ profilePublicId: a.id, name: a.name }));
  return { ...plan, athletes };
}

/** ✓ on a row. `write` is the parsed `RowWrite`; `today` is the athlete's, from the action. */
export async function logDayRow(write: RowWrite, today: string): Promise<RowResult> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  const activityTypeId = await getActivityTypeIdByKey(ACTIVITY_TYPE_KEYS.workout_item);
  const result = await quietDbErrors('logRow', () =>
    logRow(db, { scope, today, activityTypeId, write }),
  );
  // A miss reports which of the ✓'s ids is not the household's (`report-miss.ts`), on that path only.
  if (!result.ok && result.reason === ROW_REFUSAL.not_found) await reportRowMiss(scope, write);
  return result;
}

/**
 * Un-tick a row. It carries only an entry id, and an entry is not a kind `reportScopeMiss` reports,
 * so a `not_found` here is answered and not reported (plan row 12b).
 */
export async function untickDayRow(input: RowUntick, today: string): Promise<RowResult> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  return quietDbErrors('untickRow', () => untickRow(db, { scope, today, input }));
}

/** Re-tick a row un-ticked in this page visit. Reported as un-tick is: not at all. */
export async function retickDayRow(input: RowRetick, today: string): Promise<RowResult> {
  const scope = await getHouseholdScope();
  if (!scope) return NOT_FOUND;
  return quietDbErrors('retickRow', () => retickRow(db, { scope, today, input }));
}
