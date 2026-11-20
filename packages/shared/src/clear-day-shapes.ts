import { z } from 'zod';

import { keyBySelf } from './enums';
import { hiddenAtSchema } from './hide';
import { TRANSPORT_REFUSALS } from './program/actions';
import { rowRetickSchema, type RowRefusal } from './program/day-shapes';

/**
 * Clear this day and Restore all (V1-9b B1-2 and B2): the day-level contract, in
 * `practice-shapes.ts`' form. It is built from the FAM-1 row contract, never beside it: the input is
 * the re-tick's without the entry, so its ids are lower-cased after the parse (C25) and its token is
 * B2-0's six-digit text, and its refusals are words `ROW_REFUSALS` already has.
 *
 * ⚠️ A change to `rowRetickSchema` flows into `restoreClearSchema`; the contract owner names this file
 * in any such change (2026-11-17).
 */

/**
 * One clear of a day, as the banner reads it: the clear's token and how many entries it still holds
 * hidden. One definition for `clearDay`'s answer, the day's read and the banner.
 *
 * `hiddenAt` is an opaque key the page echoes back to Restore all. It is not rendered.
 */
export const clearEventSchema = z.object({
  hiddenAt: hiddenAtSchema,
  count: z.number().int().positive(),
});
export type ClearEvent = z.infer<typeof clearEventSchema>;

/**
 * Restore all: bring back one clear of this athlete's day, named by its token. `hiddenAtSchema` refuses
 * a token that names no real instant, so this inherits that through `rowRetickSchema`.
 */
export const restoreClearSchema = rowRetickSchema.omit({ entryPublicId: true });
export type RestoreClearInput = z.input<typeof restoreClearSchema>;

/**
 * Why a day-level action did not run: Clear this day or Restore all. One list for both (plan § B2 as
 * amended, P17). The words are `ROW_REFUSALS`' (the `satisfies` below keeps them so), so the day
 * screen speaks the rows' vocabulary.
 *
 * - `bad_value`: the input failed its schema (for a clear, a missing or wrong confirm word too).
 * - `not_found`: no such athlete in this household; also the transport's "no session".
 * - `closed_day`: the day is outside the action's window, or the athlete is archived. One word for
 *   both, as `rowDayOpen` has it: either way the day is read-only for that action. Restore all's
 *   window is today and yesterday; a clear's is today only (maintainer, 2026-11-19).
 * - `retry`: the transport's rate limit.
 */
export const DAY_CLEAR_REFUSALS = [
  'bad_value',
  'not_found',
  'closed_day',
  'retry',
] as const satisfies readonly RowRefusal[];
export type DayClearRefusal = (typeof DAY_CLEAR_REFUSALS)[number];
export const DAY_CLEAR_REFUSAL = keyBySelf(DAY_CLEAR_REFUSALS);
export const dayClearRefusalSchema = z.enum(DAY_CLEAR_REFUSALS);

/**
 * What Restore all resolves to. One success shape: the copy branches on the counts.
 *
 * - `restored`: entries back on the day.
 * - `keptHidden`: entries that stay hidden because the day has a newer one in their place
 *   (`slot_taken`).
 *
 * **0 and 0 is "nothing left to restore"**, which is the answer when the clear has no entries left
 * under it. That covers a retry after a lost response, a restore from another phone, every entry
 * since revived, an earlier Restore all whose entries all stayed hidden, and a token that never
 * existed. A restore erases the state that would tell these apart, so they get one answer that is
 * true for all of them.
 */
export const restoreClearResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    restored: z.number().int().nonnegative(),
    keptHidden: z.number().int().nonnegative(),
  }),
  z.object({ ok: z.literal(false), reason: dayClearRefusalSchema }),
]);
export type RestoreClearActionResult = z.infer<typeof restoreClearResultSchema>;

/**
 * Clear this day's confirm word (plan § B2 as amended). The person types it in the dialog, and the
 * server takes it again. ⚠️ **A check against a client bug, not a control**: any caller who can POST
 * can send the word. Case and surrounding spaces are ignored, so `'Delete '` passes.
 */
export const CLEAR_DAY_CONFIRM_WORD = 'delete';
/** The longest confirm a caller may send, and the dialog input's `maxLength`: one bound, two readers. */
export const CLEAR_DAY_CONFIRM_MAX = 32;

/** What the dialog and the server both compare with `CLEAR_DAY_CONFIRM_WORD`. */
export function normalizeClearConfirm(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Clear this day: hide every live entry of one athlete's day as one event. The server finds the
 * entries (`clearDay`), so the page sends only the athlete, the day and the confirm word.
 */
export const clearDaySchema = restoreClearSchema.omit({ hiddenAt: true }).extend({
  confirm: z
    .string()
    .max(CLEAR_DAY_CONFIRM_MAX)
    .transform(normalizeClearConfirm)
    .pipe(z.literal(CLEAR_DAY_CONFIRM_WORD)),
});
export type ClearDayInput = z.input<typeof clearDaySchema>;

/**
 * What Clear this day resolves to. `count` is the entries the clear holds hidden.
 *
 * **`count: 0` is "nothing was left to clear"**, never a refusal: another phone emptied the day first
 * (a blank Change, an un-tick), or a replay raced a Restore all. The person asked for an empty day and
 * has one, so a refusal would tell them a clear that did what they wanted had failed (the reasoning
 * of Restore all's 0 and 0). The banner reads the day's clears itself, so no token leaves here.
 */
export const clearDayResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), count: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false), reason: dayClearRefusalSchema }),
]);
export type ClearDayActionResult = z.infer<typeof clearDayResultSchema>;

// The transport's refusals must be reasons this result can carry. Checked at compile time.
TRANSPORT_REFUSALS satisfies Record<string, DayClearRefusal>;
