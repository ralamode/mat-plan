import { and, isNull, ne } from 'drizzle-orm';

import { foldName, movementSlug } from '@mat-plan/shared';

import { schema } from '../../client';
import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { liveTemplateBlockIn, programBlockInHousehold } from '../ownership';

/**
 * The rules `createProgram` and `renameProgram` share (FAM-1 plan D5, D9), written once.
 */

/**
 * Whether another live program this household built already has `name`, compared by `foldName`
 * (plan D5): "heavy a" and "Heavy  A" are one name.
 *
 * - `exceptPublicId`: the program being renamed, so a re-spelling of its own name is not taken.
 * - `exceptClientId`: the create attempt itself. A retry that races its own first attempt (both
 *   miss the replay lookup, the first inserts) must not be told its own program's name is taken;
 *   it falls through and the re-read returns that program (`createProfile`'s `excludeClientId`,
 *   for the same reason). A plain `!==` is safe: every template block has a `client_id`
 *   (`program_blocks_template_client_id_check`). No `db:mutations` patch: the interleaving needs
 *   two connections, and PGlite has one.
 * - **Template blocks only** ({@link liveTemplateBlockIn}): the seeded (legacy) block is not on the
 *   Programs list, so its name is not taken. Its slug still is: {@link freeProgramSlug}.
 * - **Live only**: a removed program's name is free again.
 * - **The fold is compared in JS**, as `findNameMatch` does: Postgres has no `foldName`, and a
 *   household holds a handful of programs.
 *
 * ⚠️ **A read before the write, not a lock.** Two writes of one name at the same moment (two
 * creates, two renames, or one of each, from different programs) can both pass it, and the
 * household then has two programs with one folded name. No index can hold a folded name; it needs
 * two people naming programs in the same second, and is accepted, as `createProfile`'s duplicate
 * check accepts it.
 */
export async function programNameTaken(
  exec: Executor,
  scope: HouseholdScope,
  name: string,
  options: { exceptPublicId?: string; exceptClientId?: string } = {},
): Promise<boolean> {
  const rows = await exec
    .select({ name: schema.programBlocks.name, clientId: schema.programBlocks.clientId })
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
  return rows.some(
    (row) => foldName(row.name) === folded && row.clientId !== options.exceptClientId,
  );
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
 * A slug for a program named `name`: `movementSlug(name)`, suffixed past every LIVE block of this
 * household, the seeded one included (plan D9). That is exactly the set
 * `uq_program_blocks_household_slug` (partial on `deleted_at is null`) compares against, so a removed
 * program's slug is reused, as the index allows.
 *
 * **A rename re-slugs** (`exceptPublicId` is the program being renamed, so its own slug is free to
 * keep): the slug is derived from the name, and keeping it would hold a program's first name for the
 * life of the row after the person renamed it away (inventory §3: a profile's rename keeps no
 * history either).
 *
 * ⚠️ If the seeded block of a test database is ever removed, a program may take its slug and the
 * next fixture seed's re-select finds no legacy block. Production's seed writes no programs (D10);
 * the step that first removes a legacy block owns this.
 */
export async function freeProgramSlug(
  exec: Executor,
  scope: HouseholdScope,
  name: string,
  options: { exceptPublicId?: string } = {},
): Promise<string> {
  const rows = await exec
    .select({ slug: schema.programBlocks.slug })
    .from(schema.programBlocks)
    .where(
      and(
        programBlockInHousehold(scope),
        isNull(schema.programBlocks.deletedAt),
        options.exceptPublicId === undefined
          ? undefined
          : ne(schema.programBlocks.publicId, options.exceptPublicId),
      ),
    );
  return firstFreeSlug(movementSlug(name), new Set(rows.map((row) => row.slug)));
}

/** The index a slug race violates (`schema.ts`, `programBlocks`). */
export const PROGRAM_SLUG_UNIQUE_INDEX = 'uq_program_blocks_household_slug';

/**
 * Run `write` in a savepoint and report whether it lost a slug race: `true` when it failed on
 * {@link PROGRAM_SLUG_UNIQUE_INDEX}, which rolls back only the savepoint, so the caller's transaction
 * survives to answer. Any other error is thrown unchanged.
 *
 * The race: two writes pick one free slug at the same moment (two devices naming programs alike, or
 * a create retried while its first attempt is still running), and `ON CONFLICT (household_id,
 * client_id)` does not cover the slug index, which Postgres still checks. Losing it is not a bug, so
 * the writers answer it (a replay, or `retry`) instead of throwing to `error.tsx`.
 */
export async function lostSlugRace(
  exec: Executor,
  write: (tx: Executor) => Promise<unknown>,
): Promise<boolean> {
  try {
    await exec.transaction(async (tx) => {
      await write(tx);
    });
    return false;
  } catch (e) {
    const constraint = (e as { cause?: { constraint?: string } })?.cause?.constraint;
    if (constraint === PROGRAM_SLUG_UNIQUE_INDEX) return true;
    throw e;
  }
}
