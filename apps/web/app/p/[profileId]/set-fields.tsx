'use client';

import { type RefObject, useEffect, useRef } from 'react';

import { INPUT_CLASS } from '@/lib/constants';

/**
 * V1-27 decision 6 — the custom "missing" message, set DECLARATIVELY from state, never by an
 * `onInvalid` event. An event-set message lingers when the field stops being required by other means
 * (BW tapped, or the later set removed so this row became trailing) and the form stays blocked on a
 * field that must stay empty — the "form appears dead" trap. Only a BLANK required value gets it, so a
 * step/min failure (reps `0`, `2.5`) keeps the browser's own message. No message ⇒ no custom validity.
 */
function useMissingMessage(
  ref: RefObject<HTMLInputElement | null>,
  required: boolean,
  value: string,
  message: string | undefined,
) {
  useEffect(() => {
    ref.current?.setCustomValidity(message && required && value.trim() === '' ? message : '');
  }, [ref, required, value, message]);
}

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
  repsRequired = true,
  weightRequired = true,
  repsMissingMessage,
  weightMissingMessage,
  repsDescribedBy,
  weightDescribedBy,
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
   * V1-27 — FALSE on a trailing untouched row of the log form: it is not sent, so it must not block.
   * The edit form leaves the default.
   */
  repsRequired?: boolean;
  /**
   * V1-27 — the message a required, blank REPS field shows instead of the browser's generic one, and
   * the same for WEIGHT. Per field because the way out differs: blank reps on a multi-set card is
   * "tap Remove", blank weight is "tap BW". Passed by the LOG form only: the edit form has no Remove
   * button, so neither applies there.
   */
  repsMissingMessage?: string;
  weightMissingMessage?: string;
  /** V1-27 — `aria-describedby` on the reps input (the trailing-rows hint, while the card is mixed). */
  repsDescribedBy?: string;
  /** V1-24 3a-i — `aria-describedby` on the weight input (the amend's error, while it renders). */
  weightDescribedBy?: string;
  /**
   * The movement's unit, rendered as static text after the field and folded into the accessible name.
   * Since PR 4a a movement may be logged in `in` or `sec`, so a bare `[ 30 ]` labeled "weight" is
   * ambiguous to a sighted user and meaningless to a screen reader. The edit form passes it too since
   * V1-24 3a-i: mass-only still names a unit (lb or kg), the `AMEND_COPY.valueLabel` lesson.
   */
  unitLabel?: string;
  // When the fields submit via a native <form> (the V1-9 edit form), pass field names so FormData
  // captures them. The log form omits them — its set values ride the hidden `movements` JSON instead.
  nameReps?: string;
  nameWeight?: string;
}) {
  const repsRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  useMissingMessage(repsRef, repsRequired, reps, repsMissingMessage);
  useMissingMessage(weightRef, weightRequired, weight, weightMissingMessage);
  return (
    <>
      <input
        ref={repsRef}
        type="number"
        inputMode="numeric"
        min="1"
        step="1"
        required={repsRequired}
        aria-describedby={repsDescribedBy}
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
        ref={weightRef}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.5"
        required={weightRequired}
        aria-describedby={weightDescribedBy}
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
