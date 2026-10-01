'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  AMEND_COPY,
  BODYWEIGHT_COPY,
  BODYWEIGHT_RECEIPT_ID,
  changeLabel,
  INPUT_CLASS,
  SAVING_LABEL,
} from '@/lib/constants';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';

import { INITIAL_ACTION_STATE } from './action-state';
import { editBodyweightAction } from './actions';
import { useOnActionSuccess } from './use-on-action-success';

/**
 * Correct an already-logged bodyweight (V1-24 PR 1b) — the half that makes 1a's receipt honest.
 *
 * ## Rendered on EVERY day, closed ones included
 *
 * The amend has no day bound (plan Decision 5): an amend never moves the entry's date, so a ±1 window
 * buys no integrity and would hide the control on exactly the history days a typo is found on — which
 * is what happened to the 2026-09-28 KB-swings entry that opened V1-24.
 *
 * ## The editor STACKS, and that is not styling
 *
 * At 360px the receipt card has ~294px usable and an inline editor is ~424px. Flex would WRAP it, not
 * overflow, so the number being corrected would land in a ~96px box in the gutter, and neither CI
 * gate can see that (`scrollWidth` doesn't move; the tap-target check measures height only). So the
 * form is `w-full` and drops beneath the value deterministically, then stacks inside itself. This is
 * the one full statement of that argument; the receipt, the a11y spec and the screenshot script point
 * here.
 *
 * ## No unit picker
 *
 * The unit is rendered as TEXT. A two-option native picker 8px from the number input is one
 * thumb-drag from turning `84.5 lb` into `84.5 kg` — 186 lb on a child — and the plausibility bound
 * is per-unit, so that value is perfectly legal. The amend's job is a typo in the digits; a unit is a
 * per-household constant. It is still SUBMITTED, because the bound needs it, and the writer pins it
 * in the WHERE so a crafted mismatch matches no row.
 */
export function BodyweightAmend({
  profileId,
  logged,
}: {
  profileId: string;
  logged: LoggedBodyweight;
}) {
  const [state, formAction, pending] = useActionState(editBodyweightAction, INITIAL_ACTION_STATE);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(logged.value));
  // The action state as of the last open: an error from a PREVIOUS open (submit 845, Cancel, reopen)
  // must not reappear under a correct value, and `useActionState` never resets on its own.
  const [stateAtOpen, setStateAtOpen] = useState(state);
  // This island's OWN live region, mounted in both states so it exists before the save it announces.
  // Driven by the action's local success — never by a value diff, which also fires when a refused
  // save revalidates in another device's value (that is not "saved").
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState<{ id: 'receipt' | 'change'; n: number } | null>(
    null,
  );
  const changeRef = useRef<HTMLButtonElement>(null);

  // ⚠️ While the editor is open, follow the SERVER. A refused stale save revalidates: `seenValue`
  // (hidden, from props) moves to the value that won, so if the box kept the typed number one more
  // Save would pass the guard and silently revert the other device's correction — the lost update
  // `seenValue` exists to prevent, and the stale copy promises "the latest is showing now".
  const [seenProp, setSeenProp] = useState(logged.value);
  if (logged.value !== seenProp) {
    setSeenProp(logged.value);
    setValue(String(logged.value));
  }

  // Collapse, announce and move focus on success — the caller's OWN state, so the during-render
  // update is legal. Announced from what was SUBMITTED, so saving an unchanged value still says so.
  useOnActionSuccess(state, () => {
    setEditing(false);
    setAnnouncement(BODYWEIGHT_COPY.announced(formatValueUnit(Number(value), logged.unit)));
    setFocusTarget((f) => ({ id: 'receipt', n: (f?.n ?? 0) + 1 }));
  });

  useEffect(() => {
    // The submit/Cancel button that had focus has just unmounted; without this focus drops to <body>.
    if (focusTarget?.id === 'receipt') document.getElementById(BODYWEIGHT_RECEIPT_ID)?.focus();
    if (focusTarget?.id === 'change') changeRef.current?.focus();
  }, [focusTarget]);

  const fresh = state !== stateAtOpen;
  const valueErr = fresh ? state.fieldErrors?.value?.[0] : undefined;
  const error = valueErr ?? (fresh ? state.error : null);

  const region = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (!editing) {
    return (
      <>
        {region}
        <Button
          ref={changeRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Re-seed from PROPS every time it opens: type 855, Cancel, reopen, and the box must show
            // what is SAVED, not the number just discarded one tap from Save.
            setValue(String(logged.value));
            setStateAtOpen(state);
            setAnnouncement('');
            setEditing(true);
          }}
          aria-label={changeLabel('weight', formatValueUnit(logged.value, logged.unit))}
        >
          {AMEND_COPY.change}
        </Button>
      </>
    );
  }

  return (
    <>
      {region}
      <form action={formAction} className="flex w-full flex-col gap-2">
        <input type="hidden" name="profileId" value={profileId} readOnly />
        <input type="hidden" name="entryId" value={logged.entryId} readOnly />
        {/* Guards, not edits — the writer pins both in its WHERE. `seenValue` is what makes a second
            phone's correction un-revertable by this stale render. */}
        <input type="hidden" name="unit" value={logged.unit} readOnly />
        <input type="hidden" name="seenValue" value={logged.value} readOnly />

        <div className="flex items-center gap-2">
          <label htmlFor="bodyweight-amend-value" className="sr-only">
            {AMEND_COPY.valueLabel(logged.unit)}
          </label>
          <input
            id="bodyweight-amend-value"
            name="value"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            required
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'bodyweight-amend-error' : undefined}
            className={`${INPUT_CLASS} w-24`}
          />
          <span aria-hidden="true" className="text-base">
            {logged.unit}
          </span>
        </div>

        {/* ABOVE the buttons, so a wrapped 360px editor never pushes the message out of the thumb's
            reach, and wired to the input by `aria-describedby` rather than left floating. */}
        {error ? (
          <p id="bodyweight-amend-error" role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending} className="flex-1">
            {pending ? SAVING_LABEL : AMEND_COPY.save}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            className="flex-1"
            onClick={() => {
              setEditing(false);
              // The Cancel button is about to unmount; give focus back to the control that opened it.
              setFocusTarget((f) => ({ id: 'change', n: (f?.n ?? 0) + 1 }));
            }}
          >
            {AMEND_COPY.cancel}
          </Button>
        </div>
      </form>
    </>
  );
}
