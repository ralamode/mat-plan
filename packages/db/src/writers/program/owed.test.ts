import { describe, it } from 'vitest';

/**
 * The tests lane P (program data) still owes the program contract, tagged by step: 6a to 6d
 * (FAM-1 plan §4: "`it.todo` lists of the tests each consumer still owes").
 *
 * Each line comes from its step's Tests column in plan §5 or from §8's behaviour table. **The lane
 * turns a line into a real test in its own files and deletes the line here, in the same PR**, so
 * what is left is what the lane has not proved yet.
 *
 * This file is the lane's own ([guide](../../../../../docs/features/program-writers.md)):
 * deleting a line owes no other lane's guide and is not a contract change. Lane A's and the
 * contract owner's lines are in `packages/shared/src/program/owed.test.ts`.
 *
 * These are a to-do list, not skipped tests: nothing here was ever a passing test.
 */

describe('ProgramList and ProgramView: owed by their consumers', () => {
  it.todo('6c: the program-list query deep-equals programs-list');
  it.todo('6c: the program-view query deep-equals family-program');
  it.todo('6c: the seeded fixture programs equal the contract fixtures');
});

describe('AssignDraft, TakeOff and ProgramOrder: owed by their consumers', () => {
  it.todo('6c: put on writes all seven weekday rows, on template blocks only');
  it.todo('6d: take off ends the program after today; logged days keep their rows');
  it.todo('6d: two open assignments at one place in an athlete’s order are refused');
});

describe('CopyDraft: owed by its consumers', () => {
  it.todo('6a: a replayed copy with the same clientId adds nothing');
  it.todo('7a-ii: MovementOption (packages/db) is assignable to MovementOptionDTO (apps/web)');
});
