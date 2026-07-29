'use client';

import { INPUT_CLASS } from '@/lib/constants';

/**
 * The reps × weight number-input pair — the SINGLE source shared by the log form's set rows
 * (`strength-form.tsx`) and the V1-9 edit-set form (`editable-set.tsx`), so the `inputMode`/`min`/`step`,
 * the `×` separator, and `INPUT_CLASS` can't drift between "log a set" and "fix a set". The caller owns
 * the surrounding row (index label / remove button, or Save/Cancel) and supplies the values, handlers,
 * and an `ariaLabel` context (e.g. "Movement 1 set 2" → "<ariaLabel> reps" / "<ariaLabel> weight").
 * Values are strings (the form-state shape the shared `strengthSetSchema` z.coerce's).
 */
export function SetRepsWeightFields({
  reps,
  weight,
  onReps,
  onWeight,
  ariaLabel,
  nameReps,
  nameWeight,
}: {
  reps: string;
  weight: string;
  onReps: (v: string) => void;
  onWeight: (v: string) => void;
  ariaLabel: string;
  // When the fields submit via a native <form> (the V1-9 edit form), pass field names so FormData
  // captures them. The log form omits them — its set values ride the hidden `movements` JSON instead.
  nameReps?: string;
  nameWeight?: string;
}) {
  return (
    <>
      <input
        type="number"
        inputMode="numeric"
        min="1"
        step="1"
        required
        name={nameReps}
        placeholder="reps"
        aria-label={`${ariaLabel} reps`}
        value={reps}
        onChange={(e) => onReps(e.target.value)}
        className={`${INPUT_CLASS} w-24`}
      />
      <span className="text-muted-foreground text-sm">×</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.5"
        required
        name={nameWeight}
        placeholder="weight"
        aria-label={`${ariaLabel} weight`}
        value={weight}
        onChange={(e) => onWeight(e.target.value)}
        className={`${INPUT_CLASS} w-28`}
      />
    </>
  );
}
