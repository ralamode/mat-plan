import { z } from 'zod';

/**
 * Date helpers for the "declared date" of an entry (activity_date is a plain DATE,
 * not a timestamp).
 *
 * RULE (V1-6c): calendar dates & weekdays come from the ACTIVE IANA TIMEZONE; UTC is
 * only for exact moments (created_at/deleted_at timestamptz). "Today" is the local
 * calendar date in the active tz — never `new Date().toISOString().slice(0,10)` (that's
 * UTC, which rolls over mid-afternoon in the Pacific and shows tomorrow's workout).
 * These helpers are pure + injectable so the whole tz/DST matrix is fast unit tests; the
 * server resolves the active tz in `lib/active-timezone.ts`.
 */

/** A declared date on the wire: `YYYY-MM-DD`. */
export const isoDaySchema = z.iso.date();

/**
 * The LOCAL calendar date (`YYYY-MM-DD`) of the instant `now`, in `timeZone`.
 *
 * Assembled from `formatToParts` — engine-proof (no reliance on a locale's format string
 * or part order), and it uses the platform's tz database, so DST and no-DST zones
 * (Arizona, Hawaii) are handled without any manual offset/DST math. NEVER
 * `toISOString().slice` (UTC) and NEVER `new Date("YYYY-MM-DD")` (parsed as UTC midnight).
 */
export function localDayIso(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** True iff `tz` is a resolvable IANA zone. Dependency-free: the Intl constructor throws
 *  `RangeError` on an unknown zone (more portable than `Intl.supportedValuesOf`). Used to
 *  validate the client-supplied `tz` cookie before it's ever fed to date math. */
export function isIanaTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whole days from `b` to `a` (both `YYYY-MM-DD`). Used to bound the day a form submits
 * against the server's active-tz today.
 *
 * WHY THIS EXISTS: check-ins (rice bucket, splits, brain rep) are EVENING activities and a
 * form can sit open across the local-midnight rollover, so a page rendered "today" could
 * submit after the server's local day changed. The page sends the day it rendered and the
 * action bounds it to ±1, so the row lands on the date the user was actually looking at.
 */
export function isoDayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/**
 * The Monday that starts the ISO-week containing the calendar date `day` (`YYYY-MM-DD`).
 *
 * THE week-boundary seam (V1-6b-2): feed it a LOCAL day (`localDayIso(activeTz)`); V1-15 day-nav
 * and any dashboard ISO-week bucketing should reuse this, not re-encode weekday math. Monday-based
 * (ISO-8601), matching `ramp_targets.week_start`. Pure UTC-epoch integer-day arithmetic on the safe
 * `…T00:00:00Z` parse (NEVER `new Date("YYYY-MM-DD")`): `day` is already a bare local calendar date,
 * so no zone is reinterpreted and DST never enters — the Monday is always correct.
 */
export function localWeekStartIso(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7; // Mon→0 … Sun→6 (back to THIS week's Monday)
  return new Date(t - backToMonday * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Human-readable long date from a `YYYY-MM-DD` calendar date.
 *
 * Anchored at UTC midnight and formatted in UTC BY DESIGN — and it deliberately takes NO
 * `timeZone` param. A bare calendar date has exactly one weekday, tz-invariant, so this
 * renders it correctly; re-interpreting the date-only value through a zone here would
 * reintroduce an off-by-one. The active tz belongs in computing the day (`localDayIso`),
 * never in formatting it. Feed this the LOCAL day so the header weekday matches the plan.
 */
export function formatDayLong(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}
