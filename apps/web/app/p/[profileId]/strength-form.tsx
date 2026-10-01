'use client';

import {
  DAY_ROLE_LABELS,
  type DayRole,
  DEFAULT_BODYWEIGHT_UNIT,
  ENTRY_STATUS,
  FREE_TEXT_NOTE_MAX,
  LOGGABLE_DIMENSION_LABELS,
  LOGGABLE_DIMENSIONS,
  type MovementStatus,
  newId,
  type SetStatus,
  STRENGTH_DAY_ROLES,
  type Unit,
  UNIT_DIMENSION_BY_CODE,
  UNIT_LABELS,
  type UnitDimension,
  unitsOfDimension,
} from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';

import { INPUT_CLASS } from '@/lib/constants';

import { INITIAL_ACTION_STATE, type ActionState } from './action-state';
import { logStrengthSessionAction } from './actions';
import { DayField } from './day-field';
import { SetModeToggles } from './set-mode-toggles';
import { SetRepsWeightFields } from './set-fields';
import { isUntouchedScaffold, type ScaffoldRow, scaffoldMovements } from './strength-form-scaffold';
import { useOnActionSuccess } from './use-on-action-success';
import {
  dissolveSmallSupersets,
  isUntouchedMovement,
  dropUntouchedMovements,
  groupSelected,
  ungroupSuperset,
} from './strength-form-supersets';

