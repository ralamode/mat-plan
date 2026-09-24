import { z } from 'zod';

import { setStatusSchema } from './enums';
import { uuidSchema } from './id';
import { QUANTITY_SLOT, type QuantitySlot, slotAcceptsDimension } from './quantity-slots';
import { hasCommaOrLineBreak } from './text';
import { type Unit, UNIT_DIMENSION_BY_CODE, type UnitDimension } from './units';

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

/**
 * Unit suffixes a load may carry, mapped to canonical `UNIT_CODES`. The census (§2) authors `30in`,
 * `50ft`, `20s`, `30s`; `strength.ts` has always noted `30"` is in active use too.
 *
 * This is what replaces the free-text label: `30in` is no longer a STRING, it is a typed
 * ('primary','length') quantity of 30 `in`. The aliases exist because a coach writes `s`, not `sec`.
 */
const LOAD_UNIT_ALIASES: Record<string, Unit> = {
  s: 'sec',
  sec: 'sec',
  secs: 'sec',
  min: 'min',
  mins: 'min',
  '"': 'in',
  in: 'in',
  cm: 'cm',
  ft: 'ft',
  m: 'm',
  yd: 'yd',
  lb: 'lb',
  lbs: 'lb',
  kg: 'kg',
};

/** `30in`, `50 ft`, `20s`, `30"` — a magnitude with the unit written on it. */
const MAGNITUDE_WITH_UNIT = /^(\d+(?:\.\d{1,3})?)\s*([a-z]+|")$/i;

/**
 * The result of interpreting the single `weight` field the form submits.
 *
 * GAP-3: there is no `label` arm any more — `weight_label` is dropped, so free text has nowhere to
 * land. Every arm below is a TYPED destination:
 *   - `numeric`   → one ('primary','mass') quantity; the UNIT comes from the entry (lb/kg), because a
 *                   bare `185` never writes its unit down (census §4.6: "weight units are never written").
 *   - `quantity`  → the value carried its own unit, so the slot/dimension/unit are all known here.
 *   - `bodyweight`/`band` → the two BOOLEANS on `entry_sets`. Neither is a quantity (GAP-3 §7.2b).
 */
export type ParsedLoad =
  | { kind: 'numeric'; weight: number }
  | { kind: 'quantity'; slot: QuantitySlot; dimension: UnitDimension; unit: Unit; value: number }
  | { kind: 'bodyweight' }
  | { kind: 'band' }
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

  // GAP-3: the two chips are MODES, not quantities, and become booleans on the set. Matched before
  // everything else and case-insensitively — a coach typing `bw` meant the chip, and now that there is
  // no free-text column to absorb the difference, normalising is the only non-lossy option.
  if (value.toLowerCase() === 'bw') return { kind: 'bodyweight' };
  if (value.toLowerCase() === 'band') return { kind: 'band' };

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
  // The predicate is shared with the movement name (GAP-1 P2-2) — one definition, authored messages
  // stay per-call-site.
  if (hasCommaOrLineBreak(value)) {
    return { kind: 'invalid', message: 'A load can’t contain a comma or a line break.' };
  }

  if (value.length > LOAD_MAX_LENGTH) {
    return { kind: 'invalid', message: `Keep the load under ${LOAD_MAX_LENGTH} characters.` };
  }

  // GAP-3, and the reason the free-text column could go: a magnitude that WRITES ITS OWN UNIT is not
  // free text, it is a typed quantity that was being stored as a string. `30in` is a box-jump height,
  // `50ft` a sled distance, `20s` a hold — three different physical quantities the old `weight_label`
  // flattened into one column (census §2, shapes L5/L6/L8).
  const withUnit = MAGNITUDE_WITH_UNIT.exec(value);
  if (withUnit) {
    const unit = LOAD_UNIT_ALIASES[withUnit[2].toLowerCase()];
    if (unit === undefined) {
      return {
        kind: 'invalid',
        message: `“${withUnit[2]}” isn’t a unit we know. Try in, ft, s or lb.`,
      };
    }
    const magnitude = Number(withUnit[1]);
    const dimension = UNIT_DIMENSION_BY_CODE[unit];
    // A mass written out (`185lb`) is still the primary load, just with its unit stated; every other
    // dimension is the movement's primary quantity too. `distance` is NOT reachable from this field —
    // a sled's `123 (50ft)` needs two values, which is the multi-slot form, not one text box.
    if (!slotAcceptsDimension(QUANTITY_SLOT.primary, dimension)) {
      return { kind: 'invalid', message: `A load can’t be measured in ${unit}.` };
    }
    return { kind: 'quantity', slot: QUANTITY_SLOT.primary, dimension, unit, value: magnitude };
  }

  // Nothing typed matched. Under GAP-1 P0-2 this fell through to `weight_label` and the string was
  // kept verbatim; GAP-3 deliberately REVERSES that (docs/plan.md, GAP-3 row) — the whole point is
  // that no free-text load is representable, so an uninterpretable load is now a rejection.
  return {
    kind: 'invalid',
    message: 'Enter a number, a value with its unit like 30in, or pick BW / band.',
  };
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
    // GAP-1 P1-1b. `sub_failure` = went to failure short of the prescribed reps. It rides on the SET
    // because it describes ONE attempt (see SET_STATUSES); `skipped` is excluded here — a movement
    // that didn't happen carries zero set rows (P1-1a), never a placeholder set.
    //
    // `.optional()` and NOT `.default('done')`, deliberately: `.default()` would make `status` REQUIRED
    // in the output type, forcing a `status` key onto every bare `{ reps, weight }` set literal in the
    // codebase (db:verify alone has ~15) and forking the default across zod and the column. Omitted
    // here → the writer omits the column → Postgres applies `.notNull().default('done')`. One default,
    // in one place, and every existing payload stores a byte-identical row.
    //
    // NOTE `reps` stays REQUIRED and positive for a sub-failure set. The CSV loses the number into
    // `notes`, but that is a limitation of the FILE, not an instruction to lose it in the DB —
    // byte-faithfulness is a property of the export, not of storage. A nullable `reps` would also
    // recreate a known-unrecoverable state (`formatSetLine` renders `? × BW` and `isEditableSet` then
    // refuses to fix it), which is exactly what `parseLoad`'s blank-check above exists to prevent.
    status: setStatusSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const parsed = parseLoad(val.weight);
    if (parsed.kind === 'invalid') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weight'], message: parsed.message });
    }
  })
  .transform((val) => {
    const parsed = parseLoad(val.weight);
    // Spread so an absent status stays ABSENT (never `status: undefined`), which is what lets the
    // writer's `!== undefined` check omit the column and take the DB default.
    const status = val.status !== undefined ? { status: val.status } : {};
    // Unreachable after superRefine, but the transform must be total for the types to work out.
    if (parsed.kind === 'invalid')
      return { reps: val.reps, load: { kind: 'numeric' as const, weight: 0 }, ...status };
    // GAP-3: the parsed load is carried WHOLE rather than being splayed into sibling keys. The writer
    // needs the slot/dimension/unit together to build a quantity row, and the old two-key shape
    // (`weight` | `weightLabel`) had no room for them.
    return { reps: val.reps, load: parsed, ...status };
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
