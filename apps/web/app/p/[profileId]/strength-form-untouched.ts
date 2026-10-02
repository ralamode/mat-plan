/**
 * V1-27 — the ONE place the strength form decides what the athlete has "touched", which rows are
 * `required`, which rows and cards are sent, and whether the browser will block the tap.
 *
 * Before V1-27 the "untouched" rule was written out three times (two movement predicates and the
 * collapsed-card counter), and the copies had already drifted (the counter ignored sub-failure). A field
 * added to a set must be taught to `isUntouchedSet` ONLY — every other judgement here derives from it.
 * Pure: no React, no DOM. Plan: `docs/plans/v1-27-partial-sets.md`.
 *
 * Generic over the minimal shapes it reads, so the form's `MovementVals` and the tests' drafts both fit.
 */

import { ENTRY_STATUS } from '@mat-plan/shared';

/** The set fields the "touched" judgement reads. Anything added to a form set must be added here. */
export type SetDraft = {
  reps: string;
  weight: string;
  status?: string;
  isBodyweight?: boolean;
  isBand?: boolean;
};

/** The minimal movement shape the predicates read. `status` at both levels is GAP-1 P1-1c. */
export type MovementDraft = {
  movementName: string;
  status?: string;
  /** V1-19 — the card was placed by the scaffold, not the athlete. Cleared on rename (V1-27). */
  scaffolded?: boolean;
  sets: readonly SetDraft[];
};

/** True when a status is absent or explicitly the default — i.e. the athlete has expressed nothing.
 *  Compares to the DEFAULT, never to `undefined`: a card that was marked skipped and then UNMARKED must
 *  become droppable again, or a mis-tap on a spare blank card wedges the submit behind
 *  "Movement 3: Enter a movement." with Remove as the only escape. */
export const isDefaultStatus = (status: string | undefined): boolean =>
  (status ?? ENTRY_STATUS.done) === ENTRY_STATUS.done;

/**
 * A set row the athlete has not touched: no reps, no weight, no BW, no band, no status. `0` counts as a
 * touch (it is typed). The movement's UNIT is not a set field and never a touch: the scaffold
 * pre-selects it, and changing it has not logged a set.
 */
export function isUntouchedSet(s: SetDraft): boolean {
  return (
    s.reps.trim() === '' &&
    s.weight.trim() === '' &&
    !s.isBodyweight &&
    !s.isBand &&
    isDefaultStatus(s.status)
  );
}

/**
 * A hand-added card that is safe to drop on submit: blank name, every set untouched, default status.
 *
 * GAP-1 P1-1c (BUG-2b): **a status IS a typed field**, at both levels. `[].every(...)` is vacuously
 * true, so without the movement-status clause a skipped card (zero sets) with a blank name would be
 * silently discarded; the set-status clause is the same argument one level down.
 */
export function isUntouchedMovement(m: MovementDraft): boolean {
  return m.movementName.trim() === '' && isDefaultStatus(m.status) && m.sets.every(isUntouchedSet);
}

/**
 * A SCAFFOLDED card the athlete never touched (V1-19). Deliberately not `isUntouchedMovement`, which
 * requires an empty name — every scaffolded card has one, supplied by the scaffold, not the athlete.
 * Gated on `scaffolded` so it can only ever apply to a card the app placed.
 */
export function isUntouchedScaffold(m: MovementDraft): boolean {
  return m.scaffolded === true && isDefaultStatus(m.status) && m.sets.every(isUntouchedSet);
}

/** The card is disposable: it is never sent and none of its rows are required. */
export function isDroppableMovement(m: MovementDraft): boolean {
  return isUntouchedMovement(m) || isUntouchedScaffold(m);
}

/**
 * The index after the movement's last touched set — where its trailing untouched run starts.
 *
 * ⚠️ **`sets.length` when NO set is touched** (no trailing run). A movement with nothing entered is
 * either dropped whole (`isDroppableMovement`) or every row is required — returning 0 would make every
 * row of a named all-blank card un-required and send it with `sets: []` (re-review rr-B1).
 */
export function trailingStart(sets: readonly SetDraft[]): number {
  for (let i = sets.length - 1; i >= 0; i--) {
    if (!isUntouchedSet(sets[i]!)) return i + 1;
  }
  return sets.length;
}

/**
 * Is set `i` of movement `m` required? Touched sets always are. An untouched set is required only when
 * its movement will be sent AND it sits before the last touched set (a gap). Trailing untouched sets
 * are not required — they are not sent (`dropTrailingUntouchedSets`).
 */
export function setIsRequired(m: MovementDraft, i: number): boolean {
  const s = m.sets[i];
  if (!s) return false;
  return !isUntouchedSet(s) || (!isDroppableMovement(m) && i < trailingStart(m.sets));
}

