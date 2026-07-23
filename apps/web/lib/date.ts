import { z } from 'zod';

/**
 * Date helpers for the "declared date" of an entry (activity_date is a plain
 * DATE, not a timestamp). v0 treats the day in **UTC**; per-profile timezones
 * come later. Pure + injectable so they're unit-testable.
 */

/** A declared date on the wire: `YYYY-MM-DD`. */
export const isoDaySchema = z.iso.date();

/**
 * Whole days from `b` to `a` (both `YYYY-MM-DD`). Used to bound the day a form
 * submits against the server's today.
 *
 * WHY THIS EXISTS: `todayIso()` is UTC, and check-ins (rice bucket, splits, brain
 * rep) are EVENING activities — at 19:00 CDT the UTC day has already rolled over,
 * so a form rendered "today" could submit after the server's day changed. The page
 * sends the day it rendered and the action bounds it to ±1, so the row lands on the
 * date the user was actually looking at. A real per-profile timezone is a later item.
 */
export function isoDayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Today's declared date as `YYYY-MM-DD` (UTC). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Human-readable long date from a `YYYY-MM-DD` string, rendered in UTC to match the stored day. */
export function formatDayLong(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}
