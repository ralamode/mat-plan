import { z } from 'zod';

import { BODYWEIGHT_UNITS } from './bodyweight';
import { uuidSchema } from './id';
import { DEFAULT_SESSION_TYPE, sessionTypeSchema } from './sessions';
import { strengthSetSchema } from './strength';

/**
 * One movement within a logged session: a named movement, its unit, its own idempotency
 * `clientId`, and 1..20 sets. Reuses `strengthSetSchema` + `BODYWEIGHT_UNITS` + `uuidSchema` (the
 * same set bound `logStrengthSchema` used) — no re-declared shapes.
 */
export const sessionMovementSchema = z.object({
  movementName: z.string().trim().min(1, 'Enter a movement.').max(100),
  unit: z.enum(BODYWEIGHT_UNITS),
  clientId: uuidSchema,
  sets: z.array(strengthSetSchema).min(1, 'Add at least one set.').max(20),
});
export type SessionMovementInput = z.infer<typeof sessionMovementSchema>;

/**
 * Input contract for logging a FLAT multi-movement strength session (V1-8-2). Written as one
 * `sessions` row grouping N movement `entry`s (each → its `entry_set`s) in one transaction.
 * `clientId` stamps the parent SESSION; each movement carries its own `clientId`.
 *
 * `sessionType` defaults to `DEFAULT_SESSION_TYPE` (sourced, not a literal). The action OMITS the
 * field so the default fires — `FormData.get` returns `null` for an absent field, and `.default()`
 * fires only on `undefined`, so reading it from the body would send `null` and `z.enum` would
 * reject it, making the happy path unreachable (panel B3). No superset fields — flat only; V1-8-3
 * adds superset grouping.
 */
export const logStrengthSessionSchema = z
  .object({
    profileId: uuidSchema,
    clientId: uuidSchema,
    sessionType: sessionTypeSchema.default(DEFAULT_SESSION_TYPE),
    movements: z
      .array(sessionMovementSchema)
      .min(1, 'Add at least one movement.')
      .max(12, 'That’s a lot of movements — split into two sessions.'),
  })
  // Each movement's `clientId` is its entry's idempotency key; the writer dedupes on it, so two
  // movements sharing one would silently drop the second (ON CONFLICT → skip its sets). Reject that
  // at the boundary — the form mints a fresh id per movement, so this only guards a crafted body.
  .superRefine((val, ctx) => {
    const ids = val.movements.map((m) => m.clientId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['movements'],
        message: 'Each movement needs its own id.',
      });
    }
  });
export type LogStrengthSessionInput = z.infer<typeof logStrengthSessionSchema>;
