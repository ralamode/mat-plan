'use client';

import {
  MAX_SETS_PER_MOVEMENT,
  type DayItem,
  type DayRow,
  type DayWorkout,
} from '@mat-plan/shared';
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useDay } from './day-context';
import { ChangeInput, hasRowStatus, RowStatus } from './change-parts';
import { DAY_COPY } from './day-copy';
import { fieldsOf, fieldText, valueParts, type RowField } from './row-values';
import { changeRowProps, useChange } from './use-change';
import { rowAccess, rowName, useRow } from './use-row';
import {
  CARD_CLASS,
  fieldHeader,
  ItemHeading,
  LOGGED_CARD_CLASS,
  ON_TINT_BUTTON_FOCUS_CLASS,
  RowInput,
  OtherUnitLine,
  OtherUnitNote,
  QuantityCellText,
  rowUnitLine,
  secondaryText,
  Tick,
  useOtherUnitNote,
  TINT_CLASS,
  useFocusRefusedField,
} from './row-parts';

/**
 * An item logged set by set, as a table of its sets (FAM-1 step 13b; plan §5: "set rows as a list or
 * a table with headers"): Set, Previous, a column per field, ✓.
 *
 * - **Previous is left out on a day that cannot be written** (D33), column and all.
 * - **"+ Add set"** adds one empty row past the highest, kept until it is ticked; while an unlogged
 *   row beyond the page's data is there the button is gone, so there is never a gap of unlogged
 *   sets (maintainer, 2026-11-16). An added row that is never ticked is gone on reload, as typed
 *   text is.
 * - **A row shown this visit stays for the visit** (D20): the page's data lists a writable day's
 *   prescribed sets plus those *logged* beyond them, so un-ticking an extra set drops it from the
 *   data; it keeps its row here, un-ticked, so it can be ticked back.
 * - **A row whose prescription was removed** (D7) has no fields: it shows what was logged, and can
 *   be un-ticked and ticked back.
 * - The card looks done only when every set shown is logged, as v12's does.
 *
 * Widths at 360px (card inner 302px, 288px inside a superset): the table is `table-fixed`, with
 * fixed columns for the set number, each field and the ✓, and Previous takes the rest; Previous
 * renders as two unbreakable parts (`22.5 lb`, `× 10`) so it wraps between them, never inside one.
 */
