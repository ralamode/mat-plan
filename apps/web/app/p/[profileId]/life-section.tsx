import { ACTIVITY_TYPE_KEYS, PRACTICE_UNIT } from '@mat-plan/shared';

import { CollapsibleSection } from '@/components/day/collapsible-section';
import { LIFE_COPY } from '@/lib/constants';
import { isPracticeEntry, type LoggedLifeActivity } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';
import { lifeActivitiesForKeys } from '@/lib/routine/catalog';

import { PracticeForm } from './life-form';
import { LoggedValueRow } from './logged-value-row';
import { PracticeAmend } from './practice-amend';
import { SingleValueLive } from './single-value-live';

/**
 * The life activities the day page shows: the routine's. The catalog decides: since FAM-1 12f PR 5 it
 * holds no Wake, so a stored `wake` key drops in `lifeActivitiesForKeys` (V1-24 3b-page had filtered it
 * here, because the tap time is not the wake time). The action refuses Wake too: it logs practice only
 * (`logPracticeSchema`). Kept as a function, the one seam for what the Life section shows.
 */
function shownLifeActivities(activityKeys: readonly string[]) {
  return lifeActivitiesForKeys(activityKeys);
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
 *
 * **Every shown item logged when the person arrives folds it to one line** ("Life, Wrestling practice
 * 90 min"; FAM-1 12c-iii, D38), on a day that can be logged.
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
  // The folded line's text, as the prototype's: a check item's label alone, minutes after theirs.
  const summary = rows
    .map((r) => {
      const label = labels.get(r.activityKey)!;
      return r.value === null ? label : `${label} ${formatValueUnit(r.value, r.unit)}`;
    })
    .join(', ');
  // Something logged, on a day that can be logged: the section can fold (12c-iii §5).
  const foldable = writable && rows.length > 0;

  return (
    // Keyed inside on athlete and day, as `BodyweightSection`'s (12c-iii §1). The summary is the
    // line's detail, which wraps: it can hold more than one item.
    <CollapsibleSection
      profileId={profileId}
      day={day}
      headingId="life-heading"
      heading={LIFE_COPY.heading}
      line={foldable ? { detail: summary, count: null } : null}
      finished={foldable && open.length === 0}
    >
      {/* The island in BOTH states, keyed on the day, as `BodyweightSection`'s: its region must exist
          before the log it announces, and paging to a logged day is not a log. */}
      <SingleValueLive key={`live-${day}`}>
        {rows.map((r) => {
          const practice = isPracticeEntry(r) && r.value !== null && r.unit === PRACTICE_UNIT;
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
    </CollapsibleSection>
  );
}
