'use server';

import * as Sentry from '@sentry/nextjs';

import {
  addAthleteSchema,
  athleteActionSchema,
  foldName,
  renameAthleteSchema,
} from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';
import { redirect, RedirectType } from 'next/navigation';

import { enterMutation } from '@/app/p/mutation-entry';
import {
  APP_HOME_PATH,
  athleteEditPath,
  athletePath,
  HOUSEHOLD_FULL,
  NO_ATHLETE_ADD,
  NO_ATHLETE_SAVE,
  OWNER_ONLY_ATHLETE,
  SETTINGS_PATH,
} from '@/lib/constants';
import {
  archiveAthlete,
  createAthlete,
  getProfileByPublicId,
  renameAthlete,
  restoreAthlete,
  type AthleteWriteResult,
} from '@/lib/dal/profiles';

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

/**
 * The shared body of the two **id-only** athlete actions — archive and restore (PROF-1 b).
 *
 * 🔴 **One helper, because the maintainer's N4 rule says so and because the alternative is visibly
 * worse.** Written out twice, these two actions differ in exactly two tokens: which DAL function to
 * call, and which refusal a `not_owner` maps to. Everything else — `enterMutation` first, the zod
 * parse, the `profileId`-is-not-a-field-error branch, the three `revalidatePath` calls, the
 * `{ ok, savedId }` envelope — is identical. And it would not have stopped at two: `V1-9b`'s delete
 * and restore are the same shape again.
 *
 * ⚠️ **It is NOT exported.** A `'use server'` module registers every export as a callable action
 * reference, so exporting this would publish an endpoint that takes a writer function. It is a plain
 * local function, which is why `use-server-exports.test.ts` stays green.
 *
 * 🔴 **`enterMutation` is deliberately NOT in here, and that is the one thing this helper must not
 * absorb.** The first version called it, and `app/pages-need-a-session.test.ts` went red: it scans
 * each exported action's own body for the awaited call. That guard is right and the helper was
 * wrong. A boundary check hidden one call deep is a boundary check a reader of the action cannot
 * see, and the next author adding a third action here would copy a body that appears to check
 * nothing. **Share the plumbing; never share the boundary.** So each action opens with its own
 * `enterMutation` and hands the result in.
 *
 * `revalidatePath` covers the three surfaces an archive changes: the picker (the athlete leaves or
 * rejoins the tiles), Household settings (they move between the two sections), and the athlete's own
 * day page (the notice and the form-enable flag).
 */
async function runAthleteStateAction(
  formData: FormData,
  write: (publicId: string) => Promise<AthleteWriteResult>,
  ownerOnlyMessage: string | null,
): Promise<ActionState> {
  const parsed = athleteActionSchema.safeParse({ profileId: formData.get('profileId') });
  // A malformed id is the not-found refusal, not a field error: there is no input to correct, and it
  // must answer exactly as an unknown or foreign id does or it becomes an oracle for "that one was
  // at least shaped like a real athlete". Only reachable from a crafted body.
  if (!parsed.success) return { ok: false, error: NO_ATHLETE_SAVE };

  // 🔴 **The ownership seam, HERE as well as inside the DAL, and that is not redundancy.** Two
  // reasons, both load-bearing:
  //
  // 1. It is what makes the action-level wrong-household matrix real. `actions.test.ts` makes a
  //    `profileId` foreign by mocking exactly this function to `null` — the one lever that works for
  //    every profile-addressed action — so an action that delegated the resolve would sail through
  //    the matrix on a mocked DAL and the suite would prove nothing about it.
  // 2. A foreign id is then refused before the DAL is called at all, so `expect(write).not
  //    .toHaveBeenCalled()` has something to assert.
  //
  // It costs no query: `getProfileByPublicId` is `cache()`d per request, so the DAL's own resolve a
  // moment later is the same call. ⚠️ That sentence was written before the `cache()` was there — a
  // security lens caught it, and the fix was to wrap the function rather than soften the claim. The DAL still owns the ORDER (resolve → narrow → write) for every
  // OTHER caller, which is `write-path.md` invariant 3 — a guard that exists only in the action is
  // one a second caller can skip.
  const profile = await getProfileByPublicId(parsed.data.profileId);
  if (!profile) return { ok: false, error: NO_ATHLETE_SAVE };

  const result = await write(parsed.data.profileId);
  if (!result.ok) {
    // The DAL owns the ORDER that makes this distinction possible — see `archiveAthlete`. Here we
    // only map it, and `restoreAthlete` can never produce `not_owner`, which is why the caller
    // passes `null` for it rather than a string nobody can reach.
    if (result.reason === 'not_owner' && ownerOnlyMessage) {
      return { ok: false, error: ownerOnlyMessage };
    }
    return { ok: false, error: NO_ATHLETE_SAVE };
  }

  revalidatePath(APP_HOME_PATH);
  revalidatePath(SETTINGS_PATH);
  revalidatePath(athletePath(result.id));
  return { ok: true, error: null, savedId: result.id };
}

