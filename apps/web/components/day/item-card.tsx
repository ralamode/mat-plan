'use client';

import {
  hasSetRows,
  MAX_SETS_PER_MOVEMENT,
  quantityText,
  slotQuantity,
  TRACKING_TYPE,
  type DayItem,
  type DayRow,
  type DayWorkout,
} from '@mat-plan/shared';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { useDay } from './day-context';
import { DAY_COPY } from './day-copy';
import {
  fieldsOf,
  fieldText,
  formatRowValues,
  placeholderOf,
  unitSpoken,
  unitSuffix,
  type RowField,
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
export const LOGGED_CARD_CLASS = 'border-done';
export const TINT_CLASS = 'bg-done-surface';
const secondaryText = (onTint: boolean) =>
  onTint ? 'text-done-muted-foreground' : 'text-muted-foreground';

/**
 * The ✓'s focus ring (design.md): full-opacity `foreground`, OUTSIDE the ✓, never inset on the
 * fill. An outline, so the gap shows the tint or the card behind it rather than a painted offset.
 *
 * ⚠️ `focus-visible:outline-solid` is load-bearing: Tailwind's `outline-none` sets the outline
 * style to `none` through a variable that `outline-3` reads, so without it no ring is drawn.
 */
const TICK_FOCUS_CLASS =
  'outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-foreground';

const TICK_CLASS = 'flex size-11 shrink-0 items-center justify-center rounded-lg border text-lg';

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
  if (hasSetRows(item.trackingType)) {
    return <SetItem workout={workout} workoutKey={workoutKey} item={item} label={label} />;
  }
  const row = item.rows[0];
  if (!row) {
    // A look-ahead day: the item, with no row to log.
    return (
      <li className={CARD_CLASS}>
        <ItemHeading item={item} label={label} onTint={false} />
      </li>
    );
  }
  return (
    <SingleItem workout={workout} workoutKey={workoutKey} item={item} row={row} label={label} />
  );
});

/**
 * The item's name, prescription and notes. **What a row was logged against** (plan D7): on a day
 * that can still be logged the heading shows the live prescription and, when a logged row was
 * logged against another, says so; on a read-only day it shows what the rows were logged against.
 */
function ItemHeading({
  item,
  label,
  onTint,
}: {
  item: DayItem;
  label: string | null;
  onTint: boolean;
}) {
  const { readOnly } = useDay();
  const muted = secondaryText(onTint);
  const frozen = item.rows.find((r) => r.logged)?.logged?.prescribedText ?? null;
  const shown = readOnly && frozen !== null ? frozen : item.prescribedText;
  const against =
    !readOnly && item.prescriptionPublicId !== null
      ? item.rows.find((r) => r.logged && r.logged.prescribedText !== item.prescribedText)?.logged
          ?.prescribedText
      : undefined;
  return (
    <>
      {/* Wraps, as v12's card heading does: a long prescription goes under the name. */}
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h4 className={cn('font-semibold', NAME_WRAP_CLASS)}>
          {label ? (
            <>
              <span className="bg-muted text-foreground mr-1 rounded px-1.5 py-0.5 text-xs font-medium">
                {label}
              </span>{' '}
            </>
          ) : null}
          {item.name}
        </h4>
        {shown ? <span className={cn('ml-auto text-sm', muted)}>{shown}</span> : null}
      </div>
      {item.notes ? (
        <p className={cn('mt-1 text-sm', muted, NAME_WRAP_CLASS)}>{item.notes}</p>
      ) : null}
      {item.prescriptionPublicId === null ? (
        <p className={cn('mt-1 text-sm', muted)}>{DAY_COPY.removed}</p>
      ) : null}
      {against !== undefined ? (
        <p className={cn('mt-1 text-sm', muted)}>{DAY_COPY.loggedAgainst(against)}</p>
      ) : null}
    </>
  );
}

