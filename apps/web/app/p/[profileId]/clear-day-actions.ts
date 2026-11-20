'use server';

import * as Sentry from '@sentry/nextjs';
import {
  clearDayOpenFor,
  clearDaySchema,
  dayOpenFor,
  DAY_CLEAR_REFUSAL,
  restoreClearSchema,
  TRANSPORT_REFUSALS,
  type ClearDayActionResult,
  type ClearDayInput,
  type DayClearRefusal,
  type RestoreClearActionResult,
  type RestoreClearInput,
} from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';

import { enterMutation } from '@/app/p/mutation-entry';
import { getActiveLocalDay } from '@/lib/active-timezone';
import { athletePath } from '@/lib/constants';
import { clearDayEntries, restoreClearedDay } from '@/lib/dal/entries';
import { getProfileByPublicId } from '@/lib/dal/profiles';

/**
 * Clear this day and Restore all (V1-9b B1-2, B2): the day-level actions, beside the day's row
 * actions rather than inside `DayActions` (FAM-1's contract leaves the clear's sections to the page).
 * The FAM-1 contract, as AGENTS.md requires of a new mutation: typed input (`clearDaySchema`,
 * `restoreClearSchema`), a typed result, refusals returned, never thrown.
 *
 * **Who may:** any member signed in to the household, as for every entry write (spec
 * `crud-1-fix-it-yourself.md`'s table). Neither this module nor its two DAL wrappers reads a role
 * (both tests pin it), and placement on the page is not a control.
 */

/**
 * **The two windows** (plan § B2 as amended; maintainer, 2026-11-19), both from `packages/shared`:
 * Restore all takes `dayOpenFor` (today or yesterday, not archived: the rule the day page's ✓ takes),
 * and the clear takes `clearDayOpenFor` (today only, not archived), which the page's trigger reads too.
 * "Today" is the request's active-timezone day from the client's `tz` cookie: an accepted residual
 * (`.github/SECURITY.md` → Authorization).
 */

/**
 * Server Action: Clear this day. Hides every live entry of one athlete's day as one event; the server
 * finds the entries (`clearDay`), so the page sends the athlete, the day and the confirm word.
 *
 * The order is `restoreClearAction`'s: the transport → validate → the profile → bound by the day → the
 * write → revalidate on every answer after the profile check, so the banner always re-reads.
 *
 * - **Today only**, and the athlete not archived (`closed_day` otherwise).
 * - **No program-assignment check** (C24): the entries are the athlete's own, assigned or not.
 * - **`count` is the day's newest clear's**, and `count: 0` a success, "nothing was left to clear"
 *   (see `clearDayResultSchema` for when each holds).
 * - The confirm word is checked by the schema and never reaches the DAL.
 */
export async function clearDayAction(input: ClearDayInput): Promise<ClearDayActionResult> {
  // Sentry: see the comment block above `logBodyweightAction`. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation(
    'clearDayAction',
    async (): Promise<ClearDayActionResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = clearDaySchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: DAY_CLEAR_REFUSAL.bad_value };

      const { profilePublicId, day } = parsed.data;
      const profile = await getProfileByPublicId(profilePublicId);
      if (!profile) return { ok: false, reason: DAY_CLEAR_REFUSAL.not_found };

      if (!clearDayOpenFor(profile, day, await getActiveLocalDay())) {
        revalidatePath(athletePath(profile.id));
        return { ok: false, reason: DAY_CLEAR_REFUSAL.closed_day };
      }

      const { count } = await clearDayEntries({ profilePublicId: profile.id, day });
      revalidatePath(athletePath(profile.id));
      return { ok: true, count };
    },
  );
}

/**
 * Server Action: Restore all, for one clear of one athlete's day. The server finds the clear's
 * entries (`restoreClear`), so the page sends only the athlete, the day and the clear's token.
 *
 * The order is `editPracticeAction`'s: the transport → validate → the profile → bound by the day →
 * the write → revalidate on every answer after the profile check, so the banner always re-reads.
 *
 * - **The day must be open**: today or yesterday, and the athlete not archived (`dayOpenFor`, the rule
 *   and word the day page's ✓ takes, `closed_day`). A clear on a closed day keeps its
 *   banner without Restore all (plan, Amendment of 2026-11-15).
 * - **No program-assignment check** (C24): the hidden entries are the athlete's own, assigned or not.
 * - 🔴 **A clear with nothing left under it answers `ok` with 0 and 0, never a refusal.** That is a
 *   retry after a lost response, a restore from another phone, every entry since revived, an earlier
 *   Restore all whose entries all stayed hidden, or a token that never existed. The restore itself
 *   erased what would tell these apart (B2-0), and "nothing left to restore" is true of each, where a
 *   refusal would tell a child that a restore which worked had failed. An accepted exception to
 *   "stale id → typed error" (plan § B1-2 panel, C3).
 */
export async function restoreClearAction(
  input: RestoreClearInput,
): Promise<RestoreClearActionResult> {
  // Sentry: see the comment block above `logBodyweightAction`. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation(
    'restoreClearAction',
    async (): Promise<RestoreClearActionResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = restoreClearSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: DAY_CLEAR_REFUSAL.bad_value };

      const { profilePublicId, day, hiddenAt } = parsed.data;
      const profile = await getProfileByPublicId(profilePublicId);
      if (!profile) return { ok: false, reason: DAY_CLEAR_REFUSAL.not_found };
      const refuse = (reason: DayClearRefusal): RestoreClearActionResult => {
        revalidatePath(athletePath(profile.id));
        return { ok: false, reason };
      };

      if (!dayOpenFor(profile, day, await getActiveLocalDay())) {
        return refuse(DAY_CLEAR_REFUSAL.closed_day);
      }

      const { restored, keptHidden } = await restoreClearedDay({
        profilePublicId: profile.id,
        day,
        hiddenAt,
      });
      revalidatePath(athletePath(profile.id));
      return { ok: true, restored, keptHidden };
    },
  );
}
