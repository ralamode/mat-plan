'use client';

import { hasSetRows, TRACKING_TYPE, type DayPlan } from '@mat-plan/shared';
import { useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { DAY_COPY } from './day-copy';
import {
  formatQuantity,
  formatRowValues,
  targetQuantity,
  unitSuffix,
  type DayItem,
} from './row-values';
import { useRow } from './use-row';

type Workout = DayPlan['workouts'][number];
type Row = DayItem['rows'][number];

/**
 * One item of a workout, as a card in the workout's list (FAM-1 step 13).
 *
 * A Check, Duration or Count is one row, built here. An item logged set by set shows its heading
 * and how many of its sets are logged: step 13b adds its set rows, PREVIOUS, "+ Add set" and
 * supersets. The count keeps a closed day honest until then (UX panel, second pass).
 */
export function ItemCard({
  workout,
  workoutKey,
  item,
}: {
  workout: Workout;
  workoutKey: string;
  item: DayItem;
}) {
  const row = item.rows[0];
  if (hasSetRows(item.trackingType) || !row) {
    const logged = item.rows.filter((r) => r.logged).length;
    return (
      <li className={cn('rounded-xl border p-3', logged > 0 && 'border-primary')}>
        <ItemHeading item={item} />
        {logged > 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">{DAY_COPY.setsLogged(logged)}</p>
        ) : null}
      </li>
    );
  }
  return <SingleItem workout={workout} workoutKey={workoutKey} item={item} row={row} />;
}

function ItemHeading({ item }: { item: DayItem }) {
  return (
    <>
      {/* Wraps, as v12's card heading does: a long prescription goes under the name. */}
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h4 className={cn('font-semibold', NAME_WRAP_CLASS)}>{item.name}</h4>
        {item.prescribedText ? (
          <span className="text-muted-foreground ml-auto text-sm">{item.prescribedText}</span>
        ) : null}
      </div>
      {item.notes ? <p className="text-muted-foreground mt-1 text-sm">{item.notes}</p> : null}
      {item.prescriptionPublicId === null ? (
        <p className="text-muted-foreground mt-1 text-sm">{DAY_COPY.removed}</p>
      ) : null}
    </>
  );
}

/**
 * The single row of a Check, Duration or Count: what was done last time, the field, the ✓.
 *
 * The ✓ is the same element in every state, so focus stays on it after a ✓ or an un-tick; while a
 * write is in flight it is `aria-disabled`, never `disabled`, which would drop focus.
 */
function SingleItem({
  workout,
  workoutKey,
  item,
  row,
}: {
  workout: Workout;
  workoutKey: string;
  item: DayItem;
  row: Row;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const r = useRow(workout, workoutKey, item, row, fieldRef);
  const errorId = useId();
  const isCheck = item.trackingType === TRACKING_TYPE.check;
  const unit = item.unit ? unitSuffix(item.unit) : '';
  const previous = row.previous?.quantities[0];
  const target = targetQuantity(item);

  let left: string | null = null;
  if (r.logged && isCheck) left = DAY_COPY.done;
  else if (!r.logged && previous && r.canWrite) {
    left = `${DAY_COPY.lastTime} ${formatQuantity(previous.value, previous.unit)}`;
  }

  return (
    // Neutral until a "done" colour token exists (a recorded difference from v12's green). A border,
    // not a fill: muted text on `bg-muted` fails AA contrast.
    <li className={cn('rounded-xl border p-3', r.logged && 'border-primary')}>
      <ItemHeading item={item} />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-muted-foreground min-w-0 flex-1 text-sm">{left}</span>
        {r.logged ? (
          !isCheck && (
            <span className="shrink-0 text-base font-medium tabular-nums">
              {formatRowValues(r.logged)}
            </span>
          )
        ) : r.kept ? (
          <span className="text-muted-foreground shrink-0 text-base tabular-nums">
            {formatRowValues(r.kept)}
          </span>
        ) : r.hasField ? (
          <>
            <input
              ref={fieldRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={r.text}
              onChange={(e) => r.setText(e.target.value)}
              // The prescription's number: an empty ✓ logs it (plan D13).
              placeholder={target ? String(target.value) : undefined}
              aria-label={DAY_COPY.fieldLabel(item.name, unit)}
              aria-invalid={r.error?.invalid || undefined}
              aria-describedby={r.error ? errorId : undefined}
              className={cn(INPUT_CLASS, 'w-20 shrink-0 text-right tabular-nums')}
            />
            {unit ? <span className="text-muted-foreground shrink-0 text-sm">{unit}</span> : null}
          </>
        ) : null}
        {r.canWrite ? (
          <button
            type="button"
            onClick={r.press}
            aria-pressed={r.logged !== null}
            aria-label={DAY_COPY.logLabel(item.name)}
            aria-disabled={r.pending || undefined}
            aria-describedby={r.error ? errorId : undefined}
            className={cn(
              'focus-visible:ring-ring/50 flex size-11 shrink-0 items-center justify-center rounded-lg border text-lg outline-none focus-visible:ring-3',
              // Un-pressed reads as not done: a muted glyph, as v12's is.
              r.logged
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground',
            )}
          >
            <span aria-hidden="true">✓</span>
          </button>
        ) : r.logged ? (
          <span className="flex size-11 shrink-0 items-center justify-center text-lg">
            <span aria-hidden="true">✓</span>
            <span className="sr-only">{DAY_COPY.logged}</span>
          </span>
        ) : null}
      </div>
      {r.error ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p id={errorId} className="text-destructive text-sm">
            {r.error.message}
          </p>
          {r.error.reload ? (
            <Button type="button" variant="outline" size="sm" onClick={r.reload}>
              {DAY_COPY.reload}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