/** The ✓ of a row that can be written, or the static tick of one that cannot. */
function Tick({
  r,
  label,
  errorId,
  tickRef,
}: {
  r: ReturnType<typeof useRow>;
  label: string;
  errorId: string;
  tickRef: React.RefObject<HTMLButtonElement | null>;
}) {
  if (r.canWrite) {
    return (
      <button
        ref={tickRef}
        type="button"
        onClick={r.press}
        aria-pressed={r.logged !== null}
        aria-label={DAY_COPY.logLabel(label)}
        aria-disabled={r.pending || undefined}
        aria-describedby={r.error ? errorId : undefined}
        className={cn(
          TICK_FOCUS_CLASS,
          TICK_CLASS,
          // Ticked: the `done` fill carries the state (at least 3:1 against an un-ticked ✓), and
          // under forced colours, where fills vanish, a heavier border does. Un-ticked: a muted
          // glyph, as v12's is.
          r.logged
            ? 'bg-done text-done-foreground border-done forced-colors:border-4'
            : 'bg-background text-muted-foreground',
        )}
      >
        <span aria-hidden="true">✓</span>
      </button>
    );
  }
  if (!r.logged) return null;
  // Nothing to tap on a read-only row, so the tick is text-sized and the row stays compact.
  return (
    <span className="flex shrink-0 items-center justify-center text-lg">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">{DAY_COPY.logged}</span>
    </span>
  );
}

/** A row's message, with Reload when the page is out of date. Focus goes to the ✓ before it goes. */
function RowMessage({
  r,
  errorId,
  tickRef,
}: {
  r: ReturnType<typeof useRow>;
  errorId: string;
  tickRef: React.RefObject<HTMLButtonElement | null>;
}) {
  if (!r.error) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
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
  );
}

/**
 * Focus moves to a field when the number in it was refused, once the field is back on screen (it
 * is replaced by the value while a ✓ is in flight), so this runs after the commit.
 */
function useFocusRefusedField(
  r: ReturnType<typeof useRow>,
  fields: React.RefObject<Partial<Record<RowField, HTMLInputElement | null>>>,
  first: RowField | undefined,
) {
  const invalid = r.error?.invalid === true;
  const field = r.error?.field ?? first;
  useEffect(() => {
    if (invalid && field) fields.current[field]?.focus();
  }, [invalid, field, r.error, fields]);
}

/** A number field of a row: its name, placeholder, and Enter as the ✓. */
function RowInput({
  r,
  item,
  field,
  name,
  errorId,
  tickRef,
  inputRef,
  className,
}: {
  r: ReturnType<typeof useRow>;
  item: DayItem;
  field: RowField;
  name: string;
  errorId: string;
  tickRef: React.RefObject<HTMLButtonElement | null>;
  inputRef: (el: HTMLInputElement | null) => void;
  className: string;
}) {
  const invalid = r.error?.invalid === true && (r.error.field ?? field) === field;
  const spoken = field === 'reps' ? DAY_COPY.reps.toLowerCase() : unitSpoken(item.unit!);
  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={field === 'reps' ? 'numeric' : 'decimal'}
      enterKeyHint="done"
      autoComplete="off"
      value={r.text[field]}
      onChange={(e) => r.setText(field, e.target.value)}
      // The field goes while the ✓ is in flight, so focus moves to the ✓ first, as Reload's does;
      // a refused number brings it back to the field.
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        tickRef.current?.focus();
        void r.press();
      }}
      // The prescription's number: an empty ✓ logs it (plan D13).
      placeholder={placeholderOf(item, field)}
      aria-label={DAY_COPY.fieldLabel(name, spoken)}
      aria-invalid={invalid || undefined}
      aria-describedby={r.error ? errorId : undefined}
      className={cn(INPUT_CLASS, className)}
    />
  );
}

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
    <li className={cn(CARD_CLASS, r.logged && LOGGED_CARD_CLASS, onTint && TINT_CLASS)}>
      <ItemHeading item={item} label={label} onTint={onTint} />
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
        <Tick r={r} label={item.name} errorId={errorId} tickRef={tickRef} />
      </div>
      <div className="mt-2 empty:hidden">
        <RowMessage r={r} errorId={errorId} tickRef={tickRef} />
      </div>
    </li>
  );
}

