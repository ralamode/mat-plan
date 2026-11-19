import { csvToken } from './columns';
import { csvFile, csvRow } from './row';
import { formatNumeric } from './value';

/**
 * **The check-ins file: one row per logged check-in** (FAM-1 14b; the maintainer's Q2, 2026-11-17:
 * the long format, old rows included). Every live entry with no movement and that is not a bodyweight
 * reading: practice minutes, habits, calisthenics, conditioning and the old check-in metrics, Wake.
 *
 * It replaced the legacy nine-column header (`date,stance,…,notes`), whose real files never carried a
 * row and whose columns fit none of what the app logs now.
 */
export const CHECKINS_HEADER = ['date', 'activity', 'metric', 'value', 'unit', 'notes'] as const;

/** One logged check-in, as the export reads it (`checkinMonthRows`). */
export type CheckinsRow = {
  date: string;
  /** `activity_types.key`. */
  activity: string;
  /** `entries.metric_key`; `null` for a bare habit or Wake. */
  metric: string | null;
  valueNum: string | null;
  valueText: string | null;
  /** The stored unit code (`min`, `count`, `bool`, `timing`), never a load spelling. */
  unit: string | null;
  notes: string | null;
};

/**
 * **A clock reading, `HH:MM`** (24-hour, zero-padded): what `timing` stores as local minutes since
 * midnight (Wake). A value that is not a whole minute of one day (outside 0..1439, or fractional) is
 * returned as its raw number, never a wrapped clock: the database only enforces `value_num >= 0`.
 */
export function minutesToHhMm(raw: string): string {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 1439) return formatNumeric(raw);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function valueOf(row: CheckinsRow): string {
  if (row.valueNum !== null) {
    return row.unit === 'timing' ? minutesToHhMm(row.valueNum) : formatNumeric(row.valueNum);
  }
  return row.valueText ?? '';
}

/**
 * `data/checkins/<public_id>/<YYYY-MM>.csv`. Rows are the caller's order (`activity_date`, then id).
 * A month with no check-ins still writes the header, so every month's zip holds the same three files.
 */
export function buildCheckins(rows: readonly CheckinsRow[]): string {
  const body = rows.map((r) =>
    csvRow(
      [
        r.date,
        csvToken(r.activity),
        r.metric === null ? '' : csvToken(r.metric),
        valueOf(r),
        r.unit ?? '',
        r.notes ?? '',
      ],
      CHECKINS_HEADER,
    ),
  );
  return csvFile(CHECKINS_HEADER, body);
}

export function checkinsPath(profilePublicId: string, month: string): string {
  return `data/checkins/${profilePublicId}/${month}.csv`;
}
