'use client';

import {
  ROW_REFUSAL,
  type DayItem,
  type DayRow,
  type RowRefusal,
  type RowValues,
} from '@mat-plan/shared';
import { useRef, useState } from 'react';

import { useDay } from './day-context';
import { DAY_COPY, refusalCopy } from './day-copy';
import {
  canChangeValues,
  changedText,
  EMPTY_TEXT,
  fieldValueText,
  readAmend,
  sameValues,
  spokenValues,
  textOf,
  valuesText,
  type KeptField,
  type RowField,
  type RowText,
} from './row-values';
import { rowName, type useRow } from './use-row';

/**
 * **Change** (FAM-1 step 13b-ii): a logged row's numbers, edited in place (plan D20, §8).
 *
 * The maintainer's guards (2026-11-16): focus selects the whole number, Escape reverts, and a
 * visible "Changed 30 → 35 · Undo" follows a save. Undo returns the numbers from **before the first
 * Change this visit**, so a typo between two changes is never what comes back. Phones have no
 * Escape, so while a number differs from the stored one the row says "Not saved. Was 30 lb." with
 * a Cancel.
 *
 * **When a Change is sent: when focus leaves the row from one of its fields** (for anywhere outside
 * both of its table rows), on Enter in its last field, or on its ✓; one amend per row, so a load and reps changed together are one write. Never
 * when the window loses focus (a kid checking a timer would save the half-typed number).
 *
 * 🔴 **Safari does not focus a tapped button**, so a field's blur (with no `relatedTarget`) arrives
 * before the button's click. Two buttons in the row are pressed during an edit, and each notes its
 * press on pointer-down, before that blur:
 * - **the ✓** never un-ticks a row whose press began during an edit: the blur has already sent,
 *   reverted or found nothing to send, so the click would read a clean row. A click that began in an
 *   edit saves the change if there is still one, and otherwise does nothing.
 * - **Cancel** stops the blur from sending the number it is about to throw away.
 * Only a logged row can be in an edit: an unlogged row's ✓ is a ✓ (`editable` gates both notes).
 *
 * **What is typed** is only the fields touched: the others read the stored numbers at the moment of
 * sending, so a number another phone changed meanwhile is never sent back by this one. **A field
 * that keeps its number** (blank, not a number, out of range) keeps its own logged number while the
 * row's other fields are still sent (`readAmend`), and the line says so.
 */

type Line =
  | { kind: 'changed'; from: RowValues; to: RowValues; kept: string | null }
  | { kind: 'back'; to: RowValues; kept: string | null }
  | { kind: 'kept'; text: string };

type Row = ReturnType<typeof useRow>;

/** The attribute that marks a row's elements (both table rows of a set), so focus can tell it left. */
export const ROW_ID_ATTR = 'data-row-id';
export const rowIdProps = (rowId: string) => ({ [ROW_ID_ATTR]: rowId });
const inRow = (el: Element, rowId: string) => el.closest(`[${ROW_ID_ATTR}="${rowId}"]`) !== null;

function keptText(item: DayItem, logged: RowValues, kept: KeptField[]): string | null {
  if (kept.length === 0) return null;
  return kept
    .map(({ field, problem, typed }) => {
      const was = fieldValueText(item, logged, field);
      return problem === 'out_of_range'
        ? DAY_COPY.change.kept.out_of_range(was, typed)
        : DAY_COPY.change.kept[problem](was);
    })
    .join(' ');
}

