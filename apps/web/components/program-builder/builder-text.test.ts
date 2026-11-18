import {
  emptyWeek,
  MAX_DAY_SLOTS,
  MAX_PROGRAM_WORKOUTS,
  MONDAY_FIRST,
  PROGRAM_REFUSAL,
  PROGRAM_REFUSALS,
  WEEKDAYS,
} from '@mat-plan/shared';
import { familyProgram, familyProgramAfterTakeOff } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import {
  athleteHint,
  cleanName,
  copiedFromText,
  copyRefusal,
  dayFullLabel,
  dayFullText,
  dayIsFull,
  nameRefusal,
  programFullText,
  programIsFull,
  supersetLetterOf,
  supersetSpoken,
  takenOffText,
  usedByText,
  weekdayName,
  weekRefusal,
  workoutSummary,
} from './builder-text';

describe('the program builder’s sentences (the prototype’s wording)', () => {
  it('"Used by": none, one, both, all n', () => {
    expect(usedByText([])).toBe('No one is on this yet. Changes affect no one.');
    expect(usedByText(['Adult One'])).toBe('Used by Adult One. Changes apply to Adult One.');
    expect(usedByText(['Athlete One', 'Athlete Two'])).toBe(
      'Used by Athlete One and Athlete Two. Changes apply to both.',
    );
    expect(usedByText(['A', 'B', 'C'])).toMatch(/Changes apply to all 3\.$/);
  });

  it('an athlete’s line: since or starts, last day, also on', () => {
    const [one] = familyProgram.athletes;
    expect(athleteHint(one!, familyProgram.today)).toBe('since Mon, Nov 9 · also on Stretching');
    const two = familyProgramAfterTakeOff.athletes[1]!;
    expect(athleteHint(two, familyProgramAfterTakeOff.today)).toBe(
      'since Mon, Nov 9 · last day Sat, Nov 14',
    );
    expect(athleteHint({ ...two, since: '2026-11-15', lastDay: null }, '2026-11-14')).toBe(
      'starts Sun, Nov 15',
    );
  });

  it('Take off says what happens, for someone started and someone not', () => {
    expect(takenOffText('Athlete Two', 'Family program', true)).toBe(
      'Athlete Two comes off Family program after today. Days already logged keep what they had.',
    );
    expect(takenOffText('Athlete Two', 'Family program', false)).toBe(
      'Athlete Two won’t start Family program.',
    );
  });

  it('a workout’s summary, and where a copy came from', () => {
    expect(workoutSummary(6, [1, 2, 3, 4, 5, 6])).toBe(
      '6 items · Used Mon, Tue, Wed, Thu, Fri, Sat',
    );
    expect(workoutSummary(1, [])).toBe('1 item · Not on any day yet');
    expect(copiedFromText({ programName: 'Family program', on: '2026-11-14' })).toBe(
      'Copied from Family program · Sat, Nov 14',
    );
  });

  it('the week runs Monday to Sunday', () => {
    expect(MONDAY_FIRST.map((day) => weekdayName(day))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
  });

  it('each refusal has its own words (pinned once, here)', () => {
    expect(PROGRAM_REFUSALS.map((reason) => [reason, nameRefusal(reason)])).toEqual([
      ['name_taken', 'A program with this name already exists.'],
      ['invalid', 'Give the program a name.'],
      ['not_found', 'This program no longer exists.'],
      ['once_per_day', 'Couldn’t save. Try again.'],
      ['limit_reached', 'Couldn’t save. Try again.'],
      ['retry', 'Couldn’t save. Try again.'],
    ]);
  });

  it('a name is sent the way it is stored: whitespace runs as one space, trimmed', () => {
    expect(cleanName('  Summer\t block\n ')).toBe('Summer block');
  });

  it('a superset’s letter is the label without its number, past Z too', () => {
    expect(supersetLetterOf('A2')).toBe('A');
    expect(supersetLetterOf('AA12')).toBe('AA');
    expect(supersetSpoken('AA2')).toBe('Superset AA, item 2');
  });
});

describe('the program page’s caps (FAM-1 7b-i): "is full … holds at most N", from the consts', () => {
  const [SUNDAY, MONDAY, TUESDAY, WEDNESDAY] = WEEKDAYS;
  it('a program stops at MAX_PROGRAM_WORKOUTS, a day at MAX_DAY_SLOTS, not one before', () => {
    expect(programIsFull(MAX_PROGRAM_WORKOUTS - 1)).toBe(false);
    expect(programIsFull(MAX_PROGRAM_WORKOUTS)).toBe(true);
    expect(dayIsFull(MAX_DAY_SLOTS - 1)).toBe(false);
    expect(dayIsFull(MAX_DAY_SLOTS)).toBe(true);
  });

  it('each stop’s words', () => {
    expect(programFullText).toBe(
      'This program is full: a program holds at most 50 workouts. To add one, change a workout that’s not on any day, or create another program.',
    );
    expect(dayFullText(TUESDAY)).toBe('Tuesday is full: a day holds at most 30 workouts.');
    expect(dayFullLabel(TUESDAY)).toBe('Tuesday, full');
  });

  it('a week refused limit_reached names the days at the cap in the week it sent, Monday first', () => {
    const slots = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ workoutPublicId: `w${i}`, label: null }));
    const week = {
      ...emptyWeek(),
      [SUNDAY]: slots(MAX_DAY_SLOTS + 1),
      [TUESDAY]: slots(MAX_DAY_SLOTS + 1),
      [MONDAY]: slots(MAX_DAY_SLOTS),
      [WEDNESDAY]: slots(MAX_DAY_SLOTS - 1),
    };
    expect(weekRefusal(PROGRAM_REFUSAL.limit_reached, week)).toBe(
      'Monday, Tuesday, and Sunday are full: a day holds at most 30 workouts. Nothing was added; the week is back as it was.',
    );
    expect(
      weekRefusal(PROGRAM_REFUSAL.limit_reached, { ...week, [SUNDAY]: [], [MONDAY]: [] }),
    ).toMatch(/^Tuesday is full: /);
  });

  it('a copy refused limit_reached names both causes, unless only the program can be full', () => {
    const { limit_reached } = PROGRAM_REFUSAL;
    const into = (target: string) =>
      `${target} can’t take another workout, or one of those days is full (50 workouts in a program, 30 on a day).`;
    const to = (sameProgram: boolean, dayPicked: boolean) =>
      copyRefusal(limit_reached, { sameProgram, dayPicked, target: 'Stretching' });
    // Into another program it is named, never "This program" (the page the parent is on).
    expect(to(false, false)).toBe(into('Stretching'));
    expect(to(false, true)).toBe(into('Stretching'));
    expect(to(true, true)).toBe(into('This program'));
    expect(to(true, false)).toBe(
      'This program is full: a program holds at most 50 workouts. Nothing was copied. Create another program to copy it into.',
    );
  });
});
