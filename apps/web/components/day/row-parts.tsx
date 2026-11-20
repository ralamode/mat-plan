'use client';

import { SUPERVISION_LABELS, TRACKING_TYPE, type DayItem, type RowValues } from '@mat-plan/shared';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS, NAME_WRAP_CLASS, SAVING_LABEL, TICK_FOCUS_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { useDay } from './day-context';
import { DAY_COPY } from './day-copy';
import {
  fieldsOf,
  otherUnitOf,
  placeholderOf,
  unitSpoken,
  unitSuffix,
  type RowField,
} from './row-values';
import type { RowChange } from './use-change';
import { useRow } from './use-row';

/**
 * The parts a day row is built from (FAM-1 steps 13 and 13b), shared by the single row
 * (`item-card.tsx`) and the set table (`set-table.tsx`): the card's classes, the item's heading,
 * the ✓, a row's message, a number field and the hook that focuses a refused one.
 */
/**
 * An item's card, and how a logged one looks (`docs/design.md` → the `done` tokens): a `border-done`
 * edge, which is the boundary, and a `done-surface` tint, which is decoration. Secondary text on the
 * tint is `done-muted-foreground`, since `muted-foreground` is under AA there.
 *
 * ⚠️ **No tint while the row shows a message.** `destructive` text is 4.30:1 on the light tint,
 * under AA, and a failed un-tick puts "Still logged…" on a logged row. The edge and the filled ✓
 * still say it is logged.
 */
export const CARD_CLASS = 'rounded-xl border p-3';
export const LOGGED_CARD_CLASS = 'border-done';
export const TINT_CLASS = 'bg-done-surface';
export const secondaryText = (onTint: boolean) =>
  onTint ? 'text-done-muted-foreground' : 'text-muted-foreground';

/**
 * A field's focus ring: the ✓'s foreground outline, so a field on the tint focuses the way the ✓
 * beside it does (docs/design.md: the offset outline over a `done` fill), with a 1px offset so the
 * ring (4px) stays inside the 4px between two fields.
 */
const FIELD_FOCUS_CLASS = `focus-visible:ring-0 ${TICK_FOCUS_CLASS.replace(
  'focus-visible:outline-offset-2',
  'focus-visible:outline-offset-1',
)}`;

/**
 * A logged number that Change can edit (13b-ii; maintainer, 2026-11-16): a green-edged field in the
 * card's own logged look, so a bordered well means editable and a read-only day's plain text does
 * not.
 *
 * 🔴 **Only while it holds the stored number.** Typed over, it is a plain field with a heavier
 * `foreground` border (a width cue that survives forced colours): a number that is not saved must
 * never wear the logged look (invariant 16).
 */
export const LOGGED_FIELD_CLASS = `${TINT_CLASS} ${LOGGED_CARD_CLASS} ${FIELD_FOCUS_CLASS}`;
export const CHANGED_FIELD_CLASS = `bg-background border-2 border-foreground ${FIELD_FOCUS_CLASS}`;
/** A button on the tint (Undo, the Change's ✕, "+ Add set"): the ✓'s outline, so the row's controls focus alike. */
export { ON_TINT_BUTTON_FOCUS_CLASS } from '@/lib/constants';

export const TICK_CLASS =
  'flex size-11 shrink-0 items-center justify-center rounded-lg border text-lg';

/**
 * The item's name, prescription and notes. **What a row was logged against** (plan D7): on a day
 * that can still be logged the heading shows the live prescription and, when a logged row was
 * logged against another, says so; on a read-only day it shows what the rows were logged against.
 */
