import { and, eq, isNull } from 'drizzle-orm';

import { uuidSchema } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { liveTemplateBlockIn } from '../../writers/ownership';

/**
 * Whether `prescriptionPublicId` names a live prescription of one of this household's live programs.
 * It takes no program or workout id. This is the prescription half of the day DAL's scope-miss
 * report (FAM-1 12b). The workout half is lane P's planned `workoutInHousehold` (step 6a-iii,
 * `queries/program/exists.ts`), which is not written yet. After the row writer answers `not_found`,
 * the DAL asks for the workout first, then the prescription, in the writer's order, and reports only
 * the first miss.
 *
 * The rule follows `workoutIn` (`queries/program/exists.ts`), without the program id:
 * - the prescription row is live;
 * - its block passes `liveTemplateBlockIn(scope)`: this household's, `kind = template`, and live.
 *   `prescriptions.block_id` is always its workout's block (the composite FK
 *   `prescriptions_workout_block_fkey`).
 *
 * The workout's own liveness is NOT read. A live prescription under a hidden workout answers `true`.
 * Only a mismatched pair would reach that case, and no writer hides a workout today.
 *
 * An id that is not a uuid answers `false`, never a 22P02. Any case of a valid id is found:
 * `public_id` is a `uuid` column, compared by value.
 *
 * ⚠️ **A hidden prescription of this household's own answers `false` too**, so a crafted write that
 * pairs a live workout with another workout's hidden prescription is reported as a miss
 * (`unknown_resource`) though the id never left the household. That is telemetry only, since the
 * day page always sends a matching pair, and it is lane P's `workoutIn` rule, taken as the board asked
 * ("a live row whose block is in the scope", 2026-11-17).
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