/**
 * Server Action: archive one athlete — **owner only** (PROF-1 b, acceptance criterion 8).
 *
 * The authority is not re-checked here; it is carried by `archiveAthlete`'s shape in the DAL, which
 * resolves the id through the ownership seam, narrows to an `OwnerScope`, and only then calls a
 * writer whose parameter type makes skipping the narrowing a compile error. A Server Action is a
 * public POST, so none of that may depend on the UI having hidden the button.
 *
 * `OWNER_ONLY_ATHLETE` is reachable here and nowhere else in the app — the UI renders no Archive
 * control for a member — which is why the DAL also emits a signal when it fires.
 */
export async function archiveAthleteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry: see the module docblock. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation('archiveAthleteAction', async () => {
    // In THIS body, not in the shared helper — see its docblock. An unauthenticated flood must buy
    // zero Redis and zero Postgres work, and the guard that proves it reads this function.
    const entry = await enterMutation(NO_ATHLETE_SAVE);
    if (!entry.ok) return entry;
    return runAthleteStateAction(formData, archiveAthlete, OWNER_ONLY_ATHLETE);
  });
}

/**
 * Server Action: restore one athlete — **any member** (decision M1).
 *
 * `null` for the owner-only message, because `restoreAthlete` cannot return `not_owner`: there is no
 * narrowing in its path. Passing the string anyway would put a refusal in the code that no input can
 * reach, which reads as a guard and is not one.
 *
 * It is also what **Undo** calls. One writer, one action, one matrix row — so a lost Undo line costs
 * a scroll to the Restore button rather than a capability.
 */
export async function restoreAthleteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return await Sentry.withServerActionInstrumentation('restoreAthleteAction', async () => {
    const entry = await enterMutation(NO_ATHLETE_SAVE);
    if (!entry.ok) return entry;
    return runAthleteStateAction(formData, restoreAthlete, null);
  });
}

/**
 * Server Action: add an athlete (PROF-1 a-1w). **The app's first HOUSEHOLD-scoped action.**
 *
 * 🔴 **It does NOT use `runAthleteStateAction`, and that is a reuse decision, not an oversight.**
 * That helper exists for the two **id-only** actions: it parses a `profileId`, resolves it through
 * the ownership seam, and returns a `savedId`. Add has no `profileId` to resolve, a three-field body,
 * and ends in a `redirect` rather than an envelope — so sharing it would mean parameterising all
 * three, which is how one helper becomes a thing with a mode flag. `enterMutation` is in this body
 * for the same reason it is in theirs: **share the plumbing, never share the boundary.**
 *
 * ## Why there is no `profileId` to make foreign, and what replaces that proof
 *
 * Every mutating action before this one carries a `profileId`, which the wrong-household matrix makes
 * foreign to prove isolation. This one carries none, so the isolation question moves entirely into
 * `createProfile`'s two scoped reads — proved against a real database in `db:verify`, with mutation
 * patch `20` showing the proof can fail. At this tier the matrix instead drives a **scope miss**: the
 * household suite in `actions.test.ts` makes `createAthlete` answer `no_scope` and asserts the bytes
 * match the unauthenticated refusal.
 *
 * ## The refusals, and which one names its cause
 *
 * `no_scope` and `refused` both become `NO_ATHLETE_ADD`, byte-identical to the unauth answer: the
 * first means a signed-in account with no membership reached a mutation the UI never offers, and the
 * second means the `client_id` is spent — neither is a fact about this caller's household that is
 * useful or safe to confirm. **`full` is different**: it is only reachable *after* the scope
 * resolved, it is a fact about the caller's own household that they can already see on the picker,
 * and telling them "couldn't add" would have them retry a request that can never succeed.
 *
 * ⚠️ **`revalidatePath` must precede `redirect`** — `redirect()` throws, so nothing after it runs.
 */
