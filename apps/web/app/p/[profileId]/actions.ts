'use server';

import * as Sentry from '@sentry/nextjs';

import {
  ACTIVITY_TYPE_KEYS,
  editBodyweightSchema,
  editPracticeSchema,
  logPracticeSchema,
  type LogPracticeInput,
  practiceMinutesProblem,
  PRACTICE_AMEND_REFUSAL,
  TRANSPORT_REFUSALS,
  type EditPracticeInput,
  type PracticeAmendRefusal,
  type PracticeAmendResult,
  logBodyweightSchema,
  METRIC_KEYS,
  validateRoutineForWrite,
} from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';

import {
  AMEND_ERROR_COPY,
  BODYWEIGHT_COPY,
  NO_PROFILE_LOG,
  NO_PROFILE_SAVE,
  PRACTICE_COPY,
  PRACTICE_PROBLEM_COPY,
  athletePath,
  athleteRoutinePath,
} from '@/lib/constants';
import {
  logBodyweight,
  logCheckinEntries,
  editBodyweight,
  ownedBodyweightValue,
  bodyweightRowDay,
  clearBodyweightEntry,
  clearPracticeEntry,
  editPractice,
  ownedPracticeMinutes,
  practiceRowDay,
} from '@/lib/dal/entries';
import { getProfileByPublicId, updateProfileRoutine } from '@/lib/dal/profiles';
import { ROUTINE_CATALOG } from '@/lib/routine/catalog';

import type { ActionState } from './action-state';
import { enterMutation } from '@/app/p/mutation-entry';
import { resolveDeclaredDay } from '@/lib/entries/declared-day';

// The `ActionState` type + `INITIAL_ACTION_STATE` live in ./action-state. A 'use server' module may
// export ONLY async functions — the Server Actions compiler registers every export as an action
// reference, so even a re-exported TYPE trips a runtime `ReferenceError: ActionState is not defined`.
// So DO NOT re-export it here; consumers import `ActionState` straight from ./action-state.
//
// ── Sentry, once, for every action below (V1-14a; collapsed from 6 byte-identical copies in V1-24
//    PR 1b, which would otherwise have made it 7) ────────────────────────────────────────────────
// Wrapped INSIDE each body, never as a HOF: the rule above means every export must literally be
// `export async function`. `return await` is load-bearing — the SDK returns Promise<ReturnType<A>>,
// i.e. Promise<Promise<ActionState>> for an async callback.
//
// NO `headers` and NO `formData` are passed: `headers` would ship Clerk's session cookie — a bearer
// credential for the whole app — and `formData` a kid's bodyweight, both to a third party (see
// lib/sentry-scrub.ts). ⚠️ This named `mp_gate` until `1d`; the reason SURVIVES the gate, because
// what replaced it is a stronger credential, not a weaker one. The "every export is an async
// function" rule is enforced by `use-server-exports.test.ts`. Expected failures RETURN a
// typed envelope instead of throwing, so they never reach Sentry — that falls out of the envelope
// convention for free rather than needing a filter.

/**
 * Server Action: log a bodyweight (V0-8, scoped to a profile at V1-3). A Server
 * Action is a PUBLIC POST, so it validates its own input (zod) and re-checks the
 * profile inside — never trusting the form. The tile-supplied `profileId` (a
 * hidden field) is re-validated server-side via `getProfileByPublicId` — the
 * ownership seam — since TEN-1 1b `getProfileByPublicId` scopes by the request's household too, so
 * a known id belonging to ANOTHER household returns the same `NO_PROFILE_LOG` envelope as an unknown
 * one (profile tiles are a UX switch, not a security boundary). Returns a typed envelope for
 * `useActionState` (expected errors don't throw).
 */