export function useChange(r: Row, item: DayItem, row: DayRow, rowId: string) {
  const day = useDay();
  const entry = r.entry;
  const name = rowName(item, row);
  const editable =
    r.canWrite &&
    day.actions.amendRow !== undefined &&
    item.prescriptionPublicId !== null &&
    entry !== null &&
    canChangeValues(item, entry.values);

  /** The fields typed in, and only those. */
  const [draft, setDraft] = useState<Partial<RowText> | null>(null);
  /** The numbers before the first Change this visit: what Undo returns. */
  const [baseline, setBaseline] = useState<RowValues | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  /** Whether the ✓'s current press began while an edit was open (see the header). */
  const pressBeganInEdit = useRef(false);
  /** Whether Cancel's press has begun, so the field's blur does not send what it cancels. */
  const cancelling = useRef(false);

  // A different entry (an un-tick, a new ✓, a reload that changed the row) ends this visit's Change.
  const entryId = entry?.entryPublicId ?? null;
  const [seenEntry, setSeenEntry] = useState(entryId);
  if (entryId !== seenEntry) {
    setSeenEntry(entryId);
    setDraft(null);
    setBaseline(null);
    setLine(null);
  }
  // A row that stops being changeable (its item's unit changed, the day closed) drops what was typed.
  if (!editable && draft !== null) {
    setDraft(null);
    if (r.error?.write === 'amend') r.clearError();
  }
  // Another phone's Change (or a reload) retires the line, its Undo and Undo's baseline: the row no
  // longer holds what the line says it changed to, and Undo would write over that phone's number.
  if (
    line !== null &&
    line.kind !== 'kept' &&
    entry !== null &&
    !r.pending &&
    !sameValues(entry.values, line.to)
  ) {
    setLine(null);
    setBaseline(null);
    if (r.error?.write === 'amend') r.clearError();
  }

  const clean = entry ? textOf(item, entry.values) : EMPTY_TEXT;
  const text: RowText = { ...clean, ...draft };
  const changedFields = (Object.keys(draft ?? {}) as RowField[]).filter(
    (field) => text[field] !== clean[field],
  );
  const dirty = editable && changedFields.length > 0;
  // Nothing typed differs from what is stored any more (the data caught up with a write whose
  // answer was lost): a failed save's "not saved" no longer says anything true.
  if (!dirty && r.error?.write === 'amend' && r.error.counts) r.clearError();
  const shownLine = editable && !dirty ? line : null;

  function clearChangeError() {
    if (r.error?.write === 'amend') r.clearError();
  }

  function setText(field: RowField, next: string) {
    setDraft({ ...draft, [field]: next });
    if (line?.kind === 'kept') setLine(null);
    // Typed back to what is stored: nothing is unsaved any more, so a failed save's message goes.
    const backToStored = (Object.keys({ ...draft, [field]: next }) as RowField[]).every(
      (f) => (f === field ? next : text[f]) === clean[f],
    );
    if (backToStored) clearChangeError();
  }

  function revert() {
    // A Change in flight cannot be called back: Escape then would say "cancelled" over a write
    // that still lands (Cancel is hidden then, for the same reason).
    if (r.pending) return;
    cancelling.current = false;
    const was = dirty;
    setDraft(null);
    clearChangeError();
    if (line?.kind === 'kept') setLine(null);
    if (was) day.announce(DAY_COPY.announce.cancelled(name));
  }

  /** `save`: a Change that did not save counts as "not saved"; a failed Undo leaves nothing typed. */
  function refused(reason: RowRefusal, still: RowValues, kind: 'save' | 'undo') {
    if (reason === ROW_REFUSAL.closed_day) {
      setDraft(null);
      return;
    }
    const copy = refusalCopy(reason, 'amend');
    if (!copy.reload) {
      // The typed number stays, so the row can try again.
      const failed = kind === 'save' ? DAY_COPY.change.failed : DAY_COPY.change.undoFailed;
      r.showError({
        message: failed(valuesText(still)),
        reload: false,
        counts: kind === 'save',
        invalid: false,
        write: 'amend',
      });
      return;
    }
    // The page is out of date: the row shows what is stored, and offers Reload.
    setDraft(null);
    r.showError({
      message: copy.message,
      reload: true,
      counts: false,
      invalid: false,
      write: 'amend',
    });
  }

  async function commit() {
    if (!dirty || !entry || r.pending) return;
    const from = entry.values;
    const { send, kept } = readAmend(item, text, from);
    const keptLine = keptText(item, from, kept);
    if (!send) {
      setDraft(null);
      clearChangeError();
      if (keptLine) {
        setLine({ kind: 'kept', text: keptLine });
        day.announce(DAY_COPY.announce.failed(name, keptLine));
      }
      return;
    }
    const result = await r.amend(send);
    if (!result.ok) return refused(result.reason, from, 'save');
    setDraft(null);
    const base = baseline ?? from;
    setBaseline(base);
    const kept_ = keptLine ? ` ${keptLine}` : '';
    if (sameValues(base, result.values)) {
      setLine({ kind: 'back', to: result.values, kept: keptLine });
      day.announce(DAY_COPY.announce.changedBack(name, spokenValues(result.values)) + kept_);
    } else {
      setLine({ kind: 'changed', from: base, to: result.values, kept: keptLine });
      day.announce(
        DAY_COPY.announce.changed(name, spokenValues(base), spokenValues(result.values)) + kept_,
      );
    }
  }

  async function undo() {
    if (!baseline || !entry || r.pending) return;
    const still = entry.values;
    const result = await r.amend(baseline);
    if (!result.ok) return refused(result.reason, still, 'undo');
    setLine({ kind: 'back', to: result.values, kept: null });
    day.announce(DAY_COPY.announce.changedBack(name, spokenValues(result.values)));
  }

  /** A field of this row has focus and something was typed in it: an edit is open. */
  function typingInThisRow(): boolean {
    const active = document.activeElement;
    return draft !== null && active instanceof HTMLInputElement && inRow(active, rowId);
  }

  function lineText(shown: Line): string {
    if (shown.kind === 'kept') return shown.text;
    const said =
      shown.kind === 'back'
        ? DAY_COPY.change.changedBack(valuesText(shown.to))
        : (({ from, to }) => DAY_COPY.change.changed(from, to))(
            changedText(item, shown.from, shown.to),
          );
    return shown.kept ? `${said}. ${shown.kept}` : said;
  }

  return {
    editable,
    text,
    dirty,
    /** Whether this field holds a number other than the stored one: only it loses the logged look. */
    fieldDirty: (field: RowField) => dirty && changedFields.includes(field),
    /** What the line under the row says when it is not an error: the Change, Undo's, or a kept number. */
    line: shownLine ? { text: lineText(shownLine), canUndo: shownLine.kind === 'changed' } : null,
    /** Undo is offered while a Change's line holds, also beside a failed Undo's message. */
    canUndo: editable && !dirty && line?.kind === 'changed',
    /** "Not saved. Was 30 lb.": the stored numbers, while the field holds others. */
    was: dirty && entry ? DAY_COPY.change.notSaved(valuesText(entry.values)) : null,
    /** A Change that failed to save, still typed: the row offers to try again. */
    canRetry: dirty && r.error?.write === 'amend' && !r.error.reload,
    pending: r.pending,
    setText,
    revert,
    commit,
    undo,
    /** The ✓'s pointer-down: notes whether this press began during an edit of a logged row. */
    notePress() {
      pressBeganInEdit.current = editable && (dirty || r.pending || typingInThisRow());
    },
    /** A key on the ✓: a keyboard press reads the row as it is, not a pointer's note. */
    noteKey() {
      pressBeganInEdit.current = false;
    },
    /** A field took focus, or Cancel's press was called off (a scroll): no Cancel is under way. */
    noteFocus() {
      cancelling.current = false;
    },
    /** Cancel's pointer-down: the blur that follows in Safari must not send what Cancel discards. */
    noteCancel() {
      cancelling.current = true;
    },
    /** The ✓: saves an open Change; un-ticks only when no edit was open. */
    pressTick() {
      const inEdit = pressBeganInEdit.current;
      pressBeganInEdit.current = false;
      if (dirty) return commit();
      if (inEdit) return;
      return r.press();
    },
    /** A field's blur: sends the Change once focus has left the row, never on a window blur. */
    onFieldBlur(event: React.FocusEvent<HTMLInputElement>) {
      if (!dirty || cancelling.current) return;
      const to = event.relatedTarget;
      if (to instanceof Element && inRow(to, rowId)) return;
      // The window lost focus (another app, the lock screen): the field is still the page's active
      // element, which a blur within the page never leaves it as.
      if (document.activeElement === event.currentTarget) return;
      void commit();
    },
  };
}

export type RowChange = ReturnType<typeof useChange>;
