'use client';

import {
  ROW_REFUSAL,
  type DayItem,
  type DayRow,
  type RowRefusal,
  type RowValues,
} from '@mat-plan/shared';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { useDay } from './day-context';
import { DAY_COPY, refusalCopy } from './day-copy';
import {
  changeableFields,
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
 * a ✕ (cancel) under the ✓.
 *
 * **When a Change is sent: when focus leaves the row from any of its controls** (for anywhere
 * outside both of its table rows), on Enter in its last field, or on its ✓; one amend per row, so
 * a load and reps changed together are one write. Never when the window loses focus (a kid
 * checking a timer would save the half-typed number). "Any of its controls" (13b-ii said "one of
 * its fields") and the ✕ press rule below (`noteCancel`) are the maintainer's (FAM-1 D43, 2026-11-18).
 *
 * 🔴 **Safari does not focus a tapped button**, so a field's blur (with no `relatedTarget`) arrives
 * before the button's click. Two buttons in the row are pressed during an edit, and each notes its
 * press on pointer-down, before that blur:
 * - **the ✓** never un-ticks a row whose press began during an edit: the blur has already sent,
 *   reverted or found nothing to send, so the click would read a clean row. A click that began in an
 *   edit saves the change if there is still one, and otherwise does nothing.
 * - **the ✕ (cancel)** stops the blur from sending the number it is about to throw away.
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

/**
 * How long after a ✕ press is released the click that cancels may still arrive. iOS sends its click
 * after the compat mouse events and decides itself whether the tap hit the ✕ (tap slop, touch
 * adjustment), so the release point says nothing; only a click that does not come calls the press
 * off. Long enough for that click on a phone, short next to a person's next tap.
 */
const CANCEL_CLICK_GRACE_MS = 400;

/**
 * A row's container props for Change: its id, and the row-level Escape and blur (`onRowKeyDown`,
 * `onRowBlur`). One helper for a card's `<li>` and both `<tr>`s of a set row, which share the id.
 */
export function changeRowProps(
  rowId: string,
  change: Pick<RowChange, 'onRowKeyDown' | 'onRowBlur'>,
) {
  return { ...rowIdProps(rowId), onKeyDown: change.onRowKeyDown, onBlur: change.onRowBlur };
}
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

export function useChange(
  r: Row,
  item: DayItem,
  row: DayRow,
  rowId: string,
  /** The row's ✓: where Escape from a button the revert removes sends focus. */
  tickRef: React.RefObject<HTMLButtonElement | null>,
) {
  const day = useDay();
  const entry = r.entry;
  const name = rowName(item, row);
  /** The fields a Change may edit: all, the reps only (a load logged in another unit), or none. */
  const fields =
    r.canWrite &&
    day.actions.amendRow !== undefined &&
    item.prescriptionPublicId !== null &&
    entry !== null
      ? changeableFields(item, entry.values)
      : [];
  const editable = fields.length > 0;

  /** The fields typed in, and only those. */
  const [draft, setDraft] = useState<Partial<RowText> | null>(null);
  /** The numbers before the first Change this visit: what Undo returns. */
  const [baseline, setBaseline] = useState<RowValues | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  /** Whether the ✓'s current press began while an edit was open (see the header). */
  const pressBeganInEdit = useRef(false);
  /** Whether the ✕'s press has begun, so the field's blur does not send what it cancels. */
  const cancelling = useRef(false);
  /** Ends the ✕'s press watch (`noteCancel`): removes its two window listeners. */
  const endPressWatch = useRef<(() => void) | null>(null);
  function stopPressWatch() {
    endPressWatch.current?.();
    endPressWatch.current = null;
  }
  useEffect(() => stopPressWatch, []);

  // A different entry (an un-tick, a new ✓, a reload that changed the row) ends this visit's Change.
  const entryId = entry?.entryPublicId ?? null;
  const [seenEntry, setSeenEntry] = useState(entryId);
  if (entryId !== seenEntry) {
    setSeenEntry(entryId);
    setDraft(null);
    setBaseline(null);
    setLine(null);
  }
  // Another phone's Change to this entry (the same entry, new numbers): a drafted field that
  // equalled what was stored was not an edit, so it is dropped, field by field, never turned into
  // one that a blur would send over that phone's number ("Not saved. Was 35 lb" for a "30" nobody
  // meant). A field really typed stays. Same entry only: a new one already dropped the draft above.
  // (12c-iii follow-up; the phantom predates the fold, #462.)
  const values = entry?.values ?? null;
  const [seenValues, setSeenValues] = useState(values);
  // What another phone's change does to a row this one was changing, said by the page's announcer
  // (never by the line: it is not a live region). Set here, during render; said by the effect below.
  const [elsewhere, setElsewhere] = useState<{ text: string } | null>(null);
  // This phone's own write, from the call until its draft is cleared: the answer lands (the row's
  // values move) one render before `setDraft(null)`, and is never another phone's change.
  const [saving, setSaving] = useState(false);
  if (values !== seenValues) {
    setSeenValues(values);
    if (
      entryId === seenEntry &&
      draft !== null &&
      seenValues &&
      values &&
      !sameValues(values, seenValues)
    ) {
      // A failed save's "Couldn’t save. Still 27.5 lb" names what is no longer stored: it gives way
      // to the draft's own "Not saved. Was 35 lb". Only a failed save (`counts`): a Reload notice
      // leaves no draft, and a failed Undo's draft (typed back) is no edit, so it is dropped below
      // and the line block clears its message.
      if (r.error?.write === 'amend' && r.error.counts) r.clearError();
      const was = textOf(item, seenValues);
      const drafted = Object.keys(draft) as RowField[];
      const typed = drafted.filter((f) => draft[f] !== was[f]);
      // Said only for a row that showed "Not saved" or "Couldn’t save" (a draft typed back is
      // silent), and never for this phone's own save (its answer is announced by `commit`).
      if (editable && typed.length > 0 && !r.pending && !saving) {
        const now = textOf(item, values);
        // Still typed: a field that still differs and can still be changed (a load whose unit moved
        // stops being a field, and its draft goes below). Else only what is stored is said, which is
        // true whether another phone wrote it or this one's own write landed with its answer lost.
        const stillTyped = typed.some((f) => fields.includes(f) && draft[f] !== now[f]);
        const to = spokenValues(values);
        setElsewhere({
          text: stillTyped
            ? DAY_COPY.announce.changedElsewhere(name, to)
            : DAY_COPY.announce.savedAs(name, to),
        });
      }
      if (typed.length === 0) setDraft(null);
      else if (typed.length < drafted.length) {
        setDraft(Object.fromEntries(typed.map((f) => [f, draft[f]])) as Partial<RowText>);
      }
    }
  }
  // A row that stops being changeable (the day closed), or whose typed field stops being one (its
  // item's unit changed under it, so the load is text now: 12d-iii), drops what was typed.
  if (draft !== null && (Object.keys(draft) as RowField[]).some((f) => !fields.includes(f))) {
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

  // Keyed on the sentence alone: `day` is not a dependency, so a re-render that hands down a new
  // context value (the announcement's own, say) never says it twice.
  const announceElsewhere = useEffectEvent((text: string) => day.announce(text));
  useEffect(() => {
    if (elsewhere) announceElsewhere(elsewhere.text);
  }, [elsewhere]);

  // 12c-iii: a Change typed and not saved keeps its workout open ("Collapse" is not offered). Its
  // own key: the row's message reports under `rowKey`, and its cleanup must not end this one's.
  const { setRowBusy } = day;
  const changeKey = `${r.rowKey}/change`;
  useEffect(() => {
    if (!dirty) return;
    setRowBusy(changeKey, true);
    return () => setRowBusy(changeKey, false);
  }, [dirty, changeKey, setRowBusy]);

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
    // that still lands (the ✕ is invisible then, for the same reason).
    if (r.pending) return;
    cancelling.current = false;
    // The ✕'s click (or Escape) is the cancel the press watch was waiting for.
    stopPressWatch();
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
    const { send, kept } = readAmend(item, text, from, fields);
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
    setSaving(true);
    const result = await r.amend(send);
    // Cleared with the draft (same batch), never before it.
    setSaving(false);
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
    setSaving(true);
    const result = await r.amend(baseline);
    setSaving(false);
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

  // What the ✕'s press watch reads when the press ends, after this render's closures are stale.
  const latest = useRef({ dirty, pending: r.pending, commit });
  useEffect(() => {
    latest.current = { dirty, pending: r.pending, commit };
  });

  return {
    /** The row's name (`Bench press set 1`): the announcer's, and the ✕'s. */
    name,
    editable,
    /** The fields shown as Change inputs; any other field stays text (12d-iii). */
    fields,
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
    /** A field took focus: no cancel is under way. */
    noteFocus() {
      cancelling.current = false;
      stopPressWatch();
    },
    /**
     * The ✕'s pointer-down: the blur that follows in Safari must not send what the ✕ discards. It
     * also watches how this press ends, once, by its `pointerId`:
     * - **released** (anywhere: where it lifts says nothing, since iOS targets its click itself):
     *   the ✕'s click, if it comes, cancels and ends the watch (`revert`). If none comes within
     *   `CANCEL_CLICK_GRACE_MS` (a press dragged off, a long press), the press is called off;
     * - **ended by a scroll** (`pointercancel`): no click will come, so it is called off at once.
     *
     * Called off, the row is left as a tap outside would leave it: `cancelling` is cleared, so the
     * next time focus leaves the row the Change is sent; and if focus has already left (Safari with
     * a mouse blurs the field at pointer-down), it is sent now. Sending after a press that began on
     * Cancel is a new save, which the maintainer chose ("Save it", FAM-1 D43, 2026-11-18) over only
     * clearing `cancelling` (plan `fam-1-change-escape-and-drag-off.md`).
     */
    noteCancel(event: React.PointerEvent<HTMLElement>) {
      cancelling.current = true;
      stopPressWatch();
      const pointerId = event.pointerId;
      let grace: ReturnType<typeof setTimeout> | null = null;
      const callOff = () => {
        stopPressWatch();
        cancelling.current = false;
        const now = latest.current;
        const active = document.activeElement;
        if (!now.dirty || now.pending) return;
        if (active instanceof Element && inRow(active, rowId)) return;
        void now.commit();
      };
      const onEnd = (ended: PointerEvent) => {
        if (ended.pointerId !== pointerId) return;
        window.removeEventListener('pointerup', onEnd, true);
        window.removeEventListener('pointercancel', onEnd, true);
        if (ended.type === 'pointercancel') callOff();
        else grace = setTimeout(callOff, CANCEL_CLICK_GRACE_MS);
      };
      window.addEventListener('pointerup', onEnd, true);
      window.addEventListener('pointercancel', onEnd, true);
      endPressWatch.current = () => {
        window.removeEventListener('pointerup', onEnd, true);
        window.removeEventListener('pointercancel', onEnd, true);
        if (grace !== null) clearTimeout(grace);
      };
    },
    /** The ✓: saves an open Change; un-ticks only when no edit was open. */
    pressTick() {
      const inEdit = pressBeganInEdit.current;
      pressBeganInEdit.current = false;
      if (dirty) return commit();
      if (inEdit) return;
      return r.press();
    },
    /**
     * Any control's blur, on the row's container (React's `onBlur` bubbles): sends the Change once
     * focus has left the row, never on a window blur.
     */
    onRowBlur(event: React.FocusEvent<HTMLElement>) {
      if (!dirty || cancelling.current) return;
      const to = event.relatedTarget;
      if (to instanceof Element && inRow(to, rowId)) return;
      // The window lost focus (another app, the lock screen): the control is still the page's
      // active element, which a blur within the page never leaves it as. 🔴 `target`, not
      // `currentTarget`: on the row's container that is the `<li>`/`<tr>`, which never has focus.
      if (document.activeElement === event.target) return;
      void commit();
    },
    /**
     * Escape anywhere in the row, on its container. While the row is changed and not saving, it
     * reverts; from a button the revert removes (the ✕, Try again), focus moves to the ✓ first, as
     * the ✕ does. On a clean row, Escape in a field still clears a kept number's line or an error,
     * and from a button does nothing, so another control's Escape is never taken. An event from a
     * portaled descendant (outside the row's own DOM) is ignored.
     */
    onRowKeyDown(event: React.KeyboardEvent<HTMLElement>) {
      if (event.key !== 'Escape') return;
      const from = event.target;
      if (!(from instanceof Node) || !event.currentTarget.contains(from)) return;
      const fromField = from instanceof HTMLInputElement;
      if (dirty) {
        // Prevented even while saving, as the field's own Escape was: a sheet around the row must
        // not close on it.
        event.preventDefault();
        if (r.pending) return;
        if (!fromField) tickRef.current?.focus();
        revert();
      } else if (fromField) {
        revert();
      }
    },
  };
}

export type RowChange = ReturnType<typeof useChange>;
