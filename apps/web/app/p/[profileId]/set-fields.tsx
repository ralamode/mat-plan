'use client';

import { LOAD_MAX_LENGTH } from '@mat-plan/shared';

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
  mode = 'numeric',
}: {
  reps: string;
  weight: string;
  onReps: (v: string) => void;
  onWeight: (v: string) => void;
  ariaLabel: string;
  /**
   * `'numeric'` (the DEFAULT) renders exactly the pre-GAP-1 markup — `type="number"` with the numeric
   * keypad, `min`/`step` and native validation. The V1-9 edit form relies on it and must not change:
   * its schema is numeric-only, and `editable-set.tsx` renders only `state.error`, never `fieldErrors`,
   * so a text value there would fail with no field-level explanation.
   *
   * `'load'` (the log form) accepts a TEXT load. Note `inputMode="text"`, NOT `"decimal"`: the iOS
   * decimal pad has no letters and no ABC toggle, so `inputMode="decimal"` would make `BW` literally
   * unenterable on the primary device — the one thing this feature exists to allow.
   */
  mode?: 'numeric' | 'load';
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
      {mode === 'numeric' ? (
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
      ) : (
        <input
          type="text"
          inputMode="text"
          required
          maxLength={LOAD_MAX_LENGTH}
          name={nameWeight}
          placeholder="weight or BW"
          aria-label={`${ariaLabel} weight or load`}
          value={weight}
          onChange={(e) => onWeight(e.target.value)}
          className={`${INPUT_CLASS} w-28`}
        />
      )}
    </>
  );
}
