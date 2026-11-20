import { describe, it } from 'vitest';

/**
 * The tests lane C (the day page) still owes the program contract, tagged by step:
 * 13 to 13d and 12b to 12d (FAM-1 plan §4: "`it.todo` lists of the tests each consumer
 * still owes").
 *
 * Each line comes from its step's Tests column in plan §5 or from §8's behaviour table. **The lane
 * turns a line into a real test in its own files and deletes the line here, in the same PR**, so
 * what is left is what the lane has not proved yet.
 *
 * This file is the lane's own ([guide](../../../../docs/features/day-page.md)):
 * deleting a line owes no other lane's guide and is not a contract change. Lane A's and the
 * contract owner's lines are in `packages/shared/src/program/owed.test.ts`.
 *
 * These are a to-do list, not skipped tests: nothing here was ever a passing test.
 */

describe('DayPlan: owed by its consumers', () => {
  it.todo(
    '12c: a day before yesterday is read-only, and a Change there refuses (e2e; needs a profile created before yesterday)',
  );
});

describe('RowAmend: owed by its consumers', () => {
  it.todo(
    '12d: Change’s failed state passes axe, 44px and 360px (e2e; a failed write cannot be provoked against the real server, change.test.tsx covers its copy and focus)',
  );
  it.todo(
    '12c: an un-tick or a Change, then the page’s data arriving in several refreshes, shows what was stored',
  );
});

describe('ProgramActions and DayActions: owed by their consumers', () => {
  it.todo('every screen step: focus stays on the control after an action');
  it.todo('every screen step: a dialog holds focus and returns it; targets are 44px at 360px');
});
