'use client';

import { BODYWEIGHT_UNITS, DEFAULT_BODYWEIGHT_UNIT, newId } from '@mat-plan/shared';
import { useActionState, useState } from 'react';

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
   * duplicate-row mechanism: `logBodyweight` dedupes only on `client_id`, so a new key made a second
   * submit a second ROW — over an input the reset had just emptied, which is what invited the second
   * submit. `page.tsx` now renders the receipt instead of this form once a weight exists, so there is
   * nothing to reset; and a stable key means that if this form is somehow still mounted (a failed
   * revalidation), a resubmit is an `ON CONFLICT DO NOTHING` no-op rather than a duplicate.
   */
  const [clientId] = useState(newId);

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
            defaultValue={DEFAULT_BODYWEIGHT_UNIT}
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
