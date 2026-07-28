/**
 * The shared max length for an optional free-text input (a bodyweight `notes`, a session `feel`).
 * Named once here (the AGENTS.md constants convention) so the two free-text fields can't drift — the
 * second occurrence (session `feel`, V1-8-3b) is the extract trigger. The DB columns are unbounded
 * `text`, so this is purely the app-input cap.
 */
export const FREE_TEXT_NOTE_MAX = 500;
