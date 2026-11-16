import { describe, it } from 'vitest';

/**
 * The tests lane B (the program builder) still owes the program contract, tagged by step:
 * 8a to 10b, 7a, 7b and 15 (FAM-1 plan §4: "`it.todo` lists of the tests each consumer
 * still owes").
 *
 * Each line comes from its step's Tests column in plan §5 or from §8's behaviour table. **The lane
 * turns a line into a real test in its own files and deletes the line here, in the same PR**, so
 * what is left is what the lane has not proved yet.
 *
 * This file is the lane's own ([guide](../../../../docs/features/program-builder.md)):
 * deleting a line owes no other lane's guide and is not a contract change. Lane A's and the
 * contract owner's lines are in `packages/shared/src/program/owed.test.ts`.
 *
 * These are a to-do list, not skipped tests: nothing here was ever a passing test.
 */

describe('WorkoutDraft: owed by its consumers', () => {
  it.todo(
    '7b: the workout pages pass program; the editor names it and says who a change applies to',
  );
  it.todo('7a: saveWorkout and newItem pass the inherited action matrix');
  it.todo('7b: build a program on a phone (e2e); the builder’s pages pass the a11y scan');
  it.todo('7b: every path in routes.ts has its page.tsx under app/programs/');
});

describe('WeekDraft: owed by its consumers', () => {
  it.todo('7a: saveWeek passes the inherited action matrix');
});

describe('ProgramList and ProgramView: owed by their consumers', () => {
  it.todo('7a: createProgram and renameProgram pass the inherited action matrix');
});

describe('AssignDraft, TakeOff and ProgramOrder: owed by their consumers', () => {
  it.todo('10b: Start is disabled until someone is picked');
  it.todo('15: a parent puts a test athlete on a program and they log it (e2e)');
});

describe('CopyDraft: owed by its consumers', () => {
  it.todo('10b: a copy’s name stays within WORKOUT_NAME_MAX');
  it.todo('7a: copyWorkout passes the inherited action matrix');
});

describe('ProgramActions and DayActions: owed by their consumers', () => {
  it.todo('7a: no formData or headers reach a captured event');
  it.todo('10b: a screen hides the control of a member that is undefined');
  it.todo('15: putOn and takeOff join ProgramActions, and their controls appear');
  it.todo('every screen step: focus stays on the control after an action');
  it.todo('every screen step: a dialog holds focus and returns it; targets are 44px at 360px');
});
