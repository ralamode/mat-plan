import { asc } from 'drizzle-orm';

import { isoDaySchema, programListSchema, type ProgramList } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../../writers/executor';
import { liveTemplateBlockIn } from '../../writers/ownership';
import { athletesOnPrograms } from './athletes';

/**
 * The Programs list (`ProgramList`, FAM-1 step 6c-ii): each of the household's live programs, and the
 * athletes on it as of `today`, the household's today, which the caller resolves.
 *
 * - **The household's order is the order its programs were made** (`program_blocks.id`): no column
 *   orders a household's programs, and the fixtures list them as they were made.
 * - **"On it" is "current as of today"**: on it now or starting later, the day page's own rule
 *   (`athletesOnPrograms`). An athlete who starts tomorrow is listed; one whose last day was
 *   yesterday is not. Athletes are listed earliest made first; an archived athlete is not listed.
 * - The answer is parsed with `programListSchema` before it is returned.
 */
export async function readProgramList(
  exec: Executor,
  scope: HouseholdScope,
  today: string,
): Promise<ProgramList> {
  if (!isoDaySchema.safeParse(today).success) {
    throw new Error('readProgramList needs today as an ISO day');
  }
  const programs = await exec
    .select({
      id: schema.programBlocks.id,
      publicId: schema.programBlocks.publicId,
      name: schema.programBlocks.name,
    })
    .from(schema.programBlocks)
    .where(liveTemplateBlockIn(scope))
    .orderBy(asc(schema.programBlocks.id));

  const on = new Map<number, string[]>();
  for (const athlete of await athletesOnPrograms(exec, scope, today)) {
    for (const program of athlete.current) {
      on.set(program.blockId, [...(on.get(program.blockId) ?? []), athlete.name]);
    }
  }

  return programListSchema.parse(
    programs.map((program) => ({
      programPublicId: program.publicId,
      name: program.name,
      athletes: on.get(program.id) ?? [],
    })),
  );
}
