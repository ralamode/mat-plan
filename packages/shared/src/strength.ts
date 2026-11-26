import { z } from 'zod';

import { MAX_REPS_PER_SET } from './units';

/**
 * A NUMERIC set's rep count (GAP-1 P0-2): a whole number, 1..`MAX_REPS_PER_SET`. The legacy log and
 * edit schemas built on it, and its `weight` field, were deleted by LEGACY-1; `program/pieces.ts`
 * reads `shape.reps` as the one rep-count rule.
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
});
