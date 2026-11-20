import type { DayPlan } from '@mat-plan/shared';

import type { EntryDTO } from '@/lib/dal/entries';

import { isPracticeEntry, loggedBodyweight } from './activity-totals';

/**
 * What Clear this day's dialog names (V1-9b B2-ii): counts only, never a value.
 *
 * - `workouts`: each workout with logged rows on the day, by the name the page shows, with how many
 *   of its rows are logged (sets and checks together, one count: FAM-1 plan § B2).
 * - `weighIns`, `practices`: the Bodyweight and Life sections' rows.
 * - `other`: every live entry the page does not show (an older strength session, a check-in).
 * - `total`: every live entry, the sum of the above.
 */
export type ClearDaySummary = {
  workouts: { name: string; count: number }[];
  weighIns: number;
  practices: number;
  other: number;
  total: number;
};

/**
 * The dialog's summary, derived from the page's own two reads, so it costs no query (plan § B2 as
 * amended, P1).
 *
 * 🔴 **It sums to `entries.length` by construction**, and `entries` is `listEntriesForDay`: every
 * live entry of the athlete's day, the same set `clearDay` locks and hides. A program row the
 * resolver could not place (it drops a foreign session's row, for one) is not in `plan`, so it falls
 * to `other`: counted, never named. A plan row whose entry is absent from `entries` counts nowhere.
 *
 * The numbers are the page's, read at render; the clear hides what is live at confirm. A row ticked
 * on another phone in between is hidden without being named here (an accepted risk; the banner's
 * count is the truth).
 */
export function clearDaySummary(plan: DayPlan, entries: readonly EntryDTO[]): ClearDaySummary {
  const live = new Set(entries.map((e) => e.id));
  const named = new Set<string>();
  const workouts: ClearDaySummary['workouts'] = [];
  for (const workout of plan.workouts) {
    let count = 0;
    for (const item of workout.items) {
      for (const row of item.rows) {
        const id = row.logged?.entryPublicId;
        if (id && live.has(id) && !named.has(id)) {
          named.add(id);
          count += 1;
        }
      }
    }
    if (count > 0) workouts.push({ name: workout.name, count });
  }

  const rest = entries.filter((e) => !named.has(e.id));
  const weighIns = new Set(loggedBodyweight(rest).map((b) => b.entryId));
  const practices = rest.filter((e) => !weighIns.has(e.id) && isPracticeEntry(e)).length;
  const other = rest.length - weighIns.size - practices;
  return { workouts, weighIns: weighIns.size, practices, other, total: entries.length };
}
