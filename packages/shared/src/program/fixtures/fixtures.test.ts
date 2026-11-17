import { describe, expect, it } from 'vitest';

import { uuidSchema } from '../../id';
import { TRACKING_TYPES } from '../../movements';
import { QUANTITY_SLOT } from '../../quantity-slots';
import { dayPlanSchema, showsOnlyLogged, type DayPlan } from '../day-shapes';
import { hasSetRows } from '../pieces';
import { prescribedText } from '../prescribed-text';
import {
  programListSchema,
  programViewSchema,
  weekDraftSchema,
  workoutDraftSchema,
} from '../program-shapes';
import { dayPlan, edit, programOf, workoutDraft, workoutOf } from './build';
import {
  adultProgramWithCopy,
  closedDayLoggedOnly,
  archivedAthleteNothingLogged,
  archivedAthleteToday,
  closedDayNothingLogged,
  closedDayProgramSinceLeft,
  DAY_PLAN_FIXTURE_SOURCES,
  DAY_PLAN_FIXTURES,
  everyTypeOnce,
  familyProgram,
  familyProgramAfterTakeOff,
  FIXTURE_ITEM_KEYS,
  FIXTURE_ITEMS,
  FIXTURE_SWITCH_DAY,
  FIXTURE_TODAY,
  fixtureIds,
  futurePreview,
  heavyADraft,
  heavyASupersets,
  newProgramEmpty,
  newWorkoutEmpty,
  noProgram,
  notOnAProgramThatDay,
  PROGRAM_LIST_FIXTURES,
  PROGRAM_VIEW_FIXTURES,
  programsList,
  programView,
  sundayRestStretchOnly,
  todayStretchingFirst,
  todayTwoPrograms,
  tomorrowReadOnly,
  WORKOUT_DRAFT_FIXTURES,
  workoutLeftTheWeek,
  yesterdayEditedAfterLogging,
  yesterdayHalfDone,
} from './index';

/**
 * The contract's named fixtures (FAM-1 plan §4, §8).
 *
 * Two things are held here. **Every fixture parses by its own schema and comes back unchanged**, so
 * a fixture that drifts from its shape fails the suite. And each fixture is checked against the
 * state of the accepted prototype it stands for: the literals below are read off
 * `docs/prototypes/beta-0/index.html` (v12), on the assertion side, once.
 */

const workout = (plan: DayPlan, name: string) => {
  const found = plan.workouts.find((w) => w.name === name);
  if (!found) throw new Error(`no workout ${name}`);
  return found;
};
const item = (plan: DayPlan, workoutName: string, itemName: string) => {
  const found = workout(plan, workoutName).items.find((i) => i.name === itemName);
  if (!found) throw new Error(`no item ${itemName} in ${workoutName}`);
  return found;
};
const outline = (plan: DayPlan) => plan.workouts.map((w) => [w.label, w.name]);
const loggedSets = (plan: DayPlan, workoutName: string, itemName: string) =>
  item(plan, workoutName, itemName)
    .rows.filter((row) => row.logged !== null)
    .map((row) => row.set);
const lb = (value: number) => ({ slot: QUANTITY_SLOT.primary, unit: 'lb', value });
const min = (value: number) => ({ slot: QUANTITY_SLOT.primary, unit: 'min', value });
const sec = (value: number) => ({ slot: QUANTITY_SLOT.primary, unit: 'sec', value });

describe('every fixture round-trips through its own schema', () => {
  it.each(Object.entries(DAY_PLAN_FIXTURES))('DayPlan %s', (_name, fixture) => {
    expect(dayPlanSchema.parse(fixture)).toEqual(fixture);
  });
  it.each(Object.entries(WORKOUT_DRAFT_FIXTURES))('WorkoutDraft %s', (_name, fixture) => {
    expect(workoutDraftSchema.parse(fixture)).toEqual(fixture);
  });
  it.each(Object.entries(PROGRAM_LIST_FIXTURES))('ProgramList %s', (_name, fixture) => {
    expect(programListSchema.parse(fixture)).toEqual(fixture);
  });
  it.each(Object.entries(PROGRAM_VIEW_FIXTURES))('ProgramView %s', (_name, fixture) => {
    expect(programViewSchema.parse(fixture)).toEqual(fixture);
  });

  it('carries the plan’s fixture names, and no others', () => {
    // FAM-1 plan §4, "Named fixtures". `picker-options` is step 0b's: it uses the web's option DTO.
    expect(Object.keys(DAY_PLAN_FIXTURES)).toEqual([
      'today-two-programs',
      'yesterday-half-done',
      'sunday-rest-stretch-only',
      'no-program',
      'not-on-a-program-that-day',
      'today-stretching-first',
      'tomorrow-read-only',
      'heavy-a-supersets',
      'yesterday-edited-after-logging',
      'workout-left-the-week',
      'closed-day-logged-only',
      // C17, not a prototype state: a program since left, and a workout renamed after logging.
      'closed-day-program-since-left',
      // C18, not a prototype state: an archived athlete's today.
      'archived-athlete-today',
      // C22, not prototype states: a closed day with nothing logged, and an archived athlete with
      // nothing logged and one other athlete to go to.
      'closed-day-nothing-logged',
      'archived-athlete-nothing-logged',
      'future-preview',
      'every-type-once',
    ]);
    expect(Object.keys(WORKOUT_DRAFT_FIXTURES)).toEqual(['heavy-a-draft', 'new-workout-empty']);
    expect(Object.keys(PROGRAM_LIST_FIXTURES)).toEqual(['programs-list']);
    expect(Object.keys(PROGRAM_VIEW_FIXTURES)).toEqual([
      'family-program',
      'family-program-after-take-off',
      'new-program-empty',
      'adult-program-with-copy',
    ]);
  });

  it('is frozen, so one test cannot change what the next one reads', () => {
    expect(Object.isFrozen(todayTwoPrograms)).toBe(true);
    expect(Object.isFrozen(todayTwoPrograms.workouts[0]?.items[0]?.rows)).toBe(true);
    expect(Object.isFrozen(familyProgram.week[1])).toBe(true);
    expect(Object.isFrozen(heavyADraft.items[0]?.quantities)).toBe(true);
  });

  it('names only the prototype’s made-up people', () => {
    expect(todayTwoPrograms.athletes.map((a) => a.name)).toEqual([
      'Athlete One',
      'Athlete Two',
      'Adult One',
    ]);
    expect(noProgram.athletes.map((a) => a.name)).toEqual(['Test Athlete']);
  });
});

describe('the item catalog', () => {
  it('lists every prototype item once, in the prototype’s order', () => {
    expect(FIXTURE_ITEMS.map((item) => item.itemPublicId)).toEqual(
      FIXTURE_ITEM_KEYS.map((key) => fixtureIds.item(key)),
    );
    expect(Object.isFrozen(FIXTURE_ITEMS[0])).toBe(true);
  });

  it('gives an item the id, name and type the other fixtures give it', () => {
    for (const item of heavyADraft.items) {
      expect(FIXTURE_ITEMS).toContainEqual({
        itemPublicId: item.itemPublicId,
        name: item.itemName,
        trackingType: item.trackingType,
      });
    }
  });
});

