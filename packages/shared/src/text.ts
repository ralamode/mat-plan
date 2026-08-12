import { z } from 'zod';

/**
 * The shared max length for an optional free-text input (a bodyweight `notes`, a session `feel`).
 * Named once (the AGENTS.md constants convention) so the free-text fields can't drift. The DB columns
 * are unbounded `text`, so this is purely the app-input cap.
 */
export const FREE_TEXT_NOTE_MAX = 500;

/**
 * The two ways a value can corrupt an exported row, as ONE definition shared by every field that
 * reaches the CSV (GAP-1 P2-2/P2-3). The files are deliberately **not** RFC-4180
 * (`docs/csv-export-contract.md`): fields are joined raw and nothing is quoted, so these characters
 * are structural, not cosmetic.
 *
 * They are deliberately SEPARATE predicates because the contract treats them differently:
 *   - a CR/LF splits the RECORD  → forbidden in every field, no exceptions;
 *   - a comma splits the FIELD   → forbidden where the export cannot quote (a movement name, a load),
 *     but ALLOWED in `notes`, which the contract says to quote on the way out ("going forward, quote a
 *     `notes` value containing a comma") and where two legacy rows already carry one.
 *
 * `"` is deliberately absent from both: `30"` (inches) is real, in-use data, and a quote carries no
 * special meaning in a file that never quotes.
 */
const LINE_BREAK_PATTERN = /[\r\n]/;
const COMMA_OR_LINE_BREAK_PATTERN = /[,\r\n]/;

/** True when `value` contains a CR or LF — which would split one record into two on export. */
export function hasLineBreak(value: string): boolean {
  return LINE_BREAK_PATTERN.test(value);
}

/**
 * True when `value` contains a comma or a line break — i.e. it cannot survive being joined raw into a
 * CSV row. Used by the fields the export writes unquoted (movement name, load); `notes` uses the
 * line-break check alone. Callers keep their own authored message.
 */
export function hasCommaOrLineBreak(value: string): boolean {
  return COMMA_OR_LINE_BREAK_PATTERN.test(value);
}

/**
 * The canonical optional free-text note schema — the single SHAPE (not just the max literal) shared by
 * every free-text field, so "no note" has ONE representation everywhere. `.trim().transform(v => v ||
 * undefined)` maps a left-blank ('') or whitespace-only ('  '→trim→'') input to `undefined` → the DAL
 * writes NULL (never ''); `.optional()` accepts an absent field. Reused by bodyweight `notes` and
 * session `feel` — a new free-text field imports this rather than re-deriving the normalization.
 *
 * The newline guard (GAP-1 P2-3) sits AFTER `.trim()` — which already strips leading/trailing breaks —
 * so it rejects only an INTERIOR newline, the one that would split a row. A comma is deliberately NOT
 * rejected here: the contract quotes a comma-bearing `notes` on export. This is a trust-boundary guard,
 * not an ergonomic one — `feel` is an `<input type="text">`, which strips CR/LF on paste, so the only
 * way to reach it is a crafted body.
 */
export const freeTextNoteSchema = z
  .string()
  .trim()
  .max(FREE_TEXT_NOTE_MAX)
  .refine((v) => !hasLineBreak(v), 'A note has to be a single line.')
  .transform((v) => v || undefined)
  .optional();
