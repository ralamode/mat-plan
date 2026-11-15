import { ACTIVITY_TYPE_KEYS } from '@mat-plan/shared';

import { LIFE_COPY, LIFE_LOGGED_ID } from '@/lib/constants';
import type { LoggedLifeActivity } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';
import { lifeActivitiesForKeys } from '@/lib/routine/catalog';

import { LifeForm } from './life-form';
import { SavedAnnouncer } from './saved-announcer';

/**
 * The life activities the day page shows: the routine's, minus Wake (V1-24 3b-page). The tap time is
 * not the wake time, so Wake leaves the page; the action still accepts it until 3b-life.
 */
export function shownLifeActivities(activityKeys: readonly string[]) {
  return lifeActivitiesForKeys(activityKeys).filter((a) => a.key !== ACTIVITY_TYPE_KEYS.wake);
}

/**
 * The Life section of the day page (V1-24 3b-page), the twin of `BodyweightSection`: a server
 * component, so its states are unit-testable where the async page is not.
 *
 * - **Logged:** one row per entry, with its value, on every day. A list, because nothing forbids
 *   two practices on one day until 3b-0's index.
 * - **Not logged, writable:** the one-tap button (`LifeForm`).
 * - **Not logged, read-only:** `Nothing logged.`, never a bare heading.
 *
 * Renders nothing when the routine has no activity to show.
 */
export function LifeSection({
  profileId,
  day,
  writable,
  activityKeys,
  logged,
}: {
  profileId: string;
  day: string;
  writable: boolean;
  /** The routine's life keys, in routine order. */
  activityKeys: readonly string[];
  /** The day's entries for those keys (`loggedLifeActivities`). */
  logged: readonly LoggedLifeActivity[];
}) {
  const activities = shownLifeActivities(activityKeys);
  if (activities.length === 0) return null;

  const labels = new Map<string, string>(activities.map((a) => [a.key, a.label]));
  const rows = logged.filter((l) => labels.has(l.activityKey));
  const open = activities.filter((a) => !rows.some((r) => r.activityKey === a.key));
  const announcement =
    rows.length > 0
      ? [...new Set(rows.map((r) => LIFE_COPY.announced(labels.get(r.activityKey)!)))].join('. ')
      : null;

  return (
    <section aria-labelledby="life-heading" className="flex flex-col gap-3">
      <h2 id="life-heading" className="text-lg font-medium">
        {LIFE_COPY.heading}
      </h2>
      {/* In BOTH states and keyed on the day, for the reasons `BodyweightSection` gives: the region
          must exist before the log it announces, and paging to a logged day is not a log. */}
      <SavedAnnouncer key={`announcer-${day}`} saved={announcement} focusId={LIFE_LOGGED_ID} />
      {rows.length > 0 ? (
        <ul
          id={LIFE_LOGGED_ID}
          // Focusable by script only: the button that held focus unmounts on a log.
          tabIndex={-1}
          className="focus-visible:ring-ring/50 flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-3"
        >
          {rows.map((r) => (
            <li
              key={r.entryId}
              className="flex min-h-11 items-center rounded-lg border px-4 py-3 text-base font-medium tabular-nums"
            >
              {LIFE_COPY.logged(
                labels.get(r.activityKey)!,
                r.value === null ? null : formatValueUnit(r.value, r.unit),
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {writable && open.length > 0 ? (
        <LifeForm profileId={profileId} day={day} activities={open} />
      ) : null}
      {!writable && rows.length === 0 ? (
        <p className="text-muted-foreground text-base">{LIFE_COPY.noneOnClosedDay}</p>
      ) : null}
    </section>
  );
}
