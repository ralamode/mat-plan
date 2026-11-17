import { inWritableWindow } from '@mat-plan/shared';

/**
 * **Is this day open for writing, for this athlete?** Inside the writable window (today and
 * yesterday, never a day after today: `inWritableWindow`, D32) AND not archived. One rule, lane E's
 * (FAM-1 12a, R1): the row writer refuses `closed_day` where it is false (`writers/day/log-row.ts`
 * → `openRowDay`), and the day resolver's `writable` is it (`./day-plan.ts`), so the page offers a
 * ✓ exactly where the writer takes one.
 *
 * `archivedAt` is the profile's `archived_at`; the caller has read it inside the scope.
 */
export function rowDayOpen(day: string, today: string, archivedAt: Date | null): boolean {
  return archivedAt === null && inWritableWindow(day, today);
}
