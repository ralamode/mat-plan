'use client';

import { BODYWEIGHT_UNITS, DEFAULT_BODYWEIGHT_UNIT, newId } from '@mat-plan/shared';
import { useActionState, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { INPUT_CLASS } from '@/lib/constants';

import { logBodyweightAction, type ActionState } from './actions';
import { DayField } from './day-field';

const initialState: ActionState = { ok: false, error: null };

const inputClass = INPUT_CLASS; // single-sourced field styling (lib/constants)

export function BodyweightForm({ profileId, day }: { profileId: string; day: string }) {
  const [state, formAction, pending] = useActionState(logBodyweightAction, initialState);
  // Client-stamped idempotency key: generated once, rotated after a successful
  // write (via the DOM, not state — avoids a cascading re-render).
  const [initialClientId] = useState(newId);
  const formRef = useRef<HTMLFormElement>(null);
  const clientIdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      if (clientIdRef.current) clientIdRef.current.value = newId();
    }
  }, [state]);

  const valueErr = state.fieldErrors?.value?.[0];

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <DayField day={day} />
      <input ref={clientIdRef} type="hidden" name="clientId" defaultValue={initialClientId} />
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
            className={inputClass}
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
            className={inputClass}
          >
            {BODYWEIGHT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="lg" disabled={pending} className="h-11 text-base">
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
