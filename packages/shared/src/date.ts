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
