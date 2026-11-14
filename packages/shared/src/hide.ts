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
 * of them as one event. ⚠️ It is deliberately NOT the cap for clearing a day: `CLEAR_DAY_MAX` is a
 * different number sized from a real day, and it arrives with **B2**, which is the PR that can size
 * it against the thing it caps. Naming both here now would be guessing one of them.
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
 */
export const hiddenAtSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
    'a hide token is UTC text with exactly six fractional digits',
  );

/**
 * Why a restore did not simply happen, per item.
 *
 * Once an item is live its `deleted_at` is gone, so the event token alone cannot tell these apart —
 * which is why restore names the **items** as well as the event (Decision 3).
 *
 * - `ok` — restored, or already live (a replay; one effect, identical response).
 * - `slot_taken` — a weigh-in was restored into a day that now holds another one. The holder is
 *   named so the screen can offer "Use {value} instead".
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
