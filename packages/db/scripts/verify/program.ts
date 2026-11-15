import type { VerifyContext } from './harness';

/**
 * `db:verify` proofs for the PROGRAM writers and reads.
 *
 * **Owner: lane P** (`docs/plans/fam-1-family-program.md` §5 → "Lane P · program writers"). Only
 * lane P edits this file. Its steps add the proofs here:
 *
 * - step 6a: a replayed save adds nothing; a reorder keeps logged rows attached; refusals are typed
 *   results; the `workout` read deep-equals the `heavy-a-draft` fixture;
 * - step 6b: once per weekday; a removed slot frees its place;
 * - step 6c: assignments; `program-view` deep-equals `family-program`; the seeded programs equal the
 *   contract fixtures;
 * - step 6d: logged days keep their rows; two open assignments at one `idx` are refused.
 *
 * It holds no proofs yet (FAM-1 step 0c only created it). What a module can rely on when it runs,
 * and the helpers to import, are in `./harness` → `VerifyContext`.
 *
 * ## Comparing a read with a contract fixture
 *
 * The both-sides rule (`docs/parallel-work.md` → "Once lanes run", 3): seed the state a named
 * fixture describes, in a household of this module's own, run the query, and assert the result
 * deep-equals the fixture. The database mints its own ids and timestamps, so pass BOTH sides through
 * `normalizeFixture`, with the same options:
 *
 * ```ts
 * import assert from 'node:assert/strict';
 * import { asPg } from './harness';
 * import { normalizeFixture } from './normalize-fixture';
 *
 * const read = await programView(asPg, { programPublicId, scope: FIXTURE_SCOPE });
 * assert.deepEqual(
 *   normalizeFixture(read),
 *   normalizeFixture(fixture), // the contract's `family-program`
 *   'the program read deep-equals the family-program fixture',
 * );
 * ```
 *
 * Seed the fixture's own calendar days: the normalizer leaves days alone. The names in the example
 * (`programView`, `FIXTURE_SCOPE`, where `fixture` is imported from) are lane P's to choose.
 */
export async function verifyProgram(_ctx: VerifyContext): Promise<void> {
  console.log('· verify/program.ts ran: no proofs yet (lane P adds them from step 6a)');
}
