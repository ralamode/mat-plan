import type { HouseholdScope } from '../../scope';
import type { Executor } from '../executor';

/**
 * Seed the FIXTURE family's programs into one household: the programs, workouts and week the program
 * contract's named fixtures describe, with a fixture athlete on them
 * (`docs/plans/fam-1-family-program.md` §4, "Named fixtures").
 *
 * 🔴 **It writes nothing yet.** FAM-1 step 0c created it so the two steps that need it have one
 * agreed name, signature and file, and neither waits for the other:
 *
 * - **Lane P's step 6c fills it in**, building the programs with the real program writers
 *   (`writers/program/*`, steps 6a to 6c) so that what is seeded equals the contract's fixtures. Lane
 *   P owns this directory and never edits `seed.ts`.
 * - **Lane A's step 1 makes the TEST seed call it** from `src/seed.ts`, beside `PROGRAM_SEED` (D10:
 *   only the test seed writes fixture programs). Nothing calls it before that step, and production
 *   never does.
 *
 * The parameters are what a seed step has to give a household-scoped writer:
 *
 * @param db    The seed's database handle, or an open transaction. `seed()` passes its own, as it
 *              does to `seedProgram`.
 * @param scope The household to seed into, as its owner. The CALLER resolves it: `seed.ts` already
 *              resolves the root household, and is one of the modules allowed to mint a scope
 *              (`writers/household-scope-script.ts` → "Who may call it"). This module must not mint
 *              one, and must not take a household id.
 *
 * It must stay idempotent once it writes: the seed runs more than once against one database.
 */
export async function seedProgramFixtures(db: Executor, scope: HouseholdScope): Promise<void> {
  // Deliberately empty until step 6c. `void` marks the parameters as part of the agreed signature.
  void db;
  void scope;
}
