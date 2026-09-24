import { csvFile, csvRow } from './row';

/**
 * Header verbatim from the real (empty) files — **9 columns, not 7.**
 *
 * The contract records this as a correction that would otherwise have shipped broken: an earlier
 * reading counted 7 and missed `date` and `notes`.
 */
export const CHECKINS_HEADER = [
  'date',
  'stance',
  'ladder',
  'bridge',
  'mobility',
  'pressure',
  'reaction',
  'shot',
  'notes',
] as const;

/**
 * One check-in day.
 *
 * ⚠️ **These are STRINGS, not integers.** `stance` carries its unit (`3min`), `reaction` is `7/10`,
 * `pressure` is bare. Typing them as numbers would lose the unit and the ratio.
 */
export type CheckinsRow = {
  date: string;
  stance: string;
  ladder: string;
  bridge: string;
  mobility: string;
  pressure: string;
  reaction: string;
  shot: string;
  notes: string;
};

/**
 * `data/checkins/<public_id>/<YYYY-MM>.csv`.
 *
 * **Header-only in reality** — the real files are 64 bytes, header plus LF, and have never carried a
 * row. They are still written: a *missing* file and an *empty* file are different inputs to the
 * workflow, and the contract fixes this header.
 *
 * Rice-bucket, drill-your-moves, splits and Brain Rep have **no columns** — they ride in `notes` or
 * nowhere.
 */
export function buildCheckins(rows: readonly CheckinsRow[]): string {
  const body = rows.map((r) =>
    csvRow(
      [r.date, r.stance, r.ladder, r.bridge, r.mobility, r.pressure, r.reaction, r.shot, r.notes],
      CHECKINS_HEADER,
    ),
  );
  return csvFile(CHECKINS_HEADER, body);
}

export function checkinsPath(profilePublicId: string, month: string): string {
  return `data/checkins/${profilePublicId}/${month}.csv`;
}