/** A field's column header: `lb`, `Sec`, `yd`, `Reps`. */
function fieldHeader(item: DayItem, field: RowField): string {
  if (field === 'reps' || !item.unit) return DAY_COPY.reps;
  return item.unit === 'sec' ? 'Sec' : item.unit === 'min' ? 'Min' : unitSuffix(item.unit);
}

/**
 * An item logged set by set, as a table of its sets (FAM-1 step 13b; plan §5: "set rows as a list or
 * a table with headers"): Set, Previous, a column per field, ✓.
 *
 * - **Previous is left out on a day that cannot be written** (D33), column and all.
 * - **"+ Add set"** adds one empty row past the last, kept until it is ticked; while it is there
 *   the button is gone, so there is never a gap of unlogged sets (maintainer, 2026-11-16). An added
 *   row that is never ticked is gone on reload, as typed text is.
 * - **A row whose prescription was removed** (D7) has no fields: it shows what was logged, and can
 *   be un-ticked and ticked back.
 * - The card looks done only when every set shown is logged, as v12's does.
 *
 * Widths at 360px (card inner 302px, 288px inside a superset): the table is `table-fixed`, with
 * fixed columns for the set number, each field and the ✓, and Previous takes the rest; Previous
 * renders as two unbreakable parts (`22.5 lb`, `× 10`) so it wraps between them, never inside one.
 */
function SetItem({
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
  const day = useDay();
  const [added, setAdded] = useState<number | null>(null);
  const addedFocus = useRef<HTMLInputElement | null>(null);
  const fields = fieldsOf(item);
  const writable = !day.readOnly && workout.scheduled;
  const canLog = writable && workout.workoutPublicId !== null && item.prescriptionPublicId !== null;

  const [withMessage, setWithMessage] = useState<ReadonlySet<number>>(() => new Set());
  // Stable, since each row's effect depends on it.
  const reportMessage = useCallback(
    (set: number, has: boolean) =>
      setWithMessage((was) => {
        if (was.has(set) === has) return was;
        const next = new Set(was);
        if (has) next.add(set);
        else next.delete(set);
        return next;
      }),
    [],
  );
  const rows: DayRow[] = [...item.rows];
  if (added !== null && !rows.some((r) => r.set === added)) {
    rows.push({ set: added, previous: null, logged: null });
  }
  const pendingAdd = added !== null && !item.rows.some((r) => r.set === added);
  // The next set past the highest shown: the rows need not run without a gap.
  const nextSet = Math.max(0, ...rows.map((r) => r.set)) + 1;
  const canAdd = canLog && !pendingAdd && nextSet <= MAX_SETS_PER_MOVEMENT;
  const allDone = rows.length > 0 && rows.every((r) => r.logged);
  // No tint while a row shows a message: `destructive` is under AA on it (see `TINT_CLASS`).
  const onTint = allDone && withMessage.size === 0;
  // Previous is for choosing what to log: none on a day that cannot be written (D33), and none for
  // a removed item, which cannot be logged again (its `previous` is always null).
  const showPrevious = writable && item.prescriptionPublicId !== null;

  // The added row's first field takes focus once it is on screen.
  useEffect(() => {
    if (pendingAdd) addedFocus.current?.focus();
  }, [pendingAdd]);

  if (rows.length === 0) {
    // A look-ahead day: the item, with no rows to log.
    return (
      <li className={CARD_CLASS}>
        <ItemHeading item={item} label={label} onTint={false} />
      </li>
    );
  }

  return (
    <li className={cn(CARD_CLASS, allDone && LOGGED_CARD_CLASS, onTint && TINT_CLASS)}>
      <ItemHeading item={item} label={label} onTint={onTint} />
      <table className="mt-2 w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-7" />
          {showPrevious ? <col /> : null}
          {fields.map((field) => (
            <col key={field} className={canLog ? 'w-14' : showPrevious ? 'w-16' : undefined} />
          ))}
          <col className="w-12" />
        </colgroup>
        <thead>
          <tr className={secondaryText(onTint)}>
            <th scope="col" className="py-1 text-left font-normal">
              {DAY_COPY.set}
            </th>
            {showPrevious ? (
              <th scope="col" className="py-1 text-left font-normal">
                {DAY_COPY.previous}
              </th>
            ) : null}
            {fields.map((field) => (
              <th key={field} scope="col" className="px-0.5 py-1 text-center font-normal">
                {fieldHeader(item, field)}
              </th>
            ))}
            <th scope="col" className="py-1 text-center font-normal">
              <span aria-hidden="true">✓</span>
              <span className="sr-only">{DAY_COPY.logged}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SetRow
              key={row.set}
              workout={workout}
              workoutKey={workoutKey}
              item={item}
              row={row}
              fields={fields}
              showPrevious={showPrevious}
              onTint={onTint}
              onMessage={reportMessage}
              focusRef={row.set === added ? addedFocus : undefined}
            />
          ))}
        </tbody>
      </table>
      {canAdd ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-1 px-2"
          onClick={() => {
            setAdded(nextSet);
            day.announce(DAY_COPY.setAdded(item.name));
          }}
        >
          {DAY_COPY.addSet}
        </Button>
      ) : null}
    </li>
  );
}