export async function logBodyweightAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry: see the comment block above `logBodyweightAction`. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation('logBodyweightAction', async () => {
    // The gate AND the session AND the limiter, in that order — `./mutation-entry` holds the one
    // copy and the reasoning, and `pages-need-a-session.test.ts` is what pins both.
    const entry = await enterMutation(NO_PROFILE_LOG);
    if (!entry.ok) return entry;
    const parsed = logBodyweightSchema.safeParse({
      profileId: formData.get('profileId'),
      value: formData.get('value'),
      unit: formData.get('unit'),
      clientId: formData.get('clientId'),
      notes: formData.get('notes') ?? undefined,
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Please fix the errors below.',
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    // The write lands on the day the page rendered (bounded ±1 against the active-tz today),
    // so a weigh-in never stamps a date the header didn't show — the same seam check-ins use.
    const day = await resolveDeclaredDay(formData.get('day'));
    if (!day.ok) return { ok: false, error: day.error };

    const profile = await getProfileByPublicId(parsed.data.profileId);
    if (!profile) return { ok: false, error: NO_PROFILE_LOG };

    const written = await logBodyweight({
      profilePublicId: profile.id,
      value: parsed.data.value,
      unit: parsed.data.unit,
      clientId: parsed.data.clientId,
      day: day.day,
      notes: parsed.data.notes ?? null,
    });
    // V1-24 1d: the day already holds a weigh-in (another device got there first). An expected
    // outcome → the typed envelope, not error.tsx. Revalidate so the receipt shows the row that landed.
    if ('dayTaken' in written) {
      revalidatePath(athletePath(profile.id));
      return { ok: false, error: BODYWEIGHT_COPY.dayTaken };
    }

    revalidatePath(athletePath(profile.id));
    return { ok: true, error: null };
  });
}

/**
 * Server Action: log a wrestling practice, in typed minutes (V1-7; typed since V1-24 3b-life-b).
 *
 * - **Practice only** (B6): `activityKey` must be wrestling practice (`logPracticeSchema`), so a
 *   crafted Wake POST is refused. Wake is not loggable: the tap time is not the wake time.
 * - **The minutes are the shared rule** (`logPracticeSchema`, 10–300 whole): the form checks the same
 *   rule before the request (`practiceMinutesProblem`), so this refusal is the backstop.
 * - It rides the shared `logCheckinEntries` write path (per-item `ON CONFLICT`, the practice day index).
 * - **Every outcome but a write or a replay is a refusal** (B5), never `ok`:
 *   `day_taken` (another practice holds the day, 3b-0), `conflict` (another row holds the id: a crafted
 *   reuse) and `own_hidden` (this athlete's cleared practice holds it). The form mints a new id on any
 *   refusal, so "tap ✓ to try again" is true.
 */
export async function logLifeActivitiesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry: see the comment block above `logBodyweightAction`. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation('logLifeActivitiesAction', async () => {
    const entry = await enterMutation(NO_PROFILE_LOG);
    if (!entry.ok) return entry;
    const input: Record<keyof LogPracticeInput, FormDataEntryValue | null> = {
      activityKey: formData.get('activityKey'),
      profileId: formData.get('profileId'),
      clientId: formData.get('clientId'),
      day: formData.get('day'),
      minutes: formData.get('minutes'),
    };
    // Trust boundary (B6): only practice is loggable here; Wake and anything else are refused.
    if (input.activityKey !== ACTIVITY_TYPE_KEYS.wrestling_practice) {
      return { ok: false, error: "That isn't a life activity we can log." };
    }
    // A tab still on the one-tap bundle posts no minutes at all: a reload brings the field.
    if (typeof input.minutes !== 'string') return { ok: false, error: PRACTICE_COPY.reloadToLog };
    const parsed = logPracticeSchema.safeParse(input);
    if (!parsed.success) {
      const problem = practiceMinutesProblem(input.minutes);
      // The minutes are fine, so the id or the day is malformed: a stale or crafted page. Nothing is
      // "below" to fix; a reload is the true answer.
      if (problem === null) return { ok: false, error: PRACTICE_COPY.reloadToLog };
      const message = PRACTICE_PROBLEM_COPY[problem](input.minutes);
      return { ok: false, error: message, fieldErrors: { minutes: [message] } };
    }

    const day = await resolveDeclaredDay(parsed.data.day);
    if (!day.ok) return { ok: false, error: day.error };
    const profile = await getProfileByPublicId(parsed.data.profileId);
    if (!profile) return { ok: false, error: NO_PROFILE_LOG };

    const { minutes } = parsed.data;
    const [result] = await logCheckinEntries({
      profilePublicId: profile.id,
      day: day.day,
      items: [
        {
          activityKey: ACTIVITY_TYPE_KEYS.wrestling_practice,
          metricKey: METRIC_KEYS.practice_minutes,
          value: minutes,
          clientId: parsed.data.clientId,
        },
      ],
    });
    revalidatePath(athletePath(profile.id));

    // Exhaustive by type: a new writer outcome is a compile error here until it has an answer.
    const outcome = result?.outcome;
    switch (outcome) {
      case 'created':
      case 'replay':
        return { ok: true, error: null };
      case 'day_taken':
        return { ok: false, error: PRACTICE_COPY.dayTaken(minutes), dayTaken: true as const };
      case 'own_hidden':
        return { ok: false, error: PRACTICE_COPY.clearedEarlier };
      case 'conflict': // another row holds this id: a crafted reuse
      case undefined: // no result for the one item sent: nothing is known to be written
        return { ok: false, error: PRACTICE_COPY.notSaved };
      default: {
        const unhandled: never = outcome;
        throw new Error(`logLifeActivitiesAction: unhandled outcome ${String(unhandled)}`);
      }
    }
  });
}

