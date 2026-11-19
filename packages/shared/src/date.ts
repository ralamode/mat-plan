import { z } from 'zod';

/**
 * The declared date of an entry, on the wire.
 *
 * 🔴 **Promoted here from `apps/web/lib/date.ts` at `V1-9b` B1-1** (reuse N1): `packages/shared` now
 * holds wire schemas that name a day (`hide.ts`), and `packages/*` cannot import from `apps/web`. The
 * app module **re-exports** this one rather than declaring a second — a day format that disagreed
 * between the app and a shared schema would be a validation that passes on one side of the wire and
 * fails on the other.
 *
 * ⚠️ **Only the schema moved.** The tz-aware helpers (`localDayIso`, `localMinutesSinceMidnight` and
 * the `formatToParts` primitive under them) stay in `apps/web/lib/date.ts`: they resolve the ACTIVE
 * timezone, which is a request concern, and V1-6c's rule that a calendar date comes from that
 * timezone — never `new Date().toISOString().slice(0, 10)` — is documented where they live.
 */
export const isoDaySchema = z.iso.date();

/** Minutes in one day: a clock reading (`timing`, Wake) is a whole minute in `0..MINUTES_PER_DAY - 1`. */
export const MINUTES_PER_DAY = 1440;

/**
 * **This number is a clock reading**: a whole minute of one day, `0..1439`. What `timing` stores is
 * local minutes since midnight, but the database only enforces `value_num >= 0`, so a reader that
 * renders a clock checks first and shows the raw number otherwise, never a wrapped time (1440 is
 * not `12:00 AM`). The day page (`minutesToClock`) and the export (`minutesToHhMm`) share it.
 */
export function isMinuteOfDay(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < MINUTES_PER_DAY;
}
