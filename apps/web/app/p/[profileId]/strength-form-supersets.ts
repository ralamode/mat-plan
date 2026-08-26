/**
 * Pure superset-grouping transforms for the strength form (V1-8-3d). Extracted from the React component
 * so the group / ungroup / dissolve-below-2 transitions are unit-tested independent of rendering — they
 * are the form's highest-risk new logic (a bug here makes the ≥2 superRefine reject on submit). Generic
 * over the minimal movement shape (`clientId` + the optional superset tags).
 */

import { ENTRY_STATUS } from '@mat-plan/shared';
export type SupersetTaggable = {
  clientId: string;
  supersetClientId?: string;
  supersetOrder?: number;
};

/** Tag the selected movements (only if ≥2) as ONE new superset — `supersetOrder` is 1-based in their
 *  current array order (the alternating order). Fewer than 2 selected is a no-op. */
export function groupSelected<T extends SupersetTaggable>(
  movements: readonly T[],
  selected: ReadonlySet<string>,
  supersetClientId: string,
): T[] {
  const count = movements.filter((m) => selected.has(m.clientId)).length;
  if (count < 2) return [...movements];
  let order = 0;
  return movements.map((m) =>
    selected.has(m.clientId) ? { ...m, supersetClientId, supersetOrder: ++order } : m,
  );
}

/** Strip a superset's tags off all its members (explicit ungroup). */
export function ungroupSuperset<T extends SupersetTaggable>(
  movements: readonly T[],
  supersetClientId: string,
): T[] {
  return movements.map((m) =>
    m.supersetClientId === supersetClientId
      ? { ...m, supersetClientId: undefined, supersetOrder: undefined }
      : m,
  );
}

/** Dissolve any superset that has dropped below 2 members (call after a remove/ungroup): strip the tags
 *  off the survivors so no lone member reaches the ≥2 superRefine. A no-op when every superset is ≥2. */
export function dissolveSmallSupersets<T extends SupersetTaggable>(movements: readonly T[]): T[] {
  const counts = new Map<string, number>();
  for (const m of movements) {
    if (m.supersetClientId)
      counts.set(m.supersetClientId, (counts.get(m.supersetClientId) ?? 0) + 1);
  }
  return movements.map((m) =>
    m.supersetClientId && (counts.get(m.supersetClientId) ?? 0) < 2
      ? { ...m, supersetClientId: undefined, supersetOrder: undefined }
      : m,
  );
}

/** The minimal shape the untouched-card check reads. `status` at both levels is GAP-1 P1-1c — see below. */
export type MovementDraft = {
  movementName: string;
  status?: string;
  sets: readonly { reps: string; weight: string; status?: string }[];
};

/** True when a status is absent or explicitly the default — i.e. the athlete has expressed nothing.
 *  Compares to the DEFAULT, never to `undefined`: a card that was marked skipped and then UNMARKED must
 *  become droppable again, or a mis-tap on a spare blank card wedges the submit behind
 *  "Movement 3: Enter a movement." with Remove as the only escape. */
const isDefaultStatus = (status: string | undefined): boolean =>
  (status ?? ENTRY_STATUS.done) === ENTRY_STATUS.done;

/**
 * A movement card is "untouched" — safe to drop on submit — ONLY when its name is blank, every set's
 * reps and weight are blank, AND no status has been set at either level. A card with ANY field typed is
 * a partial entry, NOT untouched, so it still validates rather than being silently discarded.
 *
 * GAP-1 P1-1c (BUG-2b): **a status IS a typed field**, and both levels matter.
 *
 * - `sets.every(...)` on an EMPTY array is **vacuously true**, so before this fix a skipped movement
 *   (which legitimately carries zero sets) with a blank name was silently discarded — no row, no error.
 *   That hazard only became reachable once P1-1a let a card have zero sets.
 * - The identical argument applies one level down: tapping "Sub-failure" on a spare card and submitting
 *   would drop it just as silently. Guarding only the movement level would have shipped the same bug in
 *   the other direction, in the very PR that closes it.
 */
export function isUntouchedMovement(m: MovementDraft): boolean {
  return (
    m.movementName.trim() === '' &&
    isDefaultStatus(m.status) &&
    m.sets.every((s) => s.reps.trim() === '' && s.weight.trim() === '' && isDefaultStatus(s.status))
  );
}

/** Drop the fully-untouched movement cards before building the submit payload, so a user who added a card
 *  and left it blank isn't blocked by its (empty-field) validation errors. Preserves the schema's min(1):
 *  if EVERY card is untouched the result is empty → the "add at least one movement" error still fires. */
export function dropUntouchedMovements<T extends MovementDraft>(movements: readonly T[]): T[] {
  return movements.filter((m) => !isUntouchedMovement(m));
}
