import { z } from 'zod';

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

/** Max characters for a text load. The longest real shape is `BW+8 (vest)` (11); 32 is generous.
 *  Drives BOTH the schema bound and the input's `maxLength`, so they cannot drift. */
export const LOAD_MAX_LENGTH = 32;

/**
 * The canonical spellings offered as one-tap chips. Sourced here so the UI, the schema and any future
 * export all agree on casing — `BW` is upper, `band` is lower, and a coach typing `bw` by hand is a
 * different (still valid) label rather than a silent normalisation.
 */
export const CANONICAL_LOAD_LABELS = ['BW', 'band'] as const;

/**
 * A plain decimal, and nothing else. Scale 3 matches `entry_sets.weight_num numeric(7,3)`.
 *
 * The leading `-?` is LOAD-BEARING: it lets `'-5'` reach the numeric branch and fail with the authored
 * "Weight can’t be negative." message, instead of being laundered into a permanent text label.
 */
const PLAIN_DECIMAL = /^-?\d+(\.\d{1,3})?$/;

/** Only signs, digits and dots — i.e. the author clearly meant a number. Used to catch malformed
 *  numerics like `.5.5` or `1.2345` (too many decimals for `numeric(7,3)`). */
const NUMERIC_ONLY_CHARS = /^[+-]?[\d.]+$/;

/** `Infinity` / `NaN` as literal words — `Number()` accepts them, a training log must not. */
const NUMERIC_WORD = /^[+-]?(Infinity|NaN)$/i;

/**
 * A range or an approximation ANYWHERE in the value — `~90`, `12-15`, `BW +5-10`, `35-45/hand`.
 *
 * Deliberately NOT anchored: `BW +5-10` has the range after a space, so an anchored pattern misses it.
 * Safe against real labels — `1-arm` has no digit after the dash, and `30 (2x 15 DB)` / `123 (50ft)`
 * contain no dash at all.
 */
const PRESCRIPTION_SHAPE = /~|\d\s*-\s*\d/;

/** The result of interpreting the single `weight` field the form submits. */
export type ParsedLoad =
  | { kind: 'numeric'; weight: number }
  | { kind: 'label'; weightLabel: string }
  | { kind: 'invalid'; message: string };

/**
 * Interpret one load value. **Order matters and is pinned** — the blank check comes FIRST.
 *
 * WHY: an earlier design said "parses as a number → numeric, otherwise → label", which maps `''` to
 * `weightLabel: ''`. That is silently unrecoverable — `formatSetLine` uses `??`, so an empty label WINS
 * over the weight and the set renders `5 × ` with the load hidden, while `isEditableSet` and
 * `updateStrengthSetById`'s `isNull(weightLabel)` guard both refuse to fix it. It is also the V1-10
 * confirm-gate failure ("a value logs as performed without a human typing it") in a new costume.
 *
 * Shared (not app-local) because the CSV export must agree on what counts as numeric.
 */
export function parseLoad(raw: unknown): ParsedLoad {
  // A JSON body may legitimately send a NUMBER (the old schema z.coerce'd one), so accept both.
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return { kind: 'invalid', message: 'Enter a weight, or pick BW / band.' };
  }
  const value = String(raw).trim(); // ENDS ONLY — `30 (2x 15 DB)`/`BW (unassisted)` need inner spaces

  if (value === '') return { kind: 'invalid', message: 'Enter a weight, or pick BW / band.' };

  if (PLAIN_DECIMAL.test(value)) {
    const weight = Number(value);
    if (weight < 0) return { kind: 'invalid', message: 'Weight can’t be negative.' };
    if (weight > 2000) return { kind: 'invalid', message: 'That weight looks too high.' };
    return { kind: 'numeric', weight };
  }

  // Numeric INTENT that isn't a plain decimal. `Number('1e3')` is 1000 and `Number('0x10')` is 16 —
  // both were silently accepted by the old schema. Rejected rather than stored as text, because a
  // labeled value has no inline edit (V1-9 refuses any set carrying a `weight_label`), so a laundered
  // typo would be unrecoverable. Note this must NOT catch `30in`/`30s`/`15/DB`, which legitimately
  // begin with a digit — hence testing the parsed VALUE, not the first character.
  if (
    NUMERIC_WORD.test(value) ||
    NUMERIC_ONLY_CHARS.test(value) ||
    Number.isFinite(Number(value))
  ) {
    return { kind: 'invalid', message: 'Enter a plain number like 62.5, or a label like BW.' };
  }

  // A PRESCRIBED load must never become a PERFORMED one. `~90` / `12-15` / `BW +5-10` are the shapes
  // Ray authors in the program (`prescription_target.load`), and the CSV contract is explicit that `~`
  // and ranges never appear in the `load` column. Rejecting them here means that even when the deferred
  // "start today's program" prefill lands, it cannot launder a plan into a performed record.
  if (PRESCRIPTION_SHAPE.test(value)) {
    return { kind: 'invalid', message: 'Log what you actually lifted — not a range or a target.' };
  }

  // `SKIPPED` is a STATUS (`entry_sets.status`), not a load. Accepting it here would create a second,
  // contradictory representation the CSV export would then have to reconcile.
  if (value.toUpperCase() === 'SKIPPED') {
    return { kind: 'invalid', message: 'Use the skip control, not the weight field.' };
  }

  // The CSV is written by joining fields raw (it is deliberately not RFC-4180 — real rows carry bare
  // inch marks), so a comma or newline here would split a row. `"` IS allowed: `30"` is in active use.
  if (/[,\n\r]/.test(value)) {
    return { kind: 'invalid', message: 'A load can’t contain a comma or a line break.' };
  }

  if (value.length > LOAD_MAX_LENGTH) {
    return { kind: 'invalid', message: `Keep the load under ${LOAD_MAX_LENGTH} characters.` };
  }

  return { kind: 'label', weightLabel: value };
}

/**
 * One set as the LOG form submits it (GAP-1 P0-2): reps × a load that may be a number or text.
 *
 * The wire shape keeps ONE `weight` key — exactly what `strength-form.tsx` already emits — so a crafted
 * body cannot set both a number and a label. The union lives in the OUTPUT type only.
 *
 * `superRefine` + `transform`, never `z.union`: a nested union failure collapses to a single
 * `invalid_union` issue whose message is literally "Invalid input", which the action would surface as
 * "Movement 1: Invalid input" — destroying the authored per-field messages ("Weight can’t be
 * negative.") the form relies on.
 */
export const strengthSetSchema = z
  .object({
    reps: numericSetSchema.shape.reps, // identical rules, one source
    weight: z.unknown(),
  })
  .superRefine((val, ctx) => {
    const parsed = parseLoad(val.weight);
    if (parsed.kind === 'invalid') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weight'], message: parsed.message });
    }
  })
  .transform((val) => {
    const parsed = parseLoad(val.weight);
    // Unreachable after superRefine, but the transform must be total for the types to work out.
    if (parsed.kind === 'invalid') return { reps: val.reps, weight: 0 };
    return parsed.kind === 'numeric'
      ? { reps: val.reps, weight: parsed.weight }
      : { reps: val.reps, weightLabel: parsed.weightLabel };
  });

/** A validated set: either a numeric weight or a text label, never both, never neither. */
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
