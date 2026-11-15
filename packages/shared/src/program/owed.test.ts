import { describe, it } from 'vitest';

import { DAY_PLAN_FIXTURES } from './fixtures';

/**
 * The tests each consumer of the contract still owes (FAM-1 plan §4: "`it.todo` lists of the tests
 * each consumer still owes").
 *
 * One section per shape. Each line is tagged with the step that owns it, and comes from that step's
 * Tests column in plan §5 or from §8's behaviour table. **A lane turns its lines into real tests in
 * its own files and deletes them here in the same PR**, so what is left in this file is what the
 * milestone has not proved yet.
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
  it.todo('8: the editor renders heavy-a-draft and new-workout-empty');
  it.todo('8: the name counter stops at WORKOUT_NAME_MAX; the unit select offers the type’s units');
  it.todo('8b: a superset left with one item dissolves on Save and drops its rest');
  it.todo('9: items picked together are added in the order they were picked');
  it.todo('9: a new item is made with its type; an existing name selects that item');
  it.todo('7a: saveWorkout and newItem pass the inherited action matrix');
  it.todo('9: the picker renders picker-options (step 0b’s fixture), and its no-match state');
  it.todo('7b: build a program on a phone (e2e); the builder’s pages pass the a11y scan');
});

describe('WeekDraft: owed by its consumers', () => {
  it.todo('6b: a workout runs at most once on a weekday (once_per_day)');
  it.todo('6b: a removed slot frees its place');
  it.todo('10: adding to several days skips the days that have it, and says so');
  it.todo('7a: saveWeek passes the inherited action matrix');
});

describe('ProgramList and ProgramView: owed by their consumers', () => {
  it.todo('6c: the program-list query deep-equals programs-list');
  it.todo('6c: the program-view query deep-equals family-program');
  it.todo('6c: the seeded fixture programs equal the contract fixtures');
  it.todo('8a: the Programs list renders programs-list, and its empty state');
  it.todo(
    '8a: the program page renders family-program, new-program-empty, adult-program-with-copy',
  );
  it.todo('10b: "Copied from" shows the frozen program name');
  it.todo('6a: a replayed createProgram (same clientId) adds nothing; a taken name is name_taken');
  it.todo('6a: renameProgram refuses an empty name and a name another program holds');
  it.todo('7a: createProgram and renameProgram pass the inherited action matrix');
  it.todo('8a: Rename shows the name counter up to PROGRAM_NAME_MAX');
});

describe('AssignDraft, TakeOff and ProgramOrder: owed by their consumers', () => {
  it.todo('6c: put on writes all seven weekday rows, on template blocks only');
  it.todo('6d: take off ends the program after today; logged days keep their rows');
  it.todo('6d: two open assignments at one place in an athlete’s order are refused');
  it.todo('10b: Start is disabled until someone is picked');
  it.todo('13d: the Program order dialog lists today-two-programs’ programs in order');
  it.todo('15: a parent puts a test athlete on a program and they log it (e2e)');
  it.todo('15c: two programs on one day, reordered (e2e)');
});

describe('CopyDraft: owed by its consumers', () => {
  it.todo('6a: a replayed copy with the same clientId adds nothing');
  it.todo('10b: a copy’s name stays within WORKOUT_NAME_MAX');
  it.todo('7a: copyWorkout passes the inherited action matrix');
});

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
  it.todo('12b: the DAL sets writable, future and canGoForward');
  it.todo('13: each DayPlan fixture renders on the preview route');
  it.todo('13: typed numbers survive ticking another row');
  it.todo('13b: set rows, PREVIOUS and Add set, per set');
  it.todo('13b: heavy-a-supersets renders linked supersets with their rest');
  it.todo('13b: superset letters are ordinal: group b reads A1, A2 when group a is gone');
  it.todo('13b: yesterday-edited-after-logging renders the kept, extra, removed and edited rows');
  it.todo('13b: future-preview renders read-only cards');
  it.todo('13d: no-program, not-on-a-program-that-day and the rest-day notices');
  it.todo('12c: an older day and a future day are read-only (e2e)');
  it.todo('0c: the normalizer round-trips a fixture');
});

describe('RowWrite, RowUntick, RowRetick and RowResult: owed by their consumers', () => {
  it.todo('11b: a twin session and a twin row are refused; a replay returns the first');
  it.todo('11b: a replay after Clear day answers own_hidden and writes nothing');
  it.todo('11b: a row of every tracking type passes the entries shape CHECK');
  it.todo('11b: an empty ✓ on a prescribed row logs the prescription; a non-number is bad_value');
  it.todo('11b: program_changed, not_scheduled and closed_day are typed refusals');
  it.todo('11b: a restore after a re-✓ answers slot_taken');
  it.todo('12b: logRow, untickRow and retickRow pass the inherited action matrix');
  it.todo('12b: row writes are held to the row rate limit, not the mutation limit');
  it.todo('12b: a crafted un-tick or re-tick on an older or a future day answers closed_day');
  it.todo('12b: an entry that is not this athlete’s on that day answers not_found');
  it.todo('12c: ✓, un-tick and re-tick on Check, Duration and Count (e2e)');
  it.todo('13: a ✓ that fails un-ticks, keeps what was typed, and says it could not save');
  it.todo('13: un-tick leaves no tomb; re-tick restores the row, on today and yesterday');
  it.todo('13: an empty ✓ shows the prescription’s numbers (target) as the logged values');
  it.todo('13: a non-number is refused by the field, which takes focus');
});

describe('RowAmend: owed by its consumers', () => {
  it.todo('11c: amend a row of each tracking type');
  it.todo('11c: a non-number is refused; a day before yesterday is refused');
  it.todo('12d: amendRow passes the inherited action matrix');
  it.todo('12d: a weight × reps set and a superset on real data; change a number (e2e)');
  it.todo('13b: Change keeps the old number if the new one is blank or not a number');
});

describe('ProgramActions and DayActions: owed by their consumers', () => {
  it.todo('7a: no formData or headers reach a captured event');
  it.todo('8a, 10b: a screen hides the control of a member that is undefined');
  it.todo('15: putOn and takeOff join ProgramActions, and their controls appear');
  it.todo('15c: reorderPrograms joins DayActions, and the Program order control appears');
  it.todo('15c: a reorder that is not a permutation of currentPrograms answers invalid');
  it.todo('every screen step: focus stays on the control after an action');
  it.todo('every screen step: a dialog holds focus and returns it; targets are 44px at 360px');
});

describe('the constants: owed by their consumers', () => {
  it.todo('3: the movements.tracking_type CHECK is pinned to TRACKING_TYPES');
  it.todo('3: (primary, count) and a ceiling for count exist, so a Count in count is storable');
  it.todo('4a-i, 4b: the name and label columns are bounded by the same constants');
});

describe('prescribedText: owed by its consumers', () => {
  it.todo('11b: a logged row’s prescribed_snapshot is prescribedText of its prescription');
  it.todo('12a: the day page’s prescribedText is the same renderer’s output');
  it.todo('14: the export writes template rows of each type through the renderer');
  it.todo('14: a comma in a workout name round-trips through the export');
  it.todo('3: a distance in mi renders once mi is a unit');
});
