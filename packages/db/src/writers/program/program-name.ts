import { and, isNull, ne } from 'drizzle-orm';

import { foldName, movementSlug } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { liveTemplateBlockIn, programBlockInHousehold } from '../ownership';

/**
 * The two rules `createProgram` and `renameProgram` share (FAM-1 plan D5, D9), written once.
 */

/**
 * Whether another live program this household built already has `name`, compared by `foldName`
 * (plan D5): "heavy a" and "Heavy  A" are one name. `exceptPublicId` is the program being renamed,
 * so renaming a program to a re-spelling of its own name is allowed.
 *
 * - **Template blocks only** ({@link liveTemplateBlockIn}): the seeded (legacy) block is not on the
 *   Programs list, so its name is not "taken". Its slug still is: {@link freeProgramSlug}.
 * - **Live only**: a removed program's name is free again.
 * - **The fold is compared in JS**, as `findNameMatch` does and for its reason: Postgres has no
 *   `foldName`, and a household holds a handful of programs.
 *
 * ⚠️ **A read before the write, not a lock.** Two devices creating one name at the same moment can
 * both pass it. No index can hold a folded name, and the race needs two people building the same
 * program in the same second; it is accepted, as `createProfile`'s duplicate check accepts it.
 */
export async function programNameTaken(
  exec: Executor,
  scope: HouseholdScope,
  name: string,
  options: { exceptPublicId?: string } = {},
): Promise<boolean> {
  const rows = await exec
    .select({ name: schema.programBlocks.name })
    .from(schema.programBlocks)
    .where(
      and(
        liveTemplateBlockIn(scope),
        options.exceptPublicId === undefined
          ? undefined
          : ne(schema.programBlocks.publicId, options.exceptPublicId),
      ),
    );
  const folded = foldName(name);
  return rows.some((row) => foldName(row.name) === folded);
}

/**
 * The first of `base`, `base-2`, `base-3`… that `taken` does not hold (plan D9). Pure, so the suffix
 * rule is unit-tested without a database.
 */
export function firstFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * A slug for a new program named `name`: `movementSlug(name)`, suffixed past every LIVE block of this
 * household, the seeded one included (plan D9). That is exactly the set
 * `uq_program_blocks_household_slug` (partial on `deleted_at is null`) compares against, so a removed
 * program's slug is reused, as the index allows.
 *
 * The slug is chosen once, at create. A rename keeps it: a template block's identity is its
 * `client_id` and its `public_id`, and nothing reads a template block by slug.
 */
export async function freeProgramSlug(
  exec: Executor,
  scope: HouseholdScope,
  name: string,
): Promise<string> {
  const rows = await exec
    .select({ slug: schema.programBlocks.slug })
    .from(schema.programBlocks)
    .where(and(programBlockInHousehold(scope), isNull(schema.programBlocks.deletedAt)));
  return firstFreeSlug(movementSlug(name), new Set(rows.map((row) => row.slug)));
}
