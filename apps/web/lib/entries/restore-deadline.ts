import { addDays, inWritableWindow, WRITABLE_DAY_RADIUS } from '@mat-plan/shared';

/** The last day Restore all is offered for a clear, relative to today, in words the copy maps. */
export const RESTORE_DEADLINE = { today: 'today', tomorrow: 'tomorrow' } as const;
export type RestoreDeadline = (typeof RESTORE_DEADLINE)[keyof typeof RESTORE_DEADLINE];

/**
 * Until when a clear of `day` can be restored, seen from `today` (V1-9b B2-ii): Restore all is open
 * while the day is inside the writable window (`dayOpenFor`), so its last day is `day` plus
 * `WRITABLE_DAY_RADIUS`. Relative words, never a date: "until the end of tomorrow" cannot be misread
 * as the start of a day.
 *
 * - `'tomorrow'`: a clear of today.
 * - `'today'`: a clear of yesterday, seen today.
 * - `null`: the window has closed, or `day` is after today (nothing to restore there).
 *
 * From the window's radius: the copy has words for today and tomorrow only, so a wider radius would
 * answer `null` for the far days until the copy gains words for them (the test pins radius 1).
 */
export function restoreDeadline(day: string, today: string): RestoreDeadline | null {
  // The window's own rule first, so this can never disagree with `dayOpenFor` about whether the day
  // is still open; the radius only names how long is left.
  if (!inWritableWindow(day, today)) return null;
  const last = addDays(day, WRITABLE_DAY_RADIUS);
  if (last === today) return RESTORE_DEADLINE.today;
  if (last === addDays(today, 1)) return RESTORE_DEADLINE.tomorrow;
  return null;
}
