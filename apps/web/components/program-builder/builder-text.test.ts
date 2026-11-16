import { PROGRAM_REFUSALS } from '@mat-plan/shared';
import { familyProgram, familyProgramAfterTakeOff } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import {
  athleteHint,
  copiedFromText,
  MONDAY_FIRST,
  nameRefusal,
  takenOffText,
  usedByText,
  weekdayName,
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

  it('every refusal has words', () => {
    for (const reason of PROGRAM_REFUSALS) expect(nameRefusal(reason)).toMatch(/\.$/);
    expect(nameRefusal('name_taken')).toBe('A program with this name already exists.');
  });
});
