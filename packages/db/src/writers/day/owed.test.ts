import { describe, it } from 'vitest';

/**
 * The tests lane E (day data) still owes the program contract, tagged by step: 12a-ii and 14
 * (FAM-1 plan §4: "`it.todo` lists of the tests each consumer still owes").
 *
 * Each line comes from its step's Tests column in plan §5 or from §8's behaviour table. **The lane
 * turns a line into a real test in its own files and deletes the line here, in the same PR**, so
 * what is left is what the lane has not proved yet.
 *
 * This file is the lane's own ([guide](../../../../../docs/features/day-writers.md)):
 * deleting a line owes no other lane's guide and is not a contract change. Lane A's and the
 * contract owner's lines are in `packages/shared/src/program/owed.test.ts`.
 *
 * These are a to-do list, not skipped tests: nothing here was ever a passing test.
 */

describe('DayPlan: owed by its consumers', () => {
  // Every fixture is proved: the fixed-world ones by 12a-i, the archive-only ones by its rules, and
  // the replays by 12a-ii (`scripts/verify/day-plan.ts`). The reorder fixture applies its change by
  // a direct `idx` update (the board's Q6, 2026-11-17); its exit is this line.
  it.todo(
    '12a-ii: when 6d lands, replay today-stretching-first through its writer and assert the same rows',
  );
});

describe('prescribedText: owed by its consumers', () => {
  it.todo('14: the export writes template rows of each type through the renderer');
  it.todo('14: a comma in a workout name round-trips through the export');
});