describe('every id in every fixture is a well-formed public id', () => {
  /**
   * The data lanes compare a query's result with a fixture through a normalizer that labels only
   * the ids `uuidSchema` accepts. A hand-written id that fails it (a version nibble of 0, say) would
   * be left as it is on one side, and no comparison could pass.
   */
  const ID_KEY = /(Id|Ids)$/;
  function idsIn(value: unknown, key = ''): string[] {
    if (Array.isArray(value)) return value.flatMap((member) => idsIn(member, key));
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([k, member]) => idsIn(member, k));
    }
    return typeof value === 'string' && ID_KEY.test(key) ? [value] : [];
  }
  const fixtures = {
    ...DAY_PLAN_FIXTURES,
    ...WORKOUT_DRAFT_FIXTURES,
    ...PROGRAM_LIST_FIXTURES,
    ...PROGRAM_VIEW_FIXTURES,
    'the item catalog': FIXTURE_ITEMS,
  };

  it.each(Object.entries(fixtures))('%s', (_name, fixture) => {
    const ids = idsIn(fixture);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !uuidSchema.safeParse(id).success)).toEqual([]);
  });

  it('finds the ids it claims to check, nested ones included', () => {
    // 3 on the draft, then a prescription client id and an item id on each of Heavy A's five items.
    expect(idsIn(heavyADraft)).toHaveLength(3 + 5 * 2);
    expect(idsIn(todayTwoPrograms)).toContain(fixtureIds.entry(64));
    expect(idsIn({ entryPublicId: 'e64', name: 'not an id' })).toEqual(['e64']);
  });

  it('gives each kind of thing its own ids', () => {
    const made = [
      fixtureIds.athlete('a1'),
      fixtureIds.program('p1'),
      fixtureIds.workout('w1'),
      fixtureIds.workoutClient('w1'),
      fixtureIds.item('grip'),
      fixtureIds.prescription('w1', 'grip'),
      fixtureIds.prescriptionClient('w1', 'grip'),
      fixtureIds.entry(1),
    ];
    expect(new Set(made).size).toBe(made.length);
    expect(made.filter((id) => !uuidSchema.safeParse(id).success)).toEqual([]);
  });
});

describe('the dates the fixtures stand on', () => {
  it('is the prototype’s calendar', () => {
    expect(FIXTURE_TODAY).toBe('2026-11-14');
    expect(FIXTURE_SWITCH_DAY).toBe('2026-11-09');
  });
});

describe('today-two-programs: Athlete One · today, on two programs', () => {
  const plan = todayTwoPrograms;

  it('is a writable Saturday on the Family program, then Stretching', () => {
    expect(plan).toMatchObject({
      profilePublicId: fixtureIds.athlete('a1'),
      day: FIXTURE_TODAY,
      writable: true,
      future: false,
      onProgram: 'yes',
      canGoForward: true,
    });
    expect(plan.programs).toEqual([
      { programPublicId: fixtureIds.program('p1'), name: 'Family program', order: 0 },
      { programPublicId: fixtureIds.program('p2'), name: 'Stretching', order: 1 },
    ]);
  });

  it('says what today is, and lists the athlete’s current programs in their order', () => {
    expect(plan.today).toBe(FIXTURE_TODAY);
    expect(plan.currentPrograms).toEqual([
      { programPublicId: fixtureIds.program('p1'), name: 'Family program' },
      { programPublicId: fixtureIds.program('p2'), name: 'Stretching' },
    ]);
  });

  it('carries each item’s prescribed numbers beside its text', () => {
    const target = (workoutName: string, itemName: string) =>
      item(plan, workoutName, itemName).target;
    expect(target('Heavy B', 'Push press')).toEqual({ reps: 6, quantities: [lb(20)] });
    expect(target('Heavy B', 'Inverted row')).toEqual({ reps: 8, quantities: [] });
    expect(target('Morning habits', 'Neck bridge')).toEqual({ reps: null, quantities: [sec(30)] });
    expect(target('Morning habits', 'Vest weight')).toEqual({ reps: null, quantities: [lb(10)] });
    expect(target('Morning habits', 'Grip: rice bucket')).toEqual({ reps: null, quantities: [] });
    expect(target('Conditioning', 'Sprints')).toEqual({
      reps: null,
      quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'yd', value: 40 }],
    });
  });

  it('counts each workout’s progress: rows logged, of rows prescribed', () => {
    expect(plan.workouts.map((w) => [w.name, w.progress])).toEqual([
      ['Morning habits', { done: 2, total: 10 }],
      ['Heavy B', { done: 0, total: 14 }],
      ['Conditioning', { done: 0, total: 10 }],
      ['Evening stretch', { done: 0, total: 3 }],
    ]);
  });

  it('lists the workouts by program order, then the week’s order; a label never sorts', () => {
    // Two "Evening" slots: the Family program's comes first because that program does.
    expect(outline(plan)).toEqual([
      ['Morning', 'Morning habits'],
      ['After lunch', 'Heavy B'],
      ['Evening', 'Conditioning'],
      ['Evening', 'Evening stretch'],
    ]);
    expect(plan.workouts.every((w) => w.scheduled)).toBe(true);
  });

  it('has the first two morning habits ticked and nothing else', () => {
    const logged = plan.workouts.flatMap((w) =>
      w.items.filter((i) => i.rows.some((row) => row.logged)).map((i) => i.name),
    );
    expect(logged).toEqual(['Grip: rice bucket', 'Watch one technique clip']);
    expect(item(plan, 'Morning habits', 'Grip: rice bucket').rows).toEqual([
      {
        set: 1,
        previous: { quantities: [] },
        logged: {
          entryPublicId: fixtureIds.entry(64),
          values: { quantities: [] },
          prescribedText: '',
        },
      },
    ]);
  });

  it('shows each prescription as the prototype writes it', () => {
    const texts = (name: string) => workout(plan, name).items.map((i) => i.prescribedText);
    expect(texts('Morning habits')).toEqual(['', '', '3 × 30 s', '5 min', '3 × 15', '10 lb']);
    expect(texts('Heavy B')).toEqual(['4 × 6 @ 20 lb', '4 × 8', '3 × 8 @ 15 lb', '3 × 45 s']);
    expect(texts('Conditioning')).toEqual(['10 min', '6 × 40 yd', '3 × 10']);
    expect(texts('Evening stretch')).toEqual(['3 min', '3 min', '4 min']);
  });

  it('gives a set-based item a row per prescribed set, and the others one row', () => {
    for (const w of plan.workouts) {
      for (const i of w.items) {
        if (!hasSetRows(i.trackingType)) expect(i.rows).toHaveLength(1);
      }
    }
    expect(item(plan, 'Conditioning', 'Sprints').rows.map((row) => row.set)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(item(plan, 'Heavy B', 'Push press').rows).toHaveLength(4);
  });

  it('carries PREVIOUS per set, from the last day the item was logged', () => {
    // Heavy B was last logged on Wednesday Nov 11; the fourth push press fell a rep short.
    expect(item(plan, 'Heavy B', 'Push press').rows.map((row) => row.previous)).toEqual([
      { reps: 6, quantities: [lb(20)] },
      { reps: 6, quantities: [lb(20)] },
      { reps: 6, quantities: [lb(20)] },
      { reps: 5, quantities: [lb(20)] },
    ]);
    expect(item(plan, 'Heavy B', 'Wall sit').rows.map((row) => row.previous)).toEqual([
      { quantities: [sec(45)] },
      { quantities: [sec(40)] },
      { quantities: [sec(40)] },
    ]);
    // Conditioning has never been logged.
    expect(item(plan, 'Conditioning', 'Jump rope').rows[0]?.previous).toBeNull();
  });

  it('takes PREVIOUS from the item, whichever workout logged it', () => {
    // Splits stretch is in both Morning habits (5 min) and Evening stretch (4 min), and yesterday
    // both were logged. An item's history is one history: both rows show the row logged first.
    expect(item(plan, 'Morning habits', 'Splits stretch').rows[0]?.previous).toEqual({
      quantities: [min(5)],
    });
    expect(item(plan, 'Evening stretch', 'Splits stretch').rows[0]?.previous).toEqual({
      quantities: [min(5)],
    });
  });

  it('names the unit each item logs in', () => {
    expect(workout(plan, 'Morning habits').items.map((i) => i.unit)).toEqual([
      null,
      null,
      'sec',
      'min',
      null,
      'lb',
    ]);
    expect(item(plan, 'Conditioning', 'Sprints').unit).toBe('yd');
  });

  it('carries the author’s instructions, and none where there are none', () => {
    expect(item(plan, 'Morning habits', 'Neck bridge').notes).toBe(
      'Front and back. Stop if anything pinches.',
    );
    expect(item(plan, 'Morning habits', 'Splits stretch').notes).toBeNull();
    expect(workout(plan, 'Heavy B').description).toBe(
      'A1 then A2, rest, repeat. About 35 minutes.',
    );
  });
});

