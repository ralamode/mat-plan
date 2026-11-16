import { familyProgram } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { addToDays, daysWith, moveSlot, removeSlot, setLabel } from './week-draft';

const week = familyProgram.week;
const [first, second] = familyProgram.workouts;

describe('the week editor’s changes (pure)', () => {
  it('a workout goes on the chosen days that lack it, at the end; days that have it are skipped', () => {
    const have = daysWith(week, second!.workoutPublicId);
    const lacking = ([1, 2, 3, 4, 5, 6, 0] as const).filter((d) => !have.has(d));
    const chosen = [lacking[0]!, [...have][0]!];
    const result = addToDays(
      week,
      { workoutPublicId: second!.workoutPublicId, label: 'Evening' },
      chosen,
    );
    expect(result.added).toEqual([lacking[0]]);
    expect(result.skipped).toEqual([[...have][0]]);
    expect(result.week[lacking[0]!].at(-1)).toEqual({
      workoutPublicId: second!.workoutPublicId,
      label: 'Evening',
    });
    expect(result.week[[...have][0]!]).toBe(week[[...have][0]!]);
  });

  it('a move swaps neighbours within the day, and does nothing at an end', () => {
    const saturday = week[6];
    const moved = moveSlot(week, 6, 1, 'up');
    expect(moved[6].map((s) => s.workoutPublicId)).toEqual([
      saturday[1]!.workoutPublicId,
      saturday[0]!.workoutPublicId,
      ...saturday.slice(2).map((s) => s.workoutPublicId),
    ]);
    expect(moveSlot(week, 6, 0, 'up')).toBe(week);
    expect(moveSlot(week, 6, saturday.length - 1, 'down')).toBe(week);
  });

  it('a remove takes the slot off; a label is set, and blank is none', () => {
    expect(removeSlot(week, 6, 0)[6]).toEqual(week[6].slice(1));
    expect(setLabel(week, 6, 0, 'Dawn')[6][0]!.label).toBe('Dawn');
    expect(setLabel(week, 6, 0, '')[6][0]!.label).toBeNull();
    expect(first).toBeTruthy();
  });
});
