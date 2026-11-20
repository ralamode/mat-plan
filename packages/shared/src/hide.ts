import { z } from 'zod';

import { isoDaySchema } from './date';
import { keyBySelf } from './enums';
import { uuidSchema } from './id';

/**
 * V1-9b — the wire contract for hiding entries and restoring them (ADR 0008's "delete").
 *
 * 🔴 **"Hide", never "delete", in every name here.** `deleted_at` is a tombstone the row keeps: the
 * entry is still present, still holds its `client_id` (non-partial since B0), and is still
 * restorable — **indefinitely**, since nothing purges a hidden row and `PRIV-3`, which owns the
 * purge, has no plan yet. Naming these `delete*` would invite the next author to assume the row is
 * gone, which is the assumption ADR 0008 exists to forbid.
 */

/**
 * The most entries one hide may name.
 *
 * It caps **a row** — a folded calisthenics row can hold several bouts, and hiding the row hides all
 * of them as one event. ⚠️ It is NOT a cap on clearing a day, and nothing is: `clearDay` reads the
 * day's ids itself under its lock, so no list crosses the wire for a cap to bound (B2-0; the
 * `CLEAR_DAY_MAX` this once promised was cut there, maintainer 2026-11-17).
 */
export const HIDE_ROW_MAX = 50;

/**
 * Hide N entries of one athlete on one day, as ONE event.
 *
 * 🔴 **Ids are de-duplicated before the count is checked** (correctness 7). Without the transform a
 * caller could send the same id fifty times and either trip `HIDE_ROW_MAX` on one real entry, or —
 * worse — pass the cap while the all-or-nothing check counts duplicates as distinct rows and finds
 * fewer owned entries than ids. De-duplicating first makes the count mean what it says.
 */
export const hideEntriesSchema = z.object({
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  entryPublicIds: z
    .array(uuidSchema)
    .min(1)
    .transform((ids) => [...new Set(ids)])
    .refine((ids) => ids.length <= HIDE_ROW_MAX, {
      message: `at most ${HIDE_ROW_MAX} entries in one hide`,
    }),
});
export type HideEntriesInput = z.infer<typeof hideEntriesSchema>;

/**
 * The hide-event token: `deleted_at` as fixed-format UTC text.
 *
 * 🔴 **It is a STRING end to end, and `z.iso.datetime()` is deliberately not used.** Postgres stores
 * `timestamptz` to **microseconds** and a JavaScript `Date` holds **milliseconds**, so a token that
 * passes through a `Date` — which `z.coerce.date()` or a `z.date()` would do — comes back rounded and
 * compares unequal to the very row it came from. The repo has already paid for that trap once
 * (`registry.ts:209-212`).
 *
 * The read produces it with
 * `to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` — one fixed format, so it
 * does not depend on the session's `DateStyle` or `TimeZone` the way `::text` would. The writer
 * compares `deleted_at = $token::timestamptz` as a bound parameter, never `sql.raw`.
 *
 * So this pattern pins **exactly six** fractional digits. Five or seven is not a token this app
 * produced, and accepting one would mean accepting a value that cannot match a row.
 *
 * **And it must be a token the app could have written: one real instant, in its one spelling**
 * (V1-9b B1-2, #547's review; `program-contract.md` invariant 29). Five shapes match the pattern and
 * are refused, for two reasons:
 * - **30 February, month 13 and year 0000 fail Postgres' `::timestamptz` cast** (22008), which would
 *   reach `error.tsx` from a public endpoint instead of answering `bad_value`.
 * - **Hour 24 and second 60 pass the cast**, as the next midnight and the next minute, so each is a
 *   second spelling of an instant. No token the app writes has one, and accepting it would let two
 *   strings name one hide.
 *
 * JS parsing is lenient (30 February becomes 2 March), so the check is that the parsed instant prints
 * back to the token's own first 23 characters, which refuses four of the five. Year 0000
 * prints back too but Postgres has no year 0, so the year must be 1 or later. The value itself is
 * never replaced: the six digits stay as typed.
 */
export const hiddenAtSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
    'a hide token is UTC text with exactly six fractional digits',
  )
  .refine(isRealInstant, 'a hide token names a real instant');

function isRealInstant(token: string): boolean {
  const ms = Date.parse(token);
  return (
    !Number.isNaN(ms) &&
    !token.startsWith('0000') &&
    new Date(ms).toISOString().slice(0, 23) === token.slice(0, 23)
  );
}

/**
 * Why a restore did not simply happen, per item.
 *
 * Once an item is live its `deleted_at` is gone, so the event token alone cannot tell these apart —
 * which is why restore names the **items** as well as the event (Decision 3).
 *
 * - `ok` — restored, or already live (a replay; one effect, identical response).
 * - `slot_taken` — a one-per-day value (a weigh-in; a practice since V1-24 3b-0) was restored into
 *   a day that now holds another one. For a weigh-in the holder is named (`heldBy`) so the screen
 *   can offer "Use {value} instead"; a practice names none.
 * - `changed` — the item is hidden under a **different** token, so something happened between the
 *   read and the tap. Maps to `AMEND_ERROR_COPY.staleWrite`.
 * - `not_found` — not an owned entry of that athlete on that day. One answer for foreign, stale and
 *   wrong-day, exactly as the shipped amends do.
 *
 * ⚠️ **There is no `expired`.** The restore window (`N`) belongs to `PRIV-3`, which introduces the
 * window, the purge and the dated copy together (decision A). Adding a reason here for a rule that
 * does not exist yet would be a contract this PR cannot honour.
 */
export const RESTORE_REASONS = ['ok', 'slot_taken', 'changed', 'not_found'] as const;
export const RESTORE_REASON = keyBySelf(RESTORE_REASONS);
export const restoreReasonSchema = z.enum(RESTORE_REASONS);
export type RestoreReason = z.infer<typeof restoreReasonSchema>;

/**
 * Why a hidden entry was hidden (V1-9b B2-0), stored as `entries.hide_reason`. **One value, written by
 * one writer:** `'clear_day'`, by `clearDay` alone, so "Day cleared · Restore all" is derived from the
 * day's clear events and survives a reload. Every other hide (a blank amend, an un-tick, a swap, an
 * operator correction) leaves it NULL, and every un-hide clears it in the same statement (a CHECK
 * refuses a live row with a reason). The DB's CHECK mirrors this list as a literal; `db:verify` pins
 * the two together.
 */
export const HIDE_REASONS = ['clear_day'] as const;
export const HIDE_REASON = keyBySelf(HIDE_REASONS);
export const hideReasonSchema = z.enum(HIDE_REASONS);
export type HideReason = z.infer<typeof hideReasonSchema>;

/**
 * Restore the items of one hide event.
 *
 * `keepInsteadOf` is the swap: the caller names the entry currently holding the bodyweight slot, and
 * the writer hides it only **after** the item being restored is proved hidden under this token
 * (Decision 8). It is optional because the ordinary restore does not need it, and absent means
 * "refuse with `slot_taken`" rather than "guess which one they meant".
 */
export const restoreHiddenSchema = z.object({
  profilePublicId: uuidSchema,
  day: isoDaySchema,
  hiddenAt: hiddenAtSchema,
  entryPublicIds: z
    .array(uuidSchema)
    .min(1)
    .transform((ids) => [...new Set(ids)])
    .refine((ids) => ids.length <= HIDE_ROW_MAX, {
      message: `at most ${HIDE_ROW_MAX} entries in one restore`,
    }),
  keepInsteadOf: uuidSchema.optional(),
});
export type RestoreHiddenInput = z.infer<typeof restoreHiddenSchema>;
