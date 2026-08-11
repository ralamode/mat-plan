'use client';

import {
  BODYWEIGHT_UNITS,
  DEFAULT_BODYWEIGHT_UNIT,
  FREE_TEXT_NOTE_MAX,
  newId,
} from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';

import { INPUT_CLASS } from '@/lib/constants';

import { INITIAL_ACTION_STATE, type ActionState } from './action-state';
import { logStrengthSessionAction } from './actions';
import { DayField } from './day-field';
import { LoadChips } from './load-chips';
import { SetRepsWeightFields } from './set-fields';
import {
  dissolveSmallSupersets,
  dropUntouchedMovements,
  groupSelected,
  ungroupSuperset,
} from './strength-form-supersets';

// Form-held movement/set state. Values are strings (the schema's `strengthSetSchema` z.coerce's
// reps/weight), serialized into the hidden `movements` JSON field on each render. Each movement
// owns its OWN `sets` array in this parent state, so add-set on one card can never mutate another
// (the independence the panel flagged) — no shared set-key list. React keys are UUIDs: a set's own
// `key`, a movement's `clientId` (which doubles as its entry idempotency key).
type SetVals = { key: string; reps: string; weight: string };
type MovementVals = {
  clientId: string;
  movementName: string;
  unit: string;
  sets: SetVals[];
  // V1-8-3d superset tags — set when the movement is grouped; serialized into the movements JSON.
  supersetClientId?: string;
  supersetOrder?: number;
};

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
  const [state, formAction, pending] = useActionState(
    logStrengthSessionAction,
    INITIAL_ACTION_STATE,
  );
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
  // TRANSIENT selection for grouping — never serialized (it's not part of the wire shape).
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const patchMovement = (
    clientId: string,
    patch: Partial<Omit<MovementVals, 'clientId' | 'sets'>>,
  ) => setMovements((ms) => ms.map((m) => (m.clientId === clientId ? { ...m, ...patch } : m)));
  const patchSets = (clientId: string, fn: (sets: SetVals[]) => SetVals[]) =>
    setMovements((ms) => ms.map((m) => (m.clientId === clientId ? { ...m, sets: fn(m.sets) } : m)));

  const addMovement = () => setMovements((ms) => [...ms, emptyMovement()]);
  // On remove, dissolve any superset that dropped below 2 members (the pure helper) so no lone member
  // reaches the ≥2 superRefine.
  const removeMovement = (clientId: string) =>
    setMovements((ms) =>
      ms.length > 1 ? dissolveSmallSupersets(ms.filter((m) => m.clientId !== clientId)) : ms,
    );

  const toggleSelect = (clientId: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  const groupSelectedMovements = () => {
    setMovements((ms) => groupSelected(ms, selected, newId()));
    setSelected(new Set());
  };
  const ungroup = (supersetClientId: string) =>
    setMovements((ms) => ungroupSuperset(ms, supersetClientId));

  const selectedCount = movements.filter((m) => selected.has(m.clientId)).length;

  // Before serializing: drop fully-untouched movement cards (blank name + all-blank sets) so an
  // added-but-unused card doesn't block the log with empty-field errors — then dissolve any superset a
  // drop left with a lone member. A partially-typed card is NOT dropped (it validates). If every card is
  // untouched the payload is [] and the schema's "add at least one movement" still fires.
  const submittable = dissolveSmallSupersets(dropUntouchedMovements(movements));

  // The wire shape the action JSON.parses + zod-validates (strings; the schema coerces numbers). Superset
  // tags ride here per-movement; the action DERIVES the supersets[] from these distinct ids.
  const movementsJson = JSON.stringify(
    submittable.map((m) => ({
      movementName: m.movementName,
      unit: m.unit,
      clientId: m.clientId,
      sets: m.sets.map((s) => ({ reps: s.reps, weight: s.weight })),
      ...(m.supersetClientId != null
        ? { supersetClientId: m.supersetClientId, supersetOrder: m.supersetOrder }
        : {}),
    })),
  );

  // All movement-level messages (the action names each by movement number), not just the first —
  // a multi-card form can have several invalid movements at once. Superset-level messages (≥2 members,
  // distinct order) come separately so a grouping mistake is recoverable, not a locked banner.
  const movementErrs = state.fieldErrors?.movements ?? [];
  const supersetErrs = state.fieldErrors?.supersets ?? [];

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
              selected={selected.has(m.clientId)}
              onToggleSelect={() => toggleSelect(m.clientId)}
              onUngroup={m.supersetClientId ? () => ungroup(m.supersetClientId!) : undefined}
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

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addMovement}>
          Add movement
        </Button>
        {selectedCount >= 2 ? (
          <Button type="button" variant="outline" size="sm" onClick={groupSelectedMovements}>
            Group {selectedCount} as superset
          </Button>
        ) : null}
      </div>

      {/* Session-level feel — a discrete named field (NOT in the movements JSON); uncontrolled, so the
          key-remount reset clears it on a successful log. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="session-feel" className="text-sm font-medium">
          How did it feel? <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="session-feel"
          name="feel"
          type="text"
          maxLength={FREE_TEXT_NOTE_MAX}
          placeholder="e.g. strong, tired, easy"
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <Button type="submit" size="lg" disabled={pending} className="text-base">
          {pending ? 'Logging…' : 'Log strength'}
        </Button>
      </div>

      {movementErrs.length > 0 || supersetErrs.length > 0 ? (
        <div role="alert" className="text-destructive flex flex-col gap-1 text-sm">
          {[...movementErrs, ...supersetErrs].map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
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
 * are independent). Reuses the shared `INPUT_CLASS`; no third copy.
 */
function MovementCard({
  index,
  movement,
  canRemove,
  selected,
  onToggleSelect,
  onUngroup,
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
  selected: boolean;
  onToggleSelect: () => void;
  onUngroup?: () => void; // present only when the movement is in a superset
  onName: (v: string) => void;
  onUnit: (v: string) => void;
  onRemove: () => void;
  onAddSet: () => void;
  onRemoveSet: (setKey: string) => void;
  onSet: (setKey: string, patch: Partial<Pick<SetVals, 'reps' | 'weight'>>) => void;
}) {
  const nameId = `movement-${movement.clientId}-name`;
  const unitId = `movement-${movement.clientId}-unit`;
  const inSuperset = movement.supersetClientId != null;
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border px-4 py-3">
      <legend className="flex items-center gap-2 px-1 text-sm font-medium">
        Movement {index + 1}
        {inSuperset ? (
          <span className="text-muted-foreground rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
            superset
          </span>
        ) : null}
      </legend>

      {/* Group-as-superset controls (V1-8-3d): select for grouping, or ungroup if already grouped. */}
      <div className="flex items-center gap-3">
        {inSuperset ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onUngroup}
            // The control dissolves the WHOLE superset this movement belongs to (ungroupSuperset
            // untags every member), not just this one card — the label says so plainly.
            aria-label="Ungroup this superset"
          >
            Ungroup
          </Button>
        ) : (
          // The <label> is the tap target (a tap toggles the checkbox), sized to the ≥44px phone-first
          // minimum — the 20px box alone would be an easy mis-tap on the gym floor.
          <label className="text-muted-foreground flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="h-5 w-5"
              aria-label={`Select movement ${index + 1} for a superset`}
            />
            Superset
          </label>
        )}
      </div>
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
            className={INPUT_CLASS}
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
            className={INPUT_CLASS}
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
          <div key={s.key} className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground w-5 text-sm tabular-nums">{i + 1}</span>
            <SetRepsWeightFields
              reps={s.reps}
              weight={s.weight}
              onReps={(v) => onSet(s.key, { reps: v })}
              onWeight={(v) => onSet(s.key, { weight: v })}
              ariaLabel={`Movement ${index + 1} set ${i + 1}`}
              // GAP-1 P0-2: the LOG form accepts a text load (BW / band / 30in / 30s). The V1-9 edit
              // form keeps the default numeric mode — its schema and its SQL guard are numeric-only.
              mode="load"
            />
            {/* One-tap canonical labels. Without these, `BW` — the most common load in the program —
                would be the hardest thing to enter on a phone. */}
            <LoadChips
              active={s.weight}
              onPick={(v) => onSet(s.key, { weight: v })}
              ariaLabel={`Movement ${index + 1} set ${i + 1}`}
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
