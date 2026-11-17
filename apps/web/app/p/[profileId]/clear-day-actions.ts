'use server';

import * as Sentry from '@sentry/nextjs';
import {
  inWritableWindow,
  RESTORE_CLEAR_REFUSAL,
  restoreClearSchema,
  TRANSPORT_REFUSALS,
  type RestoreClearInput,
  type RestoreClearRefusal,
  type RestoreClearResult,
} from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';

import { enterMutation } from '@/app/p/mutation-entry';
import { getActiveLocalDay } from '@/lib/active-timezone';
import { athletePath } from '@/lib/constants';
import { restoreClearedDay } from '@/lib/dal/entries';
import { getProfileByPublicId } from '@/lib/dal/profiles';

/**
 * Clear this day and Restore all (V1-9b B1-2, B2): the day-level actions, beside the day's row
 * actions rather than inside `DayActions` (FAM-1's contract leaves the clear's sections to the page).
 * The FAM-1 contract, as AGENTS.md requires of a new mutation: typed input (`restoreClearSchema`), a
 * typed result, refusals returned, never thrown. B2 adds `clearDayAction` here.
 */

/**
 * Server Action: Restore all, for one clear of one athlete's day. The server finds the clear's
 * entries (`restoreClear`), so the page sends only the athlete, the day and the clear's token.
 *
 * The order is `editPracticeAction`'s: the transport → validate → the profile → bound by the day →
 * the write → revalidate on every answer after the profile check, so the banner always re-reads.
 *
 * - **The day must be open**: today or yesterday, and the athlete not archived (`rowDayOpen`'s rule
 *   and word, `closed_day`: the day page's ✓ takes the same bound). A clear on a closed day keeps its
 *   banner without Restore all (plan, Amendment of 2026-11-15).
 * - **No program-assignment check** (C24): the hidden entries are the athlete's own, assigned or not.
 * - 🔴 **A clear with nothing left under it answers `ok` with 0 and 0, never a refusal.** That is a
 *   retry after a lost response, a restore from another phone, every entry since revived, an earlier
 *   Restore all whose entries all stayed hidden, or a token that never existed. The restore itself
 *   erased what would tell these apart (B2-0), and "nothing left to restore" is true of each, where a
 *   refusal would tell a child that a restore which worked had failed. An accepted exception to
 *   "stale id → typed error" (plan § B1-2 panel, C3).
 */
export async function restoreClearAction(input: RestoreClearInput): Promise<RestoreClearResult> {
  // Sentry: see the comment block above `logBodyweightAction`. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation(
    'restoreClearAction',
    async (): Promise<RestoreClearResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = restoreClearSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: RESTORE_CLEAR_REFUSAL.bad_value };

      const { profilePublicId, day, hiddenAt } = parsed.data;
      const profile = await getProfileByPublicId(profilePublicId);
      if (!profile) return { ok: false, reason: RESTORE_CLEAR_REFUSAL.not_found };
      const refuse = (reason: RestoreClearRefusal): RestoreClearResult => {
        revalidatePath(athletePath(profile.id));
        return { ok: false, reason };
      };

      if (profile.archived || !inWritableWindow(day, await getActiveLocalDay())) {
        return refuse(RESTORE_CLEAR_REFUSAL.closed_day);
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
