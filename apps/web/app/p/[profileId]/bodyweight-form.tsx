'use client';

import {
  BODYWEIGHT_UNITS,
  type BodyweightUnit,
  DEFAULT_BODYWEIGHT_UNIT,
  newId,
} from '@mat-plan/shared';
import { useActionState, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS } from '@/lib/constants';

import { INITIAL_ACTION_STATE } from './action-state';
import { logBodyweightAction } from './actions';
import { DayField } from './day-field';

export function BodyweightForm({ profileId, day }: { profileId: string; day: string }) {
  const [state, formAction, pending] = useActionState(logBodyweightAction, INITIAL_ACTION_STATE);
  /**
   * Client-stamped idempotency key, generated once and **never rotated** (V1-24 PR 1a).
   *
   * ⚠️ It used to reset the form and mint a FRESH key on every success, and that pair was the
   * second-submit path: `logBodyweight` dedupes only on `client_id`, so a new key made a second
   * submit a second ROW — over an input the reset had just emptied, which is what invited it.
   * `BodyweightSection` now renders the receipt instead of this form once a weight exists, so there
   * is nothing to reset; and a stable key means that if this form is somehow still mounted (a failed
   * revalidation), a resubmit is an `ON CONFLICT DO NOTHING` no-op rather than a second row.
   *
   * That removes the second-submit path; it does not make a duplicate impossible. Two mounts (two
   * phones, two tabs) hold two keys and can still write two rows until PR 1d's unique index lands.
   * The key is per MOUNT, and the section mounts one per day (`key={day}`).
   */
  const [clientId] = useState(newId);
  /**
   * CONTROLLED, and that is load-bearing (round 2 on #180, probed): React 19 resets an uncontrolled
   * field inside `<form action>` when the action settles — **including a rejected one**. So after the
   * plausibility bound refused `845`, the input came back empty and the unit snapped back to `lb`: the
   * kid was told to "check the decimal point" of a number that was gone, and a kg user retyping `84.5`
   * would silently save 84.5 **lb** — in range, so no second guard catches it. `e2e/a11y.spec.ts`
   * pins that both survive a rejection.
   */
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<BodyweightUnit>(DEFAULT_BODYWEIGHT_UNIT);
  /**
   * ⚠️ Controlling the `<select>` is NOT enough on its own (verified in the e2e). The reset is a native
   * `form.reset()`, run at the end of the commit's mutation phase. A controlled `<input>` survives it
   * because React keeps its `value` ATTRIBUTE (the reset target) in sync; a controlled `<select>` gets
   * no equivalent — React never sets `defaultSelected` for it — so the reset reselects the first
   * option while `unit` still says `kg`, and nothing re-applies the prop. Re-assert it after every
   * commit: a layout effect runs after the reset and before paint, so the wrong unit is never shown.
   */
  const unitRef = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (unitRef.current && unitRef.current.value !== unit) unitRef.current.value = unit;
  });

  const valueErr = state.fieldErrors?.value?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <DayField day={day} />
      <input type="hidden" name="clientId" value={clientId} readOnly />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="value" className="text-sm font-medium">
            Weight
          </label>
          <input
            id="value"
            name="value"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            required
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={valueErr ? true : undefined}
            aria-describedby={valueErr ? 'value-error' : undefined}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="unit" className="text-sm font-medium">
            Unit
          </label>
          <select
            id="unit"
            name="unit"
            ref={unitRef}
            value={unit}
            onChange={(e) => setUnit(e.target.value as BodyweightUnit)}
            className={INPUT_CLASS}
          >
            {BODYWEIGHT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="lg" disabled={pending} className="text-base">
          {pending ? 'Logging…' : 'Log weight'}
        </Button>
      </div>

      {valueErr ? (
        <p id="value-error" role="alert" className="text-destructive text-sm">
          {valueErr}
        </p>
      ) : state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
