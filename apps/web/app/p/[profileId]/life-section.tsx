import { ACTIVITY_TYPE_KEYS, PRACTICE_UNIT } from '@mat-plan/shared';

import { LIFE_COPY } from '@/lib/constants';
import type { LoggedLifeActivity } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';
import { lifeActivitiesForKeys } from '@/lib/routine/catalog';

import { PracticeForm } from './life-form';
import { LoggedValueRow } from './logged-value-row';
import { PracticeAmend } from './practice-amend';
import { SingleValueLive } from './single-value-live';

/**
 * The life activities the day page shows: the routine's, minus Wake (V1-24 3b-page). The tap time is
 * not the wake time, so Wake leaves the page, and since 3b-life-b the action refuses it too.
 */
function shownLifeActivities(activityKeys: readonly string[]) {
  return lifeActivitiesForKeys(activityKeys).filter((a) => a.key !== ACTIVITY_TYPE_KEYS.wake);
}

/**
 * The Life section of the day page (V1-24 3b-page), the twin of `BodyweightSection`: a server
 * component, so its states are unit-testable where the async page is not.
 *
 * - **Logged:** one row per entry in the done style (`LoggedValueRow`), on every day: the label, its
 *   value on a second line (one line does not fit 360px, plan A1), and **Change** for a practice on
 *   a day that can still be changed (V1-24 3b-life A1). One live practice per day (3b-0's index).
 * - **Not logged, writable:** the typed-minutes practice row (`PracticeForm`, 3b-life-b).
 * - **Not logged, read-only:** `Nothing logged.`, never a bare heading.
 *
 * Renders nothing when the routine has no activity to show.
 */
export function LifeSection({
  profileId,
  day,
  writable,
  amendable,
  activityKeys,
  logged,
}: {
  profileId: string;
  day: string;
  writable: boolean;
  /** Today or yesterday (`dayPageFlags`): a practice's Change shows. Folds in nothing about archive. */
  amendable: boolean;
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

  return (
    <section aria-labelledby="life-heading" className="flex flex-col gap-3">
      <h2 id="life-heading" className="text-lg font-medium">
        {LIFE_COPY.heading}
      </h2>
      {/* The island in BOTH states, keyed on the day, as `BodyweightSection`'s: its region must exist
          before the log it announces, and paging to a logged day is not a log. */}
      <SingleValueLive key={`live-${day}`}>
        {rows.map((r) => {
          const practice =
            r.activityKey === ACTIVITY_TYPE_KEYS.wrestling_practice &&
            r.value !== null &&
            r.unit === PRACTICE_UNIT;
          return (
            <LoggedValueRow
              key={r.entryId}
              control={
                practice && amendable ? (
                  <PracticeAmend
                    profileId={profileId}
                    logged={{ entryId: r.entryId, minutes: r.value! }}
                    canClear={writable}
                  />
                ) : null
              }
            >
              <span className="flex flex-col">
                <span>{labels.get(r.activityKey)}</span>
                {r.value === null ? null : <span>{formatValueUnit(r.value, r.unit)}</span>}
              </span>
            </LoggedValueRow>
          );
        })}
        {/* Practice is the one loggable life activity (3b-life-b B6); keyed on the day, so a day
            change mounts a fresh form with a fresh client id. */}
        {writable && open.some((a) => a.key === ACTIVITY_TYPE_KEYS.wrestling_practice) ? (
          <PracticeForm key={`form-${day}`} profileId={profileId} day={day} />
        ) : null}
        {!writable && rows.length === 0 ? (
          <p className="text-muted-foreground text-base">{LIFE_COPY.noneOnClosedDay}</p>
        ) : null}
      </SingleValueLive>
    </section>
  );
}
