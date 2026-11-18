/**
 * Read ONE line the strength log writes back into its cells, by the RFC 4180 rule `row.ts` writes
 * (FAM-1 14a): a quoted cell may hold `,` and doubled `""`; anything else is literal.
 *
 * The export never reads its own files; this is for the tests that look up a cell by header name, so
 * there is one reader in the tests instead of a `split(',')` per file that breaks on a quoted comma.
 * It reads a single line: a quoted cell never holds a line break, because `csvRow` refuses one.
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
