import { z } from 'zod';

/**
 * Pure arithmetic on a bare calendar date (`YYYY-MM-DD`), and the weekday vocabulary.
 *
 * Moved here from `apps/web/lib/date.ts` at SCHED-1 chunk 1a (FAM-1 step 2), because `packages/*`
 * cannot import from `apps/web` and the scheduling tables need a weekday on both sides. Nothing here
 * reads a timezone, a cookie or `Intl`: the helpers that resolve the ACTIVE timezone
 * (`localDayIso` and the formatters) stay in the app, where V1-6c's rule is documented.
 */

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

/** The calendar date `n` whole days after `day` (`YYYY-MM-DD`; a negative `n` goes back). */
export function addDays(day: string, n: number): string {
  // The `…T00:00:00Z` anchor is the V1-6c idiom, not a stylistic choice: `new Date("2026-07-30")`
  // parses as UTC midnight and then reports in the RUNTIME's zone, so west of UTC it is the PREVIOUS
  // day. A bare calendar date has exactly one identity; anchoring at UTC preserves it.
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
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
 * The weekdays a schedule can name, in `localWeekday`'s origin: 0 = Sunday … 6 = Saturday.
 *
 * ⚠️ THE ORIGIN IS LOAD-BEARING AND THIS REPO HOLDS BOTH. `localWeekday` is `getUTCDay()`
 * (0 = Sunday); the app's `localWeekStartIso` is Monday-first ISO-8601 to match
 * `ramp_targets.week_start`. The SILENT mistake is a Monday-first 0–6 (0 = Mon … 6 = Sun, Python's
 * `date.weekday()`): every value is in range, so nothing rejects it and the whole program shifts by
 * one day. ISO numbering (1 = Mon … 7 = Sun) agrees with this origin on Monday–Saturday and is out
 * of range only for Sunday's 7, so it fails loudly instead (SCHED-1 plan, review finding C1).
 *
 * NOT a reference table: seven universal integers are AGENTS.md's "don't over-abstract" case.
 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const weekdaySchema = z.literal(WEEKDAYS);