/**
 * Server Action: amend an already-logged bodyweight (V1-24 PR 1b), or clear it (3b-bw).
 *
 * The public-POST discipline of every writer here: zod-validate, re-resolve the profile by
 * `public_id`, and let the DAL's guarded UPDATE prove ownership.
 *
 * ## The order (V1-24 3b-bw, plan W7)
 *
 * zod → profile → **the row's own day** (`bodyweightRowDay`) → `resolveDeclaredDay(row.day)` → a blank
 * clears, a number amends. 3b-page made a day before yesterday read-only, and this is the server half:
 * the bound is read from the ROW, never a posted `day`, so a POST naming an older weigh-in is refused
 * however it labels itself. This supersedes 1b's "no day bound on an amend". ⚠️ It is the same ±1 of
 * the request's active time zone as every write (`resolveDeclaredDay`), and that zone comes from a
 * cookie, so it is a product rule for the household's own data, not a tenancy boundary.
 *
 * ## Zero rows has four causes and they are NOT interchangeable
 *
 * Wrong owner · stale/deleted id · wrong shape · someone amended it under this render. Collapsing
 * them into one message is wrong in both directions: "that changed, here's the latest" is
 * recoverable and the parent should see it, while "wrong owner" must stay indistinguishable from
 * "not found". So a refusal re-selects under the SAME ownership scope and branches three ways.
 *
 * ⚠️ **Branch (b) is the replay case, and it is mandatory** (AGENTS.md: replay → one effect,
 * identical response). A parent taps Save on gym wifi, the write lands, the response is lost, the
 * POST retries. The row has already moved, so a naive guard would answer *"someone else changed
 * this"* — about nobody, over a value that is already exactly what they asked for. The re-read is
 * the live-only `ownedBodyweightValue`, AFTER the UPDATE: the pre-read's day is not a value, and a
 * value read before the UPDATE would turn a retry's race into "changed on another device".
 *
 * **Every refusal past the profile check revalidates** (the archived blank refuses before any
 * write, so there is nothing new to show), so the page shows what is true; the day page's live
 * region carries the message after the form that sent it has unmounted.
 */
