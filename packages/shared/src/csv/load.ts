import { QUANTITY_SLOT, type QuantitySlot } from '../quantity-slots';
import { isMassUnit, type Unit } from '../units';
import { formatQuantity } from './value';

/** One measured quantity of one set, as the export reads it. */
export type ExportQuantity = {
  slot: QuantitySlot;
  unit: Unit;
  value: string; // numeric, still a string from pg
};

/** One set, reduced to what the `load` and `reps` columns need. */
export type ExportSet = {
  reps: number | null;
  isBodyweight: boolean;
  isBand: boolean;
  quantities: readonly ExportQuantity[];
};

/**
 * The `load` value for ONE set — the piece GAP-3 changed most.
 *
 * The contract lists eleven `load` shapes as **verbatim strings**, because it was written when
 * `entry_sets.weight_label` held exactly those strings and export was a copy. #139 deleted that
 * column and #141 deleted the parser, so `load` is now **re-synthesised from typed quantities**.
 * This function is where that happens, and it is the reason the contract's shape table is a spec
 * rather than a description.
 *
 * | Shape | Built from |
 * | --- | --- |
 * | `BW` | `is_bodyweight` |
 * | `band` | `is_band` |
 * | `80` | one `primary` mass |
 * | `30in` · `20s` | one `primary` at length / time |
 * | `BW+8 (vest)` · `BW+8kg (vest)` | `is_bodyweight` + a `vest` quantity (`lb` bare, any other mass suffixed) |
 * | `123 (50ft)` | `primary` mass + a `distance` quantity |
 *
 * The last two need GAP-3 PR 4b to be *loggable*, but they are built here already: 4b turns them on
 * with no change to the exporter, and the golden vectors cover them today.
 *
 * `BW (unassisted)` / `BW (modified)` / `30 (2x 15 DB)` are **not** built. They are qualitative prose
 * with no typed representation — bound for `entries.notes` via V1-9a — so emitting a guess would be
 * inventing data. A set that reduces to nothing returns `''`, an empty cell, which the contract
 * already distinguishes from `0`.
 */
export function buildLoad(set: ExportSet, context: string): string {
  const primary = set.quantities.find((q) => q.slot === QUANTITY_SLOT.primary);
  const auxiliary = set.quantities.filter((q) => q.slot !== QUANTITY_SLOT.primary);

  // ── The head: the modes, then the primary magnitude ──────────────────────────
  // Modes read as words, exactly as the corpus writes them.
  let head = '';
  if (set.isBodyweight) head += 'BW';
  if (set.isBand) head += head ? ' band' : 'band';

  if (primary) {
    const magnitude = formatQuantity(primary.value, primary.unit, `${context} load`);
    // A bare primary with no mode is just the number — `80`, never `+80`.
    head += head ? `+${magnitude}` : magnitude;
  }

  // ── The tail: auxiliaries, by DIMENSION ──────────────────────────────────────
  // Two rules, both read off the corpus rather than invented:
  //
  //   a WORN MASS attaches to the head with `+` and names its slot, because a bare `(8)` would be
  //   meaningless        →  BW+8 (vest)     — no spaces around the `+`, the contract is explicit
  //   It carries its unit suffix like the primary (`BW+8kg (vest)`); a bare kg would read as pounds.
  //
  //   a LENGTH is self-describing, because its unit says what it is
  //                      →  123 (50ft)
  const lengths: string[] = [];
  for (const q of auxiliary) {
    const magnitude = formatQuantity(q.value, q.unit, `${context} ${q.slot}`);
    if (isMassUnit(q.unit)) {
      head += `+${magnitude} (${q.slot})`;
    } else {
      lengths.push(magnitude);
    }
  }

  if (lengths.length === 0) return head;
  return head ? `${head} (${lengths.join(', ')})` : `(${lengths.join(', ')})`;
}
