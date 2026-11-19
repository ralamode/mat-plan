'use client';

import {
  hasSetRows,
  quantityText,
  slotQuantity,
  TRACKING_TYPE,
  type DayItem,
  type DayRow,
  type DayWorkout,
} from '@mat-plan/shared';
import { memo, useId, useRef } from 'react';

import { cn } from '@/lib/utils';

import { ChangeInput, hasRowStatus, RowStatus } from './change-parts';
import { DAY_COPY } from './day-copy';
import { fieldsOf, formatRowValues, unitSuffix, type RowField } from './row-values';
import { changeRowProps, useChange } from './use-change';
import { useRow } from './use-row';
import {
  CARD_CLASS,
  ItemHeading,
  LOGGED_CARD_CLASS,
  RowInput,
  OtherUnitLine,
  secondaryText,
  Tick,
  TINT_CLASS,
  useFocusRefusedField,
} from './row-parts';
import { SetItem } from './set-table';

/**
 * One item of a workout, as a card in the workout's list (FAM-1 steps 13 and 13b).
 *
 * A Check, Duration or Count is one row. An item logged set by set is a table of its sets (13b).
 * `label` is its superset label (A1), or `null`.
 */
export const ItemCard = memo(function ItemCard({
  workout,
  workoutKey,
  item,
  label,
}: {
  workout: DayWorkout;
  workoutKey: string;
  item: DayItem;
  label: string | null;
}) {
  const row = item.rows[0];
  if (!row) {
    // A look-ahead day: the item, with no row to log (for a single row and a set table alike).
    return (
      <li className={CARD_CLASS}>
        <ItemHeading item={item} label={label} onTint={false} />
      </li>
    );
  }
  if (hasSetRows(item.trackingType)) {
    return <SetItem workout={workout} workoutKey={workoutKey} item={item} label={label} />;
  }
  return (
    <SingleItem workout={workout} workoutKey={workoutKey} item={item} row={row} label={label} />
  );
});

/**
 * The single row of a Check, Duration or Count: what was done last time, the field, the ✓.
 *
 * **Focus never drops to the page.** The ✓ is the same element in every state, so it keeps focus
 * after a ✓ or an un-tick; while a write is in flight it is `aria-disabled`, never `disabled`, which
 * would drop focus. Reload hands focus to the ✓ before its own button goes.
 */
function SingleItem({
  workout,
  workoutKey,
  item,
  row,
  label,
}: {
  workout: DayWorkout;
  workoutKey: string;
  item: DayItem;
  row: DayRow;
  label: string | null;
}) {
  const fields = useRef<Partial<Record<RowField, HTMLInputElement | null>>>({});
  const tickRef = useRef<HTMLButtonElement>(null);
  const r = useRow(workout, workoutKey, item, row);
  const errorId = useId();
  const rowId = useId();
  const change = useChange(r, item, row, rowId, tickRef);
  const status = hasRowStatus(r, change);
  const isCheck = item.trackingType === TRACKING_TYPE.check;
  const previous = row.previous ? slotQuantity(item, row.previous.quantities) : null;
  useFocusRefusedField(r, fields, fieldsOf(item)[0]);

  let left: string | null = null;
  if (r.logged && isCheck) left = DAY_COPY.done;
  else if (!r.logged && previous && r.canWrite) {
    left = `${DAY_COPY.lastTime} ${quantityText(previous.value, previous.unit)}`;
  }
  const onTint = r.logged !== null && !r.error;

  return (
    <li
      {...changeRowProps(rowId, change)}
      className={cn(CARD_CLASS, r.logged && LOGGED_CARD_CLASS, onTint && TINT_CLASS)}
    >
      <ItemHeading item={item} label={label} onTint={onTint} />
      <div className="mt-2 flex items-center gap-2">
        <span className={cn('min-w-0 flex-1 text-sm', secondaryText(onTint))}>{left}</span>
        {change.editable && item.unit ? (
          <>
            <ChangeInput
              change={change}
              item={item}
              field="quantity"
              name={item.name}
              lineId={errorId}
              described={status}
              tickRef={tickRef}
              inputRef={(el) => {
                fields.current.quantity = el;
              }}
              className="w-20 shrink-0 text-right tabular-nums"
            />
            {unitSuffix(item.unit) ? (
              <span className={cn('shrink-0 text-sm', secondaryText(onTint))}>
                {unitSuffix(item.unit)}
              </span>
            ) : null}
          </>
        ) : r.logged ? (
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
            <RowInput
              r={r}
              item={item}
              field="quantity"
              name={item.name}
              errorId={errorId}
              tickRef={tickRef}
              inputRef={(el) => {
                fields.current.quantity = el;
              }}
              className="w-20 shrink-0 text-right tabular-nums"
            />
            {unitSuffix(item.unit) ? (
              <span className="text-muted-foreground shrink-0 text-sm">
                {unitSuffix(item.unit)}
              </span>
            ) : null}
          </>
        ) : null}
        <Tick
          r={r}
          change={change}
          described={status}
          label={item.name}
          errorId={errorId}
          tickRef={tickRef}
        />
      </div>
      <div className="mt-2 empty:hidden">
        <RowStatus r={r} change={change} lineId={errorId} tickRef={tickRef} />
      </div>
      {/* 12d-iii: a sibling after the status slot, as in the set table, so a message never
          replaces it and the status stays next to the row. */}
      {r.otherUnit ? (
        <div className="mt-2">
          <OtherUnitLine r={r} item={item} errorId={errorId} onTint={onTint} />
        </div>
      ) : null}
    </li>
  );
}

/** A field's column header: `lb`, `Sec`, `yd`, `Reps`. */
