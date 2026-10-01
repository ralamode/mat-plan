'use server';

import * as Sentry from '@sentry/nextjs';

import {
  ACTIVITY_TYPE_KEYS,
  editStrengthSetSchema,
  logBodyweightSchema,
  logStrengthSessionSchema,
  METRIC_KEYS,
  METRIC_VALUE_TYPE,
  uuidSchema,
  validateRoutineForWrite,
} from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveTimeZone } from '@/lib/active-timezone';
import {
  CHECKIN_FIELDS,
  clientIdInputName,
  isCheckbox,
  valueInputName,
  VALUE_NUM_MAX,
  type CheckinField,
} from '@/lib/checkins/checkin-fields';
import {
  editStrengthSet,
  logBodyweight,
  logCheckinEntries,
  logStrengthSession,
  type CheckinItemInput,
} from '@/lib/dal/entries';
import { hasGateAccess } from '@/lib/dal/gate';
import { getProfileByPublicId, updateProfileRoutine } from '@/lib/dal/profiles';
import { localDayIso, localMinutesSinceMidnight } from '@/lib/date';
import { ROUTINE_CATALOG } from '@/lib/routine/catalog';

import type { ActionState } from './action-state';
import { resolveDeclaredDay } from '@/lib/entries/declared-day';
import { DEFAULT_PRACTICE_MINUTES, LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

/**
 * Server Action: log a bodyweight (V0-8, scoped to a profile at V1-3). A Server
 * Action is a PUBLIC POST, so it validates its own input (zod) and re-checks the
 * profile inside — never trusting the form. The tile-supplied `profileId` (a
 * hidden field) is re-validated server-side via `getProfileByPublicId` — the
 * ownership seam v1.5's Clerk household scoping plugs into (profile tiles are a
 * UX switch, not a security boundary). Returns a typed envelope for
 * `useActionState` (expected errors don't throw). Sentry
 * `withServerActionInstrumentation` wrapping lands with observability (V1-14).
 */
// The `ActionState` type + `INITIAL_ACTION_STATE` live in ./action-state. A 'use server' module may
// export ONLY async functions — the Server Actions compiler registers every export as an action
// reference, so even a re-exported TYPE trips a runtime `ReferenceError: ActionState is not defined`.
// So DO NOT re-export it here; consumers import `ActionState` straight from ./action-state.

// The not-found copy. An un-gated caller gets exactly this too (SEC-1), so it learns nothing about
// whether the gate or the profile turned it away.
const NO_PROFILE_LOG = 'No profile found to log against.';
const NO_PROFILE_SAVE = 'No profile found to save against.';

export async function logBodyweightAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry (V1-14a). Wrapped INSIDE the body, never as a HOF: `use-server-exports.test.ts` requires
  // every export in a 'use server' module to be `export async function` (the compiler registers each
  // export as an action reference). `return await` is load-bearing — the SDK returns
  // Promise<ReturnType<A>>, i.e. Promise<Promise<ActionState>> for an async callback.
  //
  // NO `headers` and NO `formData` are passed: `headers` would ship the mp_gate cookie and `formData`
  // a kid's bodyweight, both to a third party (see lib/sentry-scrub.ts). Expected failures RETURN a
  // typed envelope instead of throwing, so they never reach Sentry — that falls out of the envelope
  // convention for free rather than needing a filter.
  return await Sentry.withServerActionInstrumentation('logBodyweightAction', async () => {
    if (!(await hasGateAccess())) return { ok: false, error: NO_PROFILE_LOG };
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

    await logBodyweight({
      profilePublicId: profile.id,
      value: parsed.data.value,
      unit: parsed.data.unit,
      clientId: parsed.data.clientId,
      day: day.day,
      notes: parsed.data.notes ?? null,
    });

    revalidatePath(`/p/${profile.id}`);
    return { ok: true, error: null };
  });
}

/**
 * Per-field value validator, chosen from the field's `value_type`.
 *
 * ⚠️ A checkbox submits the STRING "1" — `FormData.get()` never returns a number. A
 * `z.literal(1)` here would reject every checkbox and make the happy path unreachable,
 * and the declared return type would hide it from typecheck. Hence the string literal
 * plus an explicit transform. A required test drives this through a real FormData.
 */
function valueSchemaFor(f: CheckinField): z.ZodType<number> {
  if (isCheckbox(f)) return z.literal('1').transform(() => 1);
  if (f.valueType === METRIC_VALUE_TYPE.scale_10) {
    return z.coerce
      .number()
      .int()
      .min(f.min ?? 1)
      .max(f.max ?? 10);
  }
  // count (and any future numeric type) — clamped to the numeric(8,3) domain so an
  // out-of-range value is a typed envelope, not a Postgres 22003 escaping to error.tsx.
  return z.coerce
    .number()
    .int()
    .min(f.min ?? 0)
    .max(f.max ?? VALUE_NUM_MAX);
}

