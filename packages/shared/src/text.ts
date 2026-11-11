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

/**
 * Every C0/C1 CONTROL character, which is a superset of CR/LF.
 *
 * 🔴 **A NUL is the one that matters, and it is not a style concern.** `\u0000` passed every check
 * `hasLineBreak` makes, reached Postgres, and `text` rejects it — *"invalid byte sequence for
 * encoding UTF8"* — so the action **threw** instead of returning its typed envelope, and the parent
 * got `error.tsx` rather than a field error. That is the envelope convention defeated by one byte
 * (probed). Crafted-body only, since no input element emits a NUL.
 */
const CONTROL_PATTERN = /\p{Cc}/u;
const COMMA_OR_LINE_BREAK_PATTERN = /[,\r\n]/;

/**
 * Any Unicode LETTER. PICK-1's typed-name rule (`movementNameSchema`) is "at least one of these",
 * which is what separates a movement name a person meant from `🙂`, `123` or `---`.
 *
 * ⚠️ **`\p{L}`, not `[a-z]`** — the catalog is English today and the rule must not be. It is also
 * deliberately NOT `\p{Alphabetic}`: that includes `\p{Nl}` (letter-numbers like `Ⅷ`) and combining
 * marks, and `foldName` already strips marks, so a mark-only name would pass here and fold to `''`.
 */
const LETTER_PATTERN = /\p{L}/u;

/** True when `value` contains a CR or LF — which would split one record into two on export. */
export function hasLineBreak(value: string): boolean {
  return LINE_BREAK_PATTERN.test(value);
}

/**
 * True when `value` contains ANY control character — CR/LF included, plus NUL and the rest of C0/C1.
 *
 * Deliberately separate from {@link hasLineBreak} rather than replacing it: the two answer different
 * questions. `hasLineBreak` is the CSV-contract predicate ("would this split a record"), and its
 * message says so; this is the trust-boundary predicate ("can this reach the database at all").
 * A field that is exported uses the first; a field that is only stored uses this.
 */
export function hasControlChar(value: string): boolean {
  return CONTROL_PATTERN.test(value);
}

/**
 * Collapse every run of whitespace to one space. Shared because `athleteNameSchema` and
 * {@link foldName} must agree about what was stored — the stored name, the duplicate warning and
 * A3's typed-match confirmation all quote it, and a name that displays with three spaces while
 * folding with one makes the warning read as nonsense.
 */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ');
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
 * True when `value` contains at least one letter — PICK-1's typed-movement-name rule.
 *
 * Beside {@link hasCommaOrLineBreak} because the two are the pair a **typed** movement name must
 * pass, and neither applies to a name the DATABASE supplied (an id-resolved movement is never
 * refused for its own label — PICK-1 Decision 1, correctness S1). `MOV-1`'s rename and `V1-22` A4's
 * authored movement names import the same predicate through `movementNameSchema`.
 */
export function hasALetter(value: string): boolean {
  return LETTER_PATTERN.test(value);
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
  return (
    collapseWhitespace(value)
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      // 🔴 **FORMAT characters (`\p{Cf}`) too — zero-width space, ZWNJ, word joiner, soft hyphen.**
      // Without this, a name made only of them folds to ITSELF rather than `''`, so
      // `athleteNameSchema`'s "folds to nothing" guard — which exists precisely to refuse a name that
      // renders as nothing — let it through: probed, `'\u200b'` was accepted and stored, giving a
      // picker tile with no readable name. U+200B rides along on a paste from web content, so this is
      // not a crafted-body case. ⚠️ Folding only, never storage: a ZWJ inside an emoji name is
      // meaningful and stays stored.
      .replace(/\p{Cf}/gu, '')
      .replace(/[‘’ʼ]/gu, "'")
      .trim()
      .toLowerCase()
  );
}