describe('yesterday-half-done: Athlete One · yesterday, half done', () => {
  const plan = yesterdayHalfDone;

  it('is a writable Friday: Morning habits, Heavy A, Evening stretch', () => {
    expect(plan).toMatchObject({ day: '2026-11-13', writable: true, future: false });
    expect(outline(plan)).toEqual([
      ['Morning', 'Morning habits'],
      ['After school', 'Heavy A'],
      ['Evening', 'Evening stretch'],
    ]);
  });

  it('has two of four sets logged on Heavy A’s first superset, and nothing after it', () => {
    expect(loggedSets(plan, 'Heavy A', 'DB bench press')).toEqual([1, 2]);
    expect(loggedSets(plan, 'Heavy A', 'Pull-up')).toEqual([1, 2]);
    expect(loggedSets(plan, 'Heavy A', 'Goblet squat')).toEqual([]);
    expect(item(plan, 'Heavy A', 'DB bench press').rows.map((row) => row.set)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('keeps what was logged beside what was prescribed', () => {
    // 27.5 lb was lifted against a prescription of 25: the row holds both.
    expect(item(plan, 'Heavy A', 'DB bench press').rows[0]).toEqual({
      set: 1,
      previous: { reps: 8, quantities: [lb(25)] },
      logged: {
        entryPublicId: fixtureIds.entry(59),
        values: { reps: 8, quantities: [lb(27.5)] },
        prescribedText: '4 × 8 @ 25 lb',
      },
    });
    expect(item(plan, 'Heavy A', 'DB bench press').rows[3]).toEqual({
      set: 4,
      previous: { reps: 7, quantities: [lb(25)] },
      logged: null,
    });
  });

  it('counts Heavy A as 4 of 17, and the other two as done', () => {
    expect(plan.workouts.map((w) => w.progress)).toEqual([
      { done: 10, total: 10 },
      { done: 4, total: 17 },
      { done: 3, total: 3 },
    ]);
  });

  it('has Morning habits and the stretch fully logged', () => {
    expect(loggedSets(plan, 'Morning habits', 'Push-ups')).toEqual([1, 2, 3]);
    expect(item(plan, 'Morning habits', 'Push-ups').rows[2]?.logged?.values).toEqual({
      reps: 12,
      quantities: [],
    });
    expect(item(plan, 'Evening stretch', 'Splits stretch').rows[0]?.logged?.values).toEqual({
      quantities: [min(4)],
    });
  });
});

describe('heavy-a-supersets: Heavy A, untouched', () => {
  const plan = heavyASupersets;

  it('is Athlete Two’s Friday, on the Family program alone', () => {
    expect(plan.profilePublicId).toBe(fixtureIds.athlete('a2'));
    expect(plan.programs.map((p) => p.name)).toEqual(['Family program']);
    expect(outline(plan)).toEqual([
      ['Morning', 'Morning habits'],
      ['After school', 'Heavy A'],
    ]);
  });

  it('links two supersets in order, each with its rest, and leaves the last item on its own', () => {
    const heavyA = workout(plan, 'Heavy A');
    expect(heavyA.items.map((i) => [i.name, i.superset])).toEqual([
      ['DB bench press', { group: 'a', order: 1 }],
      ['Pull-up', { group: 'a', order: 2 }],
      ['Goblet squat', { group: 'b', order: 1 }],
      ['Sprawls', { group: 'b', order: 2 }],
      ['Hollow-body hold', null],
    ]);
    expect(heavyA.restAfter).toEqual({ a: '90 s after each round', b: '60 s after each round' });
  });

  it('shows every prescribed row, none logged, with no PREVIOUS for a workout never done', () => {
    const rows = workout(plan, 'Heavy A').items.flatMap((i) => i.rows);
    expect(rows).toHaveLength(4 + 4 + 3 + 3 + 3);
    expect(rows.every((row) => row.logged === null && row.previous === null)).toBe(true);
  });
});

describe('yesterday-edited-after-logging: the program changed after the day was logged', () => {
  const plan = yesterdayEditedAfterLogging;

  it('keeps a logged row against the prescription it was logged against', () => {
    const bench = item(plan, 'Heavy A', 'DB bench press');
    expect(bench.prescribedText).toBe('3 × 8 @ 30 lb');
    expect(bench.rows.map((row) => row.logged?.prescribedText ?? null)).toEqual([
      '4 × 8 @ 25 lb',
      '4 × 8 @ 25 lb',
      null,
    ]);
  });

  it('shows the edit on an unlogged row: the bench now has three sets', () => {
    expect(item(plan, 'Heavy A', 'DB bench press').rows.map((row) => row.set)).toEqual([1, 2, 3]);
  });

  it('still shows a logged set beyond a reduced count', () => {
    const pushUps = item(plan, 'Morning habits', 'Push-ups');
    expect(pushUps.prescribedText).toBe('2 × 15');
    expect(loggedSets(plan, 'Morning habits', 'Push-ups')).toEqual([1, 2, 3]);
    expect(pushUps.rows[2]?.logged?.prescribedText).toBe('3 × 15');
  });

  it('shows a removed item’s logged rows, built from the entries alone', () => {
    const pullUp = item(plan, 'Heavy A', 'Pull-up');
    expect(pullUp).toEqual({
      prescriptionPublicId: null,
      itemPublicId: fixtureIds.item('pullup'),
      name: 'Pull-up',
      trackingType: 'reps',
      prescribedText: '4 × 5',
      target: { reps: null, quantities: [] },
      // Its instructions ("Full hang at the bottom.") never reappear.
      notes: null,
      unit: null,
      superset: null,
      rows: [
        {
          set: 1,
          previous: null,
          logged: {
            entryPublicId: fixtureIds.entry(61),
            values: { reps: 5, quantities: [] },
            prescribedText: '4 × 5',
          },
        },
        {
          set: 2,
          previous: null,
          logged: {
            entryPublicId: fixtureIds.entry(62),
            values: { reps: 5, quantities: [] },
            prescribedText: '4 × 5',
          },
        },
      ],
    });
    // After the live items.
    expect(workout(plan, 'Heavy A').items.at(-1)).toBe(pullUp);
  });

  it('counts the extra logged set, and leaves the removed item’s rows out of the count', () => {
    // Push-ups: two prescribed, three logged, so three of three. Heavy A: 3 + 3 + 3 + 3 rows now.
    expect(workout(plan, 'Morning habits').progress).toEqual({ done: 10, total: 10 });
    expect(workout(plan, 'Heavy A').progress).toEqual({ done: 2, total: 12 });
  });

  it('dissolves the superset the removed item left behind, and its rest', () => {
    const heavyA = workout(plan, 'Heavy A');
    expect(heavyA.items.map((i) => [i.name, i.superset?.group ?? null])).toEqual([
      ['DB bench press', null],
      ['Goblet squat', 'b'],
      ['Sprawls', 'b'],
      ['Hollow-body hold', null],
      ['Pull-up', null],
    ]);
    expect(heavyA.restAfter).toEqual({ b: '60 s after each round' });
  });
});

describe('workout-left-the-week: logged, then taken off the day', () => {
  const plan = workoutLeftTheWeek;

  it('still shows Heavy A, after the scheduled workouts, marked as off the week', () => {
    expect(plan.workouts.map((w) => [w.name, w.label, w.scheduled])).toEqual([
      ['Morning habits', 'Morning', true],
      ['Evening stretch', 'Evening', true],
      // No label once the slot is gone (maintainer, 2026-11-17); the prototype shows 'After school'.
      ['Heavy A', null, false],
    ]);
  });

  it('shows only its logged rows, on a day that is otherwise writable', () => {
    expect(plan.writable).toBe(true);
    const heavyA = workout(plan, 'Heavy A');
    expect(heavyA.items.map((i) => [i.name, i.rows.map((row) => row.set)])).toEqual([
      ['DB bench press', [1, 2]],
      ['Pull-up', [1, 2]],
    ]);
    expect(heavyA.items.flatMap((i) => i.rows).every((row) => row.logged !== null)).toBe(true);
  });

  it('still counts the whole workout, and carries no rest for the superset that is not showing', () => {
    const heavyA = workout(plan, 'Heavy A');
    expect(heavyA.progress).toEqual({ done: 4, total: 17 });
    // Goblet squat and Sprawls (group b) have no logged row, so they and their rest are absent.
    expect(heavyA.items.map((i) => i.superset?.group)).toEqual(['a', 'a']);
    expect(heavyA.restAfter).toEqual({ a: '90 s after each round' });
  });
});

describe('closed-day-logged-only: Athlete One · Nov 11', () => {
  const plan = closedDayLoggedOnly;

  it('is read-only, three days back, before Stretching started', () => {
    expect(plan).toMatchObject({ day: '2026-11-11', writable: false, future: false });
    expect(plan.programs.map((p) => p.name)).toEqual(['Family program']);
    expect(outline(plan)).toEqual([
      ['Morning', 'Morning habits'],
      ['After school', 'Heavy B'],
    ]);
  });

  it('shows logged rows only: the two morning habits not done are absent', () => {
    expect(workout(plan, 'Morning habits').items.map((i) => i.name)).toEqual([
      'Grip: rice bucket',
      'Watch one technique clip',
      'Neck bridge',
      'Splits stretch',
    ]);
    const rows = plan.workouts.flatMap((w) => w.items.flatMap((i) => i.rows));
    expect(rows).toHaveLength(6 + 14);
    expect(rows.every((row) => row.logged !== null)).toBe(true);
  });

  it('says how much of each workout was done, though it lists only what was', () => {
    expect(plan.workouts.map((w) => [w.name, w.progress])).toEqual([
      ['Morning habits', { done: 6, total: 10 }],
      ['Heavy B', { done: 14, total: 14 }],
    ]);
  });

  it('carries no PREVIOUS: the day is not writable', () => {
    // Neck bridge was logged two days earlier, so on a writable day these rows would have one.
    const rows = plan.workouts.flatMap((w) => w.items.flatMap((i) => i.rows));
    expect(rows.every((row) => row.previous === null)).toBe(true);
    expect(item(yesterdayHalfDone, 'Morning habits', 'Neck bridge').rows[0]?.previous).toEqual({
      quantities: [sec(30)],
    });
  });
});

describe('closed-day-program-since-left: the order of a day’s programs, and a renamed workout (C17)', () => {
  const plan = closedDayProgramSinceLeft;
  const source = DAY_PLAN_FIXTURE_SOURCES['closed-day-program-since-left'];

  it('is a closed Tuesday on which Athlete One was on two programs', () => {
    expect(plan).toMatchObject({ day: '2026-11-10', writable: false, future: false });
    expect(plan.onProgram).toBe('yes');
  });

  it('lists the current program first and the one since left after it, with no order', () => {
    // The assignment list holds them the other way round, so this is the rule and not the array.
    expect(source.world.assign.a1?.map((a) => a.prog)).toEqual(['p3', 'p1', 'p2']);
    expect(plan.programs.map((p) => [p.name, p.order])).toEqual([
      ['Family program', 0],
      ['Adult One’s program', null],
    ]);
    // Still a current program, though it had not started on this day.
    expect(plan.currentPrograms.map((p) => p.name)).toEqual(['Family program', 'Stretching']);
  });

  it('lists the workouts in that same order, whichever was logged first', () => {
    const [first, second] = source.world.entries.filter(
      (e) => e.ath === 'a1' && e.day === plan.day,
    );
    expect([first?.prog, second?.prog]).toEqual(['p3', 'p1']);
    expect(plan.workouts.map((w) => w.programPublicId)).toEqual(
      plan.programs.map((p) => p.programPublicId),
    );
  });

  it('shows a workout under the name it had when it was logged', () => {
    const live = source.world.programs.flatMap((p) => p.workouts).find((w) => w.wid === 'w1');
    expect(live?.name).toBe('Morning routine');
    expect(
      source.before?.programs.flatMap((p) => p.workouts).find((w) => w.wid === 'w1')?.name,
    ).toBe('Morning habits');
    expect(plan.workouts.map((w) => w.name)).toEqual(['Morning habits', 'Run and core']);
  });

  it('🔴 keeps a program current when the athlete came off it and is on it again', () => {
    // Current is a property of the program, not of an assignment row. On a day of the earlier
    // stretch, the program has its order and is not sorted after the others.
    const world = {
      ...source.world,
      assign: {
        ...source.world.assign,
        a1: [...(source.world.assign.a1 ?? []), { prog: 'p3', from: '2026-11-14' }],
      },
    };
    const day = dayPlan(world, 'a1', plan.day);
    expect(day.currentPrograms.map((p) => p.name)).toEqual([
      'Family program',
      'Stretching',
      'Adult One’s program',
    ]);
    expect(day.programs.map((p) => [p.name, p.order])).toEqual([
      ['Family program', 0],
      ['Adult One’s program', 2],
    ]);
  });

  it('🔴 heads a logged-only item with what its first-logged row was logged against', () => {
    // Plank is edited after the day was logged: the closed day still reads as it was logged.
    const logged = source.world.entries.find((e) => e.n === 951)!;
    const asLogged = source.world.stamps[logged.n]!.text;
    const edited = edit(source.world, (world) => {
      for (const it of workoutOf(programOf(world, 'p3'), 'w6').items) {
        if (it.iid === 'plank') it.sets = 2;
      }
    });
    const plank = (p: DayPlan) => item(p, 'Run and core', 'Side plank');
    expect(plank(dayPlan(edited, 'a1', plan.day)).prescribedText).toBe(asLogged);
    // And the live text is something else now, so that was not the live text passing by.
    const live = workoutDraft(edited, 'p3', 'w6').items.find((it) => it.itemName === 'Side plank')!;
    expect(prescribedText(live)).not.toBe(asLogged);

    // Two rows logged against different texts: the FIRST LOGGED one heads the item, which here is
    // set 2 (the lower `n`), not the lower set number and not the later row.
    const earlier = { ...logged, n: 940, set: 2 };
    const two = dayPlan(
      {
        ...edited,
        entries: [...edited.entries, earlier],
        stamps: {
          ...edited.stamps,
          [earlier.n]: { ...edited.stamps[logged.n]!, text: 'as first logged' },
        },
      },
      'a1',
      plan.day,
    );
    expect(plank(two).rows.map((r) => r.set)).toEqual([1, 2]);
    expect(plank(two).prescribedText).toBe('as first logged');
    expect(plank(two).rows.map((r) => r.logged?.prescribedText)).toEqual([
      asLogged,
      'as first logged',
    ]);
  });

  it('shows the live name on a day that is still writable', () => {
    // The same rename, seen on yesterday: a scheduled workout on a writable day is the live one.
    const yesterday = dayPlan(source.world, 'a1', '2026-11-13');
    expect(yesterday.writable).toBe(true);
    expect(yesterday.workouts[0]?.name).toBe('Morning routine');
  });
});

describe('archived-athlete-today: an archived athlete’s day is never writable (C18)', () => {
  const plan = archivedAthleteToday;

  it('is today, and reads like a closed day', () => {
    expect(plan).toMatchObject({ day: FIXTURE_TODAY, today: FIXTURE_TODAY });
    expect(plan).toMatchObject({ writable: false, future: false, onProgram: 'yes' });
  });

  it('shows only what was logged: the two morning habits, of the day’s four workouts', () => {
    expect(todayTwoPrograms.workouts.map((w) => w.name)).toEqual([
      'Morning habits',
      'Heavy B',
      'Conditioning',
      'Evening stretch',
    ]);
    expect(plan.workouts.map((w) => w.name)).toEqual(['Morning habits']);
    const rows = plan.workouts.flatMap((w) => w.items.flatMap((i) => i.rows));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.logged !== null && row.previous === null)).toBe(true);
    // The whole workout is still counted, as on any closed day.
    expect(plan.workouts[0]?.progress).toEqual(
      workout(todayTwoPrograms, 'Morning habits').progress,
    );
  });

  it('is the same world as today-two-programs, but for the archive', () => {
    const { world, before } = DAY_PLAN_FIXTURE_SOURCES['archived-athlete-today'];
    expect(before).toBe(DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world);
    expect(world.athletes.filter((a) => a.archived).map((a) => a.id)).toEqual(['a1']);
    expect(before?.athletes.some((a) => a.archived)).toBe(false);
    expect({ ...world, athletes: before?.athletes }).toEqual(before);
  });

  it('is not in the switcher’s list, which holds the athletes who are not archived', () => {
    const mine = fixtureIds.athlete('a1');
    expect(plan.profilePublicId).toBe(mine);
    expect(plan.athletes.map((a) => a.profilePublicId)).not.toContain(mine);
    expect(plan.athletes).toEqual(
      todayTwoPrograms.athletes.filter((a) => a.profilePublicId !== mine),
    );
    expect(
      plan.athletes.every((a) => Object.keys(a).sort().join() === 'name,profilePublicId'),
    ).toBe(true);
  });

  it('leaves another athlete of the household writable', () => {
    const { world } = DAY_PLAN_FIXTURE_SOURCES['archived-athlete-today'];
    expect(dayPlan(world, 'a2', FIXTURE_TODAY).writable).toBe(true);
  });

  it('still lets them look ahead: a future day is as it is for anyone', () => {
    const { world } = DAY_PLAN_FIXTURE_SOURCES['archived-athlete-today'];
    const mine = fixtureIds.athlete('a1');
    expect(dayPlan(world, 'a1', '2026-11-16')).toEqual({
      ...futurePreview,
      athletes: futurePreview.athletes.filter((a) => a.profilePublicId !== mine),
    });
  });
});

describe('closed-day-nothing-logged: a closed day on a program, with nothing logged (C22)', () => {
  const plan = closedDayNothingLogged;

  it('is a closed Tuesday on the Family program', () => {
    expect(plan).toMatchObject({ day: '2026-11-10', writable: false, future: false });
    expect(plan.onProgram).toBe('yes');
    expect(plan.programs.map((p) => p.name)).toEqual(['Family program']);
  });

  it('lists no workouts: a closed day shows only what was logged', () => {
    expect(plan.workouts).toEqual([]);
    // The week does hold workouts that day; nobody logged them.
    const { world } = DAY_PLAN_FIXTURE_SOURCES['closed-day-nothing-logged'];
    expect(world.programs.find((p) => p.id === 'p1')?.week[2].length).toBeGreaterThan(0);
    expect(world.entries.some((e) => e.ath === 'a1' && e.day === plan.day)).toBe(false);
  });
});

describe('archived-athlete-nothing-logged: one other athlete to go to (C22)', () => {
  const plan = archivedAthleteNothingLogged;

  it('is Athlete Two’s today, read like a closed day, with nothing logged', () => {
    expect(plan.profilePublicId).toBe(fixtureIds.athlete('a2'));
    expect(plan).toMatchObject({ day: FIXTURE_TODAY, writable: false, future: false });
    expect(plan.onProgram).toBe('yes');
    expect(plan.workouts).toEqual([]);
  });

  it('has a switcher’s list of one, who is not the athlete on the page', () => {
    expect(plan.athletes.map((a) => a.profilePublicId)).toEqual([fixtureIds.athlete('a1')]);
    const { world, before } = DAY_PLAN_FIXTURE_SOURCES['archived-athlete-nothing-logged'];
    expect(world.athletes.filter((a) => a.archived).map((a) => a.id)).toEqual(['a2', 'a3']);
    expect(before).toBe(DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world);
  });
});

describe('showsOnlyLogged: one rule for a day that shows only what was logged (C23)', () => {
  it('is a day that is neither writable nor a future day', () => {
    expect(showsOnlyLogged({ writable: false, future: false })).toBe(true);
    expect(showsOnlyLogged({ writable: true, future: false })).toBe(false);
    expect(showsOnlyLogged({ writable: false, future: true })).toBe(false);
  });

  it('names exactly the fixtures of a closed day or an archived athlete', () => {
    const names = Object.entries(DAY_PLAN_FIXTURES)
      .filter(([, plan]) => showsOnlyLogged(plan))
      .map(([name]) => name);
    expect(names).toEqual([
      'not-on-a-program-that-day',
      'closed-day-logged-only',
      'closed-day-program-since-left',
      'archived-athlete-today',
      'closed-day-nothing-logged',
      'archived-athlete-nothing-logged',
    ]);
  });

  it('holds in every fixture: there, every workout and item shown has a logged row, and no PREVIOUS', () => {
    for (const [name, plan] of Object.entries(DAY_PLAN_FIXTURES)) {
      if (!showsOnlyLogged(plan)) continue;
      for (const w of plan.workouts) {
        expect(w.items.length, `${name}: ${w.name}`).toBeGreaterThan(0);
        for (const it of w.items) {
          expect(it.rows.length, `${name}: ${it.name}`).toBeGreaterThan(0);
          expect(it.rows.every((row) => row.logged !== null && row.previous === null)).toBe(true);
        }
      }
    }
  });

  it('is what the builder asks: the same world lists an unlogged workout on a writable day only', () => {
    const { world } = DAY_PLAN_FIXTURE_SOURCES['closed-day-nothing-logged'];
    // Tuesday the 10th is closed and unlogged: nothing. Today is writable: every scheduled workout.
    expect(dayPlan(world, 'a1', '2026-11-10').workouts).toEqual([]);
    expect(dayPlan(world, 'a1', FIXTURE_TODAY).workouts.length).toBeGreaterThan(0);
    // A future day lists what is coming, though nothing is logged there either.
    expect(dayPlan(world, 'a1', '2026-11-16').workouts.length).toBeGreaterThan(0);
  });

  it('🔴 keeps a workout with no items on a future day: the filter is the function, both halves', () => {
    // A workout nobody has put an item in yet, on Mondays. With no items it has nothing "logged",
    // so only the day's kind decides whether it is listed: yes on a future or a writable day, no
    // on a closed one. A filter that forgot the future half would drop it from the look-ahead.
    const { world } = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'];
    const withEmpty = edit(world, (draft) => {
      const family = programOf(draft, 'p1');
      family.workouts.push({ wid: 'w950', name: 'Empty so far', desc: '', rests: {}, items: [] });
      family.week[1].push({ label: '', wid: 'w950' });
    });
    const names = (day: string) => dayPlan(withEmpty, 'a1', day).workouts.map((w) => w.name);
    // Monday the 16th is a future day; Monday the 9th is closed.
    expect(showsOnlyLogged(dayPlan(withEmpty, 'a1', '2026-11-16'))).toBe(false);
    expect(names('2026-11-16')).toContain('Empty so far');
    expect(showsOnlyLogged(dayPlan(withEmpty, 'a1', '2026-11-09'))).toBe(true);
    expect(names('2026-11-09')).not.toContain('Empty so far');
  });
});

describe('where a DayPlan fixture comes from (C17)', () => {
  const names = Object.keys(DAY_PLAN_FIXTURES) as (keyof typeof DAY_PLAN_FIXTURES)[];

  it('has a source for every fixture, and no other', () => {
    expect(Object.keys(DAY_PLAN_FIXTURE_SOURCES)).toEqual(names);
  });

  it.each(names)('%s is its source, built', (name) => {
    const { world, athlete, day } = DAY_PLAN_FIXTURE_SOURCES[name];
    expect(dayPlan(world, athlete, day)).toEqual(DAY_PLAN_FIXTURES[name]);
    expect(DAY_PLAN_FIXTURES[name]).toMatchObject({ day, today: world.today });
  });

  it('carries the world before the edit for exactly the fixtures that describe one', () => {
    expect(names.filter((name) => DAY_PLAN_FIXTURE_SOURCES[name].before !== null)).toEqual([
      'today-stretching-first',
      'yesterday-edited-after-logging',
      'workout-left-the-week',
      'closed-day-program-since-left',
      'archived-athlete-today',
      'archived-athlete-nothing-logged',
    ]);
  });

  it.each(names)('%s: an edit leaves what was logged alone', (name) => {
    const { world, before } = DAY_PLAN_FIXTURE_SOURCES[name];
    if (before === null) return;
    expect(world.entries).toEqual(before.entries);
    expect(world.stamps).toEqual(before.stamps);
    expect(world.today).toBe(before.today);
  });

  it('stamps every logged row a fixture shows, so a seed has its frozen text and values', () => {
    for (const name of names) {
      const { world, athlete, day } = DAY_PLAN_FIXTURE_SOURCES[name];
      for (const entry of world.entries.filter((e) => e.ath === athlete && e.day === day)) {
        expect(world.stamps[entry.n], `${name}: e${entry.n}`).toBeDefined();
      }
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DAY_PLAN_FIXTURE_SOURCES)).toBe(true);
    expect(Object.isFrozen(DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world.entries)).toBe(
      true,
    );
  });
});

