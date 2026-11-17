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

/**
 * How far from today a write is still accepted, in days: 1. One number for both rules that use it:
 * `inWritableWindow` below (that many days BEFORE today, and never after), which the older forms'
 * `isWritableDay` in the web app also calls (since plan step 12c).
 */
export const WRITABLE_DAY_RADIUS = 1;

/**
 * Whether `day` can be written to, given the caller's `today`: **today and the
 * `WRITABLE_DAY_RADIUS` days before it, never a day after today** (FAM-1 plan D20, D32). This is
 * what `DayPlan.writable` means and what every row write is held to (`closed_day` otherwise).
 *
 * Pure: the caller supplies `today` (the request's active-timezone day), so the database package
 * and the web app use the same rule (contract change C10).
 *
 * The older forms' bound too: `apps/web/lib/entries/declared-day.ts`'s `isWritableDay` calls this
 * (plan step 12c), so bodyweight, practice and a row share one window.
 */
export function inWritableWindow(day: string, today: string): boolean {
  const diff = isoDayDiff(day, today);
  return diff <= 0 && diff >= -WRITABLE_DAY_RADIUS;
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

/**
 * The same seven weekdays in the order a week is SHOWN: Monday first, Sunday last (1, 2, … 6, 0).
 *
 * ⚠️ **An order, not a numbering.** Each member is still a `Weekday` in `WEEKDAYS`' origin
 * (0 = Sunday), so `MONDAY_FIRST[0]` is `1`. Index into a week with the member, never with its
 * position here: the position is the Monday-first 0–6 the note above warns about.
 *
 * FAM-1 lists a week this way wherever a person reads one: the program page's week and
 * `ProgramView.workouts[].usedOn`.
 */
export const MONDAY_FIRST: readonly Weekday[] = [...WEEKDAYS.slice(1), WEEKDAYS[0]];
