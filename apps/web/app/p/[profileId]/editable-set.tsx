'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { SetDTO } from '@/lib/dal/entries';

import { editStrengthSetAction, type ActionState } from './actions';
import { formatSetLine, isEditableSet } from './set-display';
import { SetRepsWeightFields } from './set-fields';

const initialState: ActionState = { ok: false, error: null };

/**
 * One logged strength set as a `<li>` (V1-9 fix-a-set). Read-only by default — the SAME line
 * `MovementLine` used to render (`reps × weightLabel-or-weight+unit`), so grouping/superset displays are
 * unchanged. A **numeric** reps+weight set (no `weightLabel`) also gets an "Edit" affordance that reveals
 * inline reps × weight inputs wired to `editStrengthSetAction`; on save the RSC revalidates with the new
 * value and the row collapses back to read.
 *
 * Only numeric sets are editable: a labeled set ('BW', '50ft') would have its edited `weight_num` MASKED
 * by `weight_label` at this very read seam (`weightLabel ?? …`), and a null reps/weight can't round-trip
 * the required schema — so those render read-only (panel: correctness B1).
 */
export function EditableSet({
  set,
  profileId,
  unit,
  ariaLabel,
}: {
  set: SetDTO;
  profileId: string;
  unit: string;
  ariaLabel: string;
}) {
  const readLine = formatSetLine(set, unit);
  const editable = isEditableSet(set);
  const [editing, setEditing] = useState(false);

  if (!editable || !editing) {
    return (
      <li className="flex items-center justify-between gap-2">
        <span>{readLine}</span>
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${ariaLabel}`}
          >
            Edit
          </Button>
        ) : null}
      </li>
    );
  }

  return (
    <li>
      <EditSetForm
        set={set}
        profileId={profileId}
        ariaLabel={ariaLabel}
        onDone={() => setEditing(false)}
      />
    </li>
  );
}

/** The inline edit form for one set — a native `<form>` posting to `editStrengthSetAction`, seeded from
 *  the set's current values. Collapses back to read on a successful save (the revalidated RSC supplies
 *  the new value). Reuses `SetRepsWeightFields` so the inputs match the log form exactly. */
function EditSetForm({
  set,
  profileId,
  ariaLabel,
  onDone,
}: {
  set: SetDTO;
  profileId: string;
  ariaLabel: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(editStrengthSetAction, initialState);
  const [reps, setReps] = useState(String(set.reps ?? ''));
  const [weight, setWeight] = useState(String(set.weight ?? ''));

  // Collapse on success (the during-render idiom the forms use — not an effect). revalidatePath has
  // already refreshed the read line with the saved value.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) onDone();
  }

  return (
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
        <Button type="submit" size="sm" className="min-h-11" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={onDone}
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
  );
}