describe('the rows of a set-based item (C17: the shape’s rule, in the builder)', () => {
  /** Yesterday's world with Athlete One's bench logged at these set numbers only. */
  const benchLoggedAt = (sets: number[]) => {
    const { world } = DAY_PLAN_FIXTURE_SOURCES['yesterday-half-done'];
    const bench = world.entries.find(
      (e) => e.ath === 'a1' && e.day === '2026-11-13' && e.iid === 'dbbench' && e.set === 1,
    )!;
    const stamp = world.stamps[bench.n]!;
    const extra = sets.map((set, i) => ({ ...bench, n: 990 + i, set }));
    return dayPlan(
      {
        ...world,
        entries: [
          ...world.entries.filter((e) => !(e.day === '2026-11-13' && e.iid === 'dbbench')),
          ...extra,
        ],
        stamps: { ...world.stamps, ...Object.fromEntries(extra.map((e) => [e.n, stamp])) },
      },
      'a1',
      '2026-11-13',
    );
  };
  const bench = (plan: DayPlan) => item(plan, 'Heavy A', 'DB bench press');

  it('lists every prescribed set, and a logged set beyond them', () => {
    // Four prescribed; a fifth and a sixth logged.
    expect(bench(benchLoggedAt([1, 5, 6])).rows.map((r) => [r.set, r.logged !== null])).toEqual([
      [1, true],
      [2, false],
      [3, false],
      [4, false],
      [5, true],
      [6, true],
    ]);
  });

  it('gives a type with one row exactly that row', () => {
    const { world } = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'];
    const grip = world.entries.find(
      (e) => e.ath === 'a1' && e.day === world.today && e.iid === 'grip',
    )!;
    const stray = { ...grip, n: 995, set: 2 };
    const plan = dayPlan(
      {
        ...world,
        entries: [...world.entries, stray],
        stamps: { ...world.stamps, [stray.n]: world.stamps[grip.n]! },
      },
      'a1',
      world.today,
    );
    expect(item(plan, 'Morning habits', 'Grip: rice bucket').rows.map((r) => r.set)).toEqual([1]);
  });

  it('🔴 does not list a gap below a logged extra set: an added set is a row only while logged', () => {
    // Set 5 was added and un-ticked; set 6 is logged. Set 5 is not a row, and is not counted.
    const plan = benchLoggedAt([1, 6]);
    expect(bench(plan).rows.map((r) => r.set)).toEqual([1, 2, 3, 4, 6]);
    const before = workout(benchLoggedAt([1]), 'Heavy A').progress;
    expect(workout(plan, 'Heavy A').progress).toEqual({
      done: before.done + 1,
      total: before.total + 1,
    });
  });
});

