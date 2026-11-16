'use client';

import { NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { DAY_COPY } from './day-copy';
import { ItemCard } from './item-card';
import type { DayWorkout } from './row-values';
import { itemKeyOf } from './use-row';

/**
 * One workout of the day (FAM-1 step 13; v12's "Morning habits" card).
 *
 * The slot line names the label and, when the athlete is on more than one program that day, the
 * program (plain text: the program page is lane B's and not wired yet). The progress reads
 * "2 of 10", "Done ✓" when every row is logged, and **nothing when the workout has no rows to
 * count** (plan §4 "As built": `total` 0 never reads as done). "1 not saved" stays beside it while a
 * row's save has failed, so a failure that scrolled out of sight is still seen.
 */
export function WorkoutCard({
  workout,
  workoutKey,
  headingId,
  programName,
  notSaved,
}: {
  workout: DayWorkout;
  workoutKey: string;
  headingId: string;
  programName: string | null;
  notSaved: number;
}) {
  const { done, total } = workout.progress;
  const progress =
    total === 0 ? null : done >= total ? DAY_COPY.doneMark : DAY_COPY.progress(done, total);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 border-t pt-4">
      {workout.label || programName ? (
        <p className="text-muted-foreground flex flex-wrap justify-between gap-x-3 text-xs font-medium tracking-wide">
          <span className={cn('uppercase', NAME_WRAP_CLASS)}>{workout.label}</span>
          {programName ? <span className={NAME_WRAP_CLASS}>{programName}</span> : null}
        </p>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id={headingId} className={cn('text-lg font-semibold', NAME_WRAP_CLASS)}>
          {workout.name}
        </h3>
        {progress || notSaved > 0 ? (
          <p className="text-muted-foreground text-sm">
            {progress}
            {notSaved > 0 ? (
              <>
                {progress ? <span aria-hidden="true"> · </span> : null}
                <span className="text-destructive">{DAY_COPY.notSaved(notSaved)}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {workout.description ? (
        <p className={cn('text-muted-foreground text-sm', NAME_WRAP_CLASS)}>
          {workout.description}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {workout.items.map((item) => (
          <ItemCard key={itemKeyOf(item)} workout={workout} workoutKey={workoutKey} item={item} />
        ))}
      </ul>
    </section>
  );
}
