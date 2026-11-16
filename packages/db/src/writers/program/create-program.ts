import {
  createProgramSchema,
  PROGRAM_REFUSAL,
  PROGRAM_BLOCK_KIND,
  type ProgramResult,
} from '@mat-plan/shared';

import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { insertProgramBlockOwnedBy, programBlockByClientId } from '../ownership';
import { freeProgramSlug, programNameTaken } from './program-name';

/**
 * `ProgramActions.createProgram`'s writer (FAM-1 step 6a): a program is created by naming it, as a
 * TEMPLATE block of `scope`'s household.
 *
 * The order, and why:
 *
 * 1. **Parse** with `createProgramSchema`: a bad input answers `invalid`, as the preview's fake does.
 * 2. **The replay, before any check** (AGENTS.md → Idempotency; `write-path.md` invariant 12): a
 *    block this household already holds under `clientId` is answered with its id, so a retried
 *    create is never told its own name is taken. The lookup is household-scoped, so another
 *    household's use of the same id is not seen.
 * 3. **The name** ({@link programNameTaken}): another live program of the household with the same
 *    folded name answers `name_taken`.
 * 4. **Insert** through `insertProgramBlockOwnedBy` (it sets `kind = template` and mints the
 *    `public_id`), with a slug free in the household ({@link freeProgramSlug}), then re-read by
 *    `clientId`.
 *
 * ⚠️ Two devices creating programs whose names share a slug at the same moment both pick the same
 * free slug, and the second insert fails `uq_program_blocks_household_slug` and throws (an
 * unexpected error, not a refusal). Same-second creates from two devices; accepted, as
 * {@link programNameTaken}'s race is.
 */
export async function createProgram(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<ProgramResult<{ programPublicId: string }>> {
  const parsed = createProgramSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: PROGRAM_REFUSAL.invalid };
  const { clientId, name } = parsed.data;

  const replay = await programBlockByClientId(exec, scope, clientId);
  if (replay) {
    // Only a template block carries a `client_id` (the seed writes none), so this is the first call's
    // program. Checked anyway: a legacy block must never be handed to the builder as a program.
    if (replay.kind !== PROGRAM_BLOCK_KIND.template) {
      return { ok: false, reason: PROGRAM_REFUSAL.invalid };
    }
    // Removed since: the key is spent (the index is non-partial), so the honest answer is that the
    // program is gone, never a second program under an id the device believes it already used.
    return replay.deleted
      ? { ok: false, reason: PROGRAM_REFUSAL.not_found }
      : { ok: true, programPublicId: replay.publicId };
  }

  if (await programNameTaken(exec, scope, name)) {
    return { ok: false, reason: PROGRAM_REFUSAL.name_taken };
  }

  const slug = await freeProgramSlug(exec, scope, name);
  await insertProgramBlockOwnedBy(exec, scope, { clientId, slug, name, notes: null });

  const created = await programBlockByClientId(exec, scope, clientId);
  // A same-id race lost to step 2 lands here with the winner's row, which is this attempt's program.
  return created
    ? { ok: true, programPublicId: created.publicId }
    : { ok: false, reason: PROGRAM_REFUSAL.retry };
}
