import {
  isoDaySchema,
  PROGRAM_REFUSAL,
  programOrderSchema,
  type ProgramResult,
} from '@mat-plan/shared';

import { currentPrograms } from '../../queries/day/day-plan';
import { dayAssignments } from '../../queries/day/scheduled';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { lockAthletes, placeAssignments } from './assign';
import { refuse } from './refuse';

/**
 * `DayActions.reorderPrograms`'s writer (FAM-1 step 6d-ii): an athlete's own order of their
 * programs. `today` is the household's today, which the caller resolves. Step 15c wires it, through
 * a program-DAL function (the board, 2026-11-18).
 *
 * The list must be **exactly a permutation of the athlete's current programs** as the day page reads
 * them (`currentPrograms`, over `dayAssignments`): one left out, one added, another athlete's or
 * another household's program, a hidden program, or one they left before today is `invalid`.
 * **`invalid` also means the list is stale** (a put on or take off elsewhere, or midnight passing):
 * the dialog should reload, not mark a field.
 *
 * The write is `placeAssignments`, the one band writer of the order: each listed program's OPEN row
 * takes 0, 1, 2… in list order, then any other open row (a hidden program's) after. A program ending
 * today has no open row, so its row is never moved (ADR 0007 Amendment 5: it reads after the ones
 * that stay, wherever the list put it). Only a row whose place changes is written, so an unchanged
 * order, and a replay, writes nothing.
 *
 * Refusals, before anything is written: `invalid` (the schema, or the permutation), `not_found` (the
 * athlete is not one of this household's live, not archived athletes).
 *
 * Locks: the athlete's profile alone (`lockAthletes`), **no block**. A reorder writes no program's
 * rows, and locking several blocks would need a fixed order against `putOn`, which takes a block and
 * then the profile; taking only the profile keeps the lock order acyclic (lane guide invariant 12).
 */
export async function reorderPrograms(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
  today: string,
): Promise<ProgramResult> {
  if (!isoDaySchema.safeParse(today).success) {
    throw new Error('reorderPrograms needs today as an ISO day');
  }
  const parsed = programOrderSchema.safeParse(input);
  if (!parsed.success) return refuse(PROGRAM_REFUSAL.invalid);
  // The parse hands every id back in lower case (C25; lane guide invariant 15): read them from it.
  const { profilePublicId, programPublicIds } = parsed.data;

  return exec.transaction(async (tx) => {
    const athletes = await lockAthletes(tx, scope, [profilePublicId]);
    if (!athletes) return refuse(PROGRAM_REFUSAL.not_found);
    const athlete = athletes[0]!;

    const current = currentPrograms(
      await dayAssignments(tx, scope, athlete.id, { day: today, today }),
      today,
    );
    const blockOf = new Map(current.map((p) => [p.programPublicId, p.blockId]));
    // `programOrderSchema` already refuses a repeat, so equal sizes and every id known is exactly
    // a permutation.
    if (
      programPublicIds.length !== current.length ||
      !programPublicIds.every((id) => blockOf.has(id))
    ) {
      return refuse(PROGRAM_REFUSAL.invalid);
    }

    await placeAssignments(
      tx,
      athlete.id,
      programPublicIds.map((id) => blockOf.get(id)!),
    );
    return { ok: true as const };
  });
}
