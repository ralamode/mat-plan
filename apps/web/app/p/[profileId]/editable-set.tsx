'use client';

import { QUANTITY_SLOT } from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { SetDTO } from '@/lib/dal/entries';

import { INITIAL_ACTION_STATE } from './action-state';
import { editStrengthSetAction } from './actions';
import { formatSetLine } from './set-display';
import { SetRepsWeightFields } from './set-fields';

/**
 * One EDITABLE strength set as a `<li>` (V1-9 fix-a-set). `MovementLine` renders this ONLY for numeric
 * reps+weight sets (`isEditableSet`) — read-only sets stay server-rendered — so this `'use client'`
 * island ships only where an Edit control actually exists (RSC-first: no hydration for static set lines).
 * Read mode shows the set line + an Edit button; edit mode reveals inline reps × weight inputs wired to
 * `editStrengthSetAction`. On a successful save the RSC revalidates with the new value and this collapses.
 *
 * Collapse-on-success uses the sibling forms' during-render idiom (checkin/strength-form) — but sets
 * THIS component's OWN `editing` state, never reaching into a parent mid-render.
 */
export function EditableSet({
  set,
  profileId,
  ariaLabel,
}: {
  set: SetDTO;
  profileId: string;
  ariaLabel: string;
}) {
  const [state, formAction, pending] = useActionState(editStrengthSetAction, INITIAL_ACTION_STATE);
  const [editing, setEditing] = useState(false);
  const [reps, setReps] = useState(String(set.reps ?? ''));
  // GAP-3: the editable weight is the set's PRIMARY quantity (a mass — `isEditableSet` guarantees it).
  const editableWeight =
    set.quantities.find((q) => q.slot === QUANTITY_SLOT.primary)?.value ?? null;
  const [weight, setWeight] = useState(String(editableWeight ?? ''));

  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setEditing(false); // own state — a legal during-render update
  }

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-2">
        <span>{formatSetLine(set)}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // Re-seed from the current (possibly just-revalidated) value each time edit opens.
            setReps(String(set.reps ?? ''));
            setWeight(String(editableWeight ?? ''));
            setEditing(true);
          }}
          aria-label={`Edit ${ariaLabel}`}
        >
          Edit
        </Button>
      </li>
    );
  }

  return (
    <li>
      <form action={formAction} className="flex flex-col gap-1.5">
        <input type="hidden" name="profileId" value={profileId} readOnly />
        <input type="hidden" name="setId" value={set.publicId} readOnly />
        <div className="flex flex-wrap items-center gap-2">
          <SetRepsWeightFields
            reps={reps}
            weight={weight}
            onReps={setReps}
            onWeight={setWeight}
            ariaLabel={ariaLabel}
            nameReps="reps"
            nameWeight="weight"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
      </form>
    </li>
  );
}
