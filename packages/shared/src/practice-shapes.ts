import { z } from 'zod';

import { isBlankEntry } from './bodyweight';
import { uuidSchema } from './id';
import { TRANSPORT_REFUSALS } from './program/actions';
import { isWholeNumber } from './units';

/**
 * Wrestling practice minutes: the day page's second single value (V1-24 3b-life), the twin of
 * `./bodyweight`. Plan: `docs/plans/v1-24-3b-logs-in-place.md` § "3b-life: what the slice settles".
 *
 * **One practice per athlete and day** (3b-0's index), so the number is the day's TOTAL.
 */

/**
 * The plausible range, a typo guard and not a unit cap (`MAX_QUANTITY_BY_UNIT.min` is 1440).
 * The floor catches a number meant as hours ("2" for two hours) _(maintainer, 2026-11-16)_; the
 * ceiling, a slipped digit ("900" for 90). Contract tests pin both.
 */
export const PRACTICE_MINUTES_MIN = 10;
export const PRACTICE_MINUTES_MAX = 300;

/** The practice metric's unit, as `catalog-metrics.ts` seeds it. Pinned by the writers, never posted. */
export const PRACTICE_UNIT = 'min';

/**
 * Whole minutes from the field's text, or `null` when it is not whole digits. The range is the
 * schema's, so a caller can tell "not a number" from "out of range" and say which.
 */
export function parsePracticeMinutes(text: string): number | null {
  const trimmed = text.trim();
  return isWholeNumber(trimmed) ? Number(trimmed) : null;
}

export function isPracticeMinutesInRange(minutes: number): boolean {
  return minutes >= PRACTICE_MINUTES_MIN && minutes <= PRACTICE_MINUTES_MAX;
}

/** Whole minutes in range, from text: the one rule the form and the action both apply. */
const practiceMinutesText = z.string().transform((s, ctx) => {
  const minutes = parsePracticeMinutes(s);
  if (minutes !== null && isPracticeMinutesInRange(minutes)) return minutes;
  ctx.issues.push({ code: 'custom', message: 'practice minutes out of range', input: s });
  return z.NEVER;
});

/**
 * The practice amend's input (V1-24 3b-life A5), the FAM-1 contract's shape: typed, built by the
 * client wrapper from the form, never FormData past the edge.
 *
 * `value` is `null` exactly when the text is blank: a CLEAR. ⚠️ **Only a string that is empty after
 * trim** clears; an absent `value` fails the schema, so a crafted call cannot clear by omission
 * (bodyweight's rule, `editBodyweightSchema`).
 */
export const editPracticeSchema = z.object({
  profilePublicId: uuidSchema,
  /** `entries.public_id` of the practice being amended. */
  entryId: uuidSchema,
  value: z.union([
    z
      .string()
      .refine(isBlankEntry)
      .transform(() => null),
    practiceMinutesText,
  ]),
  /** GUARD ONLY: the minutes the form showed (optimistic concurrency). */
  seenValue: z.number().int(),
});

export type EditPracticeInput = z.input<typeof editPracticeSchema>;

/**
 * Why a practice amend did not happen. Each maps to copy on the client.
 *
 * - `invalid`: the input failed `editPracticeSchema`.
 * - `not_found`: not this athlete's practice, or gone (one answer for foreign and stale ids). Also
 *   the transport's "no session".
 * - `read_only`: the practice's day is before yesterday.
 * - `stale`: another phone changed or cleared it since this form rendered.
 * - `archived_blank`: an archived athlete cannot clear (there is no field to re-enter into).
 * - `retry`: the transport's rate limit.
 */
export const PRACTICE_AMEND_REFUSALS = [
  'invalid',
  'not_found',
  'read_only',
  'stale',
  'archived_blank',
  'retry',
] as const satisfies readonly string[];

export type PracticeAmendRefusal = (typeof PRACTICE_AMEND_REFUSALS)[number];

export const PRACTICE_AMEND_REFUSAL = Object.fromEntries(
  PRACTICE_AMEND_REFUSALS.map((r) => [r, r]),
) as { readonly [K in PracticeAmendRefusal]: K };

export const practiceAmendResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.enum(PRACTICE_AMEND_REFUSALS) }),
]);

export type PracticeAmendResult = z.infer<typeof practiceAmendResultSchema>;

// The transport's refusals must be reasons this result can carry, or `enterMutation`'s answer would
// not type as one. Checked at compile time.
TRANSPORT_REFUSALS satisfies Record<string, PracticeAmendRefusal>;
