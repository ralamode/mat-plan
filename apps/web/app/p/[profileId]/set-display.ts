import { ENTRY_STATUS, QUANTITY_SLOT, UNIT_DIMENSION } from '@mat-plan/shared';

import type { SetDTO, SetQuantityDTO } from '@/lib/dal/entries';
import { formatValueUnit } from '@/lib/entries/format-value-unit';

/** The set fields the read line + editability depend on (a narrow slice of `SetDTO`). */
type SetShape = Pick<SetDTO, 'reps' | 'isBodyweight' | 'isBand' | 'quantities' | 'status'>;

/**
 * The quantity a set's read line leads with: its PRIMARY one, whatever dimension that is — 185 lb for
 * a back squat, 30 in for a box jump, 30 sec for a hold. Auxiliary quantities (a vest, a sled's
 * distance) are appended after it, never substituted for it.
 */
function primaryOf(set: SetShape): SetQuantityDTO | undefined {
  return set.quantities.find((q) => q.slot === QUANTITY_SLOT.primary);
}

/**
 * A logged set's read line: `reps × <load>`, single-sourced here so the read view and the V1-9 edit
 * view can't disagree. Nulls degrade to `?` (a partially-logged set still reads sensibly).
 *
 * GAP-3 rewrote this. It used to be `weightLabel ?? \`${weight} ${unit}\`` — a free-text label WINNING
 * over a number, which is why a labeled set could never be edited (its corrected number would have
 * been masked). There is no label any more: the MODES render as words, the magnitudes render with
 * their own stored units, and both can appear together (`8 × BW +8 lb vest`), which is exactly the
 * `BW+8 (vest)` shape ADR 0004 listed as "not representable today".
 */
export function formatSetLine(set: SetShape): string {
  const parts: string[] = [];

  if (set.isBodyweight) parts.push('BW');
  if (set.isBand) parts.push('band');

  const primary = primaryOf(set);
  if (primary) {
    // `+` only when it MODIFIES a mode — `BW +8 lb` reads as bodyweight plus eight pounds, whereas a
    // bare `185 lb` is the whole load and a leading plus would be a lie.
    parts.push(`${parts.length > 0 ? '+' : ''}${formatValueUnit(primary.value, primary.unit)}`);
  }

  for (const q of set.quantities) {
    if (q.slot === QUANTITY_SLOT.primary) continue;
    parts.push(`+${formatValueUnit(q.value, q.unit)} ${q.slot}`);
  }

  return `${set.reps ?? '?'} × ${parts.length > 0 ? parts.join(' ') : '?'}`;
}

/**
 * Whether a set gets the V1-9 inline-edit affordance — ONLY a plain numeric `done` reps+weight set
 * qualifies. The edit form submits a bare number, so the set must be one where a bare number is the
 * whole truth: no mode flag, exactly ONE quantity, and that quantity a MASS.
 *
 * GAP-3 restated the guard without weakening it. The old test was `weightLabel === null`, which after
 * the column drop would have made every previously-labeled set silently editable — including the
 * `30in` and `20s` ones a numeric edit would misrepresent. Those are now excluded on what they ARE (a
 * length, a duration) rather than on how they were spelled.
 *
 * **This predicate is mirrored server-side in `updateStrengthSetById`'s WHERE and the two must stay
 * identical** — this half is advisory (a crafted POST bypasses it entirely); that half is the boundary.
 */
export function isEditableSet(set: SetShape): boolean {
  const primary = primaryOf(set);
  return (
    !set.isBodyweight &&
    !set.isBand &&
    set.quantities.length === 1 &&
    primary !== undefined &&
    primary.dimension === UNIT_DIMENSION.mass &&
    set.reps !== null &&
    set.status === ENTRY_STATUS.done
  );
}
