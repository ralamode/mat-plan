'use client';

import { QUANTITY_SLOT } from '@mat-plan/shared';
import { useActionState, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { AMEND_COPY, changeLabel, SAVING_LABEL, setAmendErrorId } from '@/lib/constants';
import type { SetDTO } from '@/lib/dal/entries';

import { INITIAL_ACTION_STATE } from './action-state';
import { editStrengthSetAction } from './actions';
import { formatSetLine } from './set-display';
import { SetRepsWeightFields } from './set-fields';
import { useOnActionSuccess } from './use-on-action-success';

/**
 * One EDITABLE strength set as a `<li>` (V1-9; reworked in V1-24 3a-i to the 1b amend's standard).
 * `MovementLine` renders this ONLY for numeric reps+weight sets (`isEditableSet`); read-only sets stay
 * server-rendered, so this `'use client'` island ships only where a Change control exists.
 *
 * What 3a-i added, each the `bodyweight-amend.tsx` precedent:
 * - **Change**, named `changeLabel(subject, value)` so N sets on one screen are distinguishable.
 * - A **stacked** editor: inputs on one row, Save/Cancel on their own, so a 280px superset member fits
 *   deterministically rather than by wrap luck (plan I2).
 * - **Focus** goes to reps on open, and back to Change on Save and on Cancel (the button that had it
 *   unmounts each time).
 * - Its **own status region**, outside the read/edit switch so it exists before the save it announces,
 *   driven by the action's success, never by a value diff (parent B5).
 * - An error tied to its inputs by a **per-set** id, and only while it renders.
 *
 * `subject` is `${movement} set ${idx}`: the inputs' accessible names start with it, and the Change
 * button's name is built from it.
 */
export function EditableSet({
  set,
  profileId,
  subject,
}: {
  set: SetDTO;
  profileId: string;
  subject: string;
}) {
  const [state, formAction, pending] = useActionState(editStrengthSetAction, INITIAL_ACTION_STATE);
  const [editing, setEditing] = useState(false);
  // GAP-3: the editable weight is the set's PRIMARY quantity (a mass: `isEditableSet` guarantees it).
  const primary = set.quantities.find((q) => q.slot === QUANTITY_SLOT.primary);
  const editableWeight = primary?.value ?? null;
  const [reps, setReps] = useState(String(set.reps ?? ''));
  const [weight, setWeight] = useState(String(editableWeight ?? ''));
  // The action state as of the last open: an error from a PREVIOUS open must not reappear under a
  // reopened editor, and `useActionState` never resets on its own (the 1b amend's rule).
  const [stateAtOpen, setStateAtOpen] = useState(state);
  const [announcement, setAnnouncement] = useState('');
  const [focusChange, setFocusChange] = useState(0);
  const changeRef = useRef<HTMLButtonElement>(null);

  useOnActionSuccess(state, () => {
    setEditing(false);
    // Announced from what was SUBMITTED, so saving an unchanged value still says so.
    setAnnouncement(
      AMEND_COPY.setChanged(
        subject,
        formatSetLine({
          ...set,
          reps: Number(reps),
          quantities: primary ? [{ ...primary, value: Number(weight) }] : set.quantities,
        }),
      ),
    );
    setFocusChange((n) => n + 1);
  });

  useEffect(() => {
    // Save/Cancel had focus and just unmounted; without this, focus drops to <body>.
    if (focusChange > 0) changeRef.current?.focus();
  }, [focusChange]);

  const error = state !== stateAtOpen ? state.error : null;
  const errorId = setAmendErrorId(set.publicId);
  const unitLabel = primary?.unit; // the CODE, as the read line and the log form show it
  const line = formatSetLine(set);

  // Mounted in both states, before the save it announces (a region that mounts with its text is not
  // announced).
  const region = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-2">
        {region}
        <span>{line}</span>
        <Button
          ref={changeRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Re-seed from the current (possibly just-revalidated) value each time it opens.
            setReps(String(set.reps ?? ''));
            setWeight(String(editableWeight ?? ''));
            setStateAtOpen(state);
            // Cleared on open, so saving the SAME value again is a text change and is announced.
            setAnnouncement('');
            setEditing(true);
          }}
          aria-label={changeLabel(subject, line)}
        >
          {AMEND_COPY.change}
        </Button>
      </li>
    );
  }

  return (
    <li>
      {region}
      <form action={formAction} className="flex w-full flex-col gap-2">
        <input type="hidden" name="profileId" value={profileId} readOnly />
        <input type="hidden" name="setId" value={set.publicId} readOnly />
        <div className="flex items-center gap-2">
          <SetRepsWeightFields
            reps={reps}
            weight={weight}
            onReps={setReps}
            onWeight={setWeight}
            ariaLabel={subject}
            nameReps="reps"
            nameWeight="weight"
            unitLabel={unitLabel}
            autoFocusReps
            repsDescribedBy={error ? errorId : undefined}
            weightDescribedBy={error ? errorId : undefined}
          />
        </div>
        {/* ABOVE the buttons, so the message stays in the thumb's reach on a phone. */}
        {error ? (
          <p id={errorId} role="alert" className="text-destructive text-sm">
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
              setFocusChange((n) => n + 1);
            }}
          >
            {AMEND_COPY.cancel}
          </Button>
        </div>
      </form>
    </li>
  );
}