// Form-held movement/set state. Values are strings (the schema's `strengthSetSchema` z.coerce's
// reps/weight), serialized into the hidden `movements` JSON field on each render. Each movement
// owns its OWN `sets` array in this parent state, so add-set on one card can never mutate another
// (the independence the panel flagged) — no shared set-key list. React keys are UUIDs: a set's own
// `key`, a movement's `clientId` (which doubles as its entry idempotency key).
export type SetVals = {
  key: string;
  reps: string;
  weight: string;
  // GAP-3 PR 4a. The two load MODES, as booleans — they replaced the `BW`/`band` STRINGS the old chips
  // wrote into `weight`. ⚠️ Anything added here must also be taught to the two "is this card
  // untouched?" predicates (`strength-form-supersets.ts`, `strength-form-scaffold.ts`) or a set
  // carrying ONLY the new field is silently DELETED at submit.
  isBodyweight?: boolean;
  isBand?: boolean;
  status?: SetStatus;
};
export type MovementVals = {
  clientId: string;
  movementName: string;
  unit: string;
  sets: SetVals[];
  // GAP-1 P1-1c. The WIRE value, not a `skipped: boolean` — a boolean would need mapping in both
  // directions at the payload seam and would drift from the schema the moment a third status appears.
  // Absent means `done`; the payload spreads it, so absent stays absent (matching 1a/1b's writers).
  status?: MovementStatus;
  // V1-8-3d superset tags — set when the movement is grouped; serialized into the movements JSON.
  supersetClientId?: string;
  supersetOrder?: number;
  // V1-19. TRANSIENT — never serialized into the payload (the wire shape has no such field); it marks
  // a card the SCAFFOLD placed rather than the athlete. `dropUntouchedMovements` keys off a blank name
  // to decide a card is disposable, and a scaffolded card always has one, so without this flag doing
  // 5 of 7 programmed movements would block submit behind the other 2's empty required fields.
  scaffolded?: boolean;
  // V1-26 PR-A. TRANSIENT, like `scaffolded` — never serialized into the payload. The CATALOG says
  // this movement is normally loaded (`is_bodyweight: false` AND a declared `unit_default`), so a BW
  // tap on it earns a word. The server has the catalog itself and does not need the form to tell it.
  // Cleared on rename: the declaration was derived from a name that is now gone.
  declaredLoaded?: boolean;
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
export function StrengthForm({
  profileId,
  day,
  defaultDayRole,
  programDay,
}: {
  profileId: string;
  day: string;
  /**
   * GAP-1 P0-1: the programmed day the weekday map resolves for `day`, or null. Used ONLY to
   * pre-select the control below — it is never submitted implicitly. See the note on the select.
   */
  defaultDayRole: DayRole | null;
  /** V1-19 — today's prescribed movements, for the scaffold button. NARROWED (no `load`): the authored
   *  load must never cross into client state, so the boundary is the type, not a test. */
  programDay: readonly ScaffoldRow[];
}) {
  const [state, formAction, pending] = useActionState(
    logStrengthSessionAction,
    INITIAL_ACTION_STATE,
  );
  const [gen, setGen] = useState(0);
  useOnActionSuccess(state, () => setGen((n) => n + 1));

  return (
    <StrengthFormBody
      // ⚠️ **The DAY is part of the key, and that is a fix, not a nicety (V1-28).**
      //
      // V1-15 made day navigation a client-side RSC transition, so this subtree does NOT remount when
      // the day changes — and every uncontrolled field in it keeps the DOM value React set on first
      // mount. The damage is the day-role select: `defaultValue` is applied once, so paging from a
      // Strength B day back to a Strength A day left the select reading "Strength B" while the header
      // above it read "Strength A". Submitting that writes a day role the athlete never chose, into
      // the column whose entire worth is PROVENANCE (see the select's own note) and which V1-13's CSV
      // reads as `session_type`. Reported from real use, 2026-09-30.
      //
      // Remounting also clears typed-but-unsubmitted movement cards on a day change. That is the
      // intended trade: carrying them silently means Day B's movements can be submitted onto Day A,
      // under Day A's heading, with Day B's role. A refresh already loses them.
      key={`${day}:${gen}`}
      profileId={profileId}
      day={day}
      defaultDayRole={defaultDayRole}
      programDay={programDay}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
}

function StrengthFormBody({
  profileId,
  day,
  defaultDayRole,
  programDay,
  state,
  formAction,
  pending,
}: {
  profileId: string;
  day: string;
  /** Pre-selects the day picker only — see the note on that select. The `key={`${day}:${gen}`}`
   *  remount means an override resets to this default for the NEXT session on the same day, which is
   *  intended — and that a DAY change resets it too, which is V1-28. */
  defaultDayRole: DayRole | null;
  programDay: readonly ScaffoldRow[];
  state: ActionState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const [sessionClientId] = useState(newId);
  const [movements, setMovements] = useState<MovementVals[]>(() => [emptyMovement()]);
  // TRANSIENT selection for grouping — never serialized (it's not part of the wire shape).
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // V1-19 — which scaffolded card is open. Scaffolding 7 movements × 4 sets renders ~6,600px of blank
  // inputs at 360px, which would invert the form's one useful signal: today its length grows with work
  // DONE, so a wall of empty rows is maximum length at minimum progress. One card open at a time.
  const [expanded, setExpanded] = useState<string | null>(null);
  // Announcement + one-step undo for the scaffold. `null` = nothing to announce.
  const [scaffoldMsg, setScaffoldMsg] = useState<string | null>(null);
  const [undoStash, setUndoStash] = useState<MovementVals[] | null>(null);

  /** Replace the form with today's program. Ids are minted INSIDE the handler, never memoised — a
   *  replayed scaffold would reuse entry `client_id`s and the write path's ON CONFLICT would silently
   *  turn the next submit into a no-op. */
  const fillFromProgram = () => {
    const replaced = movements.filter((m) => !isUntouchedMovement(m) && !isUntouchedScaffold(m));
    const next = scaffoldMovements(programDay, DEFAULT_BODYWEIGHT_UNIT);
    setUndoStash(movements);
    setMovements(next);
    // Stale clientIds would otherwise linger and let "Group N as superset" act on removed cards.
    setSelected(new Set());
    setExpanded(next[0]?.clientId ?? null);
    // Deliberately does NOT repeat the static caption above ("weights and reps stay blank") — that
    // line is always on screen, and echoing it here reads as two sentences saying one thing. This
    // carries only what the tap CHANGED, which is what a screen-reader user has no other way to learn.
    setScaffoldMsg(
      replaced.length > 0
        ? `Loaded ${next.length} movements, replacing the ${replaced.length} you had typed.`
        : `Loaded ${next.length} movements.`,
    );
  };

  const undoScaffold = () => {
    if (!undoStash) return;
    setMovements(undoStash);
    setUndoStash(null);
    setSelected(new Set());
    setExpanded(null);
    setScaffoldMsg('Undone — your typed movements are back.');
  };

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
      // GAP-1 P1-1c. A skipped movement submits ZERO sets — computed HERE, at serialization, and
      // deliberately NOT by emptying `m.sets` in the toggle handler: that would make a blank-named
      // skipped card `name:'' + sets:[]`, which `[].every(...)` reports as vacuously untouched, and
      // `dropUntouchedMovements` above would silently discard it — reopening the exact bug this PR
      // closes, with the fix in place and looking correct. State keeps the typed sets so unchecking
      // restores them.
      sets:
        m.status === ENTRY_STATUS.skipped
          ? []
          : m.sets.map((s) => ({
              reps: s.reps,
              weight: s.weight,
              // Spread so FALSE stays ABSENT on the wire, matching the status idiom: the schema
              // defaults both to false, and the writer omits the column so Postgres applies its own
              // default. One default, in one place — and an untouched set serializes byte-identically
              // to how it did before PR 4a.
              ...(s.isBodyweight ? { isBodyweight: true } : {}),
              ...(s.isBand ? { isBand: true } : {}),
              ...(s.status !== undefined ? { status: s.status } : {}),
            })),
      ...(m.status !== undefined ? { status: m.status } : {}),
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

      {/* V1-19 — the scaffold. Rendered HERE and not on the program card, because `ProgramReference` is
          a server component that deliberately ships zero client JS; a button that seeds form state
          would drag it into the client graph. Gated on ROWS, not on `dayRole`: the weekday map returns
          a role on every Mon/Wed/Fri whether or not the household actually has a block, so gating on
          the role would show a button that scaffolds nothing. */}
      {programDay.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Button type="button" variant="outline" onClick={fillFromProgram} className="w-full">
            Fill in today&rsquo;s movements
          </Button>
          <p className="text-muted-foreground text-sm">
            Weights and reps stay blank &mdash; type what you actually lifted.
          </p>
          {/* The confirmation a screen reader would otherwise never get: the cards re-flow below the
              fold and nothing else announces the change. Also the only place the blank-fields rule is
              stated to the athlete in words rather than living in docblocks and tests. */}
          <p role="status" className="text-muted-foreground text-sm">
            {scaffoldMsg}
          </p>
          {undoStash ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={undoScaffold}
              className="self-start"
            >
              Undo
            </Button>
          ) : null}
        </div>
      ) : null}

      <ul className="flex flex-col gap-4">
        {movements.map((m, i) => (
          <li key={m.clientId}>
            <MovementCard
              index={i}
              movement={m}
              // V1-19 — a scaffolded card collapses to a one-line summary until opened. A hand-added
              // card is always open: the athlete just asked for it, and there is only ever one.
              collapsed={m.scaffolded === true && expanded !== m.clientId}
              onExpand={() => setExpanded(m.clientId)}
              canRemove={movements.length > 1}
              // GAP-1 P1-1c. `undefined` (not 'done') on uncheck, so the payload spread keeps
              // "absent stays absent" and `isUntouchedMovement` sees a card returned to droppable —
              // otherwise a mis-tap on a spare blank card would wedge the submit permanently.
              onSkipped={(skipped) =>
                patchMovement(m.clientId, {
                  status: skipped ? ENTRY_STATUS.skipped : undefined,
                })
              }
              selected={selected.has(m.clientId)}
              onToggleSelect={() => toggleSelect(m.clientId)}
              onUngroup={m.supersetClientId ? () => ungroup(m.supersetClientId!) : undefined}
              // Renaming clears the carried declaration: `declaredLoaded` was derived from the
              // scaffolded name, and typing over it makes this a different movement the catalog has
              // said nothing about. A warning that outlived its subject would be worse than none.
              onName={(v) =>
                patchMovement(m.clientId, { movementName: v, declaredLoaded: undefined })
              }
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

      {/* GAP-1 P0-1 — WHICH programmed day this was.
          VISIBLE and never a hidden input, deliberately. The stored value's whole worth is PROVENANCE:
          a non-null day_role must mean a human asserted it. The weekday map (`DAY_ROLE_BY_WEEKDAY`) is
          a documented stopgap, so a value it silently supplied would be a guess frozen into a row
          forever — whereas the same derivation applied at EXPORT time re-corrects every historical row
          when the map is replaced. Pre-selecting the default keeps the common path one submit; showing
          it is what makes the assertion real. "Not a programmed day" is a first-class option (and the
          default on Tue/Thu/Sat/Sun) so "no role" is distinguishable from "never asked". */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="session-day-role" className="text-sm font-medium">
          Which day is this?
        </label>
        <select
          id="session-day-role"
          name="dayRole"
          defaultValue={defaultDayRole ?? ''}
          className={INPUT_CLASS}
        >
          <option value="">Not a programmed day</option>
          {STRENGTH_DAY_ROLES.map((role) => (
            <option key={role} value={role}>
              {DAY_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
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
  onSkipped,
  selected,
  onToggleSelect,
  onUngroup,
  onName,
  onUnit,
  onRemove,
  onAddSet,
  onRemoveSet,
  onSet,
  collapsed,
  onExpand,
}: {
  index: number;
  movement: MovementVals;
  canRemove: boolean;
  /** V1-19 — render only the summary row. Its set rows are UNMOUNTED while collapsed (see below). */
  collapsed: boolean;
  onExpand: () => void;
  onSkipped: (skipped: boolean) => void;
  selected: boolean;
  onToggleSelect: () => void;
  onUngroup?: () => void; // present only when the movement is in a superset
  onName: (v: string) => void;
  onUnit: (v: string) => void;
  onRemove: () => void;
  onAddSet: () => void;
  onRemoveSet: (setKey: string) => void;
  onSet: (
    setKey: string,
    patch: Partial<Pick<SetVals, 'reps' | 'weight' | 'status' | 'isBodyweight' | 'isBand'>>,
  ) => void;
}) {
  const nameId = `movement-${movement.clientId}-name`;
  const unitId = `movement-${movement.clientId}-unit`;
  const dimensionId = `movement-${movement.clientId}-dimension`;
  // The movement carries only a UNIT; its dimension is derived, so there is no second field to keep in
  // sync and no way for the pair to disagree with `units(code, dimension)`.
  const dimension = UNIT_DIMENSION_BY_CODE[movement.unit as Unit];
  const inSuperset = movement.supersetClientId != null;
  const isSkipped = movement.status === ENTRY_STATUS.skipped;

  // V1-19 — the collapsed summary. NOT a native <details>, and the set rows are UNMOUNTED rather than
  // CSS-hidden: `SetRepsWeightFields` marks its inputs `required`, and a hidden-but-present required
  // input blocks the native submit with an invisible "not focusable" error — the form simply appears
  // dead. That is the identical trap the Skipped branch already documents below, at a scale of 25 rows.
  if (collapsed) {
    const filled = movement.sets.filter(
      // GAP-3 PR 4a: a BW-only set IS progress. Without the flags the collapsed card's counter reads
      // 0/3 for a fully-tapped bodyweight movement, and that counter is the only "where am I" signal
      // across a 7-movement day.
      (s) => s.reps.trim() !== '' || s.weight.trim() !== '' || s.isBodyweight || s.isBand,
    ).length;
    return (
      <button
        type="button"
        onClick={onExpand}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {index + 1}. {movement.movementName}
          </span>
          {isSkipped ? <span className="text-muted-foreground text-sm">Skipped</span> : null}
        </span>
        {/* The progress the current form has never had: "where am I" across a 7-movement day. */}
        <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
          {filled}/{movement.sets.length}
        </span>
      </button>
    );
  }

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
        {/* GAP-3 PR 4a — DIMENSION FIRST, then the units of that dimension.
            The panel killed a single widened select: nine 1-2 character codes (`m`/`min`/`in`/`cm`)
            adjacent on an iOS wheel picker is a trap, and the mistake is UNRECOVERABLE — a squat
            logged in `sec` has dimension `time`, so `isEditableSet` refuses it and there is no delete
            action in this app. Asking the plain-words question first makes a squat-in-seconds
            unreachable rather than merely unlikely, and `mass` is the default so the common movement
            costs zero extra taps. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={dimensionId} className="text-sm font-medium">
            Measuring
          </label>
          <select
            id={dimensionId}
            value={dimension}
            onChange={(e) => {
              // Switching dimension re-homes the unit to that dimension's first code — the pair can
              // never be left inconsistent, which is what the composite FK would otherwise reject.
              const next = unitsOfDimension(e.target.value as UnitDimension)[0];
              if (next) onUnit(next);
            }}
            className={INPUT_CLASS}
            aria-label={`What movement ${index + 1} measures`}
          >
            {LOGGABLE_DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {LOGGABLE_DIMENSION_LABELS[d] ?? d}
              </option>
            ))}
          </select>
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
            aria-label={`Unit for movement ${index + 1}`}
          >
            {/* UNIT_LABELS, not the raw codes: `in` and `m` are unreadable aloud and near-invisible
                on a wheel picker. The labels already exist in packages/shared and had no consumer. */}
            {unitsOfDimension(dimension).map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
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

      {/* GAP-1 P1-1c — mark the whole movement skipped. A checkbox wrapped in its own label, matching
          the superset toggle above: `e2e/a11y.spec.ts` measures the BOUND label as the tap target and
          fails an aria-label-only checkbox outright. Placed BEFORE the sets region so a screen reader
          meets the cause before the effect. */}
      <label className="flex min-h-11 w-fit items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={isSkipped}
          onChange={(e) => onSkipped(e.target.checked)}
          aria-label={`Movement ${index + 1} skipped`}
        />
        Skipped
      </label>

      {isSkipped ? (
        // The set rows are UNMOUNTED, not CSS-hidden: `SetRepsWeightFields` marks its inputs
        // `required`, and a hidden-but-present required input blocks the native submit with an
        // invisible browser error ("not focusable") — the form would simply appear dead. This line
        // also answers "did I break it?" for a sighted user and is the non-visual carrier for a
        // screen reader. The typed sets survive in parent state; unchecking brings them back.
        <p className="text-muted-foreground text-sm">Marked skipped — no sets will be logged.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Sets</span>
          {movement.sets.map((s, i) => (
            // Two EXPLICIT lines, not flex-wrap luck. At 360px the usable width is ~296px
            // (main px-4 + fieldset px-4) and line 1 alone is ~262px, so the chips + toggle + remove
            // must be their own row or they overflow on the phone this is used on.
            <div key={s.key} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground w-5 text-sm tabular-nums">{i + 1}</span>
                <SetRepsWeightFields
                  reps={s.reps}
                  weight={s.weight}
                  onReps={(v) => onSet(s.key, { reps: v })}
                  onWeight={(v) => onSet(s.key, { weight: v })}
                  ariaLabel={`Movement ${index + 1} set ${i + 1}`}
                  // ⚠️ LOAD-BEARING. A BW or band set legitimately has NO magnitude, and a `required`
                  // input that must be empty blocks the native submit with an error the browser will
                  // not render — the form just appears dead. `strengthSetSchema`'s superRefine is what
                  // actually enforces "a set must carry some load", because it can see all three
                  // fields at once and reports through fieldErrors.
                  weightRequired={!s.isBodyweight && !s.isBand}
                  unitLabel={movement.unit}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-7">
                {/* One-tap load modes. Without these, `BW` — the most common load in the program —
                would be the hardest thing to enter on a phone, because iOS's numeric keypad has no
                letters. Since PR 4a they write BOOLEANS rather than text into the weight field, so
                `BW` and a weight can now coexist (that pairing is `BW+8 (vest)`). */}
                <SetModeToggles
                  isBodyweight={s.isBodyweight ?? false}
                  isBand={s.isBand ?? false}
                  onChange={(patch) => onSet(s.key, patch)}
                  ariaLabel={`movement ${index + 1} set ${i + 1}`}
                />
                {/* GAP-1 P1-1c — this ATTEMPT went to failure short of the prescribed reps. Same idiom as
                the Skipped checkbox (one toggle pattern per card). The accessible name is unique per
                set — five controls all named "Sub-failure" are indistinguishable in a screen-reader
                forms list — and the visible text is a SUBSTRING of it (WCAG 2.5.3 Label in Name).
                `reps` stays required: a sub-failure set records what WAS achieved. */}
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={s.status === ENTRY_STATUS.sub_failure}
                    onChange={(e) =>
                      onSet(s.key, {
                        // undefined, never 'done', on untoggle — so "absent stays absent" on the wire.
                        status: e.target.checked ? ENTRY_STATUS.sub_failure : undefined,
                      })
                    }
                    aria-label={`Sub-failure — movement ${index + 1} set ${i + 1}`}
                  />
                  Sub-failure
                </label>
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
            </div>
          ))}
          {/* V1-26 PR-A — the 2026-09-28 incident, said out loud. Liam's KB swings were logged
              `20 × BW` when the session was `10 × 20 lb`, and the app said nothing at the moment of
              the mistake and then could not fix it afterwards.

              A WARNING, never a lockout: the catalog's declaration is a normal case, not a rule, and
              an athlete doing bodyweight KB swings is allowed to be right. It is also not a per-set
              note — three copies of one sentence on a three-set card is noise on a 360px screen —
              so it renders once per movement, for the whole card.

              `role="status"` and not `alert`: this is advisory, and `alert` interrupts. It sits
              BELOW the set rows deliberately, so appearing cannot reflow the row under the thumb
              that just tapped the chip. */}
          {movement.declaredLoaded && movement.sets.some((s) => s.isBodyweight) ? (
            <p role="status" className="text-muted-foreground text-sm">
              {movement.movementName} is usually logged with a weight.
            </p>
          ) : null}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={onAddSet}>
              Add set
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
