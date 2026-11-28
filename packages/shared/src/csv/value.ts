import { formatNumeric, SECONDS_SUFFIX } from '../quantity-spelling';
import { type Unit, UNIT_DIMENSION_BY_CODE, type UnitDimension } from '../units';

/**
 * `formatNumeric` (a Postgres `numeric` as the corpus writes numbers) lives in
 * `../quantity-spelling` since FAM-1 contract change C1, so the program contract's client-safe
 * text can share it without importing `csv/`. Re-exported here unchanged: every caller of
 * `@mat-plan/shared/csv` and of `./value` reads it as before.
 */
export { formatNumeric };

/**
 * How each unit is written INSIDE a `load` value.
 *
 * Exhaustive over `Unit` on purpose: a new unit code is a **compile error** here, which is the only
 * place that catches it before the export silently invents a shape.
 *
 * Two rules the corpus fixes and a naive `${value}${unit}` gets wrong:
 * - **Pounds are BARE.** Every legacy load number is unit-less and means pounds — `80`, `65/65/65`,
 *   `123 (50ft)`. There is no `80lb` anywhere. (`kg` is therefore suffixed, never bare; see below.)
 * - **Seconds is `s`, not `sec`.** The unit CODE is `sec`; the corpus writes `20s` / `30s`. Naive
 *   concatenation emits `20sec` and the diff fails. (Caught by the engineering panel.)
 */
export const CSV_UNIT_SUFFIX: Record<Unit, string | null> = {
  lb: '', // bare — the implicit unit of the whole column
  in: 'in', // 30in / 36in, no space
  ft: 'ft', // 50ft
  sec: SECONDS_SUFFIX, // 20s — NOT `sec`
  // APP-DEFINED (V1-30): no corpus spelling exists. The rules (`kg` never bare, `m` = metres,
  // `min` = minutes) are docs/csv-export-contract.md → "App-defined spellings".
  kg: 'kg',
  cm: 'cm',
  m: 'm',
  yd: 'yd',
  mi: 'mi', // FAM-1 step 3
  min: 'min',
  // No load is logged in these (a Count's number goes to reps). `null` means "cannot appear in a
  // load", which `assertExportableUnit` turns into a loud refusal rather than a plausible-looking
  // wrong number.
  count: null,
  bool: null,
  timing: null,
};

/** The units the exporter can write. Derived, so it cannot drift from the map above. */
export const EXPORTABLE_UNITS = (Object.keys(CSV_UNIT_SUFFIX) as Unit[]).filter(
  (u) => CSV_UNIT_SUFFIX[u] !== null,
);

/**
 * **Refuse to export a unit with no legacy spelling — never convert it.**
 *
 * A set logged in `kg` written as a bare `85` is read by the workflow as 85 **lb**: a 2.2× error in
 * the exact column that drives load progression, and invisible to the contract's own
 * `sets`-vs-list-length check. Given the project's one inviolable rule is that bad loads are an
 * injury risk, that is the worst defect available in this feature.
 *
 * Converting was rejected: it writes a number the athlete never logged, and ADR 0004 §6's whole point
 * is that the resolved unit rides the row. Every unit a tracking type offers has a spelling, or a
 * Count's goes to `reps` (`csv/strength-log-types.test.ts` enforces it), so this guards only units
 * no form offers: a **tripwire, not a tax**.
 */
export function assertExportableUnit(unit: Unit, context: string): string {
  const suffix = CSV_UNIT_SUFFIX[unit];
  if (suffix === null) {
    throw new Error(
      `CSV export: ${context} is logged in '${unit}', which has no spelling in the CSV contract. ` +
        `Exportable units are ${EXPORTABLE_UNITS.join(', ')}. The exporter refuses rather than ` +
        `converting — a converted number is one the athlete never logged.`,
    );
  }
  return suffix;
}

/** A magnitude with its unit written the way the corpus writes it: `80`, `30in`, `20s`. */
export function formatQuantity(value: string | number, unit: Unit, context: string): string {
  return `${formatNumeric(value)}${assertExportableUnit(unit, context)}`;
}

/** The dimension a unit measures — re-exported so the load builder need not import two modules. */
export function dimensionOf(unit: Unit): UnitDimension {
  return UNIT_DIMENSION_BY_CODE[unit];
}