export async function editBodyweightAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry: see the comment block above `logBodyweightAction`. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation('editBodyweightAction', async () => {
    const entry = await enterMutation(NO_PROFILE_LOG);
    if (!entry.ok) return entry;
    const parsed = editBodyweightSchema.safeParse({
      profileId: formData.get('profileId'),
      entryId: formData.get('entryId'),
      value: formData.get('value'),
      unit: formData.get('unit'),
      seenValue: formData.get('seenValue'),
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Please fix the errors below.',
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    const profile = await getProfileByPublicId(parsed.data.profileId);
    if (!profile) return { ok: false, error: NO_PROFILE_LOG };
    const refuse = (error: string): ActionState => {
      revalidatePath(athletePath(profile.id));
      return { ok: false, error };
    };

    const row = await bodyweightRowDay({
      profilePublicId: profile.id,
      entryId: parsed.data.entryId,
    });
    // Not theirs, not a weigh-in, or gone: one message, so a crafted id learns nothing a stale one
    // wouldn't.
    if (!row) return refuse(AMEND_ERROR_COPY.notFound(BODYWEIGHT_COPY.noun));
    const day = await resolveDeclaredDay(row.day);
    if (!day.ok) return refuse(AMEND_ERROR_COPY.dayReadOnly(BODYWEIGHT_COPY.noun));

    const { value } = parsed.data;
    if (value === null) {
      // An archived athlete has no empty field to re-enter a cleared weight into, so the clear the
      // recovery relies on is refused (plan W5). The editor never offers it; this is the POST's half.
      if (profile.archived) {
        return {
          ok: false,
          error: BODYWEIGHT_COPY.blankSave,
          fieldErrors: { value: [BODYWEIGHT_COPY.blankSave] },
        };
      }
      const cleared = await clearBodyweightEntry({
        profilePublicId: profile.id,
        entryId: parsed.data.entryId,
        unit: parsed.data.unit,
        seenValue: parsed.data.seenValue,
      });
      if ('cleared' in cleared) {
        revalidatePath(athletePath(profile.id));
        return { ok: true, error: null };
      }
      return refuse(
        'stale' in cleared
          ? AMEND_ERROR_COPY.staleWrite
          : AMEND_ERROR_COPY.notFound(BODYWEIGHT_COPY.noun),
      );
    }

    const updated = await editBodyweight({
      profilePublicId: profile.id,
      entryId: parsed.data.entryId,
      value,
      unit: parsed.data.unit,
      seenValue: parsed.data.seenValue,
    });
    if (updated) {
      revalidatePath(athletePath(profile.id));
      return { ok: true, error: null };
    }

    const current = await ownedBodyweightValue({
      profilePublicId: profile.id,
      entryId: parsed.data.entryId,
    });
    // (a) The row is gone, was never theirs, or is not an amendable bodyweight.
    if (!current) return refuse(AMEND_ERROR_COPY.notFound(BODYWEIGHT_COPY.noun));
    // (b) REPLAY: the row already holds exactly what was asked for. One effect, success.
    if (current.value === value && current.unit === parsed.data.unit) {
      revalidatePath(athletePath(profile.id));
      return { ok: true, error: null };
    }
    // (c) Someone else got there first. Revalidate so the receipt shows the value that won.
    return refuse(AMEND_ERROR_COPY.staleWrite);
  });
}

/**
 * Server Action: change or clear ONE logged wrestling practice (V1-24 3b-life A5).
 *
 * 🔴 **The FAM-1 contract, as AGENTS.md requires of a new mutation**: typed input
 * (`editPracticeSchema`), a typed result (`practiceAmendResultSchema`), refusals returned, never
 * thrown. FormData stays at the edge: the editor's client wrapper builds this input and maps each
 * reason to copy. `enterMutation` is C7's entry (#469); the registry row is `actions.registry.ts`.
 *
 * The order is `editBodyweightAction`'s (plan W7): validate → profile → the pre-read (the row's DAY,
 * live or hidden) → bound the write by THAT day → a blank clears, a number updates through the
 * guarded UPDATE → its three-way branch. The metric and unit are pinned in the writers.
 */
export async function editPracticeAction(input: EditPracticeInput): Promise<PracticeAmendResult> {
  // Sentry: see the comment block above `logBodyweightAction`. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation(
    'editPracticeAction',
    async (): Promise<PracticeAmendResult> => {
      const entry = await enterMutation(TRANSPORT_REFUSALS);
      if (!entry.ok) return entry;
      const parsed = editPracticeSchema.safeParse(input);
      if (!parsed.success) return { ok: false, reason: PRACTICE_AMEND_REFUSAL.bad_value };

      const { profilePublicId, entryId, value, seenValue } = parsed.data;
      const profile = await getProfileByPublicId(profilePublicId);
      if (!profile) return { ok: false, reason: PRACTICE_AMEND_REFUSAL.not_found };
      const refuse = (reason: PracticeAmendRefusal): PracticeAmendResult => {
        revalidatePath(athletePath(profile.id));
        return { ok: false, reason };
      };

      const row = await practiceRowDay({ profilePublicId: profile.id, entryId });
      // Not theirs, not a practice, or gone: one answer, so a crafted id learns nothing a stale one
      // wouldn't.
      if (!row) return refuse(PRACTICE_AMEND_REFUSAL.not_found);
      const day = await resolveDeclaredDay(row.day);
      if (!day.ok) return refuse(PRACTICE_AMEND_REFUSAL.closed_day);

      if (value === null) {
        // An archived athlete has no field to re-enter a cleared practice into (plan A3).
        if (profile.archived) return { ok: false, reason: PRACTICE_AMEND_REFUSAL.archived_blank };
        const cleared = await clearPracticeEntry({
          profilePublicId: profile.id,
          entryId,
          seenValue,
        });
        if ('cleared' in cleared) {
          revalidatePath(athletePath(profile.id));
          return { ok: true };
        }
        return refuse(
          'stale' in cleared ? PRACTICE_AMEND_REFUSAL.stale : PRACTICE_AMEND_REFUSAL.not_found,
        );
      }

      const updated = await editPractice({
        profilePublicId: profile.id,
        entryId,
        minutes: value,
        seenValue,
      });
      if (updated) {
        revalidatePath(athletePath(profile.id));
        return { ok: true };
      }
      const current = await ownedPracticeMinutes({ profilePublicId: profile.id, entryId });
      // (a) Gone, never theirs, or not an amendable practice.
      if (!current) return refuse(PRACTICE_AMEND_REFUSAL.not_found);
      // (b) REPLAY: the row already holds what was asked for. One effect, success.
      if (current.minutes === value) {
        revalidatePath(athletePath(profile.id));
        return { ok: true };
      }
      // (c) Another phone got there first; the revalidate shows the value that won.
      return refuse(PRACTICE_AMEND_REFUSAL.stale);
    },
  );
}

