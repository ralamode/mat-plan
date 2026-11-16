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

describe('WorkoutDraft: owed by its consumers', () => {
  it.todo('6a: a replayed saveWorkout adds nothing');
  it.todo('6a: a reorder keeps logged rows attached (items are matched by prescriptionClientId)');
  it.todo('6a: changing an item replaces its row and mints a new prescriptionClientId');
  it.todo('6a: a refusal is a typed result (name_taken, invalid, not_found), never thrown');
  it.todo('6a: an empty name is refused; a duplicate name in the program is refused');
  it.todo('6a: the workout query deep-equals heavy-a-draft');
});

describe('WeekDraft: owed by its consumers', () => {
  it.todo('6b: a workout runs at most once on a weekday (once_per_day)');
  it.todo('6b: a removed slot frees its place');
});

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
});
