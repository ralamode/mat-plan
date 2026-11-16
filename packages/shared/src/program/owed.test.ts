import { describe, it } from 'vitest';

/**
 * The tests the program contract is still owed by **lane A (the schema chain) and the contract
 * owner** (FAM-1 plan §4: "`it.todo` lists of the tests each consumer still owes"), tagged by step.
 *
 * 🔴 **Each lane with a guide keeps its own list in a file it owns**, so deleting a line never owes
 * this directory's guide or another lane's:
 *
 * - lane P: `packages/db/src/writers/program/owed.test.ts`
 * - lane E: `packages/db/src/writers/day/owed.test.ts`
 * - lane B: `apps/web/components/program-builder/owed.test.ts`
 * - lane C: `apps/web/components/day/owed.test.ts`
 *
 * **Lanes A and S have no guide of their own, so their lines live here, under the seam rule**
 * (plan §6): this file is the contract's, a PR that deletes a line owes
 * [program-contract.md](../../../../docs/features/program-contract.md), and such PRs merge one at
 * a time. Lane S has no line here today; one it comes to owe is added here.
 *
 * A line is turned into a real test in the step's own files and deleted here in the same PR, so
 * what is left is what has not been proved yet. These are a to-do list, not skipped tests: nothing
 * here was ever a passing test.
 */

describe('DayPlan: owed by its consumers', () => {
  it.todo('0c: the normalizer round-trips a fixture');
});

describe('the constants: owed by their consumers', () => {
  // 4a-i proved its half (workouts' and week slots' text CHECKs, verify/schema.ts → FAM-1 4a-i).
  it.todo('4b: the prescription text columns are bounded by the same constants');
});
