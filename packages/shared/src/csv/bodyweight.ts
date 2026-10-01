import type { Unit } from '../units';
import { csvFile, csvRow } from './row';
import { formatNumeric } from './value';

/** Header verbatim from the real files. */
export const BODYWEIGHT_HEADER = ['date', 'weight_lb', 'context', 'notes'] as const;

/** The only unit the `weight_lb` column can hold — the header is legacy bytes (CSV-1). */
export const BODYWEIGHT_CSV_UNIT = 'lb' as const satisfies Unit;

export type BodyweightRow = {
  date: string;
  /** Still a STRING from pg — `numeric` never comes back as a number. */
  weight: string;
  /** The unit the weight was LOGGED in. Only `BODYWEIGHT_CSV_UNIT` exports (CSV-1). */
  unit: string;
  context: string;
  notes: string;
};

/**
 * `data/bodyweight/<public_id>/<YYYY-MM>.csv`.
 *
 * ⚠️ **`weight_lb` is TEXT, not a number.** The real file mixes `71`, `71.0` and `71.4` in one
 * column, and a round-trip through a float normalises `71` → `71.0`. `formatNumeric` keeps it a
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
    assertBodyweightUnit(r);
    return csvRow([r.date, formatNumeric(r.weight), r.context, r.notes], BODYWEIGHT_HEADER);
  });
  return csvFile(BODYWEIGHT_HEADER, body);
}

/**
 * CSV-1: refuse, never convert. The form offers `kg`, but the column is `weight_lb`, so a kg number
 * written bare reads as POUNDS downstream — a silent 2.2× error in a trend a coach reads. Not
 * `assertExportableUnit`: since V1-30 that RETURNS `'kg'` (strength loads spell it `85kg`), which
 * would write `84.5kg` under a `weight_lb` header. Converting would publish a number the athlete never
 * logged, and widening the contract is Ray's call (the header is legacy bytes) — so the export fails
 * loudly instead. Production holds no kg weigh-in (V1-24 1c's read, 2026-09-30).
 */
function assertBodyweightUnit(r: BodyweightRow): void {
  if (r.unit !== BODYWEIGHT_CSV_UNIT) {
    throw new Error(
      `CSV export: the bodyweight on ${r.date} is logged in '${r.unit}', but the bodyweight file's ` +
        `column is weight_lb. The exporter refuses rather than converting — a converted number is ` +
        `one the athlete never logged.`,
    );
  }
}

export function bodyweightPath(profilePublicId: string, month: string): string {
  return `data/bodyweight/${profilePublicId}/${month}.csv`;
}
