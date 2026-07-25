import { z } from 'zod';

/**
 * One set of a strength movement. Weights use the same lb/kg set as bodyweight. Consumed by
 * `logStrengthSessionSchema` (V1-8-2) — the single-movement `logStrengthSchema` it once fed was
 * retired when the form flipped to multi-movement sessions.
 */
export const strengthSetSchema = z.object({
  reps: z.coerce
    .number()
    .int('Reps must be a whole number.')
    .positive('Reps must be above 0.')
    .max(1000),
  // 0 is a legitimate weight (bodyweight movement), so a blank string must NOT slip past `.min(0)`
  // as 0 (Number('') === 0) — treat a blank as invalid (NaN fails the range check) on the JSON
  // trust boundary. The browser form marks the input `required`, so this only guards a crafted body.
  weight: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? NaN : v),
    z.coerce.number().min(0, 'Weight can’t be negative.').max(2000),
  ),
});
export type StrengthSetInput = z.infer<typeof strengthSetSchema>;
