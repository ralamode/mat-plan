import {
  DEFAULT_TRACKING_TYPE,
  emptyWeek,
  hasStarted,
  isPlainDecimal,
  MONDAY_FIRST,
  PLAIN_DECIMAL,
  programsByStay,
  QUANTITY_SLOT,
  quantityText,
  showsOnlyLogged,
  slotQuantity,
  supersetLabels,
  TRACKING_TYPE,
  type DayItem,
  type DayPlan,
  type DayRow,
  type DayWorkout,
  type ProgramList,
  type ProgramListEntry,
  type ProgramView,
  type RowValues,
  type Superset,
  type TrackingType,
  type WeekDraft,
  type Weekday,
} from '@mat-plan/shared';
import {
  everyTypeOnce,
  familyProgram,
  heavyADraft,
  heavyASupersets,
  programsList,
  programView,
  todayThreeProgramsOneEnding,
  DAY_PLAN_FIXTURE_SOURCES,
} from '@mat-plan/shared/program/fixtures';
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

  it('hands a week editor an empty week as the type a WeekDraft holds', () => {
    expectTypeOf(emptyWeek()).toEqualTypeOf<WeekDraft['days']>();
    // And a week of something else, where a caller names its slot.
    expectTypeOf(emptyWeek<{ wid: string }>()).toEqualTypeOf<
      Record<Weekday, Array<{ wid: string }>>
    >();
    const days: WeekDraft['days'] = emptyWeek();
    expect(Object.keys(days)).toHaveLength(7);
  });

  it('gets a program page from a fixture world, with a week saveWeek takes (C27)', () => {
    const { world } = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'];
    expectTypeOf(programView).returns.toEqualTypeOf<ProgramView>();
    const days: WeekDraft['days'] = programView(world, 'p1').week;
    expect(Object.keys(days)).toHaveLength(7);
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

  it('supersetLabels takes the items each screen has, and answers a label or null for each', () => {
    // The day page's items, the editor's draft items, and the editor's own card shape (a superset
    // and a rest) all fit: it reads `superset` and nothing else.
    const card: { superset: Superset; restAfter: string | null }[] = heavyADraft.items.map(
      ({ superset, restAfter }) => ({ superset, restAfter }),
    );
    expectTypeOf(supersetLabels(card)).toEqualTypeOf<(string | null)[]>();
    expectTypeOf(supersetLabels).toBeCallableWith(heavyADraft.items);
    expectTypeOf(supersetLabels).toBeCallableWith(heavyASupersets.workouts[0].items);
    expect(supersetLabels(card)).toEqual(supersetLabels(heavyADraft.items));
  });

  it('isPlainDecimal takes a field’s text; PLAIN_DECIMAL is the pattern itself', () => {
    expectTypeOf(isPlainDecimal).toEqualTypeOf<(text: string) => boolean>();
    expectTypeOf(PLAIN_DECIMAL).toEqualTypeOf<RegExp>();
    const typed = ' 5.5 '.trim();
    expect(isPlainDecimal(typed)).toBe(PLAIN_DECIMAL.test(typed));
  });

  it('showsOnlyLogged takes a day plan, or just its two flags (C23)', () => {
    expectTypeOf(showsOnlyLogged).toBeCallableWith(everyTypeOnce);
    expectTypeOf(showsOnlyLogged).toBeCallableWith({ writable: false, future: false });
    expectTypeOf(showsOnlyLogged(everyTypeOnce)).toEqualTypeOf<boolean>();
    expect(showsOnlyLogged(everyTypeOnce)).toBe(false);
  });

  it('programsByStay takes a plan’s current programs and hands back their own type', () => {
    type Current = DayPlan['currentPrograms'][number];
    const plan: DayPlan = todayThreeProgramsOneEnding;
    expectTypeOf(programsByStay(plan.currentPrograms)).toEqualTypeOf<{
      staying: Current[];
      ending: Current[];
    }>();
    // A caller's own rows keep their fields: the Program order dialog's, say, with a place.
    const rows = plan.currentPrograms.map((program, place) => ({ ...program, place }));
    expectTypeOf(programsByStay(rows).staying).toEqualTypeOf<typeof rows>();
    expectTypeOf(programsByStay(rows).ending).items.toHaveProperty('place').toEqualTypeOf<number>();
    // A frozen list is taken as it is.
    expectTypeOf(programsByStay).toBeCallableWith(Object.freeze([...plan.currentPrograms]));
    // A list that cannot carry the flag is refused: `programs` is the day's, not the current ones.
    // @ts-expect-error `DayPlan.programs` has no `endsToday`, so every one would read as staying.
    programsByStay(plan.programs);
    const { staying, ending } = programsByStay(plan.currentPrograms);
    expect([staying.length, ending.length]).toEqual([2, 1]);
    expect(rows.find((row) => row.endsToday)?.place).toBe(2);
  });

  it('MONDAY_FIRST is weekdays, so each one indexes a program’s week', () => {
    expectTypeOf(MONDAY_FIRST).toEqualTypeOf<readonly Weekday[]>();
    const view: ProgramView = familyProgram;
    expect(MONDAY_FIRST.map((weekday) => view.week[weekday].length)).toHaveLength(7);
  });
});
