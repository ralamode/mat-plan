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
import { DAY_COPY } from './day-copy';
import { fieldsOf, fieldText, valueParts, type RowField } from './row-values';
import { rowAccess, rowName, useRow } from './use-row';
import {
  CARD_CLASS,
  fieldHeader,
  ItemHeading,
  LOGGED_CARD_CLASS,
  RowInput,
  RowMessage,
  secondaryText,
  Tick,
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
  // Every set number shown this visit: the page's rows, and any added or un-ticked since.
  const [shown, setShown] = useState<ReadonlySet<number>>(
    () => new Set(item.rows.map((r) => r.set)),
  );
  if (item.rows.some((r) => !shown.has(r.set))) {
    setShown(new Set([...shown, ...item.rows.map((r) => r.set)]));
  }
  const fromPage = new Map(item.rows.map((r) => [r.set, r]));
  const rows: DayRow[] = [...new Set([...shown, ...fromPage.keys()])]
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

  // The added row's first field takes focus once it is on screen, and only then.
  useEffect(() => {
    if (!focusAdded.current) return;
    focusAdded.current = false;
    addedFocus.current?.focus();
  }, [rows.length]);

  return (
    <li className={cn(CARD_CLASS, allDone && LOGGED_CARD_CLASS, onTint && TINT_CLASS)}>
      <ItemHeading item={item} label={label} onTint={onTint} />
      <table className="mt-2 w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{item.name}</caption>
        <colgroup>
          <col className="w-7" />
          {showPrevious ? <col /> : null}
          {fields.map((field) => (
            <col key={field} className={canLog ? 'w-14' : showPrevious ? 'w-16' : undefined} />
          ))}
          {/* A wider ✓ column keeps the ✓ clear of the last field: an empty ✓ logs a set (D13). */}
          <col className="w-14" />
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
              focusRef={row.set === nextSet - 1 && !fromPage.has(row.set) ? addedFocus : undefined}
            />
          ))}
        </tbody>
      </table>
      {canAdd ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-1 px-2"
          aria-label={DAY_COPY.addSetTo(item.name)}
          onClick={() => {
            focusAdded.current = true;
            setShown(new Set([...shown, nextSet]));
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
  const name = rowName(item, row);
  useFocusRefusedField(r, inputs, fields[0]);
  const hasMessage = r.error !== null;
  const { set } = row;
  useEffect(() => {
    if (!hasMessage) return;
    onMessage(set, true);
    return () => onMessage(set, false);
  }, [hasMessage, onMessage, set]);
  const shownValues = r.logged ?? r.kept;
  const previous = row.previous ? valueParts(row.previous) : null;

  return (
    <>
      <tr>
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
                last={index === fields.length - 1}
                // `px-0.5`: a six-character load (`1012.5`) fits the 56px column.
                className="w-full px-0.5 text-center tabular-nums"
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