describe('future-preview: Athlete One · look ahead to Monday', () => {
  const plan = futurePreview;

  it('is a future day that can go further forward, and is not writable', () => {
    expect(plan).toMatchObject({
      day: '2026-11-16',
      writable: false,
      future: true,
      canGoForward: true,
    });
  });

  it('shows what is coming up, with no rows to tick', () => {
    expect(outline(plan)).toEqual([
      ['Morning', 'Morning habits'],
      ['After school', 'Heavy A'],
      ['Evening', 'Evening stretch'],
    ]);
    expect(workout(plan, 'Heavy A').items.map((i) => i.prescribedText)).toEqual([
      '4 × 8 @ 25 lb',
      '4 × 5',
      '3 × 10 @ 30 lb',
      '3 × 10',
      '3 × 20 s',
    ]);
    expect(plan.workouts.flatMap((w) => w.items.flatMap((i) => i.rows))).toEqual([]);
  });

  it('still says what each item prescribes and how many rows the workout has', () => {
    expect(item(plan, 'Heavy A', 'DB bench press').target).toEqual({
      reps: 8,
      quantities: [lb(25)],
    });
    expect(plan.workouts.map((w) => w.progress)).toEqual([
      { done: 0, total: 10 },
      { done: 0, total: 17 },
      { done: 0, total: 3 },
    ]);
  });
});

