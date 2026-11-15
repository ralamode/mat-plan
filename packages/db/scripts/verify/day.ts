import type { VerifyContext } from './harness';

/**
 * `db:verify` proofs for the DAY writers and reads.
 *
 * **Owner: lane E** (`docs/plans/fam-1-family-program.md` §5 → "Lane E · day data"). Only lane E
 * edits this file. Its steps add the proofs here:
 *
 * - step 11a: none of its own (the existing strength proofs in `verify.ts` must pass unchanged);
 * - step 11b: twin session; twin row; replay after Clear day; every type passes the shape CHECK;
 *   restore after a re-tick;
 * - step 12a: seeds the state each `DayPlan` fixture describes and deep-equals it, with
 *   hand-written timestamps;
 * - step 11c: amend each type; a non-number is refused; an older day is refused;
 * - step 14: template rows of each type in the export.
 *
 * It holds no proofs yet (FAM-1 step 0c only created it). What a module can rely on when it runs,
 * and the helpers to import, are in `./harness` → `VerifyContext`.
 *
 * Step 12a's fixture comparisons go through `./normalize-fixture`, on both sides; the worked example
 * is in `./program.ts`'s header. A row result's `hiddenAt` is a timestamp: name it in
 * `timestampFields`.
 */
export async function verifyDay(_ctx: VerifyContext): Promise<void> {
  console.log('· verify/day.ts ran: no proofs yet (lane E adds them from step 11b)');
}
