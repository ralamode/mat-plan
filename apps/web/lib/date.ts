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
 * The LOCAL date+time parts of the instant `now`, in `timeZone` — the shared `formatToParts`
 * primitive `localDayIso` and `localMinutesSinceMidnight` both build on (engine-proof: assembled
 * by part `type`, no reliance on a locale's format string). `hourCycle: 'h23'` so midnight is hour
 * `00` (not `12` on a 12-hour locale, nor `24` on `h24`). Uses the platform tz database → DST and
 * no-DST zones (Arizona, Hawaii) are handled without any manual offset math.
 */
function localDateParts(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/**
 * The LOCAL calendar date (`YYYY-MM-DD`) of the instant `now`, in `timeZone`. NEVER
 * `toISOString().slice` (UTC) and NEVER `new Date("YYYY-MM-DD")` (parsed as UTC midnight).
 */
export function localDayIso(timeZone: string, now: Date = new Date()): string {
  const { year, month, day } = localDateParts(timeZone, now);
  return `${year}-${month}-${day}`;
}

/**
 * Whole minutes since LOCAL midnight of `now` in `timeZone` (0–1439). The wall-clock projection
 * `wake` stores in `value_num` (V1-7) so the clock renders tz-free at read time. `hourCycle:'h23'`
 * (via `localDateParts`) makes 00:00 → 0 and 23:59 → 1439 — a 12-hour hour part would map midnight
 * to 720. DST-safe: the tz database resolves the wall time; this is the wake CLOCK time, which is
 * what "average wake time" wants (not elapsed minutes).
 */
export function localMinutesSinceMidnight(timeZone: string, now: Date = new Date()): number {
  const { hour, minute } = localDateParts(timeZone, now);
  return Number(hour) * 60 + Number(minute);
}

/**
 * Format minutes-since-midnight (0–1439) as a local 12-hour clock string ("6:52 AM"). tz-FREE by
 * design: the minutes are anchored at UTC epoch and formatted in UTC, so no zone re-enters (the same
 * discipline as `formatDayLong`) — the caller already projected the local wall time into the number.
 */
export function minutesToClock(minutes: number): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    })
      .format(new Date(minutes * 60_000))
      // Modern ICU (>=72) separates the time from AM/PM with a NARROW NO-BREAK SPACE (U+202F);
      // JS \s matches it, so normalize to a plain space -> display/test/e2e read "6:52 AM".
      .replace(/\s/g, ' ')
  );
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
 * The weekday of the calendar date `day` (`YYYY-MM-DD`) as `0=Sun … 6=Sat`.
 *
 * THE V1-6c off-by-one trap: `new Date("2026-07-30").getDay()` parses the bare date as UTC midnight and
 * then reports it in the RUNTIME's zone — west of UTC that's the PREVIOUS day, so a Monday program would
 * render on Sunday. This uses the same safe `…T00:00:00Z` parse + `getUTCDay()` idiom as
 * `localWeekStartIso`: `day` is already a bare LOCAL calendar date (from `localDayIso(activeTz)`), it has
 * exactly one weekday, and no zone is reinterpreted. Feed it the local day, never a UTC-derived one.
 */
export function localWeekday(day: string): number {
  return new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
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
