'use client';

import { BODYWEIGHT_UNITS, DEFAULT_BODYWEIGHT_UNIT, newId } from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';

import { logStrengthSessionAction, type ActionState } from './actions';
import { DayField } from './day-field';

const initialState: ActionState = { ok: false, error: null };

const inputClass =
  'border-input bg-background focus-visible:ring-ring h-11 rounded-lg border px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

// Form-held movement/set state. Values are strings (the schema's `strengthSetSchema` z.coerce's
// reps/weight), serialized into the hidden `movements` JSON field on each render. Each movement
// owns its OWN `sets` array in this parent state, so add-set on one card can never mutate another
// (the independence the panel flagged) — no shared set-key list. React keys are UUIDs: a set's own
// `key`, a movement's `clientId` (which doubles as its entry idempotency key).
type SetVals = { key: string; reps: string; weight: string };
type MovementVals = { clientId: string; movementName: string; unit: string; sets: SetVals[] };

const emptySet = (): SetVals => ({ key: newId(), reps: '', weight: '' });
const emptyMovement = (): MovementVals => ({
  clientId: newId(),
  movementName: '',
  unit: DEFAULT_BODYWEIGHT_UNIT,
  sets: [emptySet()],
});

/**
 * Log a flat multi-movement strength session (V1-8-2). The action lives here; the actual form fields
 * live in `StrengthFormBody`, keyed on a `gen` counter this component bumps DURING RENDER after a
 * successful write (the checkin-form during-render idiom — not an effect). Bumping `gen` remounts the
 * body, so its `useState` initializers mint FRESH idempotency keys (session + per-movement) and clear
 * the inputs — a stale id would otherwise make the next submit a silent ON CONFLICT no-op.
 */
export function StrengthForm({ profileId, day }: { profileId: string; day: string }) {
  const [state, formAction, pending] = useActionState(logStrengthSessionAction, initialState);
  const [gen, setGen] = useState(0);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) setGen((n) => n + 1);
  }

  return (
    <StrengthFormBody
      key={gen}
      profileId={profileId}
      day={day}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
}

function StrengthFormBody({
  profileId,
  day,
  state,
  formAction,
  pending,
}: {
  profileId: string;
  day: string;
  state: ActionState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const [sessionClientId] = useState(newId);
  const [movements, setMovements] = useState<MovementVals[]>(() => [emptyMovement()]);

  const patchMovement = (
    clientId: string,
    patch: Partial<Omit<MovementVals, 'clientId' | 'sets'>>,
  ) => setMovements((ms) => ms.map((m) => (m.clientId === clientId ? { ...m, ...patch } : m)));
  const patchSets = (clientId: string, fn: (sets: SetVals[]) => SetVals[]) =>
    setMovements((ms) => ms.map((m) => (m.clientId === clientId ? { ...m, sets: fn(m.sets) } : m)));

  const addMovement = () => setMovements((ms) => [...ms, emptyMovement()]);
  const removeMovement = (clientId: string) =>
    setMovements((ms) => (ms.length > 1 ? ms.filter((m) => m.clientId !== clientId) : ms));

  // The wire shape the action JSON.parses + zod-validates (strings; the schema coerces numbers).
  const movementsJson = JSON.stringify(
    movements.map((m) => ({
      movementName: m.movementName,
      unit: m.unit,
      clientId: m.clientId,
      sets: m.sets.map((s) => ({ reps: s.reps, weight: s.weight })),
    })),
  );

  const movementsErr = state.fieldErrors?.movements?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <DayField day={day} />
      <input type="hidden" name="clientId" value={sessionClientId} readOnly />
      <input type="hidden" name="movements" value={movementsJson} readOnly />

      <ul className="flex flex-col gap-4">
        {movements.map((m, i) => (
          <li key={m.clientId}>
            <MovementCard
              index={i}
              movement={m}
              canRemove={movements.length > 1}
              onName={(v) => patchMovement(m.clientId, { movementName: v })}
              onUnit={(v) => patchMovement(m.clientId, { unit: v })}
              onRemove={() => removeMovement(m.clientId)}
              onAddSet={() => patchSets(m.clientId, (sets) => [...sets, emptySet()])}
              onRemoveSet={(sk) =>
                patchSets(m.clientId, (sets) =>
                  sets.length > 1 ? sets.filter((s) => s.key !== sk) : sets,
                )
              }
              onSet={(sk, patch) =>
                patchSets(m.clientId, (sets) =>
                  sets.map((s) => (s.key === sk ? { ...s, ...patch } : s)),
                )
              }
            />
          </li>
        ))}
      </ul>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={addMovement}>
          Add movement
        </Button>
      </div>

      <div>
        <Button type="submit" size="lg" disabled={pending} className="h-11 text-base">
          {pending ? 'Logging…' : 'Log strength'}
        </Button>
      </div>

      {movementsErr ? (
        <p role="alert" className="text-destructive text-sm">
          {movementsErr}
        </p>
      ) : state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * One movement card — a `<fieldset>` with a name + unit and its own set rows. Presentational: all
 * state lives in the parent `movements` array (so serialization has one source and each card's sets
 * are independent). Reuses the shared `inputClass`; no third copy.
 */
function MovementCard({
  index,
  movement,
  canRemove,
  onName,
  onUnit,
  onRemove,
  onAddSet,
  onRemoveSet,
  onSet,
}: {
  index: number;
  movement: MovementVals;
  canRemove: boolean;
  onName: (v: string) => void;
  onUnit: (v: string) => void;
  onRemove: () => void;
  onAddSet: () => void;
  onRemoveSet: (setKey: string) => void;
  onSet: (setKey: string, patch: Partial<Pick<SetVals, 'reps' | 'weight'>>) => void;
}) {
  const nameId = `movement-${movement.clientId}-name`;
  const unitId = `movement-${movement.clientId}-unit`;
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border px-4 py-3">
      <legend className="px-1 text-sm font-medium">Movement {index + 1}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            Movement
          </label>
          <input
            id={nameId}
            type="text"
            required
            placeholder="Back squat"
            autoComplete="off"
            value={movement.movementName}
            onChange={(e) => onName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={unitId} className="text-sm font-medium">
            Unit
          </label>
          <select
            id={unitId}
            value={movement.unit}
            onChange={(e) => onUnit(e.target.value)}
            className={inputClass}
          >
            {BODYWEIGHT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove movement ${index + 1}`}
          >
            Remove
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Sets</span>
        {movement.sets.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="text-muted-foreground w-5 text-sm tabular-nums">{i + 1}</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              required
              placeholder="reps"
              aria-label={`Movement ${index + 1} set ${i + 1} reps`}
              value={s.reps}
              onChange={(e) => onSet(s.key, { reps: e.target.value })}
              className={`${inputClass} w-24`}
            />
            <span className="text-muted-foreground text-sm">×</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              required
              placeholder="weight"
              aria-label={`Movement ${index + 1} set ${i + 1} weight`}
              value={s.weight}
              onChange={(e) => onSet(s.key, { weight: e.target.value })}
              className={`${inputClass} w-28`}
            />
            {movement.sets.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemoveSet(s.key)}
                aria-label={`Remove movement ${index + 1} set ${i + 1}`}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onAddSet}>
            Add set
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
