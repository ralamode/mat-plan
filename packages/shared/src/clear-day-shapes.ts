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

/** Restore all: bring back one clear of this athlete's day, named by its token. */
export const restoreClearSchema = rowRetickSchema.omit({ entryPublicId: true });
export type RestoreClearInput = z.input<typeof restoreClearSchema>;

/**
 * Why a Restore all did not run. The words are `ROW_REFUSALS`' (the `satisfies` below keeps them so),
 * so the banner on the day screen speaks the rows' vocabulary.
 *
 * - `bad_value`: the input failed `restoreClearSchema`.
 * - `not_found`: no such athlete in this household; also the transport's "no session".
 * - `closed_day`: the day is before yesterday or after today, or the athlete is archived. One word for
 *   both, as `rowDayOpen` has it: either way the day is read-only.
 * - `retry`: the transport's rate limit.
 */
export const RESTORE_CLEAR_REFUSALS = [
  'bad_value',
  'not_found',
  'closed_day',
  'retry',
] as const satisfies readonly RowRefusal[];
export type RestoreClearRefusal = (typeof RESTORE_CLEAR_REFUSALS)[number];
export const RESTORE_CLEAR_REFUSAL = keyBySelf(RESTORE_CLEAR_REFUSALS);
export const restoreClearRefusalSchema = z.enum(RESTORE_CLEAR_REFUSALS);

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
  z.object({ ok: z.literal(false), reason: restoreClearRefusalSchema }),
]);
export type RestoreClearResult = z.infer<typeof restoreClearResultSchema>;

// The transport's refusals must be reasons this result can carry. Checked at compile time.
TRANSPORT_REFUSALS satisfies Record<string, RestoreClearRefusal>;
