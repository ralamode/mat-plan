import { and, eq, sql } from 'drizzle-orm';

import { PROGRAM_REFUSAL, renameProgramSchema, type ProgramResult } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { liveTemplateBlockIn } from '../ownership';
import { programNameTaken } from './program-name';

/**
 * `ProgramActions.renameProgram`'s writer (FAM-1 step 6a). Its refusals come in the preview fake's
 * order, so a screen sees the same answer on both:
 *
 * 1. **Parse** with `renameProgramSchema`: an empty or over-long name answers `invalid`.
 * 2. **The program**, scoped by {@link liveTemplateBlockIn} and locked `FOR UPDATE`: a program of
 *    another household, a removed one, the seeded (legacy) block and an unknown id all answer
 *    `not_found`, the same answer for each (ADR 0006: never say which).
 * 3. **The name** ({@link programNameTaken}): a name another live program of the household holds,
 *    folded, answers `name_taken`. The program's own name, re-spelt, is not taken.
 * 4. **The update**, by the row's internal id.
 *
 * The slug is not changed (`freeProgramSlug`'s docblock), and a copied workout's "Copied from"
 * keeps the name frozen at copy time (`workouts.copied_from_program_name`).
 *
 * ⚠️ The lock holds only inside the caller's transaction; with a bare handle it ends with the
 * statement. So the update repeats the scope: a program removed between steps 2 and 4 matches no
 * row and still answers `not_found`.
 */
export async function renameProgram(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<ProgramResult> {
  const parsed = renameProgramSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: PROGRAM_REFUSAL.invalid };
  const { programPublicId, name } = parsed.data;

  const [program] = await exec
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .where(and(eq(schema.programBlocks.publicId, programPublicId), liveTemplateBlockIn(scope)))
    .for('update');
  if (!program) return { ok: false, reason: PROGRAM_REFUSAL.not_found };

  if (await programNameTaken(exec, scope, name, { exceptPublicId: programPublicId })) {
    return { ok: false, reason: PROGRAM_REFUSAL.name_taken };
  }

  const updated = await exec
    .update(schema.programBlocks)
    .set({ name, updatedAt: sql`now()` })
    .where(and(eq(schema.programBlocks.id, program.id), liveTemplateBlockIn(scope)))
    .returning({ id: schema.programBlocks.id });

  return updated.length > 0 ? { ok: true } : { ok: false, reason: PROGRAM_REFUSAL.not_found };
}
