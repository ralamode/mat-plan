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
  weight: z.coerce.number().min(0, 'Weight can’t be negative.').max(2000),
});
export type StrengthSetInput = z.infer<typeof strengthSetSchema>;
