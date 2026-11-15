import { DAY_PLAN_FIXTURES } from '@mat-plan/shared/program/fixtures';
import { describe, it } from 'vitest';

/**
 * The tests lane E (day data) still owes the program contract, tagged by step: 11b, 12a, 11c and 14
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
  for (const name of Object.keys(DAY_PLAN_FIXTURES)) {
    it.todo(`12a: the resolver, on the seeded state, deep-equals ${name}`);
  }
  it.todo(
    '12a: workouts are in the athlete’s program order, then each week’s order; labels never sort',
  );
  it.todo('12a: PREVIOUS counts only rows logged in a program');
  it.todo('12a: PREVIOUS, when an item was logged twice on that day, is the row logged first');
  it.todo('12a: PREVIOUS is null on a day that is not writable');
  it.todo('12a: a closed day omits the items and the workouts with no logged row');
  it.todo('12a: progress counts prescribed rows plus extra logged ones, not removed items’ rows');
  it.todo('12a: look-ahead goes forward only while the athlete is on a program the next day');
});

describe('RowWrite, RowUntick, RowRetick and RowResult: owed by their consumers', () => {
  it.todo('11b: a twin session and a twin row are refused; a replay returns the first');
  it.todo('11b: a replay after Clear day answers own_hidden and writes nothing');
  it.todo('11b: a row of every tracking type passes the entries shape CHECK');
  it.todo('11b: an empty ✓ on a prescribed row logs the prescription; a non-number is bad_value');
  it.todo('11b: program_changed, not_scheduled and closed_day are typed refusals');
  it.todo('11b: a restore after a re-✓ answers slot_taken');
});

describe('RowAmend: owed by its consumers', () => {
  it.todo('11c: amend a row of each tracking type');
  it.todo('11c: a non-number is refused; a day before yesterday is refused');
});

describe('prescribedText: owed by its consumers', () => {
  it.todo('11b: a logged row’s prescribed_snapshot is prescribedText of its prescription');
  it.todo('12a: the day page’s prescribedText is the same renderer’s output');
  it.todo('14: the export writes template rows of each type through the renderer');
  it.todo('14: a comma in a workout name round-trips through the export');
});
