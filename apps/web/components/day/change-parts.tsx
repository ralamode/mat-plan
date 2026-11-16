'use client';

import { type DayItem } from '@mat-plan/shared';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { DAY_COPY } from './day-copy';
import {
  CHANGED_FIELD_CLASS,
  LOGGED_FIELD_CLASS,
  ON_TINT_BUTTON_FOCUS_CLASS,
  RowMessage,
} from './row-parts';
import { unitSpoken, type RowField } from './row-values';
import type { RowChange } from './use-change';
import type { useRow } from './use-row';

/**
 * Change's parts (FAM-1 step 13b-ii): a logged number as a field, and the line under a row.
 */

/**
 * A logged number that can be changed. Focus selects all of it, so typing replaces the number rather
 * than appending to it ("30" then "35" must never become "3035"). Escape reverts; Enter in the row's
 * last field saves; leaving the row saves (`use-change.ts`). While a Change is in flight the field is
 * read-only and keeps focus, so there is never a second write behind it.
 */
export function ChangeInput({
  change,
  item,
  field,
  name,
  lineId,
  described,
  tickRef,
  inputRef,
  className,
  last = true,
}: {
  change: RowChange;
  item: DayItem;
  field: RowField;
  name: string;
  lineId: string;
  /** Whether the row's line is showing, so the field points at it. */
  described: boolean;
  tickRef: React.RefObject<HTMLButtonElement | null>;
  inputRef: (el: HTMLInputElement | null) => void;
  className: string;
  last?: boolean;
}) {
  const spoken = field === 'reps' ? DAY_COPY.reps.toLowerCase() : unitSpoken(item.unit!);
  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={field === 'reps' ? 'numeric' : 'decimal'}
      enterKeyHint={last ? 'done' : 'next'}
      autoComplete="off"
      value={change.text[field]}
      readOnly={change.pending}
      onChange={(e) => change.setText(field, e.target.value)}
      onFocus={(e) => {
        const el = e.currentTarget;
        const atFocus = el.value;
        el.select();
        // iOS places the caret where the tap landed after focus, undoing a select made in `focus`,
        // so select again once the tap is done. 🔴 Only if nothing was typed since: selecting after
        // a first keystroke would let the next one replace it ("30" typed fast became "0").
        setTimeout(() => {
          if (document.activeElement === el && el.value === atFocus) {
            el.setSelectionRange(0, el.value.length);
          }
        }, 0);
      }}
      onBlur={change.onFieldBlur}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (change.dirty) e.preventDefault();
          change.revert();
          return;
        }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!last) {
          const row = e.currentTarget.closest('tr');
          const inputs = row ? [...row.querySelectorAll('input')] : [];
          inputs[inputs.indexOf(e.currentTarget) + 1]?.focus();
          return;
        }
        // Focus goes to the ✓ first, as a ✓'s Enter does, so a read-only field never holds it.
        tickRef.current?.focus();
        void change.commit();
      }}
      aria-label={DAY_COPY.fieldLabel(name, spoken)}
      aria-describedby={described ? lineId : undefined}
      className={cn(
        INPUT_CLASS,
        className,
        change.fieldDirty(field) ? CHANGED_FIELD_CLASS : LOGGED_FIELD_CLASS,
      )}
    />
  );
}

/**
 * The line under a row: its error (with Reload, as before), or Change's line. While a number is
 * typed over: "Not saved. Was 30 lb." and Cancel, which is a phone's Escape. After a save: "Changed
 * 30 → 35" and Undo. Focus goes to the ✓ before a button that is about to go.
 *
 * Not a live region: the page's one announcer speaks every change (`day.announce`).
 */
export function RowStatus({
  r,
  change,
  lineId,
  tickRef,
}: {
  r: ReturnType<typeof useRow>;
  change: RowChange;
  lineId: string;
  tickRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const cancel = change.dirty ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={ON_TINT_BUTTON_FOCUS_CLASS}
      onClick={() => {
        tickRef.current?.focus();
        change.revert();
      }}
    >
      {DAY_COPY.change.cancel}
    </Button>
  ) : null;

  if (r.error) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <RowMessage r={r} errorId={lineId} tickRef={tickRef} />
        {cancel}
      </div>
    );
  }
  const text = change.was ?? change.line?.text ?? null;
  if (text === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <p id={lineId} className="text-foreground text-sm">
        {text}
        {change.was ? <span className="sr-only"> {DAY_COPY.change.tickSaves}</span> : null}
      </p>
      {cancel}
      {!change.dirty && change.line?.canUndo ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={ON_TINT_BUTTON_FOCUS_CLASS}
          aria-disabled={change.pending || undefined}
          onClick={() => {
            tickRef.current?.focus();
            void change.undo();
          }}
        >
          {DAY_COPY.change.undo}
        </Button>
      ) : null}
    </div>
  );
}

/** Whether the row's line slot has anything to show. */
export function hasRowStatus(r: ReturnType<typeof useRow>, change: RowChange): boolean {
  return r.error !== null || change.was !== null || change.line !== null;
}
