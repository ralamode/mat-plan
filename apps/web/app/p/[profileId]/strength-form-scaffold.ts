import {
  type BodyweightUnit,
  MAX_SESSION_MOVEMENTS,
  MAX_SETS_PER_MOVEMENT,
  newId,
} from '@mat-plan/shared';

import type { MovementVals } from './strength-form';
import { isDefaultStatus } from './strength-form-supersets';

/**
 * V1-19 — build the strength form's movement cards from the day's program, so the athlete stops
 * retyping the names off the card directly above the form (`program-reference.tsx`). Pure and
 * colocated, the `strength-form-supersets.ts` precedent: a sibling of the one form that uses it, so
 * `MovementVals` is an ordinary same-directory import rather than `lib/` reaching into a
 * `'use client'` module under `app/`.
 *
 * STRUCTURE ONLY — every `reps` and `weight` arrives EMPTY. That is not a simplification, it is the
 * V1-10 panel's holding (`docs/plans/v1-10-2-strength-prefill.md`): the blank `required` field IS the
 * human confirmation, so pre-filling one lets a PRESCRIBED value be logged as a PERFORMED one with no
 * affirmative entry. The panel's reason (2) is that confirm-gate — a mechanism, not a load-specific
 * rule — so it binds reps exactly as it binds loads, and its reason (3) rejects parsing `target_reps`
 * ("8-12"/"AMRAP"/"8/side") into the numeric field outright. The plan's review panel caught an earlier
 * draft of this module eroding that; `strength-form-scaffold.test.ts` now pins it structurally.
 */

/**
 * The rows this module needs — deliberately NARROWER than `ProgramDayDTO`, which also carries the
 * per-kid prescribed `load`. Omitting it means the authored load never crosses into client state at
 * all, so "no authored load reaches an input" is enforced by the type rather than by a test. A future
 * post-GAP-3 load chip widens this Pick deliberately; it cannot inherit the access by accident.
 */
export type ScaffoldRow = {
  /** The prescription's slot within the day — the coach's authored order. */
  idx: number;
  movementName: string;
  /** Prescribed set count; nullable in the schema (a movement-only prescription is legal). */
  sets: number | null;
};

/**
 * Program rows → form state, in the coach's `idx` order.
 *
 * Clamped to the SHARED schema limits, never re-typed literals: `prescriptions_sets_check` allows any
 * `sets > 0` and nothing caps the prescription count, but `sessionMovementSchema` caps movements at
 * `MAX_SESSION_MOVEMENTS` and sets at `MAX_SETS_PER_MOVEMENT`. Without the clamp, a 13-prescription
 * day would scaffold a form that can never submit — a dead end with no affordance to escape it.
 *
 * `clientId`s are minted HERE, per call, and the caller must never memoise the result: a replayed
 * scaffold would reuse entry `client_id`s and the write path's `ON CONFLICT DO NOTHING` would turn the
 * next submit into a silent no-op.
 */
export function scaffoldMovements(
  rows: readonly ScaffoldRow[],
  defaultUnit: BodyweightUnit,
): MovementVals[] {
  return rows.slice(0, MAX_SESSION_MOVEMENTS).map((row) => ({
    clientId: newId(),
    movementName: row.movementName,
    unit: defaultUnit,
    // Never 0 rows: a card with zero sets is the vacuous-truth shape BUG-2(b) had to fix
    // (`[].every(...)` is true), and a non-skipped movement with no sets fails the schema anyway.
    sets: Array.from({ length: clampSetCount(row.sets) }, () => ({
      key: newId(),
      reps: '',
      weight: '',
    })),
    // V1-19: marks this card as machine-placed rather than athlete-added, so the submit-time drop
    // predicate can discard one the athlete never touched. Without it every scaffolded card is
    // permanently "touched" (it has a name), and performing 5 of 7 programmed movements would block
    // the submit until the other 2 were explicitly skipped or removed.
    scaffolded: true,
  }));
}

/**
 * How many blank set rows a prescription that authors NO set count (`sets: null`) scaffolds.
 *
 * This is set STRUCTURE, not a prescription — the same category as the movement name V1-19 already
 * places, and every `reps`/`weight` field in these rows still arrives empty (see the module docblock).
 * `ScaffoldRow` still carries no `load`.
 *
 * Why it is not 1 (V1-23 PR 1): `PROGRAM_SEED` — the only seeded block — is `open()` on 11 of its 13
 * prescriptions, so the old `?? 1` gave every open movement ONE row. A 5-movement Day B therefore cost
 * ~10 "Add set" taps, ~20% of the session's total, and the `filled/total` counter read `0/1 → 1/1`
 * while two sets were still to come — lying on the form's only "where am I" signal. 1 was chosen as a
 * FLOOR for a nonsense value, never as a default for a program that prescribes no sets at all.
 *
 * Why not "remember last session": better, and a real follow-up, but it needs a query and a rule for
 * which session counts. Three is one constant and it matches every set-based movement in the YDP.
 */
export const DEFAULT_SCAFFOLD_SETS = 3;

/** Prescribed sets → set-row count, clamped to what the session schema will accept. */
function clampSetCount(sets: number | null): number {
  // No authored count → the default structure above.
  if (sets == null) return DEFAULT_SCAFFOLD_SETS;
  // An explicit count below 1 still FLOORS to 1 — the BUG-2(b) guard, deliberately not the default:
  // a coach who authored a set count is honoured, a nonsense one is only rescued from the zero-row
  // vacuous-truth shape, not silently replaced with three rows they never asked for.
  if (sets < 1) return 1;
  return Math.min(sets, MAX_SETS_PER_MOVEMENT);
}

/**
 * Did the athlete touch this scaffolded card at all? Deliberately NOT `isUntouchedMovement` — that
 * predicate requires an empty `movementName`, and every scaffolded card has one, so it reports every
 * scaffolded card as touched forever. The name is excluded here precisely because the scaffold, not
 * the athlete, supplied it; everything else is the same test.
 *
 * Status is compared via the shared `isDefaultStatus`, never to `undefined`: a card marked skipped and
 * then UNMARKED must become droppable again (the same reasoning that predicate already carries).
 */
export function isUntouchedScaffold(m: {
  scaffolded?: boolean;
  sets: readonly {
    reps: string;
    weight: string;
    status?: string;
    isBodyweight?: boolean;
    isBand?: boolean;
  }[];
  status?: string;
}): boolean {
  return (
    m.scaffolded === true &&
    isDefaultStatus(m.status) &&
    m.sets.every(
      (s) =>
        s.reps.trim() === '' &&
        s.weight.trim() === '' &&
        !s.isBodyweight &&
        !s.isBand &&
        isDefaultStatus(s.status),
    )
  );
}
