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
import { programListOrder } from '../../queries/program/program-list';
import { PARK_IDX, shiftIntoBand } from './shift-band';

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
 * The athletes an assignment writer works on, locked after the program (if the writer takes one),
 * in id order so two writers naming the same athletes never wait on each other in turn: live,
 * **not archived** (invariant 31), of this household, `FOR NO KEY UPDATE`. `null` unless every id
 * named is one.
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
 * An athlete's open assignments, in their order (`idx`, then id): exactly the rows
 * `uq_program_assignments_profile_idx` holds (live, `active_to IS NULL`), **with no block join**,
 * so an open row of a hidden program is counted too and can never be collided with. A row with a
 * last day (Take off) has left the order, and is never here.
 */
export async function openAssignments(
  tx: Executor,
  profileId: number,
): Promise<Array<{ id: number; blockId: number; idx: number }>> {
  const a = schema.programAssignments;
  return tx
    .select({ id: a.id, blockId: a.blockId, idx: a.idx })
    .from(a)
    .where(and(eq(a.profileId, profileId), isNull(a.deletedAt), isNull(a.activeTo)))
    .orderBy(asc(a.idx), asc(a.id));
}

/**
 * **The one band writer of an athlete's program order** (ADR 0007 A2 §7). Places their open rows at
 * 0, 1, 2…: the rows of `first`'s programs first, in that order, then every other open row in its
 * current order. Only a row whose place changes is written, through the band (`shiftIntoBand`), so a
 * row already in place keeps its `ctid`. Every open row is placed, so nothing is left in the band or
 * parked (`PARK_IDX`).
 *
 * A program with a last day has no open row, so it is never moved (Amendment 5: it reads after the
 * ones that stay). Call it after `lockAthletes`, in the caller's transaction.
 */
export async function placeAssignments(
  tx: Executor,
  profileId: number,
  first: readonly number[],
): Promise<void> {
  const a = schema.programAssignments;
  const open = await openAssignments(tx, profileId);
  const rank = new Map(first.map((blockId, i) => [blockId, i]));
  const placed = [
    ...open
      .filter((row) => rank.has(row.blockId))
      .sort((x, y) => rank.get(x.blockId)! - rank.get(y.blockId)!),
    ...open.filter((row) => !rank.has(row.blockId)),
  ];
  const moved = placed.flatMap((row, idx) => (row.idx === idx ? [] : [{ id: row.id, idx }]));
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
 *   0007 Amendment 4, C15). It goes back to **its old place**: after the open programs that were
 *   ahead of it (D41, the maintainer, 2026-11-18). That is where it was unless a program earlier in
 *   the Programs list was put on in between, or the athlete reordered; the reorder fixes it.
 * - **Otherwise**: a new row from `from`, due all seven weekdays (A2 §7: FAM-1's put-on writes all
 *   seven rows), **before the first program they keep that comes later in the household's Programs
 *   list**, or last (D41; A2 §7; the preview fake's rule). "Later" is read against their own order;
 *   a program not in the list (a hidden one) is never later.
 *
 * **Places go through the band** (`placeAssignments`): the athlete's open programs keep their order and
 * are numbered 0, 1, 2…, so a gap a Take off left is closed in the same write. A new or reopened row
 * waits at `PARK_IDX` until then.
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

    // The household's Programs list order (`readProgramList`: live template blocks, by id). A
    // program not in it (a hidden one whose open row an athlete still holds) ranks -1: never later.
    const listed = await tx
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(liveTemplateBlockIn(scope))
      .orderBy(programListOrder());
    const listPlace = new Map(listed.map((b, i) => [b.id, i]));
    const rank = (blockId: number) => listPlace.get(blockId) ?? -1;

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
      const open = await openAssignments(tx, athlete.id);
      if (open.some((row) => row.blockId === block.id)) continue;

      // Take off writes `active_to = today`; a later last day is no writer's, and is reopened too.
      const endsToday = current.find((row) => row.blockId === block.id);

      const order = open.map((row) => row.blockId);
      if (endsToday) {
        // D41 (the maintainer, 2026-11-18): back at its old place: after the open programs that were
        // ahead of it (a lower `idx`), so another program taken off today too does not move it.
        // Parked first, so clearing `active_to` meets no open row on the order index.
        const at = open.filter((row) => row.idx < endsToday.idx).length;
        await tx
          .update(a)
          .set({ activeTo: null, idx: PARK_IDX, updatedAt: sql`now()` })
          .where(eq(a.id, endsToday.id));
        await placeAssignments(tx, athlete.id, [
          ...order.slice(0, at),
          block.id,
          ...order.slice(at),
        ]);
        continue;
      }

      // D41 (ADR 0007 A2 §7): before the first program they keep that comes later in the list.
      const later = order.findIndex((blockId) => rank(blockId) > rank(block.id));
      const at = later < 0 ? order.length : later;

      const [made] = await tx
        .insert(a)
        .values({
          publicId: newId(),
          blockId: block.id,
          profileId: athlete.id,
          idx: PARK_IDX,
          activeFrom: draft.from,
        })
        .returning({ id: a.id });
      await tx
        .insert(schema.programAssignmentWeekdays)
        .values(WEEKDAYS.map((weekday) => ({ assignmentId: made!.id, weekday })));
      await placeAssignments(tx, athlete.id, [...order.slice(0, at), block.id, ...order.slice(at)]);
    }

    return { ok: true as const };
  });
}
