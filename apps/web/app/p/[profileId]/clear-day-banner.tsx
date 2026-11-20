'use client';

import type { ClearEvent } from '@mat-plan/shared';
import { useEffect, useRef, useState } from 'react';

import { pinDayBeforeWrite } from '@/components/day/day-screen';
import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { expire, take } from '@/lib/a11y/focus-handoff';
import {
  CLEAR_DAY_COPY,
  CLEAR_DAY_OUTCOME_ID,
  FOCUS_TARGET_CLASS,
  NOTICE_CLASS,
  RESTORE_ALL_ID,
} from '@/lib/constants';
import type { RestoreDeadline } from '@/lib/entries/restore-deadline';
import { cn } from '@/lib/utils';

import { restoreClearAction } from './clear-day-actions';
import { clearDayKey, onClearOutcome } from './clear-day-outcome';

/** What Restore all's answer says, in "hidden" words (B1-2 requirement 1). */
function restoredText(restored: number, keptHidden: number, older: number): string {
  if (restored === 0 && keptHidden === 0) return CLEAR_DAY_COPY.nothingToRestore;
  if (restored === 0) return CLEAR_DAY_COPY.restoredNone;
  if (keptHidden > 0) return CLEAR_DAY_COPY.restoredSome(restored, keptHidden);
  // "Day restored." would be false while an older clear still hides entries.
  if (older > 0) return CLEAR_DAY_COPY.restoredOlderLeft(restored, older);
  return CLEAR_DAY_COPY.restored;
}

/**
 * **The day's clears, and Restore all** (V1-9b B2-ii; plan § "B2 as amended"), above the program line.
 *
 * 🔴 **Mounted on every day**, keyed by athlete and day by the page, with `events` possibly empty: it
 * always renders the **outcome line** (`CLEAR_DAY_OUTCOME_ID`, focusable, visible, mounted empty),
 * the one focus target for every outcome. A full restore removes the event and the banner row with
 * it; the line survives, so the result is seen and heard.
 *
 * - **Restore all is on the newest clear only** (maintainer, 2026-11-19): restoring an older clear
 *   first could bring back an older weigh-in and strand the newer one. Older clears show as a count
 *   and become the banner once the newest is restored, when focus moves to their Restore all.
 * - **The button says what it restores**: "Restore all" when it brings back every hidden entry,
 *   "Restore n entries" when an older clear or a day logged again since makes "all" untrue.
 * - **Only on a day open for Restore all** (`writable`: today or yesterday, not archived). A closed
 *   or archived day's clear is a sentence in the page's one notice box instead.
 */
export function ClearDayBanner({
  profileId,
  day,
  today,
  events,
  writable,
  relogged,
  deadline,
}: {
  profileId: string;
  day: string;
  today: string;
  /** The day's clears, newest first (`dayClearEvents`). */
  events: readonly ClearEvent[];
  writable: boolean;
  /** The day has live entries since the clear: "all" is no longer every entry the day holds. */
  relogged: boolean;
  deadline: RestoreDeadline | null;
}) {
  const key = clearDayKey(profileId, day);
  const [outcome, setOutcome] = useState('');
  const [pending, setPending] = useState(false);
  const outcomeLine = useRef<HTMLDivElement>(null);
  const newest = events[0];
  const older = events.slice(1).reduce((sum, e) => sum + e.count, 0);

  // The dialog at the foot reports here.
  useEffect(() => onClearOutcome(key, setOutcome), [key]);
  // A NEWER clear clears an old report, adjusted during render rather than in an effect (React's
  // "storing information from previous renders"). Only newer: a restore that exposes an older clear
  // changes the newest token too, and must not wipe the line it just wrote. Tokens are fixed-format
  // six-digit UTC text (plan Decision 2), so string order is time order.
  const newestToken = newest?.hiddenAt;
  const [seenToken, setSeenToken] = useState(newestToken);
  if (newestToken !== seenToken) {
    setSeenToken(newestToken);
    if (newestToken && (seenToken === undefined || newestToken > seenToken)) setOutcome('');
  }
  useEffect(() => () => expire(key), [key]);

  async function restore(event: ClearEvent) {
    if (pending) return;
    pinDayBeforeWrite({ day, today });
    setPending(true);
    let text: string;
    let olderLeft = false;
    try {
      const result = await restoreClearAction({
        profilePublicId: profileId,
        day,
        hiddenAt: event.hiddenAt,
      });
      if (result.ok) {
        text = restoredText(result.restored, result.keptHidden, older);
        olderLeft = older > 0;
      } else {
        text = CLEAR_DAY_COPY.refused[result.reason];
      }
    } catch {
      text = CLEAR_DAY_COPY.failed;
    }
    setPending(false);
    setOutcome(text);
    // B1-2 requirement 4. An older clear left: its Restore all is this same button, which keeps focus.
    // Otherwise the outcome line, focused directly: it is in this island and always mounted, so no
    // hand-off is needed (a claim would be dropped while the tapped button holds focus).
    if (!olderLeft) outcomeLine.current?.focus();
  }

  const showBanner = writable && newest !== undefined && deadline !== null;
  const all = !relogged && older === 0;
  return (
    // `contents`: on a day with no clear and no outcome this adds no box and no gap to the page.
    <div className="contents">
      {showBanner ? (
        <section className={cn(NOTICE_CLASS, 'flex flex-col gap-3 sm:flex-row sm:items-center')}>
          <div id={`${CLEAR_DAY_OUTCOME_ID}-banner`} className="min-w-0 flex-1">
            <p>
              {relogged
                ? CLEAR_DAY_COPY.bannerRelogged(newest.count, CLEAR_DAY_COPY.deadline[deadline])
                : CLEAR_DAY_COPY.banner(newest.count, CLEAR_DAY_COPY.deadline[deadline])}
            </p>
            {older ? <p>{CLEAR_DAY_COPY.earlier(older)}</p> : null}
          </div>
          <Button
            id={RESTORE_ALL_ID}
            ref={(node) => take(key, node)}
            type="button"
            variant="outline"
            className="h-auto min-h-11 shrink-0 whitespace-normal"
            aria-describedby={`${CLEAR_DAY_OUTCOME_ID}-banner`}
            aria-disabled={pending || undefined}
            onClick={() => void restore(newest)}
          >
            {pending
              ? CLEAR_DAY_COPY.restoring
              : all
                ? CLEAR_DAY_COPY.restoreAll
                : CLEAR_DAY_COPY.restoreN(newest.count)}
          </Button>
        </section>
      ) : null}
      <div
        id={CLEAR_DAY_OUTCOME_ID}
        ref={(node) => {
          outcomeLine.current = node;
          take(key, node);
        }}
        tabIndex={-1}
        // Visible once it says something; `sr-only` while empty, so it takes no space but is mounted
        // (a live region must exist before its message) and focusable.
        className={cn('rounded-sm text-sm', FOCUS_TARGET_CLASS, outcome ? '' : 'sr-only')}
      >
        <Announcer message={outcome} className="" />
      </div>
    </div>
  );
}
