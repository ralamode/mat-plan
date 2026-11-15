import type { VerifyContext } from './harness';

/**
 * `db:verify` proofs for SINGLE VALUES (bodyweight, practice) and Clear this day.
 *
 * **Owner: lane S**, the feature thread (`docs/plans/fam-1-family-program.md` §5 → "Lane S · single
 * values and Clear this day"). Only lane S edits this file. The proofs are the ones its own plans
 * name, and those plans hold the detail:
 *
 * - `docs/plans/v1-24-3b-logs-in-place.md` (V1-24 3b): 3b-bw, 3b-0 (one practice per day; the
 *   restore's slot check), 3b-life;
 * - `docs/plans/v1-9b-delete-and-restore.md` (V1-9b B2): B1-2, B2-0 (`entries.hide_reason`), B2.
 *
 * It holds no proofs yet (FAM-1 step 0c only created it). What a module can rely on when it runs,
 * and the helpers to import, are in `./harness` → `VerifyContext`.
 */
export async function verifySingleValues(_ctx: VerifyContext): Promise<void> {
  console.log('· verify/single-values.ts ran: no proofs yet (lane S adds them from 3b-bw)');
}
