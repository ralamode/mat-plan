import {
  DEFAULT_TRACKING_TYPE,
  hasStarted,
  MONDAY_FIRST,
  QUANTITY_SLOT,
  quantityText,
  slotQuantity,
  TRACKING_TYPE,
  type DayItem,
  type DayPlan,
  type DayRow,
  type DayWorkout,
  type ProgramList,
  type ProgramListEntry,
  type ProgramView,
  type RowValues,
  type TrackingType,
  type Weekday,
} from '@mat-plan/shared';
import { everyTypeOnce, familyProgram, programsList } from '@mat-plan/shared/program/fixtures';
import { describe, expect, expectTypeOf, it } from 'vitest';

/**
 * The contract's shared helpers and types, as a lane imports them: from `@mat-plan/shared`, the
 * root barrel a `'use client'` component may read (FAM-1 contract change C1).
 *
 * ⚠️ **The type assertions are proven by `pnpm typecheck`, not by the test run.** `packages/shared`
 * has no typecheck project of its own, so a type test beside the shapes would check nothing; this
 * file is in `apps/web`, whose `tsc` reads it. The values are checked at run time as usual.
 */

describe('the day’s row types', () => {
  it('names each part of a DayPlan as the type DayPlan holds there', () => {
    expectTypeOf<DayWorkout>().toEqualTypeOf<DayPlan['workouts'][number]>();
    expectTypeOf<DayItem>().toEqualTypeOf<DayPlan['workouts'][number]['items'][number]>();
    expectTypeOf<DayRow>().toEqualTypeOf<
      DayPlan['workouts'][number]['items'][number]['rows'][number]
    >();

    // And a fixture's parts are those types, with nothing cast.
    const workout: DayWorkout = everyTypeOnce.workouts[0];
    const item: DayItem = workout.items[0];
    const row: DayRow | undefined = item.rows[0];
    expect(workout.items).toContain(item);
    expect(row === undefined || item.rows.includes(row)).toBe(true);
  });
});

describe('the builder’s named types and constants', () => {
  it('names one entry of the Programs list as the type the list holds', () => {
    expectTypeOf<ProgramListEntry>().toEqualTypeOf<ProgramList[number]>();
    // A screen handed one program takes an entry of the fixture as it is.
    const program: ProgramListEntry = programsList[0];
    expect(programsList).toContain(program);
    expect(Object.keys(program).sort()).toEqual(['athletes', 'name', 'programPublicId']);
  });

  it('types the default tracking type as a tracking type, not a string', () => {
    expectTypeOf(DEFAULT_TRACKING_TYPE).toEqualTypeOf<TrackingType>();
    expect(DEFAULT_TRACKING_TYPE).toBe(TRACKING_TYPE.weight_reps);
  });
});

describe('the helpers, with the arguments the lanes pass', () => {
  it('slotQuantity takes a day’s item and hands back the list’s own quantity type', () => {
    const item: DayItem = everyTypeOnce.workouts[0].items[0];
    const logged: RowValues = {
      quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'min', value: 5 }],
    };
    // A row's values keep their type (`value: number`); a prescription's keep theirs (`| null`).
    expectTypeOf(slotQuantity(item, logged.quantities)).toEqualTypeOf<
      RowValues['quantities'][number] | null
    >();
    expectTypeOf(slotQuantity(item, item.target.quantities)).toEqualTypeOf<
      DayItem['target']['quantities'][number] | null
    >();
    expect(slotQuantity({ trackingType: TRACKING_TYPE.duration }, logged.quantities)).toBe(
      logged.quantities[0],
    );
  });

  it('quantityText takes a logged quantity’s value and unit', () => {
    const logged: RowValues['quantities'][number] = {
      slot: QUANTITY_SLOT.primary,
      unit: 'sec',
      value: 30,
    };
    expectTypeOf(quantityText(logged.value, logged.unit)).toEqualTypeOf<string>();
    expect(quantityText(logged.value, logged.unit)).toBe('30 s');
  });

  it('hasStarted takes a program page’s athlete and its today', () => {
    const view: ProgramView = familyProgram;
    expectTypeOf(hasStarted).toBeCallableWith(view.athletes[0], view.today);
    expect(view.athletes.every((athlete) => hasStarted(athlete, view.today))).toBe(true);
  });

  it('MONDAY_FIRST is weekdays, so each one indexes a program’s week', () => {
    expectTypeOf(MONDAY_FIRST).toEqualTypeOf<readonly Weekday[]>();
    const view: ProgramView = familyProgram;
    expect(MONDAY_FIRST.map((weekday) => view.week[weekday].length)).toHaveLength(7);
  });
});
