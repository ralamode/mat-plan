import { CollapsibleSection } from '@/components/day/collapsible-section';
import { BODYWEIGHT_COPY } from '@/lib/constants';
import type { LastBodyweightDTO } from '@/lib/dal/entries';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';
import { lastTimeWhen } from '@/lib/entries/last-time';

import { BodyweightAmend } from './bodyweight-amend';
import { BodyweightForm } from './bodyweight-form';
import { BodyweightReceipt, formatLoggedWeights } from './bodyweight-receipt';
import { SingleValueLive } from './single-value-live';

/**
 * The weigh-in section of the day page (V1-24 PR 1a; the prototype's row since 3b-bw): the ✓ row on a
 * writable day with nothing logged, the logged row otherwise. Extracted from `page.tsx` so the state
 * switch, and the day keys that make it safe across a day change, are unit-testable
 * (`bodyweight-section.test.tsx`).
 *
 * ⚠️ **The logged row renders OUTSIDE the `writable` gate, deliberately.** A read-only day can still
 * be READ, and the day's truth must show on every day.
 *
 * ⚠️ **And when a weight IS logged the form is not rendered at all.** An empty input over an existing
 * record is what invited the duplicate row. Since PR 1d the database forbids a second live weigh-in
 * per (profile, day, slot) too; a two-phone race gets the typed "already logged" envelope. The row
 * still lists every row: a pre-1d day and V1-32's slots both render as more than one.
 *
 * **One weight, logged when the person arrives, folds to one line** ("Bodyweight, 84.5 lb"; FAM-1
 * 12c-iii, D38), on a day that can be logged. Two or more stay open: the receipt asks a parent.
 */
export function BodyweightSection({
  profileId,
  day,
  writable,
  amendable,
  logged,
  last,
}: {
  profileId: string;
  day: string;
  writable: boolean;
  /**
   * Whether a logged weight offers Change: today and yesterday (V1-24 3b-page). Its own flag
   * because `writable` also folds in archive, and an archived athlete's logged weight stays
   * correctable on those two days (but not clearable, `canClear` below).
   */
  amendable: boolean;
  logged: readonly LoggedBodyweight[];
  /** The "Last time" weigh-in. The page reads it only when the ✓ row renders. */
  last: LastBodyweightDTO | null;
}) {
  const lastTime = last
    ? BODYWEIGHT_COPY.lastTime(formatValueUnit(last.value, last.unit), lastTimeWhen(day, last.day))
    : null;
  const foldable = writable && logged.length === 1;

  return (
    // Keyed on athlete and day: the page does not remount on a change of day, and a new day is a new
    // visit (12c-iii §1).
    <CollapsibleSection
      key={`fold-${profileId}/${day}`}
      headingId="log-bw-heading"
      heading={BODYWEIGHT_COPY.heading}
      summary={foldable ? formatLoggedWeights(logged)[0]! : null}
      finished={foldable}
    >
      {/* The live region and the focus hand-off, mounted in BOTH states, so it outlives the form or
          row that reports to it. Keyed on the day: a message or a focus claim never crosses to
          another day, and paging to a day that already has a weight announces nothing.
          ⚠️ The keys below are PREFIXED: siblings sharing a bare `key={day}` keep a stale node. */}
      <SingleValueLive key={`live-${day}`}>
        {logged.length === 0 && writable ? (
          // ⚠️ The day key is load-bearing. Day navigation is a client-side RSC transition, so
          // without it this form survives a day change with its `useState(newId)` client id, and a
          // key already sent for one day is replayed for another: an `ON CONFLICT DO NOTHING` no-op
          // that reports success and saves nothing. It also unmounts while a value shows, so
          // re-entering after a clear mounts a fresh key.
          <BodyweightForm
            key={`form-${day}`}
            profileId={profileId}
            day={day}
            lastTime={lastTime}
            initialUnit={last?.unit}
          />
        ) : (
          <BodyweightReceipt
            logged={logged}
            // Only on a day that can still be changed (`amendable`), and only for ONE row: duplicates
            // render as a single line, and an amend addresses ONE entryId, so a lone Change there
            // would edit an unstated one of them.
            control={
              amendable && logged.length === 1 ? (
                // ⚠️ Keyed on the ENTRY: an unkeyed island would survive a day change with day A's
                // typed value while its hidden entryId/seenValue re-rendered to day B's.
                <BodyweightAmend
                  key={`amend-${logged[0]!.entryId}`}
                  profileId={profileId}
                  logged={logged[0]!}
                  canClear={writable}
                />
              ) : undefined
            }
          />
        )}
      </SingleValueLive>
    </CollapsibleSection>
  );
}
