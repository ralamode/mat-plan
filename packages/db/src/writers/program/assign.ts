import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import {
  addDays,
  assignDraftSchema,
  isoDaySchema,
  newId,
  PROGRAM_REFUSAL,
  WEEKDAYS,
  type ProgramResult,
} from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { inHousehold, liveTemplateBlockIn } from '../ownership';
import { refuse } from './refuse';
import { shiftIntoBand } from './shift-band';

/**
 * The program an assignment writer works on, locked first (lane guide invariant 12): this
 * household's live TEMPLATE block, `FOR NO KEY UPDATE`. `null` for any other id.
 */
export async function lockProgram(
  tx: Executor,
  scope: HouseholdScope,
  programPublicId: string,
): Promise<{ id: number } | null> {
  const [block] = await tx
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .where(and(eq(schema.programBlocks.publicId, programPublicId), liveTemplateBlockIn(scope)))
    .for('no key update');
  return block ?? null;
}

/**
 * The athletes an assignment writer works on, locked after the program, in id order so two writers
 * naming the same athletes never wait on each other in turn: live, **not archived** (invariant 31),
 * of this household, `FOR NO KEY UPDATE`. `null` unless every id named is one.
 */
export async function lockAthletes(
  tx: Executor,
  scope: HouseholdScope,
  profilePublicIds: readonly string[],
): Promise<Array<{ id: number }> | null> {
  const athletes = await tx
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(
      and(
        inArray(schema.profiles.publicId, [...profilePublicIds]),
        isNull(schema.profiles.deletedAt),
        isNull(schema.profiles.archivedAt),
        inHousehold(scope),
      ),
    )
    .orderBy(asc(schema.profiles.id))
    .for('no key update');
  return athletes.length === profilePublicIds.length ? athletes : null;
}

/**
 * `ProgramActions.putOn`'s writer (FAM-1 step 6c-i). Puts each named athlete on one program, from
 * `from`. `today` is the household's today, which the caller resolves (writers take the day as an
 * argument; only an action reads the clock and the time zone).
 *
 * For each athlete, by their rows of this program (`assignDraftSchema` has the rule):
 * - **Already on it** (an open row, started or still to start): skipped. A replay of the same put on
 *   is therefore one effect, with no client id (the schema's note on `programAssignments`).
 * - **Their last day on it is today** (Take off was tapped today): **reopened**. The same row's
 *   `active_to` is cleared, whatever `from` says, so they stay on with no gap and one stretch (ADR
 *   0007 Amendment 4, C15). Take off freed the row's place in their order, so it takes the last place
 *   again.
 * - **Otherwise**: a new row from `from`, in the last place of their order, due all seven weekdays
 *   (A2 §7: FAM-1's put-on writes all seven rows).
 *
 * **Places go through the band** (`shiftIntoBand`): the athlete's open programs keep their order and
 * are numbered 0, 1, 2… with the new ones after, so a gap a Take off left is closed in the same write.
 *
 * Refusals, before anything is written: `invalid` (the schema, or a `from` that is neither today nor
 * tomorrow), `not_found` (the program is not the household's live program, or an athlete is not one
 * of its live, not archived athletes; a miss looks the same whatever its cause).
 *
 * One transaction. The program's block is locked first, as every program writer does (lane guide
 * invariant 12), then the athletes' profile rows in id order, so two put-ons of one athlete onto two
 * programs number the order one after the other instead of meeting on its unique index.
 */
export async function putOn(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
  today: string,
): Promise<ProgramResult> {
  if (!isoDaySchema.safeParse(today).success) {
    throw new Error('putOn needs today as an ISO day');
  }
  const parsed = assignDraftSchema.safeParse(input);
  if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
  // The parse hands every id back in lower case (C25; lane guide invariant 15): read them from it.
  const draft = parsed.data;
  if (draft.from !== today && draft.from !== addDays(today, 1)) {
    return refuse(PROGRAM_REFUSAL.invalid);
  }

  return exec.transaction(async (tx) => {
    const block = await lockProgram(tx, scope, draft.programPublicId);
    if (!block) return refuse(PROGRAM_REFUSAL.not_found);
    const athletes = await lockAthletes(tx, scope, draft.profilePublicIds);
    if (!athletes) return refuse(PROGRAM_REFUSAL.not_found);

    const a = schema.programAssignments;
    for (const athlete of athletes) {
      // Every live row of this athlete still current today: open ones hold a place in their order.
      const current = await tx
        .select({ id: a.id, blockId: a.blockId, idx: a.idx, activeTo: a.activeTo })
        .from(a)
        .where(
          and(
            eq(a.profileId, athlete.id),
            isNull(a.deletedAt),
            // `active_to` is the inclusive last day: a row that ended before today is history.
            gte(a.activeTo, today),
          ),
        );
      const open = await tx
        .select({ id: a.id, blockId: a.blockId, idx: a.idx })
        .from(a)
        .where(and(eq(a.profileId, athlete.id), isNull(a.deletedAt), isNull(a.activeTo)))
        .orderBy(asc(a.idx), asc(a.id));

      if (open.some((row) => row.blockId === block.id)) continue;

      // Take off writes `active_to = today`; a later last day is no writer's, and is reopened too.
      const endsToday = current.find((row) => row.blockId === block.id);

      // Close any gap in the order, then take the last place. Rows already in place stay put.
      const moved = open.flatMap((row, idx) => (row.idx === idx ? [] : [{ id: row.id, idx }]));
      if (moved.length > 0) {
        await shiftIntoBand(
          tx,
          a,
          inArray(
            a.id,
            moved.map((row) => row.id),
          ),
        );
        for (const row of moved) {
          await tx
            .update(a)
            .set({ idx: row.idx, updatedAt: sql`now()` })
            .where(eq(a.id, row.id));
        }
      }
      const last = open.length;

      if (endsToday) {
        await tx
          .update(a)
          .set({ activeTo: null, idx: last, updatedAt: sql`now()` })
          .where(eq(a.id, endsToday.id));
        continue;
      }

      const [made] = await tx
        .insert(a)
        .values({
          publicId: newId(),
          blockId: block.id,
          profileId: athlete.id,
          idx: last,
          activeFrom: draft.from,
        })
        .returning({ id: a.id });
      await tx
        .insert(schema.programAssignmentWeekdays)
        .values(WEEKDAYS.map((weekday) => ({ assignmentId: made!.id, weekday })));
    }

    return { ok: true as const };
  });
}