/**
 * Server Action: log a day's check-ins / habits (V1-5). Writes N entries in one call.
 *
 * SECURITY: this NEVER enumerates the submitted FormData. It walks the trusted server-side
 * field registry and reads the names it expects, so an unknown/extra key in the POST is
 * inert, and neither `unit` nor `activity_type_id` is ever taken from the body (the DAL
 * resolves both from the seeded catalog).
 *
 * KNOWN GAP, inherited and recorded rather than papered over: `getProfileByPublicId` is an
 * EXISTENCE check (the access gate is re-checked first, SEC-1, but it is a shared code, not a
 * household) — it does not scope by household, so any known profile id writes to that profile.
 * Pre-existing since V1-3; closes at v1.5 with Clerk. Rate limiting and Sentry wrapping land at V1-14.
 */
export async function logCheckinsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry (V1-14a). Wrapped INSIDE the body, never as a HOF: `use-server-exports.test.ts` requires
  // every export in a 'use server' module to be `export async function` (the compiler registers each
  // export as an action reference). `return await` is load-bearing — the SDK returns
  // Promise<ReturnType<A>>, i.e. Promise<Promise<ActionState>> for an async callback.
  //
  // NO `headers` and NO `formData` are passed: `headers` would ship the mp_gate cookie and `formData`
  // a kid's bodyweight, both to a third party (see lib/sentry-scrub.ts). Expected failures RETURN a
  // typed envelope instead of throwing, so they never reach Sentry — that falls out of the envelope
  // convention for free rather than needing a filter.
  return await Sentry.withServerActionInstrumentation('logCheckinsAction', async () => {
    if (!(await hasGateAccess())) return { ok: false, error: NO_PROFILE_LOG };
    // 1. Walk the TRUSTED registry. Accumulate every field error rather than returning on
    //    the first — with 10 controls, one-error-at-a-time is a miserable phone form.
    const items = [];
    const fieldErrors: Record<string, string[]> = {};
    for (const f of CHECKIN_FIELDS) {
      const raw = formData.get(valueInputName(f.key));
      if (raw === null || String(raw).trim() === '') continue; // unchecked / blank → not submitted
      const value = valueSchemaFor(f).safeParse(raw);
      if (!value.success) {
        fieldErrors[f.key] = value.error.issues.map((i) => i.message);
        continue;
      }
      const clientId = uuidSchema.safeParse(formData.get(clientIdInputName(f.key)));
      if (!clientId.success) {
        fieldErrors[f.key] = ['Could not submit this item. Reload and try again.'];
        continue;
      }
      // Carry the descriptor's identity straight through — no re-encoding a key and
      // re-parsing it back out of a lookup map.
      items.push({
        activityKey: f.activityKey,
        metricKey: f.metricKey,
        value: value.data,
        clientId: clientId.data,
      });
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, error: 'Please fix the errors below.', fieldErrors };
    }
    if (items.length === 0) return { ok: false, error: 'Check at least one thing to log.' };

    // 2. The genuinely untrusted scalars.
    const profileId = uuidSchema.safeParse(formData.get('profileId'));
    const day = await resolveDeclaredDay(formData.get('day'));
    if (!profileId.success) {
      return {
        ok: false,
        error: 'Please fix the errors below.',
        fieldErrors: { profileId: ['Invalid profile.'] },
      };
    }
    if (!day.ok) return { ok: false, error: day.error };

    // 3. Re-resolve the profile server-side (never trust the hidden field).
    const profile = await getProfileByPublicId(profileId.data);
    if (!profile) return { ok: false, error: NO_PROFILE_LOG };

    const results = await logCheckinEntries({
      profilePublicId: profile.id,
      day: day.day,
      items,
    });

    revalidatePath(`/p/${profile.id}`);

    // A conflict on every item means nothing was written. `client_id` UNIQUE is GLOBAL
    // (not profile-scoped), so silently reporting success here would mask a lost write.
    if (!results.some((r) => r.created)) {
      return { ok: false, error: 'Those check-ins were already logged.' };
    }
    return { ok: true, error: null };
  });
}

/**
 * The supersets to create = the distinct `supersetClientId`s the movements are tagged with (V1-8-3d).
 * Derived from the raw movements JSON (v1 supersets carry no user label, so there's nothing else to
 * carry) — one source of truth (the movement tags), no separate wire field to drift. Reads defensively
 * off `unknown`; the schema then validates the real shapes.
 */
