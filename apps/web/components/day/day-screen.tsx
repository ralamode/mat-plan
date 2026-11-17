'use client';

import { type DayActions, type DayPlan } from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Callout } from '@/components/ui/callout';
import { NAME_WRAP_CLASS, NOTICE_CLASS } from '@/lib/constants';
import { localDayIso } from '@/lib/date';
import { cn } from '@/lib/utils';

import { DayContext, type DayContextValue } from './day-context';
import { DAY_COPY } from './day-copy';
import { nothingLoggedNotice, restNotice } from './day-notices';
import { rowIsIn, workoutKeyOf } from './use-row';
import { WorkoutCard } from './workout-card';

/**
 * One athlete's workouts for one day (FAM-1 lane C; plan §4, §8 "Today", "A ✓ that fails", "A
 * closed day"). Step 13 builds the workout cards and the single rows (Check, Duration, Count) with
 * their ✓; 13b adds set rows and look-ahead, 13d the program line and the notices.
 *
 * **A section of the day page, not the page.** The page keeps its own `<h1>` and composes
 * Bodyweight and Life (lane S's sections) before this one, so the heading here is an `<h2>`,
 * read by a screen reader and not shown, as v12 shows none.
 *
 * A member of `actions` that is `undefined` is an action the route has not wired yet: the screen
 * hides its control (plan §6). `amendRow` and `reorderPrograms` arrive that way, at steps 12d and
 * 15c.
 *
 * **Everything a row remembers is keyed by athlete and day** (`DayBody`'s key): typed text, a
 * failure, an un-tick token. The page moves between days on one mount, and a workout has the same
 * ids every week, so without the key a failure on Monday would show on Tuesday.
 */
export type DayScreenProps = { plan: DayPlan; actions: DayActions };

/**
 * 🔴 **Pins the viewed day in the URL before a write, once the device's day has moved past the
 * page's** (FAM-1 12c; UX panel, all three lenses). On the bare path (`/p/<id>`, no `?d=`) the page
 * renders "today". A ✓ just after local midnight re-renders the page in the action's own response
 * (`revalidatePath`), which would compute the NEW today, remount the screen on it and lose every
 * typed number and failure mid-workout. Pinning AFTER the first write is too late: that write's
 * response is the jump. So the pin goes on just before the send, and only when midnight has passed
 * (the device's local day is not `plan.today`); a tab that never crossed midnight keeps its bare
 * URL, so tomorrow morning it opens on tomorrow. `replaceState` is synced into Next's router, so no
 * navigation happens. ⚠️ Unverified until 12c's e2e: that a Server Action's revalidated render
 * reads the replaced URL.
 */
export function pinDayBeforeWrite(plan: Pick<DayPlan, 'day' | 'today'>): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.has('d')) return;
  const deviceToday = localDayIso(Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (deviceToday === plan.today) return;
  url.searchParams.set('d', plan.day);
  window.history.replaceState(null, '', url);
}

/** Each of the screen's writes, pinning the day first (`pinDayBeforeWrite`). */
function pinned(actions: DayActions, plan: Pick<DayPlan, 'day' | 'today'>): DayActions {
  const pin = () => pinDayBeforeWrite(plan);
  return {
    logRow: (input) => (pin(), actions.logRow(input)),
    untickRow: (input) => (pin(), actions.untickRow(input)),
    retickRow: (input) => (pin(), actions.retickRow(input)),
    ...(actions.amendRow ? { amendRow: (input) => (pin(), actions.amendRow!(input)) } : {}),
    ...(actions.reorderPrograms ? { reorderPrograms: actions.reorderPrograms } : {}),
  };
}

export function DayScreen({ plan, actions }: DayScreenProps) {
  return <DayBody key={`${plan.profilePublicId}/${plan.day}`} plan={plan} actions={actions} />;
}

function DayBody({ plan, actions }: DayScreenProps) {
  const router = useRouter();
  const headingId = useId();
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState(false);
  const [message, setMessage] = useState('');
  const closedRef = useRef<HTMLDivElement>(null);

  // A row's effect depends on this, so it keeps one identity for the life of the day.
  const setRowFailed = useCallback(
    (rowKey: string, isFailed: boolean) =>
      setFailed((was) => {
        if (was.has(rowKey) === isFailed) return was;
        const next = new Set(was);
        if (isFailed) next.add(rowKey);
        else next.delete(rowKey);
        return next;
      }),
    [],
  );

  // The ✓ that met `closed_day` is gone, so focus would drop to the page: it goes to the notice.
  useEffect(() => {
    if (closed) closedRef.current?.focus();
  }, [closed]);

  // One object per change of what it holds. With the cards memoised, an announce or a failure
  // re-renders this section and the cards whose props changed, not every row (13b brings dozens).
  const readOnly = !plan.writable || closed;
  const { day: viewedDay, today } = plan;
  const day: DayContextValue = useMemo(
    () => ({
      profilePublicId: plan.profilePublicId,
      day: viewedDay,
      actions: pinned(actions, { day: viewedDay, today }),
      readOnly,
      // A live region announces a change: the same sentence twice in a row would be silent, so
      // the second one carries a no-break space (U+00A0), which is not collapsed as a space is.
      announce: (next) => setMessage((was) => (was === next ? `${next}\u00a0` : next)),
      setRowFailed,
      // The notice takes focus, which reads it; the live region would say it a second time.
      closeDay: () => setClosed(true),
      // A reload after midnight would show the new today: the day is pinned first (a `closed_day`
      // two midnights on reloads too, UX panel 12c).
      reload: () => {
        pinDayBeforeWrite({ day: viewedDay, today });
        router.refresh();
      },
    }),
    [plan.profilePublicId, viewedDay, today, actions, readOnly, setRowFailed, router],
  );

  const many = plan.programs.length > 1;
  const rest = restNotice(plan);
  const nothingLogged = nothingLoggedNotice(plan);
  const programName = (id: string | null) =>
    (many && plan.programs.find((p) => p.programPublicId === id)?.name) || null;
  const notSavedIn = (workoutKey: string) =>
    [...failed].filter((key) => rowIsIn(workoutKey, key)).length;

  return (
    <DayContext value={day}>
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <h2 id={headingId} className="sr-only">
          {DAY_COPY.heading}
        </h2>
        {closed ? (
          <Callout ref={closedRef} messageId={`${headingId}-closed`} message={DAY_COPY.closed} />
        ) : null}
        {rest ? (
          <p
            className={cn(
              rest.allRest ? NOTICE_CLASS : 'text-muted-foreground text-sm',
              NAME_WRAP_CLASS,
            )}
          >
            {rest.text}
          </p>
        ) : null}
        {/* The notice box, as the all-rest line: it is then the only thing in the section. */}
        {nothingLogged ? <p className={NOTICE_CLASS}>{nothingLogged}</p> : null}
        {plan.workouts.map((workout, index) => {
          const key = workoutKeyOf(workout, index);
          return (
            <WorkoutCard
              key={key}
              workout={workout}
              workoutKey={key}
              future={plan.future}
              headingId={`${headingId}-w${index}`}
              programName={programName(workout.programPublicId)}
              notSaved={notSavedIn(key)}
            />
          );
        })}
        <Announcer message={message} />
      </section>
    </DayContext>
  );
}
