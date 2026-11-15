import type { VerifyContext } from './harness';

/**
 * `db:verify` proofs for the FAM-1 SCHEMA chain.
 *
 * **Owner: lane A** (`docs/plans/fam-1-family-program.md` §5 → "Lane A · the schema chain"). Only
 * lane A edits this file. Its steps add the proofs here, each in the PR that creates the object it
 * proves (§3 → "Proofs (`db:verify`), in the step that creates each object"):
 *
 * - step 3: the §3 migration's CHECKs against their shared consts, every built-in item typed,
 *   `DAY_ROLES` unchanged;
 * - step 4a-i: blocks, slots, identity (ADR 0007 Amendment 2 §10), `assertCheckCoversIntConst`;
 * - step 4a-ii: the append arbiters and the row arbiter;
 * - step 4b: the XOR both ways, slot keys, quantity keys, the scoped `client_id`;
 * - step 5: assignments and erasure.
 *
 * It holds no proofs yet (FAM-1 step 0c only created it). What a module can rely on when it runs,
 * and the helpers to import, are in `./harness` → `VerifyContext`. Read that before the first proof:
 * the modules run LAST, on a database that already holds every fixture `verify.ts` wrote.
 */
export async function verifySchema(_ctx: VerifyContext): Promise<void> {
  console.log('· verify/schema.ts ran: no proofs yet (lane A adds them from step 3)');
}