/**
 * Server Action: save a kid's routine (V1-18 PR 2, coach editor). Like the strength log, the ordered
 * routine is one hidden `routine` JSON field (parallel repeated fields can't encode an ordered,
 * variable-length list). The `JSON.parse` is wrapped so a malformed body is a typed envelope, never
 * `error.tsx`. `validateRoutineForWrite` is the trust boundary: it REJECTS (not silently drops) an empty
 * / non-catalog / duplicate order, single-sourcing the membership + dedupe rule with the read path's
 * `resolveRoutine` — so the coach can't save a routine that would render as something else. The profile
 * is re-resolved via `getProfileByPublicId` (the ownership seam + the non-UUID guard); the DAL's
 * `.returning` maps a soft-deleted/unknown profile to a typed error. Same authZ gap as the other writers
 * (existence-only until `AUTH-1` 1c-4, not "until Clerk" — see docs/tech-debt.md).
 */
export async function editRoutineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry: see the comment block above `logBodyweightAction`. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation('editRoutineAction', async () => {
    const entry = await enterMutation(NO_PROFILE_SAVE);
    if (!entry.ok) return entry;
    const raw = formData.get('routine');
    let submitted: unknown;
    try {
      submitted = typeof raw === 'string' ? JSON.parse(raw) : undefined;
    } catch {
      return { ok: false, error: 'Could not read the routine. Reload and try again.' };
    }

    // Strict write validation (empty / non-catalog / duplicate → reject), reusing resolveRoutine's rule.
    const config = validateRoutineForWrite(submitted, ROUTINE_CATALOG);
    if (!config) {
      return { ok: false, error: 'Pick at least one activity, with no duplicates, then save.' };
    }

    const profileId = formData.get('profileId');
    if (typeof profileId !== 'string') {
      return { ok: false, error: NO_PROFILE_SAVE };
    }
    const profile = await getProfileByPublicId(profileId);
    if (!profile) return { ok: false, error: NO_PROFILE_SAVE };

    const saved = await updateProfileRoutine(profile.id, config);
    if (!saved) return { ok: false, error: NO_PROFILE_SAVE };

    // Refresh both the kid's Today (renders the new order) and this editor (re-reads the saved routine).
    revalidatePath(athletePath(profile.id));
    revalidatePath(athleteRoutinePath(profile.id));
    return { ok: true, error: null };
  });
}
