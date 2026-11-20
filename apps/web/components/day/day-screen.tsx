'use client';

import { isoDayDiff, type DayActions, type DayPlan } from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Callout } from '@/components/ui/callout';
import { NAME_WRAP_CLASS, NOTICE_CLASS } from '@/lib/constants';
import { deviceToday } from '@/lib/date';
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
 * hides its control (plan §6). `amendRow` arrived at step 12d, `reorderPrograms` at 15c.
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
 * (the device's local day is after `plan.today`); a tab that never crossed midnight keeps its bare
 * URL, so tomorrow morning it opens on tomorrow. `replaceState` is synced into Next's router, so no
 * navigation happens, and a Server Action's revalidated render reads the replaced URL
 * (`e2e/day-page.spec.ts`, the PROBE test). ⚠️ The first argument must stay `null`: Next syncs its
 * router only for a call that does not carry its own `__NA` state
 * (`next/dist/client/components/app-router.js`), so passing `window.history.state` would skip the sync.
 */
export function pinDayBeforeWrite(plan: Pick<DayPlan, 'day' | 'today'>): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  // Already names the day shown. Any other `?d=` (a malformed one, or a future day the page
  // replaced with today) would re-resolve to another day after midnight, so it is replaced too.
  if (url.searchParams.get('d') === plan.day) return;
  // Only once midnight has PASSED: a device behind the page's zone (a first visit on the fallback
  // zone, a trip) would otherwise pin a day that is about to be the past or the future.
  if (isoDayDiff(deviceToday(), plan.today) <= 0) return;
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

/**
 * How long after an announcement a second one joins it rather than replacing it: long enough for a
 * write's answer and the refresh it brings, short enough that unrelated taps are read on their own.
 */
export const ANNOUNCE_TOGETHER_MS = 1500;

function DayBody({ plan, actions }: DayScreenProps) {
  const router = useRouter();
  const headingId = useId();
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState(false);
  // `n` counts announcements: each one is a new node in the live region, so the same sentence twice
  // in a row is read twice (`Announcer`'s `messageKey`).
  const [message, setMessage] = useState({ text: '', n: 0 });
  const groupStarted = useRef(-Infinity);
  const closedRef = useRef<HTMLDivElement>(null);

  // A row's effect depends on these, so each keeps one identity for the life of the day.
  const setRowFailed = useCallback(
    (rowKey: string, isFailed: boolean) => setFailed((was) => toggled(was, rowKey, isFailed)),
    [],
  );
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const setRowPending = useCallback(
    (rowKey: string, isPending: boolean) => setInFlight((was) => toggled(was, rowKey, isPending)),
    [],
  );
  // 12c-iii: work typed or added but not saved, which "Collapse" must never hide.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const setRowBusy = useCallback(
    (rowKey: string, isBusy: boolean) => setBusy((was) => toggled(was, rowKey, isBusy)),
    [],
  );

  // 🔴 **A ✓ still waiting to send is lost if the page is left** (FAM-1 12c; maintainer,
  // 2026-11-17: "Warn + record"). The browser's own leave-page prompt, while any write is in flight.
  // ⚠️ iOS Safari ignores `beforeunload`, and switching athlete is an in-app navigation, which no
  // prompt covers: a write that fails after the screen has gone is not reported, and the row reads
  // un-ticked when the athlete is opened again (recorded in the day-page guide).
  const writing = inFlight.size > 0;
  useEffect(() => {
    if (!writing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers before Chrome 119 ask only when this is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [writing]);

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
      // Two close together (a ✓ here, and another phone's change in the refresh it brings, a few
      // tasks apart) are both said, in order: within `ANNOUNCE_TOGETHER_MS` of the first, a call
      // appends instead of replacing. Measured from the group's first, so a run never grows it.
      announce: (text) => {
        const now = performance.now();
        const together = now - groupStarted.current < ANNOUNCE_TOGETHER_MS;
        if (!together) groupStarted.current = now;
        // The same sentence again (a ✓ that fails twice) is said again, never doubled in one line.
        setMessage((was) => ({
          text: together && !was.text.endsWith(text) ? `${was.text} ${text}` : text,
          n: was.n + 1,
        }));
      },
      setRowFailed,
      setRowPending,
      setRowBusy,
      // The notice takes focus, which reads it; the live region would say it a second time.
      closeDay: () => setClosed(true),
      // A reload after midnight would show the new today: the day is pinned first (a `closed_day`
      // two midnights on reloads too, UX panel 12c).
      reload: () => {
        pinDayBeforeWrite({ day: viewedDay, today });
        router.refresh();
      },
    }),
    [
      plan.profilePublicId,
      viewedDay,
      today,
      actions,
      readOnly,
      setRowFailed,
      setRowPending,
      setRowBusy,
      router,
    ],
  );

  const many = plan.programs.length > 1;
  const rest = restNotice(plan);
  const nothingLogged = nothingLoggedNotice(plan);
  const programName = (id: string | null) =>
    (many && plan.programs.find((p) => p.programPublicId === id)?.name) || null;
  const notSavedIn = (workoutKey: string) =>
    [...failed].filter((key) => rowIsIn(workoutKey, key)).length;
  // A write in flight, a Change typed and not saved, or an added set not ticked (12c-iii §4).
  const busyIn = (workoutKey: string) =>
    [...inFlight, ...busy].some((key) => rowIsIn(workoutKey, key));

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
              busy={busyIn(key)}
            />
          );
        })}
        <Announcer message={message.text} messageKey={message.n} />
      </section>
    </DayContext>
  );
}

/** `was` with `key` in it or not, the same set when nothing changes (so no re-render). */
function toggled(was: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  if (was.has(key) === on) return was;
  const next = new Set(was);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}
