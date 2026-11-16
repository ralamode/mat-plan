'use client';

import { type DayItem } from '@mat-plan/shared';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { useDay } from './day-context';
import { DAY_COPY } from './day-copy';
import { placeholderOf, unitSpoken, unitSuffix, type RowField } from './row-values';
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
 * The ✓'s focus ring (design.md): full-opacity `foreground`, OUTSIDE the ✓, never inset on the
 * fill. An outline, so the gap shows the tint or the card behind it rather than a painted offset.
 *
 * ⚠️ `focus-visible:outline-solid` is load-bearing: Tailwind's `outline-none` sets the outline
 * style to `none` through a variable that `outline-3` reads, so without it no ring is drawn.
 */
export const TICK_FOCUS_CLASS =
  'outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-foreground';

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
export function Tick({
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
export function RowInput({
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

export function fieldHeader(item: DayItem, field: RowField): string {
  if (field === 'reps' || !item.unit) return DAY_COPY.reps;
  return item.unit === 'sec' ? 'Sec' : item.unit === 'min' ? 'Min' : unitSuffix(item.unit);
}
