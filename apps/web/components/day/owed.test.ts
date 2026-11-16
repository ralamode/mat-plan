import { describe, it } from 'vitest';

/**
 * The tests lane C (the day page) still owes the program contract, tagged by step:
 * 13 to 13d, 12b to 12d and 15c (FAM-1 plan §4: "`it.todo` lists of the tests each consumer
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

describe('AssignDraft, TakeOff and ProgramOrder: owed by their consumers', () => {
  it.todo('13d: the Program order dialog lists today-two-programs’ programs in order');
  it.todo('15c: two programs on one day, reordered (e2e)');
});

describe('DayPlan: owed by its consumers', () => {
  it.todo('12b: the DAL sets writable, future and canGoForward');
  it.todo('13b: set rows, PREVIOUS and Add set, per set');
  it.todo('13b: heavy-a-supersets renders linked supersets with their rest');
  it.todo('13b: superset letters are ordinal: group b reads A1, A2 when group a is gone');
  it.todo('13b: yesterday-edited-after-logging renders the kept, extra, removed and edited rows');
  it.todo('13b: future-preview renders read-only cards');
  it.todo('13d: no-program, not-on-a-program-that-day and the rest-day notices');
  it.todo('12c: an older day and a future day are read-only (e2e)');
});

describe('RowWrite, RowUntick, RowRetick and RowResult: owed by their consumers', () => {
  it.todo('12b: logRow, untickRow and retickRow pass the inherited action matrix');
  it.todo('12b: row writes are held to the row rate limit, not the mutation limit');
  it.todo('12b: a crafted un-tick or re-tick on an older or a future day answers closed_day');
  it.todo('12b: an entry that is not this athlete’s on that day answers not_found');
  it.todo('12c: ✓, un-tick and re-tick on Check, Duration and Count (e2e)');
});

describe('RowAmend: owed by its consumers', () => {
  it.todo('12d: amendRow passes the inherited action matrix');
  it.todo('12d: a weight × reps set and a superset on real data; change a number (e2e)');
  it.todo('13b: Change keeps the old number if the new one is blank or not a number');
});

describe('ProgramActions and DayActions: owed by their consumers', () => {
  it.todo('15c: reorderPrograms joins DayActions, and the Program order control appears');
  it.todo('15c: a reorder that is not a permutation of currentPrograms answers invalid');
  it.todo('every screen step: focus stays on the control after an action');
  it.todo('every screen step: a dialog holds focus and returns it; targets are 44px at 360px');
});
