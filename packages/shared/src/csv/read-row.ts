/**
 * Read ONE line the strength log writes back into its cells, by the RFC 4180 rule `row.ts` writes
 * (FAM-1 14a): a quoted cell may hold `,` and doubled `""`; anything else is literal.
 *
 * The export never reads its own files. It is exported from `@mat-plan/shared/csv` on purpose, so the
 * tests in every package that look up a cell by header name share one reader instead of a `split(',')`
 * that breaks on a quoted comma; an importer reading these files back (IMP-1) could use it too.
 * It reads a single line: a quoted cell never holds a line break, because `csvRow` refuses one.
 *
 * ⚠️ An importer reading these files back (IMP-1) must also strip the leading `'` that `csvRow` puts
 * before a formula-like value (`FORMULA_LEAD`); this reader returns the cell as written.
 */
export function readCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}
