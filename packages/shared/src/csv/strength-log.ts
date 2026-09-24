import { aggregateMovement, type ExportMovement } from './aggregate';
import { csvMovement, csvSessionType } from './columns';
import { csvFile, csvRow } from './row';

/** The header, verbatim from the real files. Column names use UNDERSCORES; values use hyphens. */
export const STRENGTH_LOG_HEADER = [
  'date',
  'session_type',
  'movement',
  'sets',
  'reps',
  'load',
  'prescribed',
  'notes',
] as const;

/** One logged movement, with everything the row needs resolved by the caller. */
export type StrengthLogRow = ExportMovement & {
  date: string; // YYYY-MM-DD, already the local activity_date
  dayRole: string | null;
  sessionType: string | null;
  movementSlug: string;
  /** The plan, verbatim. NEVER rewritten to match what happened — that gap is the column's purpose. */
  prescribed: string;
  notes: string;
};

/**
 * `data/strength-log/<public_id>/<YYYY-MM>.csv` — the hard file (V1-13a).
 *
 * **Row order is the caller's job**, and it matters: the contract requires chronological,
 * append-only, and *within a date* session order — never alphabetical. The reader supplies rows
 * already ordered by `(activity_date, session id, entries.created_at, entries.id)`, the V1-17 clause
 * that also makes superset members read in performed order.
 *
 * ⚠️ **Stated limitation:** there is deliberately no `position` column (`schema.ts`), so intra-session
 * order is *insertion* order. A set flushed late from a second device lands at the bottom of a session
 * it happened at the top of. Re-exporting the same month twice is byte-identical, which is the
 * property the workflow actually depends on.
 */
export function buildStrengthLog(rows: readonly StrengthLogRow[]): string {
  const body = rows.map((row) => {
    const context = `${row.date} ${row.movementSlug}`;
    const { sets, reps, load } = aggregateMovement(row, context);
    return csvRow(
      [
        row.date,
        csvSessionType(row.dayRole, row.sessionType),
        csvMovement(row.movementSlug),
        sets,
        reps,
        load,
        row.prescribed,
        row.notes,
      ],
      STRENGTH_LOG_HEADER,
    );
  });
  return csvFile(STRENGTH_LOG_HEADER, body);
}

/**
 * The export path for one athlete-month.
 *
 * `<athlete>` is the profile's **`public_id`**, not a name or a slug (Ray, 2026-09-24). A readable
 * directory only ever mattered to keep app exports contiguous with the paper-era tree, and that
 * requirement was retired — an importer (IMP-1) maps the old named directories onto the right profile
 * instead. `public_id` is stable across a rename by construction, globally unique, and needs no
 * migration or collision rules.
 */
export function strengthLogPath(profilePublicId: string, month: string): string {
  return `data/strength-log/${profilePublicId}/${month}.csv`;
}
