import { z } from 'zod';

import { uuidSchema } from './id';
import { freeTextNoteSchema } from './text';
import type { Unit } from './units';

/** Bodyweight is logged in lb or kg — a drift-checked subset of Unit. */
export const BODYWEIGHT_UNITS = ['lb', 'kg'] as const satisfies readonly Unit[];
export type BodyweightUnit = (typeof BODYWEIGHT_UNITS)[number];

export const DEFAULT_BODYWEIGHT_UNIT: BodyweightUnit = 'lb';

/**
 * The plausible range for a bodyweight, per unit, inclusive at both ends (V1-24 PR 1a).
 *
 * Not a medical range: a **typo guard**. The failure it exists for is a slipped decimal point —
 * `845` or `8.45` for `84.5` — which the previous `> 0 … 2000` bound accepted and which, while the
 * weigh-in has no amend (1a ships the receipt before 1b's Change), is permanent through the UI. The
 * plan accepted a no-amend 1a *because* this bound exists. Wide enough for a small kid and a heavy
 * adult (a household app, not a kids-only one); 230 kg ≈ 507 lb and 10 kg ≈ 22 lb, so the two units
 * describe roughly the same people.
 */
export const BODYWEIGHT_BOUNDS = {
  lb: { min: 20, max: 500 },
  kg: { min: 10, max: 230 },
} as const satisfies Record<BodyweightUnit, { min: number; max: number }>;

/** The one message for an out-of-range weight — it names the likely cause, not the rule. */
export const IMPLAUSIBLE_BODYWEIGHT_MESSAGE =
  "That doesn't look like a bodyweight — check the decimal point.";

/**
 * Input contract for logging a bodyweight — the single source shared by the
 * form, the Server Action (validates here), and tests. `value` is coerced from
 * the form string; `clientId` is a client-stamped UUIDv7 for idempotency.
 */
export const logBodyweightSchema = z
  .object({
    // The profile to log against — the tile-supplied public id (UUIDv7). Re-validated
    // server-side by the DAL (V1-3 ownership seam); never trusted from the form alone.
    profileId: uuidSchema,
    value: z.coerce.number(),
    unit: z.enum(BODYWEIGHT_UNITS),
    clientId: uuidSchema,
    notes: freeTextNoteSchema, // blank → NULL, same shape as session feel (single source)
  })
  // The bound depends on the UNIT, so it is an object-level check — but its issue is filed on
  // `value`, so `flatten().fieldErrors.value` carries it and the form shows it under the input.
  .superRefine((d, ctx) => {
    const { min, max } = BODYWEIGHT_BOUNDS[d.unit];
    if (d.value < min || d.value > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: IMPLAUSIBLE_BODYWEIGHT_MESSAGE,
      });
    }
  });

export type LogBodyweightInput = z.infer<typeof logBodyweightSchema>;
