import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { isoDaySchema, PROGRAM_REFUSAL, takeOffSchema, type ProgramResult } from '@mat-plan/shared';

import { schema } from '../../client';
import { programRowOf } from '../../queries/day/program-rows';
import { assignmentCurrentAsOf } from '../../queries/program-assignments';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { lockAthletes, lockProgram } from './assign';
import { refuse } from './refuse';

/**
 * `ProgramActions.takeOff`'s writer (FAM-1 step 6d-i; ADR 0007 Amendment 4, contract change C15).
 * Takes one athlete off one program. `today` is the household's today, which the caller resolves.
 *
 * What it does depends on where their start stands (`takeOffSchema`):
 * - **not started** (`active_from` after today): the start is removed (soft delete), and the answer
 *   is `lastDay: null`: they were never on it;
 * - **started today, nothing logged under it**: removed too, `lastDay: null`. "Logged" is a live
 *   program row of this athlete today (`programRowOf`) whose session's workout is one of THIS
 *   program's workouts, live or removed. A row ticked and un-ticked is hidden, so it does not count;
 * - **otherwise**: `active_to = today`, and the answer is `lastDay: today`: they stay on it through
 *   today.
 *
 * **A replay answers as the first call did and writes nothing**: a row whose last day is already
 * today answers `lastDay: today`; with no current row, a hidden row of this program starting today
 * or later means a Take off already removed it, and answers `lastDay: null` (decided under the
 * maintainer's overnight delegation, 2026-11-18; the contract's next PR adds the sentence). Everything else
 * with no current row is `not_found`: never on it, a removed start now in the past, another
 * household's ids.
 *
 * Refusals, before anything is written: `invalid` (the schema); `not_found` (the program is not this
 * household's live program, the athlete is not one of its live, not archived athletes, or they are
 * not on it). An archived athlete is `not_found`, and their assignment is not ended (invariant 31).
 *
 * **Never hides the weekday rows** (lane guide invariant 19: a reopen trusts them live), and never
 * moves the athlete's other programs: a closed row leaves the order index, and the next put on
 * closes the gap through the band.
 *
 * Locks: the program's block, then the athlete's profile (`lockProgram`, `lockAthletes`), as `putOn`.
 *
 * ⚠️ **An accepted limit.** "Nothing logged" is read without a lock against the row writers, so a
 * logged row can stand today under a start this removed: a ✓ racing it (`logRow` checks the
 * assignment with a plain read), or with no race at all, a re-tick, Restore all, or `restoreHidden`
 * (no app caller yet) of a row hidden before the Take off (none checks an assignment, C24). That is the state the day page shows as
 * a workout that left the week. Closing it would need the row writers to lock the assignment, and
 * re-tick and Restore all would still get through.
 */
export async function takeOff(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
  today: string,
): Promise<ProgramResult<{ lastDay: string | null }>> {
  if (!isoDaySchema.safeParse(today).success) {
    throw new Error('takeOff needs today as an ISO day');
  }
  const parsed = takeOffSchema.safeParse(input);
  if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
  // The parse hands every id back in lower case (C25; lane guide invariant 15): read them from it.
  const { programPublicId, profilePublicId } = parsed.data;

  return exec.transaction(async (tx) => {
    const block = await lockProgram(tx, scope, programPublicId);
    if (!block) return refuse(PROGRAM_REFUSAL.not_found);
    const athletes = await lockAthletes(tx, scope, [profilePublicId]);
    if (!athletes) return refuse(PROGRAM_REFUSAL.not_found);
    const athlete = athletes[0]!;

    const a = schema.programAssignments;
    const ofThisProgram = and(eq(a.profileId, athlete.id), eq(a.blockId, block.id));
    // The current row. The writers leave at most one per program (a put on the day of a take off
    // reopens it), so a second is a writer bug: thrown, so the transaction rolls back loudly.
    const current = await tx
      .select({ id: a.id, activeFrom: a.activeFrom, activeTo: a.activeTo })
      .from(a)
      .where(and(ofThisProgram, assignmentCurrentAsOf(today)))
      .orderBy(sql`${a.activeTo} is null desc`, desc(a.activeFrom), desc(a.id));
    if (current.length > 1) throw new Error('takeOff found two current rows of one program');
    const row = current[0];

    if (!row) {
      // Removed already by a Take off (only Take off hides an assignment): the same answer again.
      const [removed] = await tx
        .select({ id: a.id })
        .from(a)
        .where(and(ofThisProgram, sql`${a.deletedAt} is not null`, gte(a.activeFrom, today)))
        .limit(1);
      return removed ? { ok: true as const, lastDay: null } : refuse(PROGRAM_REFUSAL.not_found);
    }
    // A Take off ended it today already: the same answer again. (A later last day is no writer's;
    // it is closed to today below like an open row.)
    if (row.activeTo === today) return { ok: true as const, lastDay: today };

    const remove = async () => {
      await tx
        .update(a)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(a.id, row.id));
      return { ok: true as const, lastDay: null };
    };
    if (row.activeFrom > today) return remove();
    if (row.activeFrom === today) {
      const [logged] = await tx
        .select({ id: schema.entries.id })
        .from(schema.entries)
        .innerJoin(
          schema.sessions,
          and(
            eq(schema.sessions.id, schema.entries.sessionId),
            // The session is this athlete's too (defence in depth, as #589 and #601): a row whose
            // session another athlete holds is a writer bug's shape, never "logged" for this one.
            eq(schema.sessions.profileId, athlete.id),
            isNull(schema.sessions.deletedAt),
          ),
        )
        .innerJoin(schema.workouts, eq(schema.workouts.id, schema.sessions.workoutId))
        .where(
          and(
            programRowOf(athlete.id, today),
            isNull(schema.entries.deletedAt),
            eq(schema.workouts.blockId, block.id),
          ),
        )
        .limit(1);
      if (!logged) return remove();
    }

    await tx
      .update(a)
      .set({ activeTo: today, updatedAt: sql`now()` })
      .where(eq(a.id, row.id));
    return { ok: true as const, lastDay: today };
  });
}
