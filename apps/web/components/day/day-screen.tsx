'use client';

import type { DayActions, DayPlan } from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Announcer } from '@/components/ui/announcer';

import { DayContext, type DayContextValue } from './day-context';
import { DAY_COPY } from './day-copy';
import { workoutKeyOf } from './use-row';
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

export function DayScreen({ plan, actions }: DayScreenProps) {
  return <DayBody key={`${plan.profilePublicId}/${plan.day}`} plan={plan} actions={actions} />;
}

function DayBody({ plan, actions }: DayScreenProps) {
  const router = useRouter();
  const headingId = useId();
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState(false);
  const [message, setMessage] = useState('');

  const day: DayContextValue = {
    profilePublicId: plan.profilePublicId,
    day: plan.day,
    actions,
    readOnly: !plan.writable || closed,
    // A live region announces a change: the same sentence twice in a row would be silent, so the
    // second one carries an invisible difference.
    announce: (next) => setMessage((was) => (was === next ? `${next} ` : next)),
    setRowFailed: (rowKey, isFailed) =>
      setFailed((was) => {
        if (was.has(rowKey) === isFailed) return was;
        const next = new Set(was);
        if (isFailed) next.add(rowKey);
        else next.delete(rowKey);
        return next;
      }),
    closeDay: () => {
      setClosed(true);
      setMessage(DAY_COPY.closed);
    },
    reload: () => router.refresh(),
  };

  const many = plan.programs.length > 1;
  const programName = (id: string | null) =>
    (many && plan.programs.find((p) => p.programPublicId === id)?.name) || null;
  const notSavedIn = (workoutKey: string) =>
    [...failed].filter((key) => key.startsWith(`${workoutKey}/`)).length;

  return (
    <DayContext value={day}>
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <h2 id={headingId} className="sr-only">
          {DAY_COPY.heading}
        </h2>
        {closed ? <p className="rounded-lg border p-3 text-sm">{DAY_COPY.closed}</p> : null}
        {plan.workouts.map((workout, index) => {
          const key = workoutKeyOf(workout);
          return (
            <WorkoutCard
              key={key}
              workout={workout}
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
