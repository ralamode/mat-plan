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

/**
 * Fold a person's NAME to a comparison key — "are these two the same name, to a human?" (PROF-1 D11).
 *
 * Created by PROF-1 a-r because rename is the first surface that has to ask the question; the
 * duplicate warning (a-1d), the picker (PICK-1) and the movement catalog (MOV-1) are the other
 * consumers, and all four must fold by the SAME rule or two of them disagree about what a duplicate
 * is. One definition, imported — never a per-surface `.toLowerCase().trim()`.
 *
 * The steps, in order: **NFKD** → strip combining marks (`\p{M}`) → map the three apostrophes people
 * actually type to `'` → collapse interior whitespace → trim → lower-case.
 *
 * ⚠️ **NFKD, not NFD, and that is the one choice worth arguing.** The question this answers is "would
 * a parent read these as the same name", so the COMPATIBILITY forms must fold too: the ligature `ﬁ`
 * and full-width `Ｚｏｅ` decompose to `fi` and `Zoe` under NFKD and stay distinct under NFD. Under NFD
 * two names a parent reads as identical would not warn, which is the failure this exists to prevent.
 *
 * ⚠️ **It can return `''`** — a name of only combining marks folds to nothing. That is not a bug and
 * callers must not treat the empty string as "no duplicate": `athleteNameSchema`
 * (`packages/shared/src/profiles.ts`) rejects such a name at the boundary so it never reaches a
 * comparison, which is why the fold is free to be lossy here.
 *
 * ⚠️ **A fold is NOT a display value and NOT a storage value.** The stored name is what the person
 * typed (whitespace-collapsed by the schema, nothing else); this output exists only to be compared.
 */
export function foldName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’ʼ]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}
