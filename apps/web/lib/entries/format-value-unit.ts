import type { Unit } from '@mat-plan/shared';

/**
 * A measured value with its unit, for DISPLAY — `84.5 lb`, `20 lb`, `30 in` (V1-24 PR 1a).
 *
 * Pure and route-agnostic (type-only import), the `entry-label.ts` / `activity-totals.ts` precedent.
 *
 * ## Why this exists
 *
 * The same four characters were spelled out in two places — `entryLabel` (the "Logged entries" list)
 * and `formatSetLine` (a strength set) — and V1-24's receipt would have been the third, with PR 2's
 * check-in receipt and PR 3's strength receipt making five. One definition, per AGENTS.md's
 * constants rule: the second occurrence is the trigger to extract, and this was already past it.
 *
 * ## ⚠️ NOT `@mat-plan/shared/csv`'s `formatQuantity` — they are deliberately different
 *
 * The CSV formatter looks like it does the same job and does not:
 *
 * | | display (here) | CSV (`csv/value.ts`) |
 * | --- | --- | --- |
 * | pounds | `84.5 lb` | `84.5` — **bare**, the corpus writes no unit |
 * | seconds | `20 sec` | `20s` |
 * | kilograms | `5 kg` | `5kg` — suffixed, never bare (V1-30) |
 *
 * Those are contract bytes a downstream workflow diffs, not prose. Reusing it here would drop the
 * unit off every weight on screen; reusing this one there would corrupt the export. Naming this
 * `formatQuantity` would have set the same trap for the next reader, which is why it is not.
 *
 * ## No numeric formatting
 *
 * `value` is already a JS `number` at the DTO boundary (`dal/entries.ts` maps `numeric` → `Number`),
 * so `84.5` prints as `84.5` and `84` as `84`. The CSV path needs `formatNumeric` because it reads
 * pg's `numeric` as a STRING and must not round-trip it through a float; that problem does not exist
 * here. Do not add it "for safety" — it would make `92` render as `92.0` on screen.
 */
export function formatValueUnit(value: number, unit: Unit): string {
  return `${value} ${unit}`;
}
