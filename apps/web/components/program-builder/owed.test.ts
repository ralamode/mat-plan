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
  // 7b-i proves the list and program pages (`e2e/program-builder.spec.ts`, `.a11y.spec.ts`).
  it.todo('7b-ii: add a workout on a phone (e2e); the two workout pages pass the a11y scan');
  it.todo('7b-ii: the program page passes workoutPagesWired');
  it.todo('7b: every path in routes.ts has its page.tsx or route.ts under app/programs/');
});

describe('AssignDraft, TakeOff and ProgramOrder: owed by their consumers', () => {
  it.todo('15: a parent puts a test athlete on a program and they log it (e2e)');
});

describe('ProgramActions and DayActions: owed by their consumers', () => {
  it.todo('15: putOn and takeOff join ProgramActions, and their controls appear');
  it.todo('every screen step: focus stays on the control after an action');
  it.todo('every screen step: a dialog holds focus and returns it; targets are 44px at 360px');
  it.todo(
    '7b: the e2e hears "n items added." only after the item picker has closed (jsdom closes the sheet before a frame, so no unit test can)',
  );
  // The Copy half is `e2e/program-builder.spec.ts` (7b-i).
  it.todo('15: the e2e opens the Put-on dialog at 360px and runs axe, tap targets and overflow');
  it.todo(
    '15: the interim line under "Who’s on it" (BUILDER_COPY.putOnComing) is deleted once Put on is wired',
  );
});
