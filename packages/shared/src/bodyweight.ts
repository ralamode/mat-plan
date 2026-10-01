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

/**
 * The one message for an out-of-range weight — it names the likely cause, not the rule. The curly
 * apostrophe matches the page's `&rsquo;` typography (the app's copy constants use it too).
 */
export const IMPLAUSIBLE_BODYWEIGHT_MESSAGE =
  'That doesn’t look like a bodyweight — check the decimal point.';

/**
 * The value fields both write paths share — **deliberately an unrefined `ZodObject`**.
 *
 * ⚠️ **A refined schema cannot be `.pick()`ed or `.omit()`ed.** zod 4.6.5 throws
 * *"`.pick()` cannot be used on object schemas containing refinements"* — at **module load**, which
 * `tsc` does not catch and which takes the whole app down at first import. V1-24 PR 1b's draft plan
 * specified exactly that and was caught by a probe, not by review. `strength.ts` carries the same
 * warning for `numericSetSchema`, which is why `editStrengthSetSchema` can extend it.
 *
 * So: keep the base plain, extend it per path, and apply the bound **last** via the one shared
 * refiner below. Both paths then enforce an identical rule from a single definition.
 */
const bodyweightValueShape = z.object({
  // The profile to log against — the tile-supplied public id (UUIDv7). Re-validated server-side by
  // the DAL (V1-3 ownership seam); never trusted from the form alone.
  profileId: uuidSchema,
  value: z.coerce.number(),
  unit: z.enum(BODYWEIGHT_UNITS),
});

/**
 * The plausibility bound, as one refiner both schemas run.
 *
 * The bound depends on the UNIT, so it is an object-level check — but its issue is filed on `value`,
 * so `flatten().fieldErrors.value` carries it and the form shows it under the input.
 *
 * ⚠️ **The amend must run this too.** It is the one path that writes a *corrected* weight, so a
 * version of it that skipped the bound would be a brand-new way to write the `845` this exists to
 * stop — and the plan accepted a no-amend 1a precisely because the bound was there.
 */
function checkBodyweightBound(
  d: { value: number; unit: BodyweightUnit },
  ctx: z.RefinementCtx,
): void {
  const { min, max } = BODYWEIGHT_BOUNDS[d.unit];
  if (d.value < min || d.value > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: IMPLAUSIBLE_BODYWEIGHT_MESSAGE,
    });
  }
}

/**
 * Input contract for logging a bodyweight — the single source shared by the form, the Server Action
 * (validates here), and tests. `value` is coerced from the form string; `clientId` is a
 * client-stamped UUIDv7 for idempotency.
 */
export const logBodyweightSchema = bodyweightValueShape
  .extend({
    clientId: uuidSchema,
    notes: freeTextNoteSchema, // blank → NULL, same shape as session feel (single source)
  })
  .superRefine(checkBodyweightBound);

export type LogBodyweightInput = z.infer<typeof logBodyweightSchema>;

/**
 * Input contract for **amending** an already-logged bodyweight (V1-24 PR 1b).
 *
 * ## `unit` is a GUARD here, never an edit
 *
 * The amend cannot change the unit — Decision 13. A two-option picker beside the number input is one
 * thumb-drag from turning `84.5 lb` into `84.5 kg`, which is **186 lb on a child**, and the
 * plausibility bound is *per unit* so that value is perfectly legal. The amend's job is a typo in the
 * digits.
 *
 * But the bound needs to know which unit applies, so the unit is still submitted — and the writer
 * **pins it in the WHERE**. That closes the hole carrying it would otherwise open: a crafted POST
 * claiming `kg` to slip `200` past the lb bound matches **zero rows**, because the stored row is
 * `lb`. Submitted for the check, verified against reality, never written.
 *
 * ## `seenValue` is optimistic concurrency, not LWW
 *
 * The value the form was rendered with. The writer applies the amend only if the row **still** holds
 * it, so a second phone's correction cannot be silently reverted by a stale render.
 *
 * ⚠️ Deliberately the VALUE and not an `updated_at` token: Postgres stores microseconds, a JS `Date`
 * is milliseconds, and a form field renders to seconds — so a timestamp token matches zero rows
 * essentially always, while PGlite's millisecond `now()` would let the proof pass green anyway
 * (probed; plan Decision 11). `numeric(8,3)` compares exactly and needs no new DTO field.
 */
export const editBodyweightSchema = bodyweightValueShape
  .extend({
    /** `entries.public_id` of the row being amended — never an internal id. */
    entryId: uuidSchema,
    seenValue: z.coerce.number(),
  })
  .superRefine(checkBodyweightBound);

export type EditBodyweightInput = z.infer<typeof editBodyweightSchema>;
