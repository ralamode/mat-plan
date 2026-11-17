import { and, eq, isNull } from 'drizzle-orm';

import { uuidSchema } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { liveTemplateBlockIn } from '../../writers/ownership';

/**
 * Scoped existence reads for the program builder's DAL (FAM-1 lane B's 7a-i asked for them): whether
 * an id names one of this household's live programs, or a live workout of one. Built on
 * `liveTemplateBlockIn`, which the app must not name (`program-tables-stay-dark.test.ts`).
 *
 * The DAL calls them after a writer answers `not_found` (every miss is that one answer), to report
 * which id missed the scope; 7b's pages reuse them. An id that is not a uuid is `false`.
 */
export async function programIn(
  exec: Executor,
  scope: HouseholdScope,
  programPublicId: string,
): Promise<boolean> {
  return (await liveProgramBlockId(exec, scope, programPublicId)) !== null;
}

/**
 * The internal id of this household's live program `programPublicId`, for a read that goes on to
 * load its rows; `null` for a miss or an id that is not a uuid. Unlocked: the writers lock the block
 * in their own transaction.
 */
export async function liveProgramBlockId(
  exec: Executor,
  scope: HouseholdScope,
  programPublicId: string,
): Promise<number | null> {
  if (!uuidSchema.safeParse(programPublicId).success) return null;
  const [row] = await exec
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .where(and(eq(schema.programBlocks.publicId, programPublicId), liveTemplateBlockIn(scope)))
    .limit(1);
  return row?.id ?? null;
}

/** Whether `workoutPublicId` is a live workout of this household's live program `programPublicId`. */
export async function workoutIn(
  exec: Executor,
  scope: HouseholdScope,
  programPublicId: string,
  workoutPublicId: string,
): Promise<boolean> {
  if (!uuidSchema.safeParse(programPublicId).success) return false;
  if (!uuidSchema.safeParse(workoutPublicId).success) return false;
  const [row] = await exec
    .select({ id: schema.workouts.id })
    .from(schema.workouts)
    .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.workouts.blockId))
    .where(
      and(
        eq(schema.workouts.publicId, workoutPublicId),
        isNull(schema.workouts.deletedAt),
        eq(schema.programBlocks.publicId, programPublicId),
        liveTemplateBlockIn(scope),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Whether `workoutPublicId` is a live workout of one of this household's live programs, whichever
 * program it is in: `workoutIn` without the program id. For a caller that holds only the workout's
 * id: the copy action's scope-miss report (`CopyDraft` names the workout, not its program; lane B's
 * 7a-ii) and the day page's (12b). An id that is not a uuid is `false`.
 */
export async function workoutInHousehold(
  exec: Executor,
  scope: HouseholdScope,
  workoutPublicId: string,
): Promise<boolean> {
  if (!uuidSchema.safeParse(workoutPublicId).success) return false;
  const [row] = await exec
    .select({ id: schema.workouts.id })
    .from(schema.workouts)
    .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.workouts.blockId))
    .where(
      and(
        eq(schema.workouts.publicId, workoutPublicId),
        isNull(schema.workouts.deletedAt),
        liveTemplateBlockIn(scope),
      ),
    )
    .limit(1);
  return row !== undefined;
}
