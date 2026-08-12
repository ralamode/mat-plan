import { ENTRY_STATUS } from '@mat-plan/shared';

import type { SetDTO } from '@/lib/dal/entries';

/** The set fields the read line + editability depend on (a narrow slice of `SetDTO`). */
type SetShape = Pick<SetDTO, 'reps' | 'weight' | 'weightLabel' | 'status'>;

/**
 * A logged set's read line: `reps × (weightLabel — or weight + unit)`. `weightLabel` WINS over
 * `weight` (the historic `MovementLine` render), single-sourced here so the read view and the V1-9
 * edit view can't disagree. Nulls degrade to `?` (a partially-logged set still reads sensibly).
 */
export function formatSetLine(set: SetShape, unit: string): string {
  return `${set.reps ?? '?'} × ${set.weightLabel ?? `${set.weight ?? '?'} ${unit}`}`;
}

/**
 * Whether a set gets the V1-9 inline-edit affordance — ONLY a numeric, `done` reps+weight set
 * qualifies: no `weightLabel` (a labeled 'BW'/'50ft' set would have its edited `weight_num` MASKED at
 * the read seam above), and both `reps` + `weight` present (else it can't round-trip the required edit
 * schema). Labeled, timing (`seconds`-only), and null-valued sets render read-only. (Panel:
 * correctness B1.)
 *
 * The `status` clause is GAP-1 P1-1b (BUG-2a). A `sub_failure` set is NUMERIC, so every other guard
 * passes it — editing its reps 3 → 5 would leave `status = 'sub_failure'` behind and the row would
 * still export as `sub-failure` while claiming reps it never achieved. Correcting a sub-failure set
 * means changing its STATUS, which the V1-9 edit cannot do, so it isn't offered.
 *
 * **This predicate is mirrored server-side in `updateStrengthSetById`'s WHERE and the two must stay
 * identical** — this half is advisory (a crafted POST bypasses it entirely); that half is the boundary.
 */
export function isEditableSet(set: SetShape): boolean {
  return (
    set.weightLabel === null &&
    set.reps !== null &&
    set.weight !== null &&
    set.status === ENTRY_STATUS.done
  );
}
