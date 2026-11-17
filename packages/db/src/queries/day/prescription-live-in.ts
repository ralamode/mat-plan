import { and, eq, isNull } from 'drizzle-orm';

import { uuidSchema } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { liveTemplateBlockIn } from '../../writers/ownership';

/**
 * Whether `prescriptionPublicId` names a live prescription of one of this household's live programs.
 * It takes no program or workout id. This is the prescription half of the day DAL's scope-miss
 * report (FAM-1 12b). The workout half is lane P's `workoutInHousehold`. After the row writer
 * answers `not_found`, the DAL asks for the workout first, then the prescription, in the writer's
 * order, and reports only the first miss.
 *
 * The rule is `workoutIn`'s (`queries/program/exists.ts`), without the program id:
 * - the row is live;
 * - its block passes `liveTemplateBlockIn(scope)`: this household's, `kind = template`, and live.
 *
 * An id that is not a uuid answers `false`, never a 22P02.
 */
export async function prescriptionLiveIn(
  exec: Executor,
  scope: HouseholdScope,
  prescriptionPublicId: string,
): Promise<boolean> {
  if (!uuidSchema.safeParse(prescriptionPublicId).success) return false;
  const [row] = await exec
    .select({ id: schema.prescriptions.id })
    .from(schema.prescriptions)
    .innerJoin(schema.programBlocks, eq(schema.programBlocks.id, schema.prescriptions.blockId))
    .where(
      and(
        eq(schema.prescriptions.publicId, prescriptionPublicId),
        isNull(schema.prescriptions.deletedAt),
        liveTemplateBlockIn(scope),
      ),
    )
    .limit(1);
  return row !== undefined;
}
