import type { Unit } from '../units';
import { csvFile, csvRow } from './row';
import { formatNumeric } from './value';

/** Header verbatim from the real files. */
export const BODYWEIGHT_HEADER = ['date', 'weight_lb', 'context', 'notes'] as const;

/** The unit the `weight_lb` column holds — the header is legacy bytes (CSV-1). */
export const BODYWEIGHT_CSV_UNIT = 'lb' as const satisfies Unit;

/** Pounds per kilogram: 1 / 0.45359237 (1 lb = 0.45359237 kg exactly) to 11 decimal places. Every
 *  one-decimal output over the form's range is identical to using the exact reciprocal. CSV-1. */
export const LB_PER_KG = 2.20462262185;

/** Decimals a converted weight is written with — the form's own `step="0.1"`, so a converted value
 *  claims no more precision than a typed one. */
export const CONVERTED_WEIGHT_DECIMALS = 1;

export type BodyweightRow = {
  date: string;
  /** Still a STRING from pg — `numeric` never comes back as a number. */
  weight: string;
  /** The unit the weight was LOGGED in. `lb` exports as logged; `kg` is converted (CSV-1). */
  unit: string;
  context: string;
  notes: string;
};

/**
 * `data/bodyweight/<public_id>/<YYYY-MM>.csv`.
 *
 * ⚠️ **`weight_lb` is TEXT, not a number.** The legacy files mix `92`, `92.0` and `91.7` in one
 * column, and a round-trip through a float normalises `92` → `92.0`. `formatNumeric` keeps it a
 * string end to end.
 *
 * Ray's ruling (2026-09-24): a typed `92.0` exports as `92`, and a bare integer is read as `.0`. The
 * loss is real — the corpus has `92.0` and `74.0`, 2 of 14 rows — but it already happened at the FORM
 * boundary, where `bodyweight.ts` coerces to a number. No export-layer choice could recover it.
 *
 * ⚠️ **`context` exports empty, always.** It is `morning` on 100% of real rows, and
 * `logBodyweightSchema` has **no such field** — the app cannot write it. A known regression of a
 * populated column, stated rather than discovered.
 *
 * Gaps are normal: not every day has a row, and days are never backfilled.
 */
export function buildBodyweight(rows: readonly BodyweightRow[]): string {
  const body = rows.map((r) => {
    const { weightLb, notes } = toWeightLb(r);
    return csvRow([r.date, weightLb, r.context, notes], BODYWEIGHT_HEADER);
  });
  return csvFile(BODYWEIGHT_HEADER, body);
}

/**
 * CSV-1 — Ray's decision (2026-10-02): CONVERT a kg weigh-in, never refuse it and never write it bare.
 * - `lb` is written exactly as logged (byte-identical to before CSV-1).
 * - `kg` writes `weight_lb` = kg × `LB_PER_KG`, rounded half-up to `CONVERTED_WEIGHT_DECIMALS`, and
 *   APPENDS `logged <value> kg` to the row's notes — so the number the athlete actually logged stays in
 *   the row (the export's rule is that a converted number must not stand in for one alone). The note
 *   has no comma or newline, so it can never trip `csvRow`'s notes rules.
 * - Any other unit throws: `BODYWEIGHT_UNITS` is lb/kg today, and a future unit must not slip through
 *   silently as a bare number under a pounds header.
 * Not `assertExportableUnit`: that spells strength loads (`85kg`), which is no spelling for this column.
 */
function toWeightLb(r: BodyweightRow): { weightLb: string; notes: string } {
  if (r.unit === BODYWEIGHT_CSV_UNIT) return { weightLb: formatNumeric(r.weight), notes: r.notes };
  if (r.unit === 'kg') {
    // An empty weight stays empty (as an lb row's would): never "0" lb with "logged  kg".
    if (r.weight.trim() === '') return { weightLb: '', notes: r.notes };
    const scale = 10 ** CONVERTED_WEIGHT_DECIMALS;
    const lb = Math.round(Number(r.weight) * LB_PER_KG * scale) / scale;
    const logged = `logged ${formatNumeric(r.weight)} kg`;
    return {
      weightLb: formatNumeric(lb.toFixed(CONVERTED_WEIGHT_DECIMALS)),
      notes: r.notes.trim() === '' ? logged : `${r.notes}; ${logged}`,
    };
  }
  throw new Error(
    `CSV export: the bodyweight on ${r.date} is logged in '${r.unit}', which the weight_lb column ` +
      `has no rule for (lb is written as logged, kg is converted).`,
  );
}

export function bodyweightPath(profilePublicId: string, month: string): string {
  return `data/bodyweight/${profilePublicId}/${month}.csv`;
}
