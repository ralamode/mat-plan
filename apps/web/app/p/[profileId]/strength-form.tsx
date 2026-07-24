'use client';

import { BODYWEIGHT_UNITS, DEFAULT_BODYWEIGHT_UNIT, newId } from '@mat-plan/shared';
import { useActionState, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { logStrengthAction, type ActionState } from './actions';
import { DayField } from './day-field';

const initialState: ActionState = { ok: false, error: null };

const inputClass =
  'border-input bg-background focus-visible:ring-ring h-11 rounded-lg border px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

export function StrengthForm({ profileId, day }: { profileId: string; day: string }) {
  const [state, formAction, pending] = useActionState(logStrengthAction, initialState);
  const [initialClientId] = useState(newId);
  const [setKeys, setSetKeys] = useState<number[]>([0]);
  const nextKey = useRef(1);
  const formRef = useRef<HTMLFormElement>(null);
  const clientIdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      if (clientIdRef.current) clientIdRef.current.value = newId();
    }
  }, [state]);

  const addSet = () => setSetKeys((keys) => [...keys, nextKey.current++]);
  const removeSet = (key: number) =>
    setSetKeys((keys) => (keys.length > 1 ? keys.filter((k) => k !== key) : keys));

  const movementErr = state.fieldErrors?.movementName?.[0];
  const setsErr = state.fieldErrors?.sets?.[0];

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <DayField day={day} />
      <input ref={clientIdRef} type="hidden" name="clientId" defaultValue={initialClientId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="movementName" className="text-sm font-medium">
            Movement
          </label>
          <input
            id="movementName"
            name="movementName"
            type="text"
            required
            placeholder="Back squat"
            autoComplete="off"
            aria-invalid={movementErr ? true : undefined}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="strength-unit" className="text-sm font-medium">
            Unit
          </label>
          <select
            id="strength-unit"
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
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Sets</legend>
        {setKeys.map((key, i) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-muted-foreground w-5 text-sm tabular-nums">{i + 1}</span>
            <input
              name="reps"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              required
              placeholder="reps"
              aria-label={`Set ${i + 1} reps`}
              className={`${inputClass} w-24`}
            />
            <span className="text-muted-foreground text-sm">×</span>
            <input
              name="weight"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              required
              placeholder="weight"
              aria-label={`Set ${i + 1} weight`}
              className={`${inputClass} w-28`}
            />
            {setKeys.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeSet(key)}
                aria-label={`Remove set ${i + 1}`}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={addSet}>
            Add set
          </Button>
        </div>
      </fieldset>

      <div>
        <Button type="submit" size="lg" disabled={pending} className="h-11 text-base">
          {pending ? 'Logging…' : 'Log strength'}
        </Button>
      </div>

      {movementErr ? (
        <p role="alert" className="text-destructive text-sm">
          {movementErr}
        </p>
      ) : setsErr ? (
        <p role="alert" className="text-destructive text-sm">
          {setsErr}
        </p>
      ) : state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
