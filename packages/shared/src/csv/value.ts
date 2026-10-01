import { type Unit, UNIT_DIMENSION_BY_CODE, type UnitDimension } from '../units';

/**
 * Render a Postgres `numeric` the way the corpus writes numbers (V1-13).
 *
 * ⚠️ **drizzle returns `numeric` as a STRING**, not a number — deliberately, so precision survives.
 * So a logged `70` reads back `"70.000"` and a logged `67.5` reads back `"67.500"`. Without this,
 * **every load value in the export is wrong**, not just `weight_lb`. (The draft plan scoped the
 * trailing-zero problem to bodyweight alone; the engineering panel caught it.)
 *
 * **Decimal-aware, deliberately.** A naive `replace(/0+$/, '')` turns `90` into `9`. Only zeros
 * *after a decimal point* are insignificant, and the point goes too once nothing follows it.
 *
 * Ray's ruling (2026-09-24) on the loss this accepts: _"we can assume .0 if no tenth or decimal is
 * used"_ — so a typed `92.0` exports as `92` and a reader takes a bare integer to mean `.0`. The
 * corpus really does contain `92.0` and `74.0`, and the precision is already gone at the form
 * boundary (`bodyweight.ts` coerces to a number), so nothing downstream could have recovered it.
 */
export function formatNumeric(value: string | number): string {
  const raw = String(value).trim();
  if (!raw.includes('.')) return raw;
  return raw.replace(/\.?0+$/, '') || '0';
}

/**
 * How each unit is written INSIDE a `load` value.
 *
 * Exhaustive over `Unit` on purpose: a new unit code is a **compile error** here, which is the only
 * place that catches it before the export silently invents a shape.
 *
 * Two rules the corpus fixes and a naive `${value}${unit}` gets wrong:
 * - **Mass is BARE.** Every legacy load number is unit-less and means pounds — `80`, `65/65/65`,
 *   `123 (50ft)`. There is no `80lb` anywhere.
 * - **Seconds is `s`, not `sec`.** The unit CODE is `sec`; the corpus writes `20s` / `30s`. Naive
 *   concatenation emits `20sec` and the diff fails. (Caught by the engineering panel.)
 */
export const CSV_UNIT_SUFFIX: Record<Unit, string | null> = {
  lb: '', // bare — the implicit unit of the whole column
  in: 'in', // 30in / 36in, no space
  ft: 'ft', // 50ft
  sec: 's', // 20s — NOT `sec`
  // APP-DEFINED in V1-30 (Ray, 2026-10-01): nothing was ever logged in these, so the corpus has no
  // spelling. They follow its pattern (value + code, no space) so the form's every unit exports.
  // ⚠️ `kg` is SUFFIXED, never bare: a bare number in this column means POUNDS. `m` = metres and
  // `min` = minutes (docs/csv-export-contract.md says so for the workflow reading the file).
  kg: 'kg',
  cm: 'cm',
  m: 'm',
  yd: 'yd',
  min: 'min',
  // No form offers these (they are not LOGGABLE_UNITS). `null` means "cannot appear in a load", which
  // `assertExportableUnit` turns into a loud refusal rather than a plausible-looking wrong number.
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
 * is that the resolved unit rides the row. Since V1-30 every unit a form offers has a spelling (the
 * chain test in `units.test.ts` enforces it), so this guards only units no form offers: a
 * **tripwire, not a tax**.
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