function deriveSupersets(movements: unknown): { clientId: string }[] {
  if (!Array.isArray(movements)) return [];
  const ids = new Set<string>();
  for (const m of movements) {
    const id =
      m && typeof m === 'object'
        ? (m as { supersetClientId?: unknown }).supersetClientId
        : undefined;
    if (typeof id === 'string') ids.add(id);
  }
  return [...ids].map((clientId) => ({ clientId }));
}

/**
 * Server Action: log a multi-movement strength SESSION (V1-8-2; supersets V1-8-3d). The form serializes
 * its movement cards (each: movementName, unit, per-movement clientId, sets, and superset tags) into ONE
 * hidden `movements` JSON field — the only way to encode N movements × variable set counts (parallel
 * repeated fields can't disambiguate boundaries). The `JSON.parse` is wrapped so a malformed body is a
 * typed envelope, never `error.tsx`; the zod schema is the trust boundary (strength is inherently free
 * data — no server registry to walk, unlike check-ins).
 *
 * `sessionType` is deliberately NOT read from the body — it's omitted so the schema default fires
 * (FormData.get returns null, which .default() doesn't catch and z.enum rejects; V1-8-2 has no
 * type control anyway). Same authZ gap as the other writers (existence-only until Clerk v1.5).
 */
export async function logStrengthSessionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry (V1-14a). Wrapped INSIDE the body, never as a HOF: `use-server-exports.test.ts` requires
  // every export in a 'use server' module to be `export async function` (the compiler registers each
  // export as an action reference). `return await` is load-bearing — the SDK returns
  // Promise<ReturnType<A>>, i.e. Promise<Promise<ActionState>> for an async callback.
  //
  // NO `headers` and NO `formData` are passed: `headers` would ship the mp_gate cookie and `formData`
  // a kid's bodyweight, both to a third party (see lib/sentry-scrub.ts). Expected failures RETURN a
  // typed envelope instead of throwing, so they never reach Sentry — that falls out of the envelope
  // convention for free rather than needing a filter.
  return await Sentry.withServerActionInstrumentation('logStrengthSessionAction', async () => {
    if (!(await hasGateAccess())) return { ok: false, error: NO_PROFILE_LOG };
    const raw = formData.get('movements');
    let movements: unknown;
    try {
      movements = typeof raw === 'string' ? JSON.parse(raw) : undefined;
    } catch {
      return { ok: false, error: 'Could not read the session. Reload and try again.' };
    }

    const parsed = logStrengthSessionSchema.safeParse({
      profileId: formData.get('profileId'),
      clientId: formData.get('clientId'),
      // `feel` is a session-level scalar (a discrete field, NOT part of the movements JSON). `?? undefined`
      // maps an absent field to undefined so `.optional()` fires; a blank value is normalized to NULL by
      // the schema's transform.
      feel: formData.get('feel') ?? undefined,
      // `?? undefined` for the SAME reason as `feel`: FormData.get returns null when absent, and the
      // shared optionalDayRoleSchema also maps '' (the "Not a programmed day" option) to undefined.
      dayRole: formData.get('dayRole') ?? undefined,
      movements,
      // V1-8-3d: supersets are DERIVED from the movements' distinct superset tags (v1 has no superset
      // label), so there's no second wire field to keep in sync with the movement tags. Built before
      // validation so the schema's membership check (movement.supersetClientId ∈ supersets[]) passes.
      supersets: deriveSupersets(movements),
      // sessionType omitted on purpose → schema default (see the note above).
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      // `flatten()` collapses every nested `movements[i].sets[j]` issue onto the one `movements` key
      // with no index. Rebuild it from the raw issues so each message names WHICH movement is wrong
      // (a multi-card form otherwise shows an unlocatable "reps must be positive").
      const movementMsgs = parsed.error.issues
        .filter((i) => i.path[0] === 'movements')
        .map((i) =>
          typeof i.path[1] === 'number' ? `Movement ${i.path[1] + 1}: ${i.message}` : i.message,
        );
      if (movementMsgs.length > 0) fieldErrors.movements = movementMsgs;
      // Superset-level issues (≥2 members, distinct order) key on `['supersets', i]` — surface them too,
      // or a form bug in the grouping logic shows only the generic banner with no recoverable message.
      const supersetMsgs = parsed.error.issues
        .filter((i) => i.path[0] === 'supersets')
        .map((i) => i.message);
      if (supersetMsgs.length > 0) fieldErrors.supersets = supersetMsgs;
      return { ok: false, error: 'Please fix the errors below.', fieldErrors };
    }

    const day = await resolveDeclaredDay(formData.get('day'));
    if (!day.ok) return { ok: false, error: day.error };

    const profile = await getProfileByPublicId(parsed.data.profileId);
    if (!profile) return { ok: false, error: NO_PROFILE_LOG };

    await logStrengthSession({
      profilePublicId: profile.id,
      sessionType: parsed.data.sessionType,
      clientId: parsed.data.clientId,
      day: day.day,
      feel: parsed.data.feel,
      // GAP-1 P0-1. Validated above but previously NOT forwarded, so `sessions.day_role` was never
      // written from the app: `LogStrengthSessionArgs.dayRole` is optional, so omitting it typechecked
      // clean, and `db:verify` drives the writer directly rather than through this action — so both
      // gates stayed green while the feature was inert. The regression test submits a `dayRole` and
      // asserts the DAL receives it; assert on the VALUE, since `objectContaining` is blind to a key
      // that is simply absent.
      dayRole: parsed.data.dayRole,
      supersets: parsed.data.supersets,
      movements: parsed.data.movements,
    });

    revalidatePath(`/p/${profile.id}`);
    // Idempotent by the session's `client_id`: a replay (network retry) dedupes via ON CONFLICT and
    // the end state is identical — that IS success (the form rotates the clientId on ok, so a
    // resubmit is a genuine retry, not a new session), not a destructive "already logged" error.
    return { ok: true, error: null };
  });
}

