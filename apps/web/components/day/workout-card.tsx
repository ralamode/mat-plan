'use client';

import { supersetLabels, type DayItem, type DayWorkout } from '@mat-plan/shared';
import { memo, useState } from 'react';

import { itemCountText, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { DAY_COPY } from './day-copy';
import { ItemCard } from './item-card';
import { useDay } from './day-context';
import { itemKeyOf } from './use-row';

/**
 * One workout of the day (FAM-1 step 13; v12's "Morning habits" card).
 *
 * The slot line names the label and, when the athlete is on more than one program that day, the
 * program (plain text: the program page is lane B's and not wired yet). The progress reads
 * "2 of 10", "Done ✓" when every row is logged, and **nothing when the workout has no rows to
 * count** (plan §4 "As built": `total` 0 never reads as done). "1 not saved" stays beside it while a
 * row's save has failed, so a failure that scrolled out of sight is still seen. On a look-ahead day,
 * where nothing can be logged, the line says the workout's size instead ("6 items", as v12).
 *
 * **Supersets** (13b): neighbouring items of one group sit together under "Superset A", with each
 * item's ordinal label (A1, A2: `supersetLabels`, the contract's rule) and the group's rest after
 * them.
 */
export const WorkoutCard = memo(function WorkoutCard({
  workout,
  workoutKey,
  headingId,
  programName,
  notSaved,
  future,
}: {
  workout: DayWorkout;
  workoutKey: string;
  headingId: string;
  programName: string | null;
  notSaved: number;
  future: boolean;
}) {
  const { done, total } = workout.progress;
  const progress = future
    ? itemCountText(workout.items.length)
    : total === 0
      ? null
      : done >= total
        ? DAY_COPY.doneMark
        : DAY_COPY.progress(done, total);
  const items = useItemsShownThisVisit(workout);
  const labels = supersetLabels(items);
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
        {groupsOf(items).map((group) => {
          const cards = group.map(({ item, index }) => (
            <ItemCard
              key={itemKeyOf(item)}
              workout={workout}
              workoutKey={workoutKey}
              item={item}
              label={labels[index] ?? null}
            />
          ));
          const superset = group[0]!.item.superset;
          // A group of one (only one of its items shown, on a closed day) keeps its container and
          // its rest line, as v12 does, so its label is never unexplained.
          if (!superset) return cards;
          const letter = supersetLetterOf(labels[group[0]!.index] ?? '');
          const rest = workout.restAfter[superset.group];
          return (
            // Keyed by its first item: a group whose items are not neighbours shows as two runs, and
            // an item added above it must not remount it (typed text and un-tick tokens live inside).
            <li
              key={`superset:${itemKeyOf(group[0]!.item)}`}
              className="border-primary border-l-2 pl-3"
            >
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                {DAY_COPY.superset(letter)}
              </p>
              <ul aria-label={DAY_COPY.superset(letter)} className="flex flex-col gap-3">
                {cards}
              </ul>
              {rest ? (
                <p className={cn('text-muted-foreground mt-2 text-sm', NAME_WRAP_CLASS)}>
                  {DAY_COPY.rest(rest)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
});

/** The items in runs: neighbouring items of one superset group together, every other item alone. */
function groupsOf(items: readonly DayItem[]): Array<Array<{ item: DayItem; index: number }>> {
  const out: Array<Array<{ item: DayItem; index: number }>> = [];
  items.forEach((item, index) => {
    const last = out.at(-1);
    const group = item.superset?.group;
    if (group && last && last[0]!.item.superset?.group === group) last.push({ item, index });
    else out.push([{ item, index }]);
  });
  return out;
}

/** A superset label's letter: `A` of `A1`, `AB` of `AB2` (the contract's labels, `supersetLabels`). */
export function supersetLetterOf(label: string): string {
  return label.replace(/\d+$/, '');
}

/**
 * The workout's items, plus any **removed item** shown earlier this visit that the page's data has
 * since dropped (D20, D7). A removed item is listed only through its logged rows, so un-ticking all
 * of them drops it from the data; kept here, its rows stay, un-ticked, and can be ticked back. Only
 * on a day that can be written: a read-only day shows the page's data as it is.
 */
function useItemsShownThisVisit(workout: DayWorkout): DayItem[] {
  const { readOnly } = useDay();
  const removedNow = workout.items.filter((i) => i.prescriptionPublicId === null);
  const [removed, setRemoved] = useState<ReadonlyMap<string, DayItem>>(
    () => new Map(removedNow.map((i) => [itemKeyOf(i), i])),
  );
  if (removedNow.some((i) => removed.get(itemKeyOf(i)) !== i)) {
    setRemoved(new Map([...removed, ...removedNow.map((i) => [itemKeyOf(i), i] as const)]));
  }
  if (readOnly || !workout.scheduled) return workout.items;
  const listed = new Set(workout.items.map(itemKeyOf));
  // A dropped item is no longer logged: its rows say so, so it neither looks done nor shows a
  // pressed ✓. Rows this visit un-ticked keep their numbers and re-tick through the row's own state.
  const dropped = [...removed.values()]
    .filter((i) => !listed.has(itemKeyOf(i)))
    .map((i) => ({ ...i, rows: i.rows.map((r) => ({ ...r, logged: null })) }));
  return [...workout.items, ...dropped];
}