/** The reps input's `required`. The inputs and `isSubmitBlocked` read ONLY this and the next. */
export function repsRequired(m: MovementDraft, i: number): boolean {
  return setIsRequired(m, i);
}

/**
 * The weight input's `required`. ⚠️ LOAD-BEARING exemption kept verbatim: a BW or band set legitimately
 * has no magnitude, and a `required` input that must stay empty blocks the native submit with an error
 * the browser will not render — the form just appears dead.
 */
export function weightRequired(m: MovementDraft, i: number): boolean {
  const s = m.sets[i];
  if (!s) return false;
  return setIsRequired(m, i) && !s.isBodyweight && !s.isBand;
}

/** Is the card's name input required? Only on a card that will be sent — a droppable card is never
 *  sent, so its (blank) name must not block the tap (V1-27, see the plan's deviation log). */
export function nameRequired(m: MovementDraft): boolean {
  return !isDroppableMovement(m);
}

/** V1-19's collapse rule — a scaffolded card is collapsed unless it is the expanded one. The ONE copy:
 *  the form renders from it and `firstBlocker` reads it, so the summary cannot drift from the page. */
export function isCollapsed(
  m: MovementDraft & { clientId: string },
  expandedId: string | null,
): boolean {
  return m.scaffolded === true && expandedId !== m.clientId;
}

/** What would make the browser refuse the tap, located on screen (0-based card and set numbers). */
export type SubmitBlocker =
  | { kind: 'name'; index: number }
  | { kind: 'set'; index: number; setIndex: number; movementName: string };

/**
 * The FIRST blank required field the BROWSER would refuse the tap on, in on-screen order (card, then its
 * name before its rows), or `null`. Mirrors exactly what is rendered: a collapsed card renders nothing
 * the browser checks (`isCollapsed`), and a skipped card renders its name but not its rows. Reads the
 * same `nameRequired` / `repsRequired` / `weightRequired` the inputs render from, so the summary line and
 * the inputs cannot drift.
 *
 * Blind, by design, to non-blank invalid values (reps `0` / `2.5`, a step failure) and to a
 * `type=number` input holding partial input (`badInput`): neither is visible in form state. A collapsed
 * gap card is not a blocker either — its inputs are unmounted, so the tap sends and the server refuses.
 */
export function firstBlocker(
  movements: readonly (MovementDraft & { clientId: string })[],
  expandedId: string | null,
): SubmitBlocker | null {
  for (const [index, m] of movements.entries()) {
    if (isCollapsed(m, expandedId)) continue;
    if (nameRequired(m) && m.movementName.trim() === '') return { kind: 'name', index };
    if (m.status === ENTRY_STATUS.skipped) continue;
    const setIndex = m.sets.findIndex(
      (s, i) =>
        (repsRequired(m, i) && s.reps.trim() === '') ||
        (weightRequired(m, i) && s.weight.trim() === ''),
    );
    if (setIndex !== -1) return { kind: 'set', index, setIndex, movementName: m.movementName };
  }
  return null;
}

/** Would the browser refuse the tap? `firstBlocker` without the location. */
export function isSubmitBlocked(
  movements: readonly (MovementDraft & { clientId: string })[],
  expandedId: string | null,
): boolean {
  return firstBlocker(movements, expandedId) !== null;
}

/** Drop the droppable cards before building the payload. Preserves the schema's min(1): if EVERY card
 *  is droppable the result is empty, and the "add at least one movement" error still fires. */
export function dropUntouchedMovements<T extends MovementDraft>(movements: readonly T[]): T[] {
  return movements.filter((m) => !isDroppableMovement(m));
}

/**
 * Drop each movement's TRAILING untouched sets — the empty rows after its last touched set — from the
 * payload. Applied at serialization, never to state, so the athlete's view loses nothing before submit.
 * Only trailing rows: a gap stays (and blocks), which keeps every sent set's index equal to its
 * on-screen number, so the server's `set M` labels stay correct with no wire change. A movement with no
 * touched set is returned unchanged (`trailingStart` = `sets.length`).
 */
export function dropTrailingUntouchedSets<T extends MovementDraft>(movements: readonly T[]): T[] {
  return movements.map((m) => {
    const end = trailingStart(m.sets);
    return end === m.sets.length ? m : { ...m, sets: m.sets.slice(0, end) };
  });
}

/** Does this rendered card show the "empty sets at the end" hint? At least one touched set AND a
 *  trailing untouched run. A skipped card renders no rows, so never. */
export function hasTrailingUntouched(m: MovementDraft): boolean {
  if (m.status === ENTRY_STATUS.skipped) return false;
  const end = trailingStart(m.sets);
  return end > 0 && end < m.sets.length;
}
