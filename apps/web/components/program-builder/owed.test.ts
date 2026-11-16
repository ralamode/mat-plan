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
  it.todo('15: a parent puts a test athlete on a program and they log it (e2e)');
});

describe('CopyDraft: owed by its consumers', () => {
  it.todo(
    'C15: Copy shows a Name field, prefilled "Heavy A (copy)", when To is this program, and after a name_taken into another program (maintainer, 2026-11-16); copyName in builder-text then goes',
  );
  it.todo('7a: copyWorkout passes the inherited action matrix');
});

describe('ProgramActions and DayActions: owed by their consumers', () => {
  it.todo('7a: no formData or headers reach a captured event');
  it.todo('15: putOn and takeOff join ProgramActions, and their controls appear');
  it.todo('every screen step: focus stays on the control after an action');
  it.todo('every screen step: a dialog holds focus and returns it; targets are 44px at 360px');
  it.todo(
    '7b: the e2e hears "n items added." only after the item picker has closed (jsdom closes the sheet before a frame, so no unit test can)',
  );
  it.todo(
    '7b: the e2e opens the Copy and Put-on dialogs at 360px and runs axe, tap targets and overflow',
  );
  it.todo(
    'C15: Put on lets a "last day today" athlete be ticked; putting them on undoes the Take off (maintainer, 2026-11-16)',
  );
});
