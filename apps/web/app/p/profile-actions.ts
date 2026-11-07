'use server';

import * as Sentry from '@sentry/nextjs';

import { renameAthleteSchema } from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';

import { enterMutation } from '@/app/p/mutation-entry';
import { APP_HOME_PATH, athleteEditPath, athletePath, NO_ATHLETE_SAVE } from '@/lib/constants';
import { getProfileByPublicId, renameAthlete } from '@/lib/dal/profiles';

import type { ActionState } from '@/app/p/[profileId]/action-state';

/**
 * The HOUSEHOLD-level athlete actions (PROF-1; the module WP-1's fixed set reserved for them).
 *
 * ## Why this module exists rather than a slot in `[profileId]/actions.ts`
 *
 * These actions manage athletes; they do not log against one. `addAthleteAction` (PROF-1 a-1) has no
 * `profileId` in its body at all, so it cannot live under a route segment named by one — and
 * `/p/[profileId]/actions.ts` is already 644 lines of logging. WP-1 named the split and made the
 * boundary suites scan EVERY `'use server'` module rather than that one file, which is why this
 * module is covered by them the moment it appears (`wp-1-shard-actions.md`).
 *
 * ## The rules this file is held to, enumerated where an author will look
 *
 * - **Every export must be `export async function`.** A `'use server'` module registers every export
 *   as an action reference, so even a re-exported TYPE throws at runtime. `use-server-exports.test.ts`
 *   fails a non-async export. Hence `ActionState` is imported, never re-exported.
 * - **Sentry is wrapped INSIDE each body**, not as a HOF, for the same reason. `return await` is
 *   load-bearing: the SDK returns `Promise<ReturnType<A>>`.
 * - **No `headers` and no `formData` reach Sentry.** `headers` would ship Clerk's session cookie — a
 *   bearer credential for the whole app — and `formData` here carries **an athlete's name**, which is
 *   personal data about a minor (`lib/sentry-scrub.ts`; `docs/privacy/data-inventory.md` §3).
 * - **`enterMutation` first, before the zod parse and the DAL read**, so an unauthenticated flood
 *   buys zero Redis and zero Postgres work. Its refusal is RETURNED, not discarded —
 *   `app/pages-need-a-session.test.ts` asserts both, and the pinned import specifier.
 */

/**
 * Server Action: rename one athlete (PROF-1 a-r, acceptance criterion 8).
 *
 * A Server Action is a PUBLIC POST, so the `profileId` in the body is re-resolved through
 * `getProfileByPublicId` — the ownership seam — before anything is written, and the DAL's
 * `renameAthlete` scopes the UPDATE by the same predicate. An unknown, soft-deleted or
 * foreign-household id gets `NO_ATHLETE_SAVE`, byte-identical to the no-session refusal (ADR 0006 →
 * 404, never 403).
 *
 * ⚠️ **It cannot change `kind`.** `renameAthleteSchema` has no such field, so a body that sends one
 * is ignored rather than applied — see that schema's docblock for why a-r is rename-only.
 *
 * Returns `{ ok: true }` rather than redirecting: the form's island decides where to go, because
 * "back to where the parent came from" is a history question a server redirect cannot answer without
 * adding a duplicate entry (PROF-1 D6). `revalidatePath` covers the three surfaces that render the
 * name — the picker, the athlete's day page and this edit screen itself.
 *
 * ⚠️ **No duplicate-name warning here.** That is PROF-1 a-1d's, which adds the callout and the
 * `acknowledgedDuplicate` field to the schema. A rename today saves whatever the name schema accepts.
 */
export async function renameAthleteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry: see the module docblock. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation('renameAthleteAction', async () => {
    const entry = await enterMutation(NO_ATHLETE_SAVE);
    if (!entry.ok) return entry;

    const parsed = renameAthleteSchema.safeParse({
      profileId: formData.get('profileId'),
      name: formData.get('name'),
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      // 🔴 **A bad `profileId` is NOT a field error — it is the not-found refusal.** The id is a
      // hidden field, so there is no input for a parent to correct and `fieldErrors.name` would be
      // empty: the form would render an invalid-but-unexplained state. It also must answer exactly
      // as an unknown or foreign id does, or a malformed id becomes an oracle for "that one was at
      // least shaped like a real athlete". Only reachable from a crafted body.
      if (fieldErrors.profileId) return { ok: false, error: NO_ATHLETE_SAVE };
      // Field-level, so the form can mark the input `aria-invalid` and show the message under it
      // rather than as a page-level alert the parent has to go looking for.
      return { ok: false, error: null, fieldErrors: { name: fieldErrors.name } };
    }

    const profile = await getProfileByPublicId(parsed.data.profileId);
    if (!profile) return { ok: false, error: NO_ATHLETE_SAVE };

    const saved = await renameAthlete(profile.id, parsed.data.name);
    if (!saved) return { ok: false, error: NO_ATHLETE_SAVE };

    revalidatePath(APP_HOME_PATH);
    revalidatePath(athletePath(saved.id));
    revalidatePath(athleteEditPath(saved.id));
    return { ok: true, error: null };
  });
}