describe('tomorrow-read-only: the nearest future day', () => {
  const plan = tomorrowReadOnly;

  it('is today plus one, and read-only like every future day', () => {
    expect(plan).toMatchObject({
      day: '2026-11-15',
      today: FIXTURE_TODAY,
      writable: false,
      future: true,
      onProgram: 'yes',
    });
  });

  it('is a Sunday: only the stretch is coming up, with no rows', () => {
    expect(outline(plan)).toEqual([['Evening', 'Evening stretch']]);
    expect(plan.workouts.flatMap((w) => w.items.flatMap((i) => i.rows))).toEqual([]);
    expect(plan.programs.map((p) => p.name)).toEqual(['Family program', 'Stretching']);
  });
});

describe('today-stretching-first: the same day, the programs in the other order', () => {
  const plan = todayStretchingFirst;

  it('lists Stretching first in the athlete’s order', () => {
    expect(plan.currentPrograms.map((p) => p.name)).toEqual(['Stretching', 'Family program']);
    expect(plan.programs).toEqual([
      { programPublicId: fixtureIds.program('p2'), name: 'Stretching', order: 0 },
      { programPublicId: fixtureIds.program('p1'), name: 'Family program', order: 1 },
    ]);
  });

  it('puts the evening stretch ahead of the workout labelled Morning', () => {
    // Ordering by a label's time of day would put Morning first. Order is the athlete's.
    expect(outline(plan)).toEqual([
      ['Evening', 'Evening stretch'],
      ['Morning', 'Morning habits'],
      ['After lunch', 'Heavy B'],
      ['Evening', 'Conditioning'],
    ]);
    expect(outline(plan)).not.toEqual(outline(todayTwoPrograms));
  });

  it('is otherwise the same day: the same workouts, rows and history', () => {
    const byName = (p: DayPlan) => [...p.workouts].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName(plan)).toEqual(byName(todayTwoPrograms));
  });
});

