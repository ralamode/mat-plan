import type { SetDTO } from '@/lib/dal/entries';

/** The set fields the read line + editability depend on (a narrow slice of `SetDTO`). */
type SetShape = Pick<SetDTO, 'reps' | 'weight' | 'weightLabel'>;

/**
 * A logged set's read line: `reps × (weightLabel — or weight + unit)`. `weightLabel` WINS over
 * `weight` (the historic `MovementLine` render), single-sourced here so the read view and the V1-9
 * edit view can't disagree. Nulls degrade to `?` (a partially-logged set still reads sensibly).
 */
export function formatSetLine(set: SetShape, unit: string): string {
  return `${set.reps ?? '?'} × ${set.weightLabel ?? `${set.weight ?? '?'} ${unit}`}`;
}

/**
 * Whether a set gets the V1-9 inline-edit affordance — ONLY a numeric reps+weight set qualifies:
 * no `weightLabel` (a labeled 'BW'/'50ft' set would have its edited `weight_num` MASKED at the read
 * seam above), and both `reps` + `weight` present (else it can't round-trip the required edit schema).
 * Labeled, timing (`seconds`-only), and null-valued sets render read-only. (Panel: correctness B1.)
 */
export function isEditableSet(set: SetShape): boolean {
  return set.weightLabel === null && set.reps !== null && set.weight !== null;
}
