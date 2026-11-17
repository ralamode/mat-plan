import { DAY_PLAN_FIXTURE_SOURCES } from '@mat-plan/shared/program/fixtures';
import { describe, it } from 'vitest';

import { ARCHIVE_ONLY_FIXTURES } from '../../../scripts/verify/fixture-groups';

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
  // 12a-i proves the fixtures with no `before` (`scripts/verify/day-plan.ts`), and the two whose
  // only change is an archive, which a proof applies directly. The other `before` fixtures change
  // the program after logging, so they need its edits replayed: 12a-ii.
  const ARCHIVE_ONLY = new Set<string>(ARCHIVE_ONLY_FIXTURES);
  for (const [name, source] of Object.entries(DAY_PLAN_FIXTURE_SOURCES)) {
    if (source.before === null || ARCHIVE_ONLY.has(name)) continue;
    it.todo(`12a-ii: the resolver, on the seeded state, deep-equals ${name}`);
  }
  it.todo('12a-ii: progress does not count removed items’ rows');
});

describe('prescribedText: owed by its consumers', () => {
  it.todo('14: the export writes template rows of each type through the renderer');
  it.todo('14: a comma in a workout name round-trips through the export');
});
