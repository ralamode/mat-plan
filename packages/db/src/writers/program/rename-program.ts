import { and, eq, sql } from 'drizzle-orm';

import { PROGRAM_REFUSAL, renameProgramSchema, type ProgramResult } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { liveTemplateBlockIn } from '../ownership';
import { freeProgramSlug, lostSlugRace, programNameTaken } from './program-name';

/**
 * `ProgramActions.renameProgram`'s writer (FAM-1 step 6a-i). Correct on a bare `db` or inside a
 * transaction. Its refusals come in the preview fake's order, so a screen sees the same answer on
 * both:
 *
 * 1. **Parse** with `renameProgramSchema`: an empty or over-long name answers `invalid`.
 * 2. **The program**, scoped by {@link liveTemplateBlockIn}: a program of another household, a removed
 *    one, the seeded (legacy) block and an unknown id all answer `not_found`, the same answer for
 *    each (ADR 0006: never say which).
 * 3. **The name** ({@link programNameTaken}): a name another live program of the household holds,
 *    folded, answers `name_taken`. The program's own name, re-spelt, is not taken.
 * 4. **One guarded `UPDATE`** of the name and a new slug ({@link freeProgramSlug}: a rename keeps no
 *    trace of the old name), repeating the scope, so a program removed since step 2 still answers
 *    `not_found`. No row lock, as `renameProfile` takes none: the race it could not stop anyway is
 *    the name check's, written on {@link programNameTaken}. A slug race lost answers `retry`.
 *
 * A copied workout's "Copied from" keeps the name frozen at copy time
 * (`workouts.copied_from_program_name`).
 */
export async function renameProgram(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<ProgramResult> {
  const parsed = renameProgramSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: PROGRAM_REFUSAL.invalid };
  const { programPublicId, name } = parsed.data;

  const isThisProgram = and(
    eq(schema.programBlocks.publicId, programPublicId),
    liveTemplateBlockIn(scope),
  );
  const [program] = await exec
    .select({ id: schema.programBlocks.id })
    .from(schema.programBlocks)
    .where(isThisProgram);
  if (!program) return { ok: false, reason: PROGRAM_REFUSAL.not_found };

  if (await programNameTaken(exec, scope, name, { exceptPublicId: programPublicId })) {
    return { ok: false, reason: PROGRAM_REFUSAL.name_taken };
  }

  const slug = await freeProgramSlug(exec, scope, name, { exceptPublicId: programPublicId });
  let updated = 0;
  const lost = await lostSlugRace(exec, async (tx) => {
    const rows = await tx
      .update(schema.programBlocks)
      .set({ name, slug, updatedAt: sql`now()` })
      .where(isThisProgram)
      .returning({ id: schema.programBlocks.id });
    updated = rows.length;
  });
  if (lost) return { ok: false, reason: PROGRAM_REFUSAL.retry };
  return updated > 0 ? { ok: true } : { ok: false, reason: PROGRAM_REFUSAL.not_found };
}
