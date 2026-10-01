import { z } from 'zod';

import { setStatusSchema } from './enums';
import { uuidSchema } from './id';

/**
 * A NUMERIC set — reps × a number. This is the original `strengthSetSchema`, preserved **unchanged**
 * under a new name (GAP-1 P0-2).
 *
 * It stays a plain `ZodObject` on purpose: `editStrengthSetSchema` below calls `.extend()`, which
 * exists on `ZodObject` **only** — it is `undefined` on the result of `.transform()`, `z.union()` or
 * `z.preprocess()`. Turning this into any of those to accommodate text loads would break the V1-9 edit
 * contract at the type level. So the log path builds its own schema alongside; the edit path keeps this.
 */
export const numericSetSchema = z.object({
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

/**
 * A set with no number and no mode. Unit-neutral since V1-30: this set may be a time or a distance,
 * where BW / band are refused (the session refine), so "or tap BW / band" would point at a button
 * that fails. Exported so tests assert through it.
 */
export const BLANK_SET_MESSAGE = 'Enter a number.';

/**
 * One set as the LOG form submits it.
 *
 * **GAP-3 PR 4a — the form stopped describing a load in prose and started naming its parts.** It used
 * to send one `weight` STRING that `parseLoad` reverse-engineered into a shape (`BW` → a mode, `30in`
 * → a height, a bare number → a weight). The form always knew which of those the athlete meant — it
 * had the chips — so it now SENDS that, and `parseLoad` is deleted along with the ~90 lines of pattern
 * matching whose only job was recovering information the client had thrown away.
 *
 * **This SHRINKS the trust surface.** A number, two booleans and a closed unit vocabulary cannot
 * express `seventy five pounds` or `~75-85`, so the boundary no longer has to recognise those in order
 * to refuse them. `PRESCRIPTION_SHAPE`'s job — keeping a PRESCRIBED range out of a PERFORMED record —
 * is now done by the field's type rather than by a regex.
 */
export const strengthSetSchema = z
  .object({
    reps: numericSetSchema.shape.reps, // identical rules, one source
    /**
     * The magnitude, still a STRING on the wire because that is what an `<input>` yields, and still
     * optional because a bodyweight set legitimately has none. `''` → null, never 0: a blank field and
     * "zero pounds" are different claims, and 0 is a real logged weight (an unloaded bar).
     */
    weight: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === undefined || String(v).trim() === '' ? null : String(v).trim()))
      .pipe(
        z
          .string()
          .nullable()
          .superRefine((v, ctx) => {
            if (v === null) return;
            if (!/^\d+(\.\d{1,3})?$/.test(v)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Enter a plain number like 62.5.',
              });
              return;
            }
            if (Number(v) > 2000) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That number looks too high.' });
            }
          }),
      )
      .transform((v) => (v === null ? null : Number(v))),
    /**
     * The two MODES. Booleans because neither is a quantity (GAP-3 §7.2b): a band has no number, and
     * bodyweight is a mode rather than a load. They are NOT mutually exclusive with `weight` — that
     * combination IS `BW+8 (vest)`, which 4b's auxiliary row completes.
     */
    // `.optional()` and NOT `.default(false)` — the same deliberate choice the `status` note below
    // records, for the same reason: `.default()` makes the key REQUIRED in the output type, forcing
    // `isBodyweight: false` onto every bare `{ reps, weight }` set literal in the codebase (db:verify
    // alone has ~20) and forking the default across zod and the column. Omitted here → the writer
    // omits the column → Postgres applies `.notNull().default(false)`. One default, in one place.
    isBodyweight: z.boolean().optional(),
    isBand: z.boolean().optional(),
    // GAP-1 P1-1b. `sub_failure` = went to failure short of the prescribed reps. It rides on the SET
    // because it describes ONE attempt (see SET_STATUSES); `skipped` is excluded here — a movement
    // that didn't happen carries zero set rows (P1-1a), never a placeholder set.
    //
    // `.optional()` and NOT `.default('done')`, deliberately: `.default()` would make `status` REQUIRED
    // in the output type and fork the default across zod and the column. Omitted here → the writer
    // omits the column → Postgres applies `.notNull().default('done')`. One default, in one place.
    status: setStatusSchema.optional(),
  })
  .superRefine((val, ctx) => {
    /**
     * **A set must carry SOME load.** This replaces `parseLoad`'s blank check, which was the first
     * branch it ran and for a load-bearing reason: a set with reps and no load renders `5 × ?` and
     * `isEditableSet` then refuses to fix it — permanently, because there is no delete action in this
     * app. Splitting the load across three independent fields removed the single-field invariant that
     * made blank unrepresentable, so it has to be restated here or the unrecoverable state returns.
     */
    if (val.weight === null && !val.isBodyweight && !val.isBand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weight'],
        message: BLANK_SET_MESSAGE,
      });
    }
  });

/** A validated set: reps, an optional magnitude, and the two mode flags. */
export type StrengthSetInput = z.infer<typeof strengthSetSchema>;

/**
 * Input contract for editing ONE already-logged strength set (V1-9 fix-a-set). Extends
 * **`numericSetSchema`** — deliberately NOT the log-path schema above, which is a transform and has no
 * `.extend`. The edit path is numeric-only by design: a labeled set's edited `weight_num` would be
 * MASKED at the read seam (`formatSetLine` prefers `weightLabel`), so `isEditableSet` excludes them and
 * `updateStrengthSetById` refuses them at the SQL level.
 */
export const editStrengthSetSchema = numericSetSchema.extend({
  profileId: uuidSchema,
  setId: uuidSchema,
});
export type EditStrengthSetInput = z.infer<typeof editStrengthSetSchema>;
