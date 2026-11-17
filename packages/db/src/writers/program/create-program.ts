import { createProgramSchema, PROGRAM_REFUSAL, type ProgramResult } from '@mat-plan/shared';

import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';
import { insertProgramBlockOwnedBy, programBlockByClientId } from '../ownership';
import { freeProgramSlug, lostSlugRace, programNameTaken } from './program-name';

/**
 * `ProgramActions.createProgram`'s writer (FAM-1 step 6a-i): a program is created by naming it, as a
 * TEMPLATE block of `scope`'s household. Correct on a bare `db` or inside a transaction.
 *
 * The order, which is the preview fake's (`apps/web/app/design/program/fakes.ts`):
 *
 * 1. **Parse** with `createProgramSchema`: a bad input answers `invalid`.
 * 2. **The replay, before any check** (AGENTS.md → Idempotency; `write-path.md` invariant 12): a
 *    block this household holds under `clientId` is answered with its id, so a retried create is
 *    never told its own name is taken. Household-scoped, so another household's use of the id is
 *    not seen. Only template blocks carry a `client_id` (the seed writes none), so a hit is always
 *    this attempt's program; one removed since answers `not_found` (the key is spent).
 * 3. **The name** ({@link programNameTaken}, excluding this attempt): `name_taken`.
 * 4. **Insert** through `insertProgramBlockOwnedBy` (it sets `kind = template` and mints the
 *    `public_id`), with a slug free in the household ({@link freeProgramSlug}), then re-read by
 *    `clientId`. A slug race lost ({@link lostSlugRace}) is answered by that re-read too: a twin of
 *    this attempt won it, and its program is this one; otherwise another program took the slug
 *    first, and `retry` picks a new one.
 */
export async function createProgram(
  exec: Executor,
  scope: HouseholdScope,
  input: unknown,
): Promise<ProgramResult<{ programPublicId: string }>> {
  const parsed = createProgramSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: PROGRAM_REFUSAL.invalid };
  const { name } = parsed.data;
  // Postgres compares a uuid in any case; `programNameTaken`'s exclusion compares in JS.
  const clientId = parsed.data.clientId.toLowerCase();

  const answer = async (): Promise<ProgramResult<{ programPublicId: string }> | null> => {
    const block = await programBlockByClientId(exec, scope, clientId);
    if (!block) return null;
    return block.deleted
      ? { ok: false, reason: PROGRAM_REFUSAL.not_found }
      : { ok: true, programPublicId: block.publicId };
  };

  const replay = await answer();
  if (replay) return replay;

  if (await programNameTaken(exec, scope, name, { exceptClientId: clientId })) {
    return { ok: false, reason: PROGRAM_REFUSAL.name_taken };
  }

  const slug = await freeProgramSlug(exec, scope, name);
  await lostSlugRace(exec, (tx) =>
    insertProgramBlockOwnedBy(tx, scope, { clientId, slug, name, notes: null }),
  );

  return (await answer()) ?? { ok: false, reason: PROGRAM_REFUSAL.retry };
}
