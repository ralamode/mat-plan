'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { AMEND_COPY, changeLabel, INPUT_CLASS } from '@/lib/constants';
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
 * At 360px the receipt card has ~294px usable. An inline editor — value line + number input + unit +
 * Save + Cancel + gaps — is ~424px. It would not overflow, because flex **wraps**: the number being
 * corrected would land in a ~96px box in the right-hand gutter beside a two-line label.
 * ⚠️ **Neither CI gate can see that**: `expectNoHorizontalOverflow` reads `scrollWidth`, and the
 * tap-target check measures HEIGHT only, which `min-h-11` satisfies. So the form is `w-full` — a
 * 100% basis cannot share a flex row, so it drops beneath the value deterministically — and stacks
 * inside itself: `[input + unit]` on one line, two `flex-1` buttons on the next, thumb-width on both
 * axes, which a height-only gate cannot ask for.
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

  // Collapse on success — the caller's OWN state, so the during-render update is legal.
  useOnActionSuccess(state, () => setEditing(false));

  const valueErr = state.fieldErrors?.value?.[0];
  const error = valueErr ?? state.error;

  if (!editing) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          // ⚠️ Re-seed from PROPS every time it opens (the `editable-set.tsx` line, verbatim in
          // spirit). Without it: type 855, Cancel — the row correctly shows 84.5 — reopen, and the
          // box still holds the 855 you just discarded, one tap from Save. Same after a refused
          // save that revalidated: the server has moved on and the editor must follow it.
          setValue(String(logged.value));
          setEditing(true);
        }}
        aria-label={changeLabel('weight', formatValueUnit(logged.value, logged.unit))}
      >
        {AMEND_COPY.change}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-2">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <input type="hidden" name="entryId" value={logged.entryId} readOnly />
      {/* Guards, not edits — the writer pins both in its WHERE. `seenValue` is what makes a second
          phone's correction un-revertable by this stale render. */}
      <input type="hidden" name="unit" value={logged.unit} readOnly />
      <input type="hidden" name="seenValue" value={logged.value} readOnly />

      <div className="flex items-center gap-2">
        <label htmlFor="bodyweight-amend-value" className="sr-only">
          Weight
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
        <span className="text-base">{logged.unit}</span>
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
          {pending ? 'Saving…' : AMEND_COPY.save}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          className="flex-1"
          onClick={() => setEditing(false)}
        >
          {AMEND_COPY.cancel}
        </Button>
      </div>
    </form>
  );
}
