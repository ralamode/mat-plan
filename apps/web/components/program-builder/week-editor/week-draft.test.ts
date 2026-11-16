import { MONDAY_FIRST } from '@mat-plan/shared';
import { familyProgram } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { addToDays, daysWith, insertSlot, moveSlot, removeSlot, setLabel } from './week-draft';

const week = familyProgram.week;
const second = familyProgram.workouts[1];

describe('the week editor’s changes (pure)', () => {
  it('a workout goes on the chosen days that lack it, at the end; days that have it are skipped', () => {
    const have = daysWith(week, second!.workoutPublicId);
    const lacking = MONDAY_FIRST.filter((d) => !have.has(d));
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
    expect(removeSlot(week, 6, 1)[6]).toEqual([week[6][0], week[6][2]]);
    expect(setLabel(week, 6, 0, 'Dawn')[6][0]!.label).toBe('Dawn');
    expect(setLabel(week, 6, 0, '')[6][0]!.label).toBeNull();
  });

  it('Undo’s insert goes back at its place, or the end of a shorter day, and never twice', () => {
    const slot = week[6][1]!;
    const without = removeSlot(week, 6, 1);
    expect(insertSlot(without, 6, 1, slot)[6]).toEqual(week[6]);
    expect(insertSlot(removeSlot(without, 6, 1), 6, 2, slot)[6]).toEqual([week[6][0], slot]);
    expect(insertSlot(week, 6, 0, slot)).toBe(week);
  });
});
