/**
 * Date helpers for the "declared date" of an entry (activity_date is a plain
 * DATE, not a timestamp). v0 treats the day in **UTC**; per-profile timezones
 * come later. Pure + injectable so they're unit-testable.
 */

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
