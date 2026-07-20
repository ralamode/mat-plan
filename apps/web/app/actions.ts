'use server';

import { logBodyweightSchema, logStrengthSchema } from '@mat-plan/shared';
import { revalidatePath } from 'next/cache';

import { logBodyweight, logStrengthEntry } from '@/lib/dal/entries';
import { getDefaultProfile } from '@/lib/dal/profiles';
import { todayIso } from '@/lib/date';

/**
 * Server Action: log a bodyweight (V0-8). A Server Action is a PUBLIC POST, so it
 * validates its own input (zod) and re-checks ownership inside — never trusting
 * the form. Returns a typed envelope for `useActionState` (expected errors don't
 * throw). Ownership is the default profile in v0; Clerk household scoping plugs
 * in here at V1-1/v1.5. Sentry `withServerActionInstrumentation` wrapping lands
 * with observability (V1-14).
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

  const profile = await getDefaultProfile();
  if (!profile) return { ok: false, error: 'No profile found to log against.' };

  await logBodyweight({
    profilePublicId: profile.id,
    value: parsed.data.value,
    unit: parsed.data.unit,
    clientId: parsed.data.clientId,
    day: todayIso(),
    notes: parsed.data.notes ?? null,
  });

  revalidatePath('/');
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

  const profile = await getDefaultProfile();
  if (!profile) return { ok: false, error: 'No profile found to log against.' };

  await logStrengthEntry({
    profilePublicId: profile.id,
    movementName: parsed.data.movementName,
    unit: parsed.data.unit,
    sets: parsed.data.sets,
    clientId: parsed.data.clientId,
    day: todayIso(),
  });

  revalidatePath('/');
  return { ok: true, error: null };
}