export function ItemHeading({
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
      {/* The library's label for a movement learned with a coach present (D40, C32; FAM-1 12c-ii):
          under the name, at full contrast, as the picker shows it, on every day and in every row
          state. It informs and never gates the ✓. Outside the `<h4>`, so the heading's name stays
          the movement's (the rows are found by it). `card-foreground`: the text token on the tint
          too (`docs/design.md`, done-surface). */}
      {item.supervision ? (
        <p className="text-card-foreground mt-1 text-sm font-medium">
          {SUPERVISION_LABELS[item.supervision]}
        </p>
      ) : null}
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

/**
 * The ✓ of a row that can be written, or the static tick of one that cannot. `change` is the row's
 * Change (13b-ii), whose ✓ saves an open edit and never un-ticks one (`use-change.ts`). `described`:
 * the row's line is showing (`hasRowStatus`), so the ✓ points at it.
 */
export function Tick({
  r,
  change,
  described,
  label,
  errorId,
  tickRef,
}: {
  r: ReturnType<typeof useRow>;
  change: RowChange;
  described: boolean;
  label: string;
  errorId: string;
  tickRef: React.RefObject<HTMLButtonElement | null>;
}) {
  if (r.canWrite) {
    return (
      <button
        ref={tickRef}
        type="button"
        // Safari does not focus a tapped button, so its press is noted before the field's blur.
        onPointerDown={change.notePress}
        onKeyDown={change.noteKey}
        // Focus the ✓ here, or a field the ✓ replaces would take focus with it to the page.
        onClick={() => {
          tickRef.current?.focus();
          void change.pressTick();
        }}
        aria-pressed={r.logged !== null}
        aria-label={DAY_COPY.logLabel(label)}
        aria-disabled={r.pending || undefined}
        aria-busy={r.pending || undefined}
        // "Saving…" is the ✓'s DESCRIPTION while it is sent: its name stays "Log …", which
        // `aria-label` sets and content cannot change (12c review).
        aria-describedby={
          [
            described ? errorId : null,
            r.pending ? `${errorId}-saving` : null,
            r.otherUnit ? otherUnitLineId(errorId) : null,
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        className={cn(
          TICK_FOCUS_CLASS,
          TICK_CLASS,
          // Ticked: the `done` fill carries the state (at least 3:1 against an un-ticked ✓), and
          // under forced colours, where fills vanish, a heavier border does. Un-ticked: a muted
          // glyph, as v12's is.
          r.logged
            ? 'bg-done text-done-foreground border-done forced-colors:border-4'
            : 'bg-background text-muted-foreground',
          // FAM-1 12c: a ✓ still being sent does not look saved. Dashes in the foreground colour,
          // so they show on the done fill as on an empty ✓ (a `done` dash on a `done` fill does
          // not); not a fade (a faded glyph fails contrast), and a border style forced colours keep.
          r.pending && 'border-foreground border-2 border-dashed',
        )}
      >
        <span aria-hidden="true">✓</span>
        {r.pending ? (
          <span id={`${errorId}-saving`} className="sr-only">
            {SAVING_LABEL}
          </span>
        ) : null}
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
export function RowMessage({
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
export function useFocusRefusedField(
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
/** A field's name ends with what it holds: the unit spoken (`pounds`), or `reps`. */
export function fieldSpoken(item: DayItem, field: RowField): string {
  return field === 'reps' ? DAY_COPY.reps.toLowerCase() : unitSpoken(item.unit!);
}

/** The attributes every number field of a row shares: a ✓'s field and a Change's alike. */
export function numberFieldProps(field: RowField, last: boolean) {
  return {
    type: 'text',
    inputMode: field === 'reps' ? 'numeric' : 'decimal',
    enterKeyHint: last ? 'done' : 'next',
    autoComplete: 'off',
  } as const;
}

/** Enter on a field before the row's last: the next field of the same table row ("next" on a phone). */
export function focusNextField(input: HTMLInputElement) {
  const row = input.closest('tr');
  const inputs = row ? [...row.querySelectorAll('input')] : [];
  inputs[inputs.indexOf(input) + 1]?.focus();
}

export function RowInput({
  r,
  item,
  field,
  name,
  errorId,
  tickRef,
  inputRef,
  className,
  last = true,
}: {
  r: ReturnType<typeof useRow>;
  item: DayItem;
  field: RowField;
  name: string;
  errorId: string;
  tickRef: React.RefObject<HTMLButtonElement | null>;
  inputRef: (el: HTMLInputElement | null) => void;
  className: string;
  /** The row's last field: the phone's key says "done" (Enter is the ✓); before it, "next". */
  last?: boolean;
}) {
  const invalid = r.error?.invalid === true && (r.error.field ?? field) === field;
  const spoken = fieldSpoken(item, field);
  return (
    <input
      ref={inputRef}
      {...numberFieldProps(field, last)}
      value={r.text[field]}
      onChange={(e) => r.setText(field, e.target.value)}
      // Enter on the last field is the ✓. The field goes while the ✓ is in flight, so focus moves to
      // the ✓ first, as Reload's does; a refused number brings it back to the field. Enter on an
      // earlier field moves to the next one ("next" on a phone's keyboard).
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        if (!last) {
          e.preventDefault();
          focusNextField(e.currentTarget);
          return;
        }
        tickRef.current?.focus();
        void r.press();
      }}
      // The prescription's number: an empty ✓ logs it (plan D13). Not on a load that must be typed
      // again (H9), where an empty ✓ is refused: a placeholder there would look already filled in.
      placeholder={field === 'quantity' && r.mustTypeLoad ? undefined : placeholderOf(item, field)}
      aria-label={DAY_COPY.fieldLabel(name, spoken)}
      aria-invalid={invalid || undefined}
      aria-describedby={
        [r.error ? errorId : null, r.otherUnit ? otherUnitLineId(errorId) : null]
          .filter(Boolean)
          .join(' ') || undefined
      }
      className={cn(INPUT_CLASS, className)}
    />
  );
}

export function fieldHeader(item: DayItem, field: RowField): string {
  if (field === 'reps' || !item.unit) return DAY_COPY.reps;
  if (item.unit === 'sec') return DAY_COPY.secHeader;
  return item.unit === 'min' ? DAY_COPY.minHeader : unitSuffix(item.unit);
}

/** The id of a row's other-unit line, from the row's message id (`OtherUnitLine`). */
export const otherUnitLineId = (errorId: string) => `${errorId}-unit`;

/**
 * 12d-iii (D44): why a row's load is text, on a row whose quantity was logged in another unit than
 * the item's now. Not a live region: it is there on arrival, and the ✓ and the reps field point at
 * it (`aria-describedby`) only while it shows. On the tint it takes the tint's secondary text.
 */
export function OtherUnitLine({
  r,
  item,
  errorId,
  onTint,
}: {
  r: ReturnType<typeof useRow>;
  item: DayItem;
  errorId: string;
  onTint: boolean;
}) {
  if (!r.otherUnit) return null;
  const { from, to, unticked } = r.otherUnit;
  return (
    <p id={otherUnitLineId(errorId)} className={cn('text-sm', secondaryText(onTint))}>
      {DAY_COPY.otherUnit(unitSpoken(from), unitSpoken(to), { noun: fixNoun(item), unticked })}
    </p>
  );
}

/** What the other-unit line asks to have fixed: the load of a weight × reps row, else by its type. */
function fixNoun(item: DayItem): string {
  if (fieldsOf(item).includes('reps')) return DAY_COPY.otherUnitNoun.load;
  return item.trackingType === TRACKING_TYPE.distance
    ? DAY_COPY.otherUnitNoun.distance
    : DAY_COPY.otherUnitNoun.number;
}

/**
 * A quantity cell's text (12d-iii; plan U2.5): a load logged in another unit than its column's
 * shows its unit's code to the eye and says the unit's word to a screen reader, so "27.5 lb" under
 * a kg header is heard as "27.5 pounds". Any other cell is the bare text.
 */
export function QuantityCellText({
  item,
  values,
  text,
}: {
  item: DayItem;
  values: RowValues;
  text: string;
}) {
  const unit = otherUnitOf(item, values);
  const space = text.lastIndexOf(' ');
  // A plain count has no code to hide (`quantityText` writes the bare number).
  if (!unit || space < 0) return <>{text}</>;
  const quantity = text.slice(0, space);
  return (
    <>
      {quantity} <span aria-hidden="true">{unitSuffix(unit)}</span>
      <span className="sr-only">{unitSpoken(unit)}</span>
    </>
  );
}