/** One set: its number, Previous, a field per value (or the logged values), the ✓. */
function SetRow({
  workout,
  workoutKey,
  item,
  row,
  fields,
  showPrevious,
  onTint,
  onMessage,
  focusRef,
}: {
  workout: DayWorkout;
  workoutKey: string;
  item: DayItem;
  row: DayRow;
  fields: RowField[];
  showPrevious: boolean;
  onTint: boolean;
  /** Reports whether this row shows a message, so the card drops its tint. */
  onMessage: (set: number, has: boolean) => void;
  focusRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const inputs = useRef<Partial<Record<RowField, HTMLInputElement | null>>>({});
  const tickRef = useRef<HTMLButtonElement>(null);
  const r = useRow(workout, workoutKey, item, row);
  const errorId = useId();
  const name = DAY_COPY.setLabel(item.name, row.set);
  useFocusRefusedField(r, inputs, fields[0]);
  const hasMessage = r.error !== null;
  const { set } = row;
  useEffect(() => {
    if (!hasMessage) return;
    onMessage(set, true);
    return () => onMessage(set, false);
  }, [hasMessage, onMessage, set]);
  const shownValues = r.logged ?? r.kept;
  const previous = row.previous ? formatRowValues(row.previous) : null;
  const [lead, ...rest] = previous ? previous.split(' × ') : [];

  return (
    <>
      <tr>
        <th scope="row" className="py-1 text-left font-normal tabular-nums">
          {row.set}
        </th>
        {showPrevious ? (
          <td className={cn('py-1 pr-1 tabular-nums', secondaryText(onTint))}>
            {previous ? (
              <>
                <span className="whitespace-nowrap">{lead}</span>{' '}
                {rest.length ? (
                  <span className="whitespace-nowrap">× {rest.join(' × ')}</span>
                ) : null}
              </>
            ) : (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">{DAY_COPY.noPrevious}</span>
              </>
            )}
          </td>
        ) : null}
        {fields.map((field, index) => (
          <td key={field} className="px-0.5 py-1 text-center">
            {shownValues || !r.hasField ? (
              <span
                className={cn(
                  'tabular-nums',
                  r.logged ? 'text-base font-medium' : secondaryText(onTint),
                )}
              >
                {shownValues ? fieldText(item, shownValues, field) : ''}
              </span>
            ) : (
              <RowInput
                r={r}
                item={item}
                field={field}
                name={name}
                errorId={errorId}
                tickRef={tickRef}
                inputRef={(el) => {
                  inputs.current[field] = el;
                  if (index === 0 && focusRef) focusRef.current = el;
                }}
                className="w-full px-1 text-center tabular-nums"
              />
            )}
          </td>
        ))}
        <td className="py-1">
          <div className="flex justify-center">
            <Tick r={r} label={name} errorId={errorId} tickRef={tickRef} />
          </div>
        </td>
      </tr>
      {r.error ? (
        <tr>
          <td colSpan={fields.length + (showPrevious ? 3 : 2)} className="pb-1">
            <RowMessage r={r} errorId={errorId} tickRef={tickRef} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
