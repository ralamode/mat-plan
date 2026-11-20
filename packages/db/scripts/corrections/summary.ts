/**
 * What a correction returns, and the runner's summary of it (`scripts/correct.ts`).
 *
 * 🔴 **A line is either a CHANGE or a NOTE, and only changes are counted.** A correction used to
 * return plain strings, and the runner counted every one, so a no-op run that said why it had nothing
 * to do ("already claimed by this Clerk account — no change") ended with _"1 change(s) would be
 * made. Re-run with --apply to write them."_ An operator reading that before a production apply is
 * told to write something that is not there. Seen on the preview claim of 2026-11-19.
 *
 * A note is printed, and never counted. Return one for "nothing to do", "already done" and any other
 * line that describes no write.
 */

/** A line the runner prints but does not count: it describes no write. */
export type CorrectionNote = { readonly note: string };

/**
 * The correction's own last line, printed INSTEAD of the runner's count. For a correction whose unit
 * is not "a change": the one-shot erasure counts tables and rows, and "12 change(s)" beside "412
 * row(s)" is two numbers where the operator types one (board, 2026-11-19).
 */
export type CorrectionSummary = { readonly summary: string };

/** One line of a correction's result: a change (a string), a note, or its own summary. */
export type CorrectionLine = string | CorrectionNote | CorrectionSummary;

/** The correction's own last line (see `CorrectionSummary`). */
export function summaryLine(text: string): CorrectionSummary {
  return { summary: text };
}

export function isSummary(line: CorrectionLine): line is CorrectionSummary {
  return typeof line !== 'string' && 'summary' in line;
}

/** A line that describes no write ("nothing to do", "already claimed … no change"). */
export function note(text: string): CorrectionNote {
  return { note: text };
}

export function isNote(line: CorrectionLine): line is CorrectionNote {
  return typeof line !== 'string' && 'note' in line;
}

/** The text of a line, change or note. */
export function lineText(line: CorrectionLine): string {
  return isNote(line) ? line.note : isSummary(line) ? line.summary : line;
}

/**
 * The lines the runner prints after a run: each change and note, then one count of the CHANGES only.
 * `isReport` is a `kind: 'report'` entry, which only reads.
 */
export function summarize(
  lines: readonly CorrectionLine[],
  { isReport, apply }: { isReport: boolean; apply: boolean },
): string[] {
  const own = lines.find(isSummary);
  const shown = lines.filter((l) => !isSummary(l)) as (string | CorrectionNote)[];
  const changes = shown.filter((l) => !isNote(l)).length;
  const out = shown.map((l) =>
    isNote(l) ? `  – ${l.note}` : `  ${isReport ? '·' : apply ? '✓' : '·'} ${l}`,
  );
  if (lines.length > 0) out.push('');
  if (own) {
    out.push(own.summary);
    return out;
  }
  if (isReport) {
    out.push(
      lines.length === 0
        ? 'Nothing to report — this census found no rows in any of the shapes it counts.'
        : `${lines.length} line(s) reported. Nothing to apply — this entry only reads.`,
    );
  } else if (changes === 0) {
    // Not an error: a guarded correction that matches nothing has almost certainly already run.
    out.push(
      lines.length === 0
        ? 'No matching rows — already corrected, or the guard did not match. Nothing to do.'
        : 'No changes — nothing to write.',
    );
  } else {
    out.push(
      apply
        ? `✓ applied ${changes} change(s).`
        : `${changes} change(s) would be made. Re-run with --apply to write them.`,
    );
  }
  return out;
}