export async function addAthleteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry: see the module docblock. `return await` is load-bearing.
  return await Sentry.withServerActionInstrumentation('addAthleteAction', async () => {
    const entry = await enterMutation(NO_ATHLETE_ADD);
    if (!entry.ok) return entry;

    const parsed = addAthleteSchema.safeParse({
      name: formData.get('name'),
      kind: formData.get('kind'),
      clientId: formData.get('clientId'),
      // 🔴 `?? undefined`, and it is load-bearing. `formData.get()` returns **null** for an absent
      // field — which is EVERY add that is not a re-confirm — and `z.string().optional()` rejects
      // `null` (probed: `null` → false, `undefined` → true). Without this the ordinary path fails the
      // parse and renders NOTHING, because no visible field is named in the error. The `notes`
      // handling in `[profileId]/actions.ts` is the precedent.
      acknowledgedDuplicate: formData.get('acknowledgedDuplicate') ?? undefined,
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      // A bad `clientId` is NOT a field error: it is a hidden field, so there is nothing for a
      // parent to correct, and it must answer exactly as a spent key does. Only reachable from a
      // crafted body — the form mints the id itself.
      // Neither hidden field is a thing a parent can correct, so both answer page-level.
      if (fieldErrors.clientId || fieldErrors.acknowledgedDuplicate) {
        return { ok: false, error: NO_ATHLETE_ADD };
      }
      return {
        ok: false,
        error: null,
        fieldErrors: { name: fieldErrors.name, kind: fieldErrors.kind },
      };
    }

    // 🔴 **`acknowledgedDuplicate` rides in the spread, and is compared SERVER-SIDE against the
    // parsed (trimmed, collapsed) name.** The client sends a fold it computed; `createProfile`
    // re-derives it with `foldName` from the name actually being saved
    // (`packages/db/src/writers/profile.ts`, step 2), so an acknowledgement can only ever skip the
    // check for the name it was shown for. A crafted body can still forge it: duplicates are
    // advisory, not a boundary. (An earlier version restated the key after the spread, which
    // assigned it to itself and read as though this line did the comparing.)
    const created = await createAthlete(parsed.data);
    if (!created.ok) {
      if (created.reason === 'duplicate') {
        // Not a `fieldError`: the name is not invalid, and `aria-invalid` on a correct value is a
        // lie. The form renders a callout from this and offers the choices.
        return {
          ok: false,
          error: null,
          duplicate: {
            match: created.match,
            atCap: created.atCap,
            folded: foldName(parsed.data.name),
            // The PARSED name and kind, so a render with no client state can rebuild the form —
            // see the envelope's docblock. `parsed.data.name`, never the raw field: it folds to
            // `folded` by construction, so the callout cannot be discarded by its own gate.
            typed: parsed.data.name,
            chosenKind: parsed.data.kind,
          },
        };
      }
      return { ok: false, error: created.reason === 'full' ? HOUSEHOLD_FULL : NO_ATHLETE_ADD };
    }

    revalidatePath(APP_HOME_PATH);
    revalidatePath(SETTINGS_PATH);
    // D6: the parent lands on the athlete they just created, where logging happens. `replace` so
    // Back returns to the picker rather than re-opening a filled form.
    redirect(athletePath(created.id), RedirectType.replace);
  });
}