describe('sunday-rest-stretch-only: a rest day on one program', () => {
  const plan = sundayRestStretchOnly;

  it('is today, a Sunday, on both programs, with only the stretch scheduled', () => {
    expect(plan).toMatchObject({ day: '2026-11-15', writable: true, future: false });
    expect(plan.programs.map((p) => p.name)).toEqual(['Family program', 'Stretching']);
    expect(outline(plan)).toEqual([['Evening', 'Evening stretch']]);
    expect(workout(plan, 'Evening stretch').programPublicId).toBe(fixtureIds.program('p2'));
  });
});

describe('the two days with no program', () => {
  it('no-program: a new athlete, on nothing yet, who cannot look ahead', () => {
    expect(noProgram).toMatchObject({
      profilePublicId: fixtureIds.athlete('a9'),
      day: FIXTURE_TODAY,
      writable: true,
      onProgram: 'never',
      canGoForward: false,
      programs: [],
      workouts: [],
    });
  });

  it('not-on-a-program-that-day: the day before the Family program started', () => {
    expect(notOnAProgramThatDay).toMatchObject({
      profilePublicId: fixtureIds.athlete('a1'),
      day: '2026-11-08',
      writable: false,
      future: false,
      onProgram: 'not-this-day',
      canGoForward: true,
      programs: [],
      workouts: [],
    });
  });
});

describe('every-type-once', () => {
  const [only] = everyTypeOnce.workouts;

  it('holds one item of each tracking type, in the types’ order', () => {
    expect(everyTypeOnce.workouts).toHaveLength(1);
    expect(only?.items.map((i) => i.trackingType)).toEqual([...TRACKING_TYPES]);
    expect(only?.items.map((i) => i.prescribedText)).toEqual([
      '',
      '10 lb',
      '3 × 15',
      '4 × 8 @ 25 lb',
      '5 min',
      '3 × 30 s',
      '6 × 40 yd',
    ]);
  });

  it('has each item’s first row logged as prescribed, and the later sets open', () => {
    expect(only?.items.map((i) => i.rows[0]?.logged?.values)).toEqual([
      { quantities: [] },
      { quantities: [lb(10)] },
      { reps: 15, quantities: [] },
      { reps: 8, quantities: [lb(25)] },
      { quantities: [min(5)] },
      { quantities: [sec(30)] },
      { quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'yd', value: 40 }] },
    ]);
    expect(only?.items.map((i) => i.rows.filter((row) => row.logged === null).length)).toEqual([
      0, 0, 2, 3, 0, 2, 5,
    ]);
  });
});

describe('heavy-a-draft and new-workout-empty', () => {
  it('heavy-a-draft is Heavy A as the editor loads it', () => {
    expect(heavyADraft).toMatchObject({
      programPublicId: fixtureIds.program('p1'),
      workoutPublicId: fixtureIds.workout('w2'),
      name: 'Heavy A',
      description: 'A1 then A2, rest, repeat. Then B. About 40 minutes.',
    });
    expect(
      heavyADraft.items.map((i) => [
        i.itemName,
        i.trackingType,
        i.sets,
        i.targetReps,
        i.quantities,
      ]),
    ).toEqual([
      ['DB bench press', 'weight_reps', 4, '8', [lb(25)]],
      ['Pull-up', 'reps', 4, '5', []],
      ['Goblet squat', 'weight_reps', 3, '10', [lb(30)]],
      ['Sprawls', 'reps', 3, '10', []],
      ['Hollow-body hold', 'time_sets', 3, null, [sec(20)]],
    ]);
  });

  it('puts a superset’s rest on its last item only', () => {
    expect(heavyADraft.items.map((i) => [i.superset?.group ?? null, i.restAfter])).toEqual([
      ['a', null],
      ['a', '90 s after each round'],
      ['b', null],
      ['b', '60 s after each round'],
      [null, null],
    ]);
  });

  it('names each item’s prescription and item, the same ones the day page shows', () => {
    expect(heavyADraft.items[0]).toMatchObject({
      prescriptionClientId: fixtureIds.prescriptionClient('w2', 'dbbench'),
      itemPublicId: fixtureIds.item('dbbench'),
      notes: 'Feet flat. Two seconds down.',
    });
    // The draft and the day agree on what Heavy A prescribes, through the one renderer.
    expect(heavyADraft.items.map(prescribedText)).toEqual(
      workout(futurePreview, 'Heavy A').items.map((i) => i.prescribedText),
    );
    expect(new Set(heavyADraft.items.map((i) => i.prescriptionClientId)).size).toBe(5);
  });

  it('new-workout-empty is a workout nobody has named or saved', () => {
    expect(newWorkoutEmpty).toEqual({
      programPublicId: fixtureIds.program('p1'),
      workoutClientId: fixtureIds.workoutClient('w1001'),
      workoutPublicId: null,
      name: '',
      description: null,
      items: [],
    });
  });
});

