'use client';

import { isBlankEntry, type Unit } from '@mat-plan/shared';
import { useActionState, useId, useLayoutEffect, useRef, useState } from 'react';

import { useSectionBusy } from '@/components/day/collapsible-section';
import { Button } from '@/components/ui/button';
import { InlineEditActions } from '@/components/ui/inline-edit-actions';
import { AMEND_COPY, changeLabel, INPUT_CLASS, type SingleValueCopy } from '@/lib/constants';
import { formatValueUnit } from '@/lib/entries/format-value-unit';

import { TickedCopy } from './log-tick';
import { useSingleValueLive } from './single-value-live';

/** What a submit answered, in the editor's own terms: each row's wrapper maps its action to this. */
export type AmendOutcome = { ok: true } | { ok: false; error: string; field?: string };

const NOT_SUBMITTED: AmendOutcome = { ok: true };

/**
 * Change an already-logged single value, or clear it with a blank ✓ (V1-24 3b-bw W5; shared with
 * practice at 3b-life A2). The bodyweight and practice rows pass their copy, their field's name and
 * keypad, and a `submit` that runs their action and maps its answer to an `AmendOutcome`.
 *
 * ## Rendered on today and yesterday only
 *
 * A day before yesterday is read-only (`dayPageFlags`), so the section does not pass this control
 * there, and both actions refuse it too: they bound the write by the row's own day.
 *
 * ## The editor drops beneath the value, and its line never wraps
 *
 * At 360px the row has ~294px usable, and an editor beside the value would WRAP, not overflow, so the
 * number being corrected would land in a narrow box in the gutter, and neither CI gate can see that.
 * So the form is `w-full` and drops beneath the value deterministically. Its first line is the field,
 * the unit and the icon-only ✓ / ✕ (`InlineEditActions`, maintainer 2026-11-16): ~139px fixed, so the
 * field keeps ~155px. What keeps the pair on that line is the field's `flex-1 min-w-0` (a zero
 * basis that shrinks), not the absence of `flex-wrap`: a fixed field width over ~155px would push the
 * ✕ onto its own line, which passes every gate, so the a11y spec measures that the pair shares the
 * field's row. The
 * hint and any error sit beneath. This is the one full statement of that argument; the receipts, the
 * a11y spec and the screenshot script point here.
 *
 * ## The unit is text, never a picker
 *
 * A two-option picker beside the number is one thumb-drag from turning `84.5 lb` into `84.5 kg`.
 * Each writer pins the unit, so a crafted mismatch matches no row.
 *
 * ## A blank ✓ clears, and the hint says so before it is tapped
 *
 * The ✓ looks the same whether it saves or clears (maintainer, 2026-11-16: no red Clear, no trash);
 * the line under the field always says a blank clears, and the ✓'s NAME follows the same predicate
 * as the clear (`clears`): `Clear weight` while it would clear. `isBlankEntry` is the one
 * predicate the name, the report and the server share. An archived athlete (`canClear` false) keeps
 * the save name and no hint, and a blank is refused: their page has no empty field to re-enter a
 * cleared value into.
 *
 * ## Escape cancels, from anywhere in the editor, but never mid-save
 *
 * The form catches it, so it works from the field and from either button. While a save is in flight
 * it does nothing: the write would still land behind a closed editor (the ✕ hides for the same
 * reason).
 */
