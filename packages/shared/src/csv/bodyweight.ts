import { csvFile, csvRow } from './row';
import { formatNumeric } from './value';

/** Header verbatim from the real files. */
export const BODYWEIGHT_HEADER = ['date', 'weight_lb', 'context', 'notes'] as const;

export type BodyweightRow = {
  date: string;
  /** Still a STRING from pg — `numeric` never comes back as a number. */
  weight: string;
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
  const body = rows.map((r) =>
    csvRow([r.date, formatNumeric(r.weight), r.context, r.notes], BODYWEIGHT_HEADER),
  );
  return csvFile(BODYWEIGHT_HEADER, body);
}

export function bodyweightPath(profilePublicId: string, month: string): string {
  return `data/bodyweight/${profilePublicId}/${month}.csv`;
}
