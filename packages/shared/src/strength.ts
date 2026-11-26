import { z } from 'zod';

import { MASS_QUANTITY_CEILING, MAX_REPS_PER_SET } from './units';

/** Over the ceiling. Names the likeliest cause now that metres and seconds save (V1-30): a
 *  real 3200 m or 2400 s is usually a unit slip, and the copy must not imply the athlete is wrong. */
export const NUMBER_TOO_HIGH_MESSAGE = 'That number looks too high — check the unit.';

/**
 * A NUMERIC set — reps × a number (GAP-1 P0-2). The legacy log and edit schemas built on it were
 * deleted by LEGACY-1; `program/pieces.ts` reads `shape.reps` as the one rep-count rule.
 *
 * It stays a plain `ZodObject` on purpose: `.shape` exists on `ZodObject` **only** — it is
 * `undefined` on the result of `.transform()`, `z.union()` or `z.preprocess()`.
 */
export const numericSetSchema = z.object({
  reps: z.coerce
    .number()
    .int('Reps must be a whole number.')
    .positive('Reps must be above 0.')
    .max(MAX_REPS_PER_SET),
  // 0 is a legitimate weight (bodyweight movement), so a blank string must NOT slip past `.min(0)`
  // as 0 (Number('') === 0) — treat a blank as invalid (NaN fails the range check) on the JSON
  // trust boundary. The browser form marks the input `required`, so this only guards a crafted body.
  weight: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? NaN : v),
    // A mass set's bound: the same ceiling as `MAX_QUANTITY_BY_UNIT.lb/.kg`, read from the one
    // source rather than re-typed, so lowering the map cannot leave this accepting more.
    z.coerce
      .number()
      .min(0, 'Weight can’t be negative.')
      .max(MASS_QUANTITY_CEILING, NUMBER_TOO_HIGH_MESSAGE),
  ),
});
