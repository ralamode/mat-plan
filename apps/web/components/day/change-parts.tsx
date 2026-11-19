'use client';

import { type DayItem } from '@mat-plan/shared';

import { Button } from '@/components/ui/button';
import { InlineEditActions } from '@/components/ui/inline-edit-actions';
import { AMEND_COPY, INPUT_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { DAY_COPY } from './day-copy';
import {
  CHANGED_FIELD_CLASS,
  fieldSpoken,
  focusNextField,
  LOGGED_FIELD_CLASS,
  numberFieldProps,
  ON_TINT_BUTTON_FOCUS_CLASS,
  otherUnitLineId,
  RowMessage,
} from './row-parts';
import { type RowField } from './row-values';
import type { RowChange } from './use-change';
import type { useRow } from './use-row';

/**
 * Change's parts (FAM-1 step 13b-ii): a logged number as a field, and the line under a row.
 */

/**
 * A logged number that can be changed. Focus selects all of it, so typing replaces the number rather
 * than appending to it ("30" then "35" must never become "3035"). Escape (handled by the row,
 * `changeRowProps`) reverts; Enter in the row's last field saves and moves focus to the ✓; leaving
 * the row saves (`use-change.ts`). While a Change
 * is in flight the field is read-only, so there is never a second write behind it.
 */
export function ChangeInput({
  change,
  item,
  field,
  name,
  lineId,
  described,
  unitLine = false,
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
  /** Whether the row's other-unit line is showing (12d-iii), so the field points at it too. */
  unitLine?: boolean;
  tickRef: React.RefObject<HTMLButtonElement | null>;
  inputRef: (el: HTMLInputElement | null) => void;
  className: string;
  last?: boolean;
}) {
  return (
    <input
      ref={inputRef}
      {...numberFieldProps(field, last)}
      value={change.text[field]}
      readOnly={change.pending}
      onChange={(e) => change.setText(field, e.target.value)}
      onFocus={(e) => {
        change.noteFocus();
        // A half-typed number keeps its caret (focus coming back from another app, say).
        if (change.fieldDirty(field)) return;
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
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!last) {
          focusNextField(e.currentTarget);
          return;
        }
        // Focus goes to the ✓ first, as a ✓'s Enter does, so a read-only field never holds it.
        tickRef.current?.focus();
        void change.commit();
      }}
      aria-label={DAY_COPY.fieldLabel(name, fieldSpoken(item, field))}
      aria-describedby={
        [described ? lineId : null, unitLine ? otherUnitLineId(lineId) : null]
          .filter(Boolean)
          .join(' ') || undefined
      }
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
 * typed over: "Not saved. Was 30 lb." and an icon-only ✕, which is a phone's Escape. A failed save
 * adds "Try again". After a save: "Changed 30 → 35" and Undo, which stays beside a failed Undo.
 * Focus goes to the ✓ before a button that is about to go. Each button is described by the line, so
 * a screen reader hears which row's Undo or ✕ it is.
 *
 * **The ✕ sits at the line's right end, directly under the row's ✓** (maintainer, 2026-11-17, from
 * three captured options): the field's own line has no room for it at 360px, where a 44px column
 * would leave Previous 40-54px, narrower than its own header. Under the ✓ it reads as the ✓'s
 * partner, not as "dismiss this message". The caller's `underTickClassName` puts its right edge on
 * the ✓'s (`UNDER_TICK_CLASS` in the set table; none on a card, whose ✓ ends the line), and on the
 * "Not saved" line `pt-1` keeps 8px between the two, as `InlineEditActions` spaces a pair. Undo
 * never shows beside it (`canUndo` needs a row that is not typed over), so Undo stays by its text.
 *
 * Not a live region: the page's one announcer speaks every change (`day.announce`).
 */
export function RowStatus({
  r,
  change,
  lineId,
  tickRef,
  underTickClassName,
}: {
  r: ReturnType<typeof useRow>;
  change: RowChange;
  lineId: string;
  tickRef: React.RefObject<HTMLButtonElement | null>;
  /** Lines the ✕ up under the row's ✓: a table's ✓ is centred in its column, a card's is not. */
  underTickClassName?: string;
}) {
  const buttonProps = {
    type: 'button',
    variant: 'outline',
    size: 'sm',
    className: ON_TINT_BUTTON_FOCUS_CLASS,
    'aria-describedby': lineId,
  } as const;
  const retry = change.canRetry ? (
    <Button
      {...buttonProps}
      aria-disabled={change.pending || undefined}
      onClick={() => {
        tickRef.current?.focus();
        void change.commit();
      }}
    >
      {DAY_COPY.change.retry}
    </Button>
  ) : null;
  // Mounted for as long as a number is typed over, the save included: while it is in flight the ✕
  // is invisible but keeps its 44px, so the line does not move, and it cannot stop the write.
  // Its name is the row's (`change.name`, the announcer's too), so two rows' ✕s never share one.
  // `pt-1` only under the ✓: beside Try again or Reload it would sit 2px low.
  const cancel = (underTick: boolean) =>
    change.dirty ? (
      <div className={cn('ml-auto shrink-0', underTick && 'pt-1', underTickClassName)}>
        <InlineEditActions
          cancelLabel={AMEND_COPY.cancelLabel(change.name)}
          onCancel={() => {
            // The caller's own guard (the ✕ is out of reach then anyway): focus stays put.
            if (change.pending) return;
            // The ✕ goes with the edit it cancels, so focus moves first, or it falls to the page.
            tickRef.current?.focus();
            change.revert();
          }}
          cancelHandlers={{
            // Safari: the field's blur comes before this click and must not send what ✕ discards.
            // How the press ends (a release elsewhere, a scroll) is watched by `noteCancel` itself.
            onPointerDown: change.noteCancel,
          }}
          pending={change.pending}
          describedBy={lineId}
          focusClassName={ON_TINT_BUTTON_FOCUS_CLASS}
        />
      </div>
    ) : null;
  const undo = change.canUndo ? (
    <Button
      {...buttonProps}
      aria-disabled={change.pending || undefined}
      onClick={() => {
        tickRef.current?.focus();
        void change.undo();
      }}
    >
      {DAY_COPY.change.undo}
    </Button>
  ) : null;

  if (r.error) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <RowMessage r={r} errorId={lineId} tickRef={tickRef} />
        {retry}
        {undo}
        {cancel(false)}
      </div>
    );
  }
  const text = change.was ?? change.line?.text ?? null;
  if (text === null) return null;
  return (
    // No wrap: the text is at most ~215px, and the ✕ takes 58px with the gap and `mr-1.5`, inside
    // a 288px superset card at 360px; longer text wraps inside the `<p>`. No `flex-1` on the text,
    // so Undo stays beside "Changed 30 → 35" and only the ✕ (`ml-auto`) goes to the right end.
    <div className="flex items-center gap-x-2">
      <p id={lineId} className="text-foreground min-w-0 text-sm">
        {text}
        {change.was ? <span className="sr-only"> {DAY_COPY.change.tickSaves}</span> : null}
      </p>
      {undo}
      {cancel(true)}
    </div>
  );
}

/** Whether the row's line slot has anything to show. */
export function hasRowStatus(r: ReturnType<typeof useRow>, change: RowChange): boolean {
  return r.error !== null || change.was !== null || change.line !== null;
}