/**
 * Server Action: log a one-tap "life" activity (V1-7). Two shapes, both riding the shared
 * `logCheckinEntries` write path (profile/catalog/unit resolution, always-set `value_num`, per-item
 * `ON CONFLICT` idempotency):
 *   - `wake` — a `timing` event stamped at NOW: `event_at`, `value_num = local minutes-since-midnight`,
 *     and the entry's calendar `day` all derive from the SAME instant (so a stale tab can't file this
 *     morning's wake under yesterday), NEITHER source column (metric_key null → unit resolves to 'timing').
 *   - `wrestling_practice` — the `practice_minutes` metric at `DEFAULT_PRACTICE_MINUTES`, day-grain, so it
 *     uses the declared day (bounded ±1) like the other day-grain writers.
 * The submitted `activityKey` is validated against the TRUSTED `LIFE_ACTIVITY_KEYS` set — never trusted
 * from the body; unit/metric are resolved server-side. Same authZ gap as the other writers (existence-only
 * until Clerk v1.5).
 */
export async function logLifeActivitiesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry (V1-14a). Wrapped INSIDE the body, never as a HOF: `use-server-exports.test.ts` requires
  // every export in a 'use server' module to be `export async function` (the compiler registers each
  // export as an action reference). `return await` is load-bearing — the SDK returns
  // Promise<ReturnType<A>>, i.e. Promise<Promise<ActionState>> for an async callback.
  //
  // NO `headers` and NO `formData` are passed: `headers` would ship the mp_gate cookie and `formData`
  // a kid's bodyweight, both to a third party (see lib/sentry-scrub.ts). Expected failures RETURN a
  // typed envelope instead of throwing, so they never reach Sentry — that falls out of the envelope
  // convention for free rather than needing a filter.
  return await Sentry.withServerActionInstrumentation('logLifeActivitiesAction', async () => {
    if (!(await hasGateAccess())) return { ok: false, error: NO_PROFILE_LOG };
    const profileId = uuidSchema.safeParse(formData.get('profileId'));
    const clientId = uuidSchema.safeParse(formData.get('clientId'));
    const activityKey = formData.get('activityKey');

    if (!profileId.success || !clientId.success) {
      return { ok: false, error: 'Please fix the errors below.' };
    }
    // Trust boundary: only the life activities are loggable here.
    if (
      typeof activityKey !== 'string' ||
      !(LIFE_ACTIVITY_KEYS as readonly string[]).includes(activityKey)
    ) {
      return { ok: false, error: "That isn't a life activity we can log." };
    }

    // Build the entry item + its calendar `day` per activity — the ONLY life-specific logic. The dispatch
    // is EXHAUSTIVE: a key that's in the trust set but has no arm here fails loudly (never silently written
    // with wrestling's metric/value).
    let item: CheckinItemInput;
    let entryDay: string;
    if (activityKey === ACTIVITY_TYPE_KEYS.wake) {
      // Wake is a "now" event: day, clock minutes, and event_at all from the same instant + active tz.
      const timeZone = await getActiveTimeZone();
      const eventAt = new Date();
      entryDay = localDayIso(timeZone, eventAt);
      item = {
        activityKey,
        metricKey: null, // neither-source: unit resolves to the wake activity's 'timing'
        value: localMinutesSinceMidnight(timeZone, eventAt),
        clientId: clientId.data,
        eventAt,
      };
    } else if (activityKey === ACTIVITY_TYPE_KEYS.wrestling_practice) {
      const day = await resolveDeclaredDay(formData.get('day'));
      if (!day.ok) return { ok: false, error: day.error };
      entryDay = day.day;
      item = {
        activityKey,
        metricKey: METRIC_KEYS.practice_minutes,
        value: DEFAULT_PRACTICE_MINUTES,
        clientId: clientId.data,
      };
    } else {
      return { ok: false, error: "That isn't a life activity we can log." };
    }

    const profile = await getProfileByPublicId(profileId.data);
    if (!profile) return { ok: false, error: NO_PROFILE_LOG };

    await logCheckinEntries({ profilePublicId: profile.id, day: entryDay, items: [item] });
    revalidatePath(`/p/${profile.id}`);

    // A one-tap life activity is idempotent by its fixed `client_id`: a replay (double-tap) dedupes via
    // ON CONFLICT and the end state is identical — that IS success, not the destructive "already logged"
    // error the batch check-in path returns (where a partial conflict can mean a genuinely lost write).
    return { ok: true, error: null };
  });
}

