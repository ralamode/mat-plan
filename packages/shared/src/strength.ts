import { z } from 'zod';

import { BODYWEIGHT_UNITS } from './bodyweight';
import { uuidSchema } from './id';

/** One set of a strength movement. Weights use the same lb/kg set as bodyweight. */
export const strengthSetSchema = z.object({
  reps: z.coerce
    .number()
    .int('Reps must be a whole number.')
    .positive('Reps must be above 0.')
    .max(1000),
  weight: z.coerce.number().min(0, 'Weight can’t be negative.').max(2000),
});
export type StrengthSetInput = z.infer<typeof strengthSetSchema>;

/**
 * Input contract for logging a strength entry with its sets (V0-9). Written as
 * one `entry` + N `entry_set` rows in a single transaction. `clientId` stamps the
 * parent entry for idempotency (set ids are generated server-side).
 */
export const logStrengthSchema = z.object({
  // The profile to log against — the tile-supplied public id (UUIDv7). Re-validated
  // server-side by the DAL (V1-3 ownership seam); never trusted from the form alone.
  profileId: uuidSchema,
  movementName: z.string().trim().min(1, 'Enter a movement.').max(100),
  unit: z.enum(BODYWEIGHT_UNITS),
  clientId: uuidSchema,
  sets: z.array(strengthSetSchema).min(1, 'Add at least one set.').max(20),
});
export type LogStrengthInput = z.infer<typeof logStrengthSchema>;
