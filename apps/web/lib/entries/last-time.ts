import { isoDayDiff } from '@mat-plan/shared';

/** How far back "Last time" stops naming the weekday and names the date instead. */
const WEEKDAY_RANGE = 6;

/**
 * The day suffix of `Last time 72.5 lb · Tue` (V1-24 3b-bw, plan W1): `null` when the weigh-in was
 * the day before the viewed one, the weekday 2–6 days back, the date (`Nov 3`) from a week back.
 *
 * Formatted from the DAY STRING, anchored at UTC and formatted in UTC, never `new Date(day)` in the
 * runtime's zone, which west of UTC is the previous day (`packages/shared/src/day.ts`). The server
 * renders it, so the same string reaches every viewer.
 */
export function lastTimeWhen(viewedDay: string, lastDay: string): string | null {
  const back = isoDayDiff(viewedDay, lastDay);
  if (back <= 1) return null;
  const date = new Date(`${lastDay}T00:00:00Z`);
  return back <= WEEKDAY_RANGE
    ? date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