/**
 * Server Action: edit ONE logged strength set's reps/weight (V1-9 fix-a-set). Same public-POST
 * discipline as the log actions — zod-validate, re-resolve the profile by `public_id` (the ownership
 * seam). The DAL's guarded UPDATE proves the set belongs to that live profile; a `null` return means
 * the set wasn't found under this owner (a stale/deleted id, or a crafted cross-profile `setId`) — an
 * EXPECTED typed error, not a throw. No `day` handling: an edit never moves the entry's date.
 */
export async function editStrengthSetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry (V1-14a). Wrapped INSIDE the body, never as a HOF: `use-server-exports.test.ts` requires
  // every export in a 'use server' module to be `export async function` (the compiler registers each
  // export as an action reference). `return await` is load-bearing — the SDK returns
  // Promise<ReturnType<A>>, i.e. Promise<Promise<ActionState>> for an async callback.
  //
  // NO `headers` and NO `formData` are passed: `headers` would ship the mp_gate cookie and `formData`
  // a kid's bodyweight, both to a third party (see lib/sentry-scrub.ts). Expected failures RETURN a
  // typed envelope instead of throwing, so they never reach Sentry — that falls out of the envelope
  // convention for free rather than needing a filter.
  return await Sentry.withServerActionInstrumentation('editStrengthSetAction', async () => {
    if (!(await hasGateAccess())) return { ok: false, error: NO_PROFILE_LOG };
    const parsed = editStrengthSetSchema.safeParse({
      profileId: formData.get('profileId'),
      setId: formData.get('setId'),
      reps: formData.get('reps'),
      weight: formData.get('weight'),
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

    const updated = await editStrengthSet({
      profilePublicId: profile.id,
      setId: parsed.data.setId,
      reps: parsed.data.reps,
      weight: parsed.data.weight,
    });
    if (!updated) return { ok: false, error: 'That set could not be found.' };

    revalidatePath(`/p/${profile.id}`);
    return { ok: true, error: null };
  });
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
 * (existence-only until Clerk v1.5 — see docs/tech-debt.md).
 */
export async function editRoutineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sentry (V1-14a). Wrapped INSIDE the body, never as a HOF: `use-server-exports.test.ts` requires
  // every export in a 'use server' module to be `export async function` (the compiler registers each
  // export as an action reference). `return await` is load-bearing — the SDK returns
  // Promise<ReturnType<A>>, i.e. Promise<Promise<ActionState>> for an async callback.
  //
  // NO `headers` and NO `formData` are passed: `headers` would ship the mp_gate cookie and `formData`
  // a kid's bodyweight, both to a third party (see lib/sentry-scrub.ts). Expected failures RETURN a
  // typed envelope instead of throwing, so they never reach Sentry — that falls out of the envelope
  // convention for free rather than needing a filter.
  return await Sentry.withServerActionInstrumentation('editRoutineAction', async () => {
    if (!(await hasGateAccess())) return { ok: false, error: NO_PROFILE_SAVE };
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
    revalidatePath(`/p/${profile.id}`);
    revalidatePath(`/p/${profile.id}/routine`);
    return { ok: true, error: null };
  });
}
