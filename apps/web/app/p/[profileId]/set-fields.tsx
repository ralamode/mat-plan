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
  weightRequired = true,
  unitLabel,
}: {
  reps: string;
  weight: string;
  onReps: (v: string) => void;
  onWeight: (v: string) => void;
  ariaLabel: string;
  /**
   * ⚠️ **`required` must be FALSE whenever the set can legitimately have no magnitude** — i.e. when BW
   * or band is toggled (GAP-3 PR 4a). A hidden-or-empty `required` input blocks the native submit with
   * an error the browser will not show, and the form simply appears DEAD — the trap `strength-form.tsx`
   * documents twice, at a scale of 25 rows. The real validity rule lives in `strengthSetSchema`'s
   * superRefine, which can see all three fields at once and reports through `fieldErrors`.
   *
   * The V1-9 edit form leaves this TRUE: its schema is numeric-only and `editable-set.tsx` renders
   * only `state.error`, never `fieldErrors`, so native validation is the only feedback it has.
   */
  weightRequired?: boolean;
  /**
   * The movement's unit, rendered as static text after the field and folded into the accessible name.
   * Since PR 4a a movement may be logged in `in` or `sec`, so a bare `[ 30 ]` labeled "weight" is
   * ambiguous to a sighted user and meaningless to a screen reader. Omitted by the edit form, which
   * is mass-only by construction.
   */
  unitLabel?: string;
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
      {/* GAP-3 PR 4a: ONE numeric input again. GAP-1 P0-2 had to make this `type="text"` so `BW` could
          be typed at all — iOS's decimal pad has no letters and no ABC toggle. `BW` is a toggle now,
          so the keypad comes back for the ~90% case that is genuinely a number. */}
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.5"
        required={weightRequired}
        name={nameWeight}
        placeholder="weight"
        aria-label={unitLabel ? `${ariaLabel} weight in ${unitLabel}` : `${ariaLabel} weight`}
        value={weight}
        onChange={(e) => onWeight(e.target.value)}
        className={`${INPUT_CLASS} w-24`}
      />
      {unitLabel ? (
        <span className="text-muted-foreground text-sm whitespace-nowrap">{unitLabel}</span>
      ) : null}
    </>
  );
}
