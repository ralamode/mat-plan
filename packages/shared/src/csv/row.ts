import { hasLineBreak } from '../text';

/**
 * Join fields into one CSV row — **by hand, never with a CSV library** (V1-13).
 *
 * The contract ([docs/csv-export-contract.md](../../../../docs/csv-export-contract.md)) is emphatic,
 * and it has two reasons that a general-purpose writer cannot be talked out of:
 *
 * 1. **Bare double-quotes are real data.** A row in the legacy evidence set
 *    (`docs/samples/legacy-csv/strength-log/athlete-a/2020-06.csv`) reads `Athlete A at 30" box (Athlete B did 36")` —
 *    those are INCH MARKS in an unquoted field. Any RFC-4180 writer re-emits them as
 *    `"Athlete One at 30"" box (Athlete Two did 36"")"` and the diff fails.
 * 2. **Zero quoted fields exist across all eight real files**, and one legacy row carries an
 *    unescaped comma that splits it into 9 fields against an 8-field header. The files are not valid
 *    CSV and are not trying to be.
 *
 * So: join with `,` and write raw. The ONE forward-looking exception the contract grants is a NEW
 * value containing a comma — quote that, and leave the legacy rows alone.
 */

/** Fields that may legitimately contain a comma, and must therefore be quoted when they do. */
const QUOTABLE = new Set(['notes', 'prescribed']);

/**
 * Quote a field only if it must be, and only if it is allowed to be.
 *
 * `prescribed` is in the quotable set because **8 of the 21 seeded prescriptions contain a comma** —
 * `5, last set to failure`, `3 (top triple, then 2 back-offs)`, `40 yd, to grip failure`. Unquoted,
 * each one splits the row into 9 fields. That is ~38% of the program, so it is the common case, not
 * an edge case. (Found by the engineering panel; the draft plan quoted only `notes`.)
 */
function quoteIfNeeded(value: string, field: string): string {
  if (!value.includes(',')) return value;
  if (!QUOTABLE.has(field)) {
    // A comma in a movement name or a load would silently shift every later column. `text.ts`'s
    // `hasCommaOrLineBreak` already rejects these at the INPUT boundary; this is the export-side
    // backstop, because `/api/sync` and the seed can write rows the form never saw.
    throw new Error(
      `CSV export: the '${field}' field cannot contain a comma (got ${JSON.stringify(value)}). ` +
        `Only ${[...QUOTABLE].join('/')} may be quoted; anything else would shift the row.`,
    );
  }
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * One CSV row, terminated with LF.
 *
 * `fields` is ordered to match the header; `names` labels them so a comma violation names the column
 * rather than an index. Trailing empty fields are WRITTEN, not dropped — `2020-07-09,92.3,morning,`
 * keeps its trailing comma, which falls out of joining rather than needing a rule.
 */
export function csvRow(fields: readonly (string | null | undefined)[], names: readonly string[]) {
  if (fields.length !== names.length) {
    throw new Error(`CSV export: ${fields.length} fields for ${names.length} columns`);
  }
  return (
    fields
      .map((raw, i) => {
        const value = raw ?? '';
        // A newline would end the row early and corrupt every following line. `notes` is free text
        // and single-line by contract; nothing else is free text at all.
        if (hasLineBreak(value)) {
          throw new Error(`CSV export: the '${names[i]}' field cannot contain a line break`);
        }
        return quoteIfNeeded(value, names[i]);
      })
      .join(',') + '\n'
  );
}

/**
 * A whole file: header row + body, LF endings, trailing newline, no BOM.
 *
 * A file with no rows is still written **header-only** — that is what the real `checkins` files are
 * (64 bytes, header + LF), and a missing file and an empty file are different inputs to the workflow.
 */
export function csvFile(header: readonly string[], rows: readonly string[]): string {
  return csvRow(header, header) + rows.join('');
}