export function SingleValueAmend({
  logged,
  canClear,
  copy,
  fieldLabel,
  inputMode,
  parse,
  hiddenFields,
  submit,
}: {
  logged: { entryId: string; value: number; unit: Unit };
  /** False for an archived athlete: Change stays, a clear does not (plan W5). */
  canClear: boolean;
  copy: SingleValueCopy;
  /** The field's accessible name; the visible unit beside it is `aria-hidden`. */
  fieldLabel: string;
  inputMode: 'decimal' | 'numeric';
  /** The typed text as the value it saves, or `null`: used only for the "changed to" line. */
  parse: (text: string) => number | null;
  /** Posted beside `value`: what the row's action needs to address and guard the row. */
  hiddenFields: Readonly<Record<string, string>>;
  submit: (formData: FormData) => Promise<AmendOutcome>;
}) {
  const live = useSingleValueLive();
  const shown = formatValueUnit(logged.value, logged.unit);
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_prev: AmendOutcome, formData: FormData): Promise<AmendOutcome> => {
      const result = await submit(formData);
      const submitted = formData.get('value');
      if (result.ok) {
        if (isBlankEntry(submitted)) {
          // The row unmounts; what replaces it takes focus, and the line stays on screen.
          live.report({ message: copy.announcedCleared(shown), tone: 'status', focus: ['field'] });
        } else {
          setEditing(false);
          live.report({
            message: copy.announcedChanged(
              formatValueUnit(parse(String(submitted)) ?? logged.value, logged.unit),
            ),
            tone: 'sr',
            focus: ['change'],
          });
        }
      } else if (!result.field) {
        // A refusal the page has revalidated under: this editor may be gone (the row was cleared
        // elsewhere, the day closed), so the island shows it. If the editor survives (a stale value),
        // it stays open on the value that won, and its field keeps focus.
        live.report({ message: result.error, tone: 'alert', focus: ['field', 'change'] });
      } else {
        // A refusal under the field: the tap on Save blurred it and closed the keypad, so hand focus
        // back to the field (plan A4) — only from <body> or inside the island, never a steal.
        live.claimFocus(['field']);
      }
      return result;
    },
    NOT_SUBMITTED,
  );
  // An open editor or a save in flight holds the section's "Collapse" (FAM-1 12c-iii §5).
  useSectionBusy(editing || pending);
  const [value, setValue] = useState(String(logged.value));
  // The outcome as of the last open: an error from a PREVIOUS open (submit 845, Cancel, reopen)
  // must not reappear under a correct value, and `useActionState` never resets on its own.
  const [stateAtOpen, setStateAtOpen] = useState(state);
  /** The archived athlete's blank ✓, refused before any request. Cleared by typing. */
  const [blankRefused, setBlankRefused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const takeChange = live.focusRef('change');
  const takeField = live.focusRef('field');
  const ids = { value: useId(), hint: useId(), error: useId() };

  // ⚠️ While the editor is open, follow the SERVER. A refused stale save revalidates: `seenValue`
  // (hidden, from props) moves to the value that won, so if the box kept the typed number one more
  // Save would pass the guard and silently revert the other device's correction.
  const [seenProp, setSeenProp] = useState(logged.value);
  if (logged.value !== seenProp) {
    setSeenProp(logged.value);
    setValue(String(logged.value));
  }

  // Opening SELECTS the value, once, so the first digit typed replaces it and a correction never
  // passes through an empty field (which would read Clear). In a layout effect, not `onFocus`, which
  // iOS undoes on mouseup.
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (editing && node) {
      node.focus();
      node.setSelectionRange(0, node.value.length);
    }
  }, [editing]);

  const fresh = state !== stateAtOpen;
  const blank = isBlankEntry(value);
  const clears = blank && canClear;
  const valueErr = blankRefused ? copy.blankSave : fresh && !state.ok ? state.field : undefined;
  const saveLabel = clears ? copy.clearLabel : copy.saveLabel;
  const cancel = () => {
    // Never mid-save: the write would still land behind a closed editor, and a refusal under the
    // field would have nowhere to show. One guard for the ✕ and Escape.
    if (pending) return;
    setEditing(false);
    live.dismiss();
    // The editor is about to unmount; hand focus back to the Change that opened it.
    live.claimFocus(['change']);
  };
  const describedBy =
    // A kept "already logged" alert (the only one that survives Change opening) names the number
    // that was not saved, so the field this editor focuses is described by it too.
    [canClear ? ids.hint : null, valueErr ? ids.error : null, live.alertId]
      .filter(Boolean)
      .join(' ') || undefined;

  if (!editing) {
    return (
      <Button
        ref={takeChange}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          // Re-seed from PROPS every time it opens: type 855, Cancel, reopen, and the box must show
          // what is SAVED, not the number just discarded one tap from Save.
          setValue(String(logged.value));
          setStateAtOpen(state);
          setBlankRefused(false);
          // A refusal from an earlier try is about a value this editor no longer shows, except an
          // "already logged" one, which names the number to enter here (`keepOnOpen`).
          live.dismissOnOpen();
          setEditing(true);
        }}
        aria-label={changeLabel(copy.changeSubject, shown)}
      >
        {AMEND_COPY.change}
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (blank && !canClear) {
          e.preventDefault();
          setBlankRefused(true);
          inputRef.current?.focus();
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
      className="flex w-full flex-col gap-2"
    >
      {/* Guards and the address, not edits: each writer pins what it must. `seenValue` is what makes
          a second phone's correction un-revertable by this stale render. */}
      {Object.entries(hiddenFields).map(([name, v]) => (
        <input key={name} type="hidden" name={name} value={v} readOnly />
      ))}
      <input type="hidden" name="seenValue" value={logged.value} readOnly />

      {/* The field's `flex-1 min-w-0` keeps the ✓ and ✕ on this line (the docblock's width math). */}
      <div className="flex items-center gap-2">
        <label htmlFor={ids.value} className="sr-only">
          {fieldLabel}
        </label>
        <input
          ref={(node) => {
            inputRef.current = node;
            return takeField(node);
          }}
          id={ids.value}
          name="value"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setBlankRefused(false);
          }}
          aria-invalid={valueErr ? true : undefined}
          aria-describedby={describedBy}
          className={`${INPUT_CLASS} min-w-0 flex-1`}
        />
        <span aria-hidden="true" className="text-base">
          {logged.unit}
        </span>
        <InlineEditActions
          confirm={{ label: saveLabel }}
          cancelLabel={copy.cancelLabel}
          onCancel={cancel}
          pending={pending}
        />
      </div>

      {canClear ? (
        // On a plain surface: the row drops its tint while this editor is open (LOGGED_ROW_CLASS).
        <p id={ids.hint} className="text-muted-foreground text-sm">
          {copy.clearHint}
        </p>
      ) : null}
      {valueErr ? (
        <p id={ids.error} role="alert" className="text-destructive text-sm">
          <TickedCopy text={valueErr} buttonLabel={saveLabel} />
        </p>
      ) : null}
    </form>
  );
}
