import { z } from 'zod';

import { METRIC_DEFINITION_SEED_ROWS, METRIC_KEYS } from './catalog-metrics';
import { keyBySelf } from './enums';
import { uuidSchema } from './id';
import { TRANSPORT_REFUSALS } from './program/actions';
import { isBlankEntry } from './text';
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
 * ceiling, a slipped digit ("900" for 90). `practice-shapes.test.ts` pins both, and that both are
 * inclusive.
 */
export const PRACTICE_MINUTES_MIN = 10;
export const PRACTICE_MINUTES_MAX = 300;

/**
 * The practice metric's unit, READ from the seed row that defines it, never re-typed: both writers pin
 * it in their WHERE, so a copy that drifted from the seed would make every amend and clear match
 * nothing, silently. Never posted.
 */
export const PRACTICE_UNIT = METRIC_DEFINITION_SEED_ROWS.find(
  (r) => r.key === METRIC_KEYS.practice_minutes,
)!.unit;

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

/**
 * What is wrong with a typed practice entry, or `null` if it is whole minutes in range (V1-24 3b-life-b
 * B2). One classifier, so the form's message before the request and the action's refusal agree.
 *
 * - `blank`: nothing typed.
 * - `hours`: a number that reads as HOURS: 1 to 9 (the floor's reason), or a decimal or a `h:mm`.
 * - `range`: anything else that is not whole minutes from 10 to 300.
 */
export type PracticeMinutesProblem = 'blank' | 'hours' | 'range';

export function practiceMinutesProblem(text: string): PracticeMinutesProblem | null {
  const trimmed = text.trim();
  if (trimmed === '') return 'blank';
  const minutes = parsePracticeMinutes(trimmed);
  if (minutes !== null) {
    if (isPracticeMinutesInRange(minutes)) return null;
    return minutes >= 1 && minutes < PRACTICE_MINUTES_MIN ? 'hours' : 'range';
  }
  return /^\d+([.,:]\d+)?$/.test(trimmed) ? 'hours' : 'range';
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
 * Logging a practice (V1-24 3b-life-b): the existing life form action's input, now with the minutes.
 * The action builds this from FormData at its edge and parses it here. `day` is the declared day the
 * action bounds (`resolveDeclaredDay`), so it stays a string here.
 */
export const logPracticeSchema = z.object({
  profileId: uuidSchema,
  clientId: uuidSchema,
  day: z.string(),
  minutes: practiceMinutesText,
});

export type LogPracticeInput = z.input<typeof logPracticeSchema>;

/**
 * Why a practice amend did not happen. Each maps to copy on the client. The words are the FAM-1 row
 * contract's where the meaning is the same (`ROW_REFUSALS`: `bad_value`, `closed_day`, `not_found`),
 * so a practice row folded into the day screen later speaks one vocabulary.
 *
 * - `bad_value`: the input failed `editPracticeSchema`.
 * - `not_found`: not this athlete's practice, or gone (one answer for foreign and stale ids). Also
 *   the transport's "no session".
 * - `closed_day`: the practice's day is before yesterday.
 * - `stale`: another phone changed or cleared it since this form rendered.
 * - `archived_blank`: an archived athlete cannot clear (there is no field to re-enter into).
 * - `retry`: the transport's rate limit.
 */
export const PRACTICE_AMEND_REFUSALS = [
  'bad_value',
  'not_found',
  'closed_day',
  'stale',
  'archived_blank',
  'retry',
] as const;

export type PracticeAmendRefusal = (typeof PRACTICE_AMEND_REFUSALS)[number];

export const PRACTICE_AMEND_REFUSAL = keyBySelf(PRACTICE_AMEND_REFUSALS);
export const practiceAmendRefusalSchema = z.enum(PRACTICE_AMEND_REFUSALS);

export const practiceAmendResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: practiceAmendRefusalSchema }),
]);

export type PracticeAmendResult = z.infer<typeof practiceAmendResultSchema>;

// The transport's refusals must be reasons this result can carry, or `enterMutation`'s answer would
// not type as one. Checked at compile time.
TRANSPORT_REFUSALS satisfies Record<string, PracticeAmendRefusal>;
