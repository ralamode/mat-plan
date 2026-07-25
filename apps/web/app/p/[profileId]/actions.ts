'use server';

import {
  ACTIVITY_TYPE_KEYS,
  logBodyweightSchema,
  logStrengthSchema,
  METRIC_KEYS,
  METRIC_VALUE_TYPE,
  uuidSchema,
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
  logBodyweight,
  logCheckinEntries,
  logStrengthEntry,
  type CheckinItemInput,
} from '@/lib/dal/entries';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { localDayIso, localMinutesSinceMidnight } from '@/lib/date';
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
export type ActionState = {
  ok: boolean;
  error: string | null;
  fieldErrors?: Record<string, string[] | undefined>;
};

export async function logBodyweightAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
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
  if (!profile) return { ok: false, error: 'No profile found to log against.' };

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
 * KNOWN GAPS, inherited and recorded rather than papered over: there is no authN here (the
 * access gate is middleware-only, which .github/SECURITY.md explicitly disclaims as the auth
 * boundary), and `getProfileByPublicId` is an EXISTENCE check — it does not scope by
 * household, so any known profile id writes to that profile. Both are pre-existing since
 * V1-3 and close at v1.5 with Clerk. Rate limiting and Sentry wrapping land at V1-14.
 */
export async function logCheckinsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
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
  if (!profile) return { ok: false, error: 'No profile found to log against.' };

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
}

export async function logStrengthAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sets come in as parallel repeated fields; pair them up, drop blank rows.
  const reps = formData.getAll('reps').map(String);
  const weights = formData.getAll('weight').map(String);
  const sets = reps
    .map((r, i) => ({ reps: r, weight: weights[i] ?? '' }))
    .filter((s) => s.reps.trim() !== '' || s.weight.trim() !== '');

  const parsed = logStrengthSchema.safeParse({
    profileId: formData.get('profileId'),
    movementName: formData.get('movementName'),
    unit: formData.get('unit'),
    clientId: formData.get('clientId'),
    sets,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const day = await resolveDeclaredDay(formData.get('day'));
  if (!day.ok) return { ok: false, error: day.error };

  const profile = await getProfileByPublicId(parsed.data.profileId);
  if (!profile) return { ok: false, error: 'No profile found to log against.' };

  await logStrengthEntry({
    profilePublicId: profile.id,
    movementName: parsed.data.movementName,
    unit: parsed.data.unit,
    sets: parsed.data.sets,
    clientId: parsed.data.clientId,
    day: day.day,
  });

  revalidatePath(`/p/${profile.id}`);
  return { ok: true, error: null };
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
  if (!profile) return { ok: false, error: 'No profile found to log against.' };

  await logCheckinEntries({ profilePublicId: profile.id, day: entryDay, items: [item] });
  revalidatePath(`/p/${profile.id}`);

  // A one-tap life activity is idempotent by its fixed `client_id`: a replay (double-tap) dedupes via
  // ON CONFLICT and the end state is identical — that IS success, not the destructive "already logged"
  // error the batch check-in path returns (where a partial conflict can mean a genuinely lost write).
  return { ok: true, error: null };
}