export function SetItem({
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
  const addedFocus = useRef<HTMLInputElement | null>(null);
  /** Set when "+ Add set" is pressed: the added row's first field takes focus once it is shown. */
  const focusAdded = useRef(false);
  const fields = fieldsOf(item);
  const { canWrite: writable, canLog } = rowAccess(day.readOnly, workout, item);

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
  // The sets this visit keeps beyond the page's data: every set the page has shown logged (so an
  // un-ticked one keeps its row when the data drops it), and every set added here. A set the page
  // listed but never logged is not kept: if the program cuts it, it goes.
  const loggedSets = item.rows.filter((r) => r.logged).map((r) => r.set);
  const [kept, setKept] = useState<ReadonlySet<number>>(() => new Set(loggedSets));
  if (loggedSets.some((set) => !kept.has(set))) setKept(new Set([...kept, ...loggedSets]));
  const fromPage = new Map(item.rows.map((r) => [r.set, r]));
  // A day that cannot be written shows the page's rows only: nothing kept here can be ticked there.
  const rows: DayRow[] = [...new Set([...(writable ? kept : []), ...fromPage.keys()])]
    .sort((a, b) => a - b)
    .map((set) => fromPage.get(set) ?? { set, previous: null, logged: null });
  // A row beyond the page's data that is not logged: an added set not ticked yet, or an extra
  // set un-ticked. One at a time, so Add set waits for it.
  const pendingExtra = rows.some((r) => !fromPage.has(r.set));
  // The next set past the highest shown: the rows need not run without a gap.
  const nextSet = Math.max(0, ...rows.map((r) => r.set)) + 1;
  const canAdd = canLog && !pendingExtra && nextSet <= MAX_SETS_PER_MOVEMENT;
  const allDone = rows.length > 0 && rows.every((r) => r.logged);
  // No tint while a row shows a message: `destructive` is under AA on it (see `TINT_CLASS`).
  const onTint = allDone && withMessage.size === 0;
  // Previous is for choosing what to log: none on a day that cannot be written (D33), and none for
  // a removed item, which cannot be logged again (its `previous` is always null).
  const showPrevious = writable && item.prescriptionPublicId !== null;
  // The other-unit note, once for the item under its heading (#688 follow-up), kept for the visit.
  const noteUnit = useOtherUnitNote(item);
  const noteId = useId();

  // The added row's first field takes focus once it is on screen, and only then.
  useEffect(() => {
    if (!focusAdded.current) return;
    focusAdded.current = false;
    addedFocus.current?.focus();
  }, [rows.length]);

  return (
    <li className={cn(CARD_CLASS, allDone && LOGGED_CARD_CLASS, onTint && TINT_CLASS)}>
      <ItemHeading item={item} label={label} onTint={onTint} />
      {noteUnit ? <OtherUnitNote item={item} from={noteUnit} id={noteId} onTint={onTint} /> : null}
      <table className="mt-2 w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{item.name}</caption>
        <colgroup>
          <col className="w-7" />
          {showPrevious ? <col /> : null}
          {fields.map((field) => (
            <col key={field} className={fieldColumnClass(field, canLog, showPrevious)} />
          ))}
          {/* A wider ✓ column keeps the ✓ clear of the last field: an empty ✓ logs a set (D13). */}
          <col className={TICK_COLUMN_CLASS} />
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
              unitNoteId={noteUnit ? noteId : undefined}
              focusRef={row.set === nextSet - 1 && !fromPage.has(row.set) ? addedFocus : undefined}
            />
          ))}
        </tbody>
      </table>
      {canAdd ? (
        <Button
          type="button"
          variant="ghost"
          className={cn('mt-1 px-2', ON_TINT_BUTTON_FOCUS_CLASS)}
          aria-label={DAY_COPY.addSetTo(item.name)}
          onClick={() => {
            focusAdded.current = true;
            setKept(new Set([...kept, nextSet]));
            day.announce(DAY_COPY.setAdded(item.name));
          }}
        >
          {DAY_COPY.addSet}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * The ✓ column, and the inset that puts the Change ✕ on the line below exactly under the ✓: the
 * 44px ✓ is centred in the column, (56 − 44) / 2 = 6px from its right. Change one, change both.
 */
const TICK_COLUMN_CLASS = 'w-14';
const UNDER_TICK_CLASS = 'mr-1.5';

/**
 * A field's column. A load is `w-16` where it is a field: its content box (64px less the cell's and
 * the field's padding and a 2px border) holds a six-character load (`1012.5`, 51px at 16px), which
 * `w-14` clipped once a logged load became a Change field (13b-ii). Reps stay `w-14` (`1000` is 38px).
 */
function fieldColumnClass(field: RowField, canLog: boolean, showPrevious: boolean) {
  if (canLog) return field === 'quantity' ? 'w-16' : 'w-14';
  return showPrevious ? 'w-16' : undefined;
}

/** One set: its number, Previous, a field per value (or the logged values, or Change's), the ✓. */
function SetRow({
  workout,
  workoutKey,
  item,
  row,
  fields,
  showPrevious,
  onTint,
  onMessage,
  unitNoteId,
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
  /** The item's other-unit note, when it shows: a logged row points at it (`rowUnitLine`). */
  unitNoteId?: string;
  focusRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const inputs = useRef<Partial<Record<RowField, HTMLInputElement | null>>>({});
  const tickRef = useRef<HTMLButtonElement>(null);
  const r = useRow(workout, workoutKey, item, row);
  const errorId = useId();
  const rowId = useId();
  const change = useChange(r, item, row, rowId, tickRef);
  const name = rowName(item, row);
  useFocusRefusedField(r, inputs, fields[0]);
  const hasMessage = r.error !== null;
  const status = hasRowStatus(r, change);
  const { set } = row;
  useEffect(() => {
    if (!hasMessage) return;
    onMessage(set, true);
    return () => onMessage(set, false);
  }, [hasMessage, onMessage, set]);
  const shownValues = r.logged ?? r.kept;
  // The second line: Change's or a message (`status`), then the other-unit line when the row has one.
  const unitLine = rowUnitLine(r, errorId, unitNoteId);
  const changeFields = change.fields;
  const previous = row.previous ? valueParts(row.previous) : null;

  return (
    <>
      <tr {...changeRowProps(rowId, change)}>
        <th scope="row" className="py-1 text-left font-normal tabular-nums">
          {row.set}
        </th>
        {showPrevious ? (
          <td className={cn('py-1 pr-1 tabular-nums', secondaryText(onTint))}>
            {previous ? (
              previous.map((part, index) => (
                // The space sits between the parts, outside each: the line may break there only.
                <Fragment key={part}>
                  {index > 0 ? ' ' : null}
                  <span className="whitespace-nowrap">{part}</span>
                </Fragment>
              ))
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
            {changeFields.includes(field) ? (
              <ChangeInput
                change={change}
                item={item}
                field={field}
                name={name}
                lineId={errorId}
                described={status}
                unitLineId={unitLine.id}
                tickRef={tickRef}
                inputRef={(el) => {
                  inputs.current[field] = el;
                }}
                last={field === changeFields[changeFields.length - 1]}
                className="w-full px-0.5 text-center tabular-nums"
              />
            ) : shownValues || !r.hasField ? (
              <span
                className={cn(
                  'tabular-nums',
                  r.logged ? 'text-base font-medium' : secondaryText(onTint),
                )}
              >
                {shownValues && field === 'quantity' ? (
                  <QuantityCellText
                    item={item}
                    values={shownValues}
                    text={fieldText(item, shownValues, field)}
                  />
                ) : shownValues ? (
                  fieldText(item, shownValues, field)
                ) : (
                  ''
                )}
              </span>
            ) : (
              <RowInput
                r={r}
                item={item}
                field={field}
                name={name}
                errorId={errorId}
                unitNoteId={unitNoteId}
                tickRef={tickRef}
                inputRef={(el) => {
                  inputs.current[field] = el;
                  if (index === 0 && focusRef) focusRef.current = el;
                }}
                last={index === fields.length - 1}
                // `px-0.5`: a six-character load (`1012.5`) fits the load column (`fieldColumnClass`).
                className="w-full px-0.5 text-center tabular-nums"
              />
            )}
          </td>
        ))}
        <td className="py-1">
          <div className="flex justify-center">
            <Tick
              r={r}
              change={change}
              described={status}
              label={name}
              errorId={errorId}
              unitNoteId={unitNoteId}
              tickRef={tickRef}
            />
          </div>
        </td>
      </tr>
      {status || unitLine.own ? (
        <tr {...changeRowProps(rowId, change)}>
          <td
            colSpan={fields.length + (showPrevious ? 3 : 2)}
            // Typed over, the ✕ sits under this row's ✓: twice the room below it as above, so a
            // tap that lands low does not reach the next set's ✓ (which would send this change).
            className={change.dirty ? 'pb-3' : 'pb-1'}
          >
            {/* The status first, so Change's ✕ stays directly under the ✓ (maintainer, 2026-11-17). */}
            {status ? (
              <RowStatus
                r={r}
                change={change}
                lineId={errorId}
                tickRef={tickRef}
                underTickClassName={UNDER_TICK_CLASS}
              />
            ) : null}
            <OtherUnitLine
              r={r}
              item={item}
              errorId={errorId}
              unitNoteId={unitNoteId}
              onTint={onTint}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}
