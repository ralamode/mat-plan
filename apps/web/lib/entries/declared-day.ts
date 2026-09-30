import 'server-only';

import { getActiveLocalDay } from '@/lib/active-timezone';
import { addDays, isoDayDiff, isoDaySchema } from '@/lib/date';

/** Shown when a form submits a day too far from the server's active-tz today (a stale tab). */
export const DECLARED_DAY_CLOSED_ERROR = 'That day is no longer open for logging. Reload the page.';

export type DeclaredDayResult = { ok: true; day: string } | { ok: false; error: string };

/**
 * Validate the `day` a log form declares (the day the page rendered) against the request's
 * active-tz today, bounded to ±1. ONE seam shared by all three writers (check-ins,
 * bodyweight, strength) so a write always lands on the date the user actually saw — even
 * across a local-midnight session — and the check-in "dance" isn't copy-pasted per form.
 *
 * The ±1 tolerance assumes the supported US zones; a detected zone ≥2 days from the server
 * default during the first-visit-while-traveling window is out of scope (V1-6c risk R7).
 */
export async function resolveDeclaredDay(
  raw: FormDataEntryValue | null,
): Promise<DeclaredDayResult> {
  const parsed = isoDaySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: DECLARED_DAY_CLOSED_ERROR };
  const today = await getActiveLocalDay();
  if (Math.abs(isoDayDiff(parsed.data, today)) > 1) {
    return { ok: false, error: DECLARED_DAY_CLOSED_ERROR };
  }
  return { ok: true, day: parsed.data };
}

/**
 * How many days either side of today a write is accepted. Exported so the UI can gate its forms on
 * the SAME number the server enforces — a re-typed `1` in `page.tsx` is exactly the drift the
 * constants rule exists to stop.
 */
export const WRITABLE_DAY_RADIUS = 1;

/** Whether `day` is inside the write window. The UI half of `resolveDeclaredDay`'s bound. */
export function isWritableDay(day: string, today: string): boolean {
  return Math.abs(isoDayDiff(day, today)) <= WRITABLE_DAY_RADIUS;
}

/**
 * Which day the page should RENDER — today, or the validated `?d=` (V1-15).
 *
 * Deliberately beside `resolveDeclaredDay`: both are "validate an ISO day, then clamp it against the
 * active-tz today", and a second near-identical resolver in another directory is the duplication
 * AGENTS.md's constants rule names.
 *
 * **Malformed → today, not 404.** A stale or hand-edited URL should land the athlete on a usable
 * page; there is no resource to "not find", since every date is a legal day and most simply have
 * nothing logged.
 *
 * **The future is clamped**, so a tab left open across midnight cannot render a day that has not
 * happened. **The past is floored at the profile's first day**, so a kid tapping `‹` cannot walk back
 * into 2019 and conclude the app is broken.
 */
export function resolveViewedDay(
  requested: string | undefined,
  today: string,
  profileFirstDay: string,
): string {
  // ⚠️ The floor can NEVER be later than the earliest WRITABLE day. If `resolveDeclaredDay` would
  // accept a write for yesterday, the page must be able to show yesterday — otherwise the UI is
  // stricter than the endpoint it fronts, which is the same class of bug as hiding yesterday's forms.
  //
  // It bites on a profile created today: `created_at` alone would clamp `?d=<yesterday>` up to today,
  // so a brand-new household could never look at the day it just logged from a stale tab — which is
  // the exact confusion this feature exists to answer.
  const earliestWritable = addDays(today, -WRITABLE_DAY_RADIUS);
  const floor =
    isoDayDiff(profileFirstDay, earliestWritable) < 0 ? profileFirstDay : earliestWritable;
  const parsed = isoDaySchema.safeParse(requested);
  if (!parsed.success) return today;
  if (isoDayDiff(parsed.data, today) > 0) return today; // never the future
  if (isoDayDiff(parsed.data, floor) < 0) return floor; // never before the profile existed
  return parsed.data;
}
