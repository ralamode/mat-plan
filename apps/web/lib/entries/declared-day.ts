import 'server-only';

import { getActiveLocalDay } from '@/lib/active-timezone';
import { isoDayDiff, isoDaySchema } from '@/lib/date';

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
