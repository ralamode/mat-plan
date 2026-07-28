import { z } from 'zod';

import { uuidSchema } from './id';
import { FREE_TEXT_NOTE_MAX } from './text';
import type { Unit } from './units';

/** Bodyweight is logged in lb or kg — a drift-checked subset of Unit. */
export const BODYWEIGHT_UNITS = ['lb', 'kg'] as const satisfies readonly Unit[];
export type BodyweightUnit = (typeof BODYWEIGHT_UNITS)[number];

export const DEFAULT_BODYWEIGHT_UNIT: BodyweightUnit = 'lb';

/**
 * Input contract for logging a bodyweight — the single source shared by the
 * form, the Server Action (validates here), and tests. `value` is coerced from
 * the form string; `clientId` is a client-stamped UUIDv7 for idempotency.
 */
export const logBodyweightSchema = z.object({
  // The profile to log against — the tile-supplied public id (UUIDv7). Re-validated
  // server-side by the DAL (V1-3 ownership seam); never trusted from the form alone.
  profileId: uuidSchema,
  value: z.coerce
    .number()
    .positive('Enter a weight above 0.')
    .max(2000, 'That weight looks too high.'),
  unit: z.enum(BODYWEIGHT_UNITS),
  clientId: uuidSchema,
  notes: z.string().max(FREE_TEXT_NOTE_MAX).optional(),
});

export type LogBodyweightInput = z.infer<typeof logBodyweightSchema>;
