'use client';

import { isBlankWeight } from '@mat-plan/shared';
import { useActionState, useId, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  AMEND_COPY,
  BODYWEIGHT_COPY,
  changeLabel,
  INPUT_CLASS,
  SAVING_LABEL,
} from '@/lib/constants';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';

import { type ActionState, INITIAL_ACTION_STATE } from './action-state';
import { editBodyweightAction } from './actions';
import { useSingleValueLive } from './single-value-live';

/**
 * Change an already-logged bodyweight (V1-24 PR 1b), or clear it with a blank Save (3b-bw, plan W5).
 *
 * ## Rendered on today and yesterday only
 *
 * A day before yesterday is read-only since V1-24 3b-page (`dayPageFlags`), so the section does not
 * pass this control there, and since 3b-bw the action refuses it too: it bounds the write by the
 * row's own day.
 *
 * ## The editor STACKS, and that is not styling
 *
 * At 360px the row has ~294px usable and an inline editor is wider. Flex would WRAP it, not overflow,
 * so the number being corrected would land in a narrow box in the gutter, and neither CI gate can see
 * that. So the form is `w-full` and drops beneath the value deterministically, then stacks inside
 * itself. This is the one full statement of that argument; the receipt, the a11y spec and the
 * screenshot script point here.
 *
 * ## No unit picker
 *
 * The unit is rendered as TEXT. A two-option picker beside the number is one thumb-drag from turning
 * `84.5 lb` into `84.5 kg` — 186 lb on a child — and the bound is per-unit, so that value is legal.
 * It is still SUBMITTED, because the bound needs it, and the writer pins it so a crafted mismatch
 * matches no row.
 *
 * ## A blank Save clears, and says so before it is tapped
 *
 * While the field is empty after trim, Save reads **Clear** (`Clear bodyweight`, destructive), and the
 * line under the field always says how a weigh-in is removed. `isBlankWeight` is the one predicate the
 * label, the report and the server share. An archived athlete (`canClear` false) keeps Save and no
 * hint, and a blank is refused: their page has no empty field to re-enter a cleared weight into.
 */
export function BodyweightAmend({
  profileId,
  logged,
  canClear,
}: {
  profileId: string;
  logged: LoggedBodyweight;
  /** False for an archived athlete: Change stays, a clear does not (plan W5). */
  canClear: boolean;
}) {
  const live = useSingleValueLive();
  const shown = formatValueUnit(logged.value, logged.unit);
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      const result = await editBodyweightAction(prev, formData);
      const submitted = formData.get('value');
      if (result.ok) {
        if (isBlankWeight(submitted)) {
          // The row unmounts; the field it leaves behind takes focus, and the line stays on screen.
          live.report({
            message: BODYWEIGHT_COPY.announcedCleared(shown),
            tone: 'status',
            focus: ['field'],
          });
        } else {
          setEditing(false);
          live.report({
            message: BODYWEIGHT_COPY.announcedChanged(
              formatValueUnit(Number(String(submitted).replace(',', '.')), logged.unit),
            ),
            tone: 'sr',
            focus: ['change'],
          });
        }
      } else if (!result.fieldErrors && result.error) {
        // A refusal the page has revalidated under: this editor may be gone (the row was cleared
        // elsewhere, the day closed), so the island shows it. If the editor survives (a stale value),
        // it stays open on the value that won, and its field keeps focus.
        live.report({ message: result.error, tone: 'alert', focus: ['field', 'change'] });
      }
      return result;
    },
    INITIAL_ACTION_STATE,
  );
  const [value, setValue] = useState(String(logged.value));
  // The action state as of the last open: an error from a PREVIOUS open (submit 845, Cancel, reopen)
  // must not reappear under a correct value, and `useActionState` never resets on its own.
  const [stateAtOpen, setStateAtOpen] = useState(state);
  /** The archived athlete's blank Save, refused before any request. Cleared by typing. */
  const [blankRefused, setBlankRefused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const takeChange = live.focusRef('change');
  const takeField = live.focusRef('field');
  const ids = { value: useId(), hint: useId(), error: useId() };

  // ⚠️ While the editor is open, follow the SERVER. A refused stale save revalidates: `seenValue`
  // (hidden, from props) moves to the value that won, so if the box kept the typed number one more
  // Save would pass the guard and silently revert the other device's correction — the lost update
  // `seenValue` exists to prevent, and the stale copy promises "the latest is showing now".
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
  const blank = isBlankWeight(value);
  const clears = blank && canClear;
  const valueErr = blankRefused
    ? BODYWEIGHT_COPY.blankSave
    : fresh
      ? state.fieldErrors?.value?.[0]
      : undefined;
  const describedBy =
    [canClear ? ids.hint : null, valueErr ? ids.error : null].filter(Boolean).join(' ') ||
    undefined;

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
          setEditing(true);
        }}
        aria-label={changeLabel('weight', shown)}
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
      className="flex w-full flex-col gap-2"
    >
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <input type="hidden" name="entryId" value={logged.entryId} readOnly />
      {/* Guards, not edits — the writer pins both. `seenValue` is what makes a second phone's
          correction un-revertable by this stale render. */}
      <input type="hidden" name="unit" value={logged.unit} readOnly />
      <input type="hidden" name="seenValue" value={logged.value} readOnly />

      <div className="flex items-center gap-2">
        <label htmlFor={ids.value} className="sr-only">
          {AMEND_COPY.valueLabel(logged.unit)}
        </label>
        <input
          ref={(node) => {
            inputRef.current = node;
            return takeField(node);
          }}
          id={ids.value}
          name="value"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setBlankRefused(false);
          }}
          aria-invalid={valueErr ? true : undefined}
          aria-describedby={describedBy}
          className={`${INPUT_CLASS} w-24`}
        />
        <span aria-hidden="true" className="text-base">
          {logged.unit}
        </span>
      </div>

      {canClear ? (
        <p id={ids.hint} className="text-muted-foreground text-sm">
          {BODYWEIGHT_COPY.clearHint}
        </p>
      ) : null}
      {/* ABOVE the buttons, so a wrapped 360px editor never pushes the message out of reach. */}
      {valueErr ? (
        <p id={ids.error} role="alert" className="text-destructive text-sm">
          {valueErr}
        </p>
      ) : null}

      {/* v12's order: Cancel, then the action. */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          className="flex-1"
          onClick={() => {
            setEditing(false);
            // Cancel is about to unmount; hand focus back to the Change that opened the editor.
            live.claimFocus(['change']);
          }}
        >
          {AMEND_COPY.cancel}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant={clears ? 'destructive' : 'default'}
          disabled={pending}
          aria-label={clears && !pending ? BODYWEIGHT_COPY.clearLabel : undefined}
          className="flex-1"
        >
          {pending ? SAVING_LABEL : clears ? BODYWEIGHT_COPY.clear : AMEND_COPY.save}
        </Button>
      </div>
    </form>
  );
}