describe('programs-list', () => {
  it('lists the three programs with who is on each', () => {
    expect(programsList.map((p) => [p.name, p.athletes])).toEqual([
      ['Family program', ['Athlete One', 'Athlete Two']],
      ['Stretching', ['Athlete One']],
      ['Adult One’s program', ['Adult One']],
    ]);
  });
});

describe('family-program: one program’s page', () => {
  it('says who is on it, since when, and what else they are on', () => {
    expect(familyProgram.name).toBe('Family program');
    expect(familyProgram.athletes).toEqual([
      {
        profilePublicId: fixtureIds.athlete('a1'),
        name: 'Athlete One',
        since: FIXTURE_SWITCH_DAY,
        lastDay: null,
        alsoOn: ['Stretching'],
      },
      {
        profilePublicId: fixtureIds.athlete('a2'),
        name: 'Athlete Two',
        since: FIXTURE_SWITCH_DAY,
        lastDay: null,
        alsoOn: [],
      },
    ]);
  });

  it('offers the household’s other programs to copy a workout to', () => {
    expect(familyProgram.otherPrograms).toEqual([
      { programPublicId: fixtureIds.program('p2'), name: 'Stretching' },
      { programPublicId: fixtureIds.program('p3'), name: 'Adult One’s program' },
    ]);
  });

  it('offers everyone in "Put someone on", with what each would keep', () => {
    expect(familyProgram.candidates.map((c) => [c.name, c.on, c.keeps])).toEqual([
      ['Athlete One', true, ['Family program', 'Stretching']],
      ['Athlete Two', true, ['Family program']],
      ['Adult One', false, ['Adult One’s program']],
    ]);
  });

  it('lists the workouts with their item counts and the days that use them, Monday first', () => {
    expect(
      familyProgram.workouts.map((w) => [w.name, w.itemCount, w.usedOn, w.copiedFrom]),
    ).toEqual([
      ['Morning habits', 6, [1, 2, 3, 4, 5, 6], null],
      ['Heavy A', 5, [1, 5], null],
      ['Heavy B', 4, [3, 6], null],
      ['Conditioning', 3, [2, 4, 6], null],
    ]);
  });

  it('holds the week: a rest day on Sunday, three workouts on Saturday', () => {
    const names = Object.fromEntries(
      familyProgram.workouts.map((w) => [w.workoutPublicId, w.name]),
    );
    const day = (k: 0 | 1 | 6) =>
      familyProgram.week[k].map((s) => [s.label, names[s.workoutPublicId]]);
    expect(day(0)).toEqual([]);
    expect(day(1)).toEqual([
      ['Morning', 'Morning habits'],
      ['After school', 'Heavy A'],
    ]);
    expect(day(6)).toEqual([
      ['Morning', 'Morning habits'],
      ['After lunch', 'Heavy B'],
      ['Evening', 'Conditioning'],
    ]);
  });
});

describe('every ProgramView fixture says what today is', () => {
  // The page prints "starts" or "since" by it, and the Put-on dialog offers it and the day after.
  it.each(Object.entries(PROGRAM_VIEW_FIXTURES))('%s', (_name, view) => {
    expect(view.today).toBe(FIXTURE_TODAY);
    expect(programViewSchema.safeParse({ ...view, today: undefined }).success).toBe(false);
  });
});

describe('family-program-after-take-off', () => {
  it('keeps the athlete listed through their last day, which is today', () => {
    expect(familyProgramAfterTakeOff.athletes.map((a) => [a.name, a.since, a.lastDay])).toEqual([
      ['Athlete One', FIXTURE_SWITCH_DAY, null],
      ['Athlete Two', FIXTURE_SWITCH_DAY, FIXTURE_TODAY],
    ]);
  });

  it('differs from the Family program’s page in nothing else', () => {
    const withoutLastDay = (view: typeof familyProgram) => ({
      ...view,
      athletes: view.athletes.map((a) => ({ ...a, lastDay: null })),
    });
    expect(withoutLastDay(familyProgramAfterTakeOff)).toEqual(familyProgram);
  });
});

describe('new-program-empty and adult-program-with-copy', () => {
  it('new-program-empty has a name and nothing else, and offers everyone', () => {
    expect(newProgramEmpty).toMatchObject({ name: 'New program', athletes: [], workouts: [] });
    expect(Object.values(newProgramEmpty.week)).toEqual([[], [], [], [], [], [], []]);
    expect(newProgramEmpty.otherPrograms.map((p) => p.name)).toEqual([
      'Family program',
      'Stretching',
      'Adult One’s program',
    ]);
    expect(newProgramEmpty.candidates.map((c) => [c.name, c.on])).toEqual([
      ['Athlete One', false],
      ['Athlete Two', false],
      ['Adult One', false],
    ]);
  });

  it('adult-program-with-copy shows where the copied workout came from, frozen', () => {
    expect(adultProgramWithCopy.name).toBe('Adult One’s program');
    expect(
      adultProgramWithCopy.workouts.map((w) => [w.name, w.itemCount, w.usedOn, w.copiedFrom]),
    ).toEqual([
      ['Run and core', 2, [2, 4, 6], null],
      ['Conditioning', 3, [1], { programName: 'Family program', on: FIXTURE_TODAY }],
    ]);
    const [, copy] = adultProgramWithCopy.workouts;
    expect(adultProgramWithCopy.week[1]).toEqual([
      { workoutPublicId: copy?.workoutPublicId, label: 'Evening' },
    ]);
    // A copy is its own workout: not the Family program's Conditioning.
    expect(copy?.workoutPublicId).not.toBe(fixtureIds.workout('w4'));
  });
});

describe('programView, exported for a proof that saves a week (C27)', () => {
  const seededWorld = DAY_PLAN_FIXTURE_SOURCES['today-two-programs'].world;

  it('builds the program page the fixtures hold', () => {
    expect(programView(seededWorld, 'p1')).toEqual(familyProgram);
  });

  it('gives a week saveWeek takes as it is, before and after an edit', () => {
    const { world, before } = DAY_PLAN_FIXTURE_SOURCES['workout-left-the-week'];
    if (!before) throw new Error('workout-left-the-week has no world before its edit');
    for (const of of [before, world]) {
      const view = programView(of, 'p1');
      const draft = { programPublicId: view.programPublicId, days: view.week };
      expect(weekDraftSchema.parse(draft)).toEqual(draft);
    }
    // The edit took Heavy A off Friday: the two weeks differ there and only there.
    const was = programView(before, 'p1').week;
    const is = programView(world, 'p1').week;
    expect(is[5]).toEqual(
      was[5].filter((slot) => slot.workoutPublicId !== fixtureIds.workout('w2')),
    );
    expect(is[5]).not.toEqual(was[5]);
    expect({ ...is, 5: was[5] }).toEqual(was);
  });
});
