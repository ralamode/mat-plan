import { z } from 'zod';

/**
 * The shared max length for an optional free-text input (a bodyweight `notes`, a session `feel`).
 * Named once (the AGENTS.md constants convention) so the free-text fields can't drift. The DB columns
 * are unbounded `text`, so this is purely the app-input cap.
 */
export const FREE_TEXT_NOTE_MAX = 500;

/**
 * The canonical optional free-text note schema — the single SHAPE (not just the max literal) shared by
 * every free-text field, so "no note" has ONE representation everywhere. `.trim().transform(v => v ||
 * undefined)` maps a left-blank ('') or whitespace-only ('  '→trim→'') input to `undefined` → the DAL
 * writes NULL (never ''); `.optional()` accepts an absent field. Reused by bodyweight `notes` and
 * session `feel` — a new free-text field imports this rather than re-deriving the normalization.
 */
export const freeTextNoteSchema = z
  .string()
  .trim()
  .max(FREE_TEXT_NOTE_MAX)
  .transform((v) => v || undefined)
  .optional();
