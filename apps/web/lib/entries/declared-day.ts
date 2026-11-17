import 'server-only';

import {
  addDays,
  inWritableWindow,
  isoDayDiff,
  isoDaySchema,
  WRITABLE_DAY_RADIUS,
} from '@mat-plan/shared';

import { getActiveLocalDay } from '@/lib/active-timezone';
import { LOOK_AHEAD_DAYS } from '@/lib/constants';

/** Shown when a form submits a day too far from the server's active-tz today (a stale tab). */
export const DECLARED_DAY_CLOSED_ERROR = 'That day is no longer open for logging. Reload the page.';

export type DeclaredDayResult = { ok: true; day: string } | { ok: false; error: string };

/**
 * Validate the `day` a log form declares (the day the page rendered) against the request's
 * active-tz today: today or yesterday, never a later day (FAM-1 D32). ONE seam shared by all three writers (check-ins,
 * bodyweight, strength) so a write always lands on the date the user actually saw — even
 * across a local-midnight session — and the check-in "dance" isn't copy-pasted per form.
 *
 * The one-day tolerance assumes the supported US zones; a detected zone ≥2 days from the server
 * default during the first-visit-while-traveling window is out of scope (V1-6c risk R7).
 */
export async function resolveDeclaredDay(
  raw: FormDataEntryValue | null,
): Promise<DeclaredDayResult> {
  const parsed = isoDaySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: DECLARED_DAY_CLOSED_ERROR };
  const today = await getActiveLocalDay();
  if (!isWritableDay(parsed.data, today)) {
    return { ok: false, error: DECLARED_DAY_CLOSED_ERROR };
  }
  return { ok: true, day: parsed.data };
}

/**
 * How many days before today a write is accepted. The number lives in `@mat-plan/shared` (`day.ts`,
 * FAM-1 contract change C10) so the database package reads the same one; re-exported because the
 * UI gates its forms on it.
 */
export { WRITABLE_DAY_RADIUS };

/**
 * Whether `day` can be written to: **today and yesterday, never a later day** (FAM-1 D32, since step
 * 12c). It is the shared `inWritableWindow`, the rule every program row is held to, so the older
 * forms (bodyweight, practice, clear day), their actions and the day's rows share one window.
 * `resolveDeclaredDay` is this, so the UI and the server cannot differ.
 */
export function isWritableDay(day: string, today: string): boolean {
  return inWritableWindow(day, today);
}

/**
 * What the day page may offer on `day` (V1-24 3b-page). Pure, so the read-only rule is tested here
 * rather than only in the async page, which Vitest cannot render.
 *
 * - `closedDay`: not today or yesterday. Read-only for everyone.
 * - `future`: a day after today, which the page shows only as look-ahead (FAM-1 12c): its own
 *   notice, no Bodyweight or Life, never the closed-day sentence.
 * - `writable`: a log form may render — not closed, and the athlete is not archived.
 * - `amendable`: a logged value offers Change. Follows the DAY only: an archived athlete's weight on
 *   today or yesterday stays correctable, as before.
 * - `showClosedNotice`: the read-only sentence, on a PAST closed day. Not for an archived athlete,
 *   where its "today and yesterday can be logged" is false and the archived notice gives the real
 *   reason, and not for a future day, which has not happened yet (maintainer, 2026-11-17).
 */
export function dayPageFlags(day: string, today: string, archived: boolean) {
  const closedDay = !isWritableDay(day, today);
  const future = isoDayDiff(day, today) > 0;
  return {
    closedDay,
    future,
    writable: !closedDay && !archived,
    amendable: !closedDay,
    showClosedNotice: closedDay && !future && !archived,
  };
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
 * **A future day passes through** (FAM-1 12c, look-ahead), and the PAGE decides whether to show it:
 * only while the athlete is on a program that day (plan §9, "goes forward only while the athlete is
 * on a program the next day"); otherwise it renders today, as this function once did for every
 * future day. A day more than `LOOK_AHEAD_DAYS` ahead renders today here. **The past is floored at the profile's first day**, so a kid tapping `‹` cannot walk
 * back into 2019 and conclude the app is broken.
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
  const ahead = isoDayDiff(parsed.data, today);
  if (ahead > LOOK_AHEAD_DAYS) return today; // past the look-ahead horizon (maintainer, 2026-11-17)
  if (ahead > 0) return parsed.data; // look-ahead: the page checks the athlete is on a program
  if (isoDayDiff(parsed.data, floor) < 0) return floor; // never before the profile existed
  return parsed.data;
}
