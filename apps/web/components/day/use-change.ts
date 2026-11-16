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
 * **When a Change is sent: when focus leaves the row** (both of its table rows), on Enter in its last
 * field, or on its ✓; one amend per row, so a load and reps changed together are one write. Never
 * when the window loses focus (a kid checking a timer would save the half-typed number).
 *
 * 🔴 **The ✓ never un-ticks a row whose press began during an edit.** Safari does not focus a tapped
 * button, so the field's blur (with no `relatedTarget`) arrives before the ✓'s click and has already
 * sent, reverted or found nothing to send by the time the click lands; the click would then read a
 * clean row and un-tick it. So the ✓ notes, on pointer-down, whether an edit was open, and a click
 * that began in one saves the change if there is still one, and otherwise does nothing.
 *
 * **A field that keeps its number** (blank, not a number, out of range) keeps its own logged number
 * while the row's other fields are still sent (`readAmend`).
 */

type Line =
  | { kind: 'changed'; from: RowValues; to: RowValues }
  | { kind: 'back'; to: RowValues }
  | { kind: 'kept'; text: string };

type Row = ReturnType<typeof useRow>;

function keptText(item: DayItem, logged: RowValues, kept: KeptField): string {
  const was = fieldValueText(item, logged, kept.field);
  if (kept.problem === 'out_of_range') return DAY_COPY.change.kept.out_of_range(was, kept.typed);
  return DAY_COPY.change.kept[kept.problem](was);
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

  const [draft, setDraft] = useState<RowText | null>(null);
  /** The numbers before the first Change this visit: what Undo returns. */
  const [baseline, setBaseline] = useState<RowValues | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  /** Whether the ✓'s current press began while an edit was open (see the header). */
  const pressBeganInEdit = useRef(false);

  // A different entry (an un-tick, a new ✓, a reload that changed the row) ends this visit's Change.
  const entryId = entry?.entryPublicId ?? null;
  const [seenEntry, setSeenEntry] = useState(entryId);
  if (entryId !== seenEntry) {
    setSeenEntry(entryId);
    setDraft(null);
    setBaseline(null);
    setLine(null);
  }

  const clean = entry ? textOf(item, entry.values) : EMPTY_TEXT;
  const text = draft ?? clean;
  const dirty =
    editable && draft !== null && (draft.quantity !== clean.quantity || draft.reps !== clean.reps);
  // A "Changed" line describes the row only while the row still holds what it says it changed to:
  // another phone's Change, or a reload, retires it and its Undo.
  const lineHolds =
    line !== null &&
    (line.kind === 'kept' || (entry !== null && sameValues(entry.values, line.to)));
  const shownLine = editable && !dirty && lineHolds ? line : null;

  function clearChangeError() {
    if (r.error?.write === 'amend') r.clearError();
  }

  function setText(field: RowField, next: string) {
    setDraft({ ...text, [field]: next });
  }

  function revert() {
    setDraft(null);
    clearChangeError();
  }

  function refused(reason: RowRefusal, still: RowValues, failed: (still: string) => string) {
    if (reason === ROW_REFUSAL.closed_day) {
      setDraft(null);
      return;
    }
    if (reason === ROW_REFUSAL.retry || reason === ROW_REFUSAL.own_hidden) {
      // The typed number stays, so the ✓ can try again; it is a save that did not happen.
      r.showError({
        message: failed(valuesText(still)),
        reload: false,
        counts: true,
        invalid: false,
        write: 'amend',
      });
      return;
    }
    // Any other refusal means the page is out of date: the row shows what is stored.
    setDraft(null);
    r.showError({ ...staleCopy(reason), counts: false, invalid: false, write: 'amend' });
  }

  async function commit() {
    if (!dirty || !entry || r.pending) return;
    const from = entry.values;
    const { send, kept } = readAmend(item, text, from);
    if (!send) {
      setDraft(null);
      clearChangeError();
      const first = kept[0];
      if (first) {
        const message = keptText(item, from, first);
        setLine({ kind: 'kept', text: message });
        day.announce(DAY_COPY.announce.failed(name, message));
      }
      return;
    }
    const result = await r.amend(send);
    if (!result.ok) return refused(result.reason, from, DAY_COPY.change.failed);
    setDraft(null);
    const base = baseline ?? from;
    setBaseline(base);
    if (sameValues(base, result.values)) {
      setLine({ kind: 'back', to: result.values });
      day.announce(DAY_COPY.announce.changedBack(name, spokenValues(result.values)));
    } else {
      setLine({ kind: 'changed', from: base, to: result.values });
      day.announce(
        DAY_COPY.announce.changed(name, spokenValues(base), spokenValues(result.values)),
      );
    }
  }

  async function undo() {
    if (!baseline || !entry || r.pending) return;
    const still = entry.values;
    const result = await r.amend(baseline);
    if (!result.ok) return refused(result.reason, still, DAY_COPY.change.undoFailed);
    setLine({ kind: 'back', to: result.values });
    day.announce(DAY_COPY.announce.changedBack(name, spokenValues(result.values)));
  }

  function editingThisRow(): boolean {
    const active = document.activeElement;
    return (
      active instanceof HTMLInputElement && active.closest(`[data-row-id="${rowId}"]`) !== null
    );
  }

  return {
    editable,
    text,
    dirty,
    /** Whether this field holds a number other than the stored one: only it loses the logged look. */
    fieldDirty: (field: RowField) => dirty && text[field] !== clean[field],
    /** What the line under the row says when it is not an error: the Change, Undo's, or a kept number. */
    line: shownLine
      ? shownLine.kind === 'kept'
        ? { text: shownLine.text, canUndo: false }
        : shownLine.kind === 'back'
          ? { text: DAY_COPY.change.changedBack(valuesText(shownLine.to)), canUndo: false }
          : {
              text: (({ from, to }) => DAY_COPY.change.changed(from, to))(
                changedText(item, shownLine.from, shownLine.to),
              ),
              canUndo: true,
            }
      : null,
    /** "Not saved. Was 30 lb.": the stored numbers, while the field holds others. */
    was: dirty && entry ? DAY_COPY.change.notSaved(valuesText(entry.values)) : null,
    pending: r.pending,
    setText,
    revert,
    commit,
    undo,
    /** The ✓'s pointer-down: notes whether this press began during an edit. */
    notePress() {
      pressBeganInEdit.current = dirty || r.pending || editingThisRow();
    },
    /** A key on the ✓: a keyboard press reads the row as it is, not a pointer's note. */
    noteKey() {
      pressBeganInEdit.current = false;
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
      if (!dirty) return;
      const to = event.relatedTarget;
      if (to instanceof Element && to.closest(`[data-row-id="${rowId}"]`)) return;
      // The window lost focus (another app, the lock screen): the field is still the page's active
      // element, which a blur within the page never leaves it as.
      if (document.activeElement === event.currentTarget) return;
      void commit();
    },
  };
}

/** A refusal of a Change that means the page is out of date: the row offers Reload. */
function staleCopy(reason: RowRefusal): { message: string; reload: boolean } {
  return { message: refusalCopy(reason, 'amend').message, reload: true };
}

export type RowChange = ReturnType<typeof useChange>;
