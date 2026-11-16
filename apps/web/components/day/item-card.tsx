'use client';

import { hasSetRows, TRACKING_TYPE } from '@mat-plan/shared';
import { useEffect, useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { DAY_COPY } from './day-copy';
import {
  formatRowQuantity,
  formatRowValues,
  slotQuantity,
  targetQuantity,
  unitSpoken,
  unitSuffix,
  type DayItem,
  type DayRow,
  type DayWorkout,
} from './row-values';
import { useRow } from './use-row';

/**
 * An item's card, and how a logged one looks (`docs/design.md` → the `done` tokens): a `border-done`
 * edge, which is the boundary, and a `done-surface` tint, which is decoration. Secondary text on the
 * tint is `done-muted-foreground`, since `muted-foreground` is under AA there.
 *
 * ⚠️ **No tint while the row shows a message.** `destructive` text is 4.30:1 on the light tint,
 * under AA, and a failed un-tick puts "Still logged…" on a logged row. The edge and the filled ✓
 * still say it is logged.
 */
const CARD_CLASS = 'rounded-xl border p-3';
const LOGGED_CARD_CLASS = 'border-done';
const TINT_CLASS = 'bg-done-surface';
const secondaryText = (onTint: boolean) =>
  onTint ? 'text-done-muted-foreground' : 'text-muted-foreground';

/**
 * The ✓'s focus ring (design.md): full-opacity `foreground`, OUTSIDE the ✓, never inset on the
 * fill. An outline, so the gap shows the tint or the card behind it rather than a painted offset.
 */
const TICK_FOCUS_CLASS =
  'outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-foreground';

/**
 * One item of a workout, as a card in the workout's list (FAM-1 step 13).
 *
 * A Check, Duration or Count is one row, built here. An item logged set by set shows its heading
 * and how many of its sets are logged: step 13b adds its set rows, PREVIOUS, "+ Add set" and
 * supersets. The count keeps a closed day honest until then.
 */
export function ItemCard({
  workout,
  workoutKey,
  item,
}: {
  workout: DayWorkout;
  workoutKey: string;
  item: DayItem;
}) {
  const row = item.rows[0];
  if (hasSetRows(item.trackingType) || !row) {
    const logged = item.rows.filter((r) => r.logged).length;
    return (
      <li className={cn(CARD_CLASS, logged > 0 && [LOGGED_CARD_CLASS, TINT_CLASS])}>
        <ItemHeading item={item} onTint={logged > 0} />
        {logged > 0 ? (
          <p className={cn('mt-2 text-sm', secondaryText(true))}>{DAY_COPY.setsLogged(logged)}</p>
        ) : null}
      </li>
    );
  }
  return <SingleItem workout={workout} workoutKey={workoutKey} item={item} row={row} />;
}

function ItemHeading({ item, onTint }: { item: DayItem; onTint: boolean }) {
  const muted = secondaryText(onTint);
  return (
    <>
      {/* Wraps, as v12's card heading does: a long prescription goes under the name. */}
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h4 className={cn('font-semibold', NAME_WRAP_CLASS)}>{item.name}</h4>
        {item.prescribedText ? (
          <span className={cn('ml-auto text-sm', muted)}>{item.prescribedText}</span>
        ) : null}
      </div>
      {item.notes ? (
        <p className={cn('mt-1 text-sm', muted, NAME_WRAP_CLASS)}>{item.notes}</p>
      ) : null}
      {item.prescriptionPublicId === null ? (
        <p className={cn('mt-1 text-sm', muted)}>{DAY_COPY.removed}</p>
      ) : null}
    </>
  );
}

/**
 * The single row of a Check, Duration or Count: what was done last time, the field, the ✓.
 *
 * **Focus never drops to the page.** The ✓ is the same element in every state, so it keeps focus
 * after a ✓ or an un-tick; while a write is in flight it is `aria-disabled`, never `disabled`, which
 * would drop focus. Reload hands focus to the ✓ before its own button goes. A refused number moves
 * focus to the field once the field is back on screen (it is replaced by the value while a ✓ is in
 * flight), so the focus happens after the commit, not in the handler.
 */
function SingleItem({
  workout,
  workoutKey,
  item,
  row,
}: {
  workout: DayWorkout;
  workoutKey: string;
  item: DayItem;
  row: DayRow;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const tickRef = useRef<HTMLButtonElement>(null);
  const r = useRow(workout, workoutKey, item, row);
  const errorId = useId();
  const isCheck = item.trackingType === TRACKING_TYPE.check;
  const previous = row.previous ? slotQuantity(item, row.previous.quantities) : null;
  const target = targetQuantity(item);

  const invalid = r.error?.invalid === true;
  useEffect(() => {
    if (invalid) fieldRef.current?.focus();
  }, [invalid, r.error]);

  let left: string | null = null;
  if (r.logged && isCheck) left = DAY_COPY.done;
  else if (!r.logged && previous && r.canWrite) {
    left = `${DAY_COPY.lastTime} ${formatRowQuantity(previous.value, previous.unit)}`;
  }

  const onTint = r.logged !== null && !r.error;

  return (
    <li className={cn(CARD_CLASS, r.logged && LOGGED_CARD_CLASS, onTint && TINT_CLASS)}>
      <ItemHeading item={item} onTint={onTint} />
      <div className="mt-2 flex items-center gap-2">
        <span className={cn('min-w-0 flex-1 text-sm', secondaryText(onTint))}>{left}</span>
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
        ) : r.hasField && item.unit ? (
          <>
            <input
              ref={fieldRef}
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              value={r.text}
              onChange={(e) => r.setText(e.target.value)}
              // Enter is the ✓: a keyboard or a phone's "done" key logs the row.
              onKeyDown={(e) => {
                if (e.key === 'Enter') void r.press();
              }}
              // The prescription's number: an empty ✓ logs it (plan D13).
              placeholder={target ? String(target.value) : undefined}
              aria-label={DAY_COPY.fieldLabel(item.name, unitSpoken(item.unit))}
              aria-invalid={invalid || undefined}
              aria-describedby={r.error ? errorId : undefined}
              className={cn(INPUT_CLASS, 'w-20 shrink-0 text-right tabular-nums')}
            />
            {unitSuffix(item.unit) ? (
              <span className="text-muted-foreground shrink-0 text-sm">
                {unitSuffix(item.unit)}
              </span>
            ) : null}
          </>
        ) : null}
        {r.canWrite ? (
          <button
            ref={tickRef}
            type="button"
            onClick={r.press}
            aria-pressed={r.logged !== null}
            aria-label={DAY_COPY.logLabel(item.name)}
            aria-disabled={r.pending || undefined}
            aria-describedby={r.error ? errorId : undefined}
            className={cn(
              TICK_FOCUS_CLASS,
              'flex size-11 shrink-0 items-center justify-center rounded-lg border text-lg',
              // Ticked: the `done` fill carries the state (at least 3:1 against an un-ticked ✓),
              // and under forced colours, where fills vanish, a heavier border does. Un-ticked: a
              // muted glyph, as v12's is.
              r.logged
                ? 'bg-done text-done-foreground border-done forced-colors:border-4'
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                tickRef.current?.focus();
                r.reload();
              }}
            >
              {DAY_COPY.reload}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
