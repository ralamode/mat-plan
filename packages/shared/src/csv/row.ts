import { hasLineBreak } from '../text';

/**
 * Join fields into one CSV row, **by hand, never with a CSV library** (V1-13), quoted the **RFC 4180**
 * way (FAM-1 14a; ADR 0009 §3(c), "allowed and preferred"; the maintainer, 2026-11-17).
 *
 * **One rule for every field:** a value holding a `,` or a `"` is wrapped in `"…"` with each inner
 * `"` doubled; any other value is written as it is. A standard reader (a spreadsheet, a CSV library)
 * then reads every cell back exactly, whichever column it sits in.
 *
 * This replaces the byte-faithful rule (write raw; quote only a comma, and only in `notes` and
 * `prescribed`; refuse a comma anywhere else). That rule matched the legacy files, where inch marks
 * (`30" box`) sat unquoted, but it left a note with an opening `"` able to swallow the rest of its
 * line in a standard reader. ADR 0009 retired the byte contract, and §4 lets a PR change those tests.
 */
function quoteIfNeeded(value: string): string {
  if (!value.includes(',') && !value.includes('"')) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * One CSV row, terminated with LF.
 *
 * `fields` is ordered to match the header; `names` labels them so a line-break violation names the column
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
        return quoteIfNeeded(value);
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
