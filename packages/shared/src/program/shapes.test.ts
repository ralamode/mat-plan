import { describe, expect, it } from 'vitest';

import { WEEKDAYS } from '../day';
import {
  TRACKING_TYPE,
  TRACKING_TYPE_LABELS,
  TRACKING_TYPES,
  trackingTypeSchema,
} from '../movements';
import { MAX_HOUSEHOLD_ATHLETES } from '../profiles';
import {
  MAX_WORKOUT_ITEMS,
  PROGRAM_NAME_MAX,
  SLOT_LABEL_MAX,
  SLOT_LABEL_SUGGESTIONS,
  TARGET_REPS_MAX,
  WORKOUT_NAME_MAX,
} from '../programming';
import { QUANTITY_SLOT, slotAcceptsDimension } from '../quantity-slots';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { FREE_TEXT_NOTE_MAX } from '../text';
import { MAX_STORABLE_QUANTITY, UNIT_DIMENSION_BY_CODE } from '../units';
import { PROGRAM_REFUSALS, type DayActions, type ProgramActions } from './actions';
import {
  dayPlanSchema,
  ON_PROGRAM_STATES,
  ROW_REFUSAL,
  ROW_REFUSALS,
  rowAmendSchema,
  rowResultSchema,
  rowRetickSchema,
  rowUntickSchema,
  rowWriteSchema,
} from './day-shapes';
import { fixtureIds, heavyADraft, familyProgram, todayTwoPrograms } from './fixtures';
import {
  hasSetRows,
  rowValuesSchema,
  SET_TRACKING_TYPES,
  supersetSchema,
  TRACKING_TYPE_FIELDS,
  unitsForTrackingType,
  wholeReps,
} from './pieces';
import {
  assignDraftSchema,
  copyDraftSchema,
  createProgramSchema,
  newItemSchema,
  programOrderSchema,
  programViewSchema,
  renameProgramSchema,
  saveWorkoutSchema,
  takeOffSchema,
  weekDraftSchema,
  workoutDraftSchema,
  type CreateProgram,
} from './program-shapes';

/**
 * The contract's constants and bounds (FAM-1 plan §4, chunk 0a). Each bound is built from the
 * constant that names it, so the test follows a limit when it moves; the constants themselves are
 * pinned once, below.
 */

const A_PROFILE = fixtureIds.athlete('a1');
const A_PROGRAM = fixtureIds.program('p1');
const A_WORKOUT = fixtureIds.workout('w2');
const AN_ENTRY = fixtureIds.entry(1);
const A_DAY = '2026-11-14';
const A_HIDE_TOKEN = '2026-11-14T15:04:05.123456Z';
/** `n` different public ids, for a list that must hold no repeats. */
const distinctIds = (n: number) => Array.from({ length: n }, (_, i) => fixtureIds.entry(5000 + i));

describe('the constants the lanes build against (contract pins)', () => {
  it('names the seven tracking types, in the plan’s order', () => {
    // FAM-1 step 3 pins `movements.tracking_type`'s CHECK to this array, so its members are data.
    expect(TRACKING_TYPES).toEqual([
      'check',
      'count',
      'reps',
      'weight_reps',
      'duration',
      'time_sets',
      'distance',
    ]);
  });

  it('labels each type as the prototype does', () => {
    expect(TRACKING_TYPE_LABELS).toEqual({
      check: 'Check',
      count: 'Count',
      reps: 'Reps',
      weight_reps: 'Weight × reps',
      duration: 'Duration',
      time_sets: 'Time per set',
      distance: 'Distance',
    });
  });

  it('gives every type a named member and accepts nothing else', () => {
    for (const type of TRACKING_TYPES) {
      expect(TRACKING_TYPE[type]).toBe(type);
      expect(trackingTypeSchema.safeParse(type).success).toBe(true);
    }
    expect(trackingTypeSchema.safeParse('weight').success).toBe(false);
  });

  it('states plan §2’s table as data: each type’s fields', () => {
    const { primary, distance } = QUANTITY_SLOT;
    expect(TRACKING_TYPE_FIELDS).toEqual({
      check: { sets: false, reps: false, slot: null, dimensions: [], unit: null },
      count: {
        sets: false,
        reps: false,
        slot: primary,
        dimensions: ['mass', 'length', 'time', 'count'],
        unit: null,
      },
      reps: { sets: true, reps: true, slot: null, dimensions: [], unit: null },
      weight_reps: { sets: true, reps: true, slot: primary, dimensions: ['mass'], unit: null },
      duration: { sets: false, reps: false, slot: primary, dimensions: ['time'], unit: 'min' },
      time_sets: { sets: true, reps: false, slot: primary, dimensions: ['time'], unit: 'sec' },
      distance: { sets: true, reps: false, slot: distance, dimensions: ['length'], unit: null },
    });
  });

  it('keeps each type’s fields consistent with the units and the slots', () => {
    for (const type of TRACKING_TYPES) {
      const { slot, dimensions, unit } = TRACKING_TYPE_FIELDS[type];
      // A slot and its dimensions come together; a fixed unit is one of those dimensions.
      expect(dimensions.length > 0).toBe(slot !== null);
      if (unit) expect(dimensions).toContain(UNIT_DIMENSION_BY_CODE[unit]);
      for (const offered of unitsForTrackingType(type)) {
        expect(dimensions).toContain(UNIT_DIMENSION_BY_CODE[offered]);
      }
      // Every pairing is storable: step 3 added (primary, count), the last one missing.
      for (const dimension of dimensions) {
        if (slot) expect(slotAcceptsDimension(slot, dimension)).toBe(true);
      }
    }
  });

  it('offers the units of a type’s dimensions, or the one unit it is fixed to', () => {
    expect(unitsForTrackingType(TRACKING_TYPE.check)).toEqual([]);
    expect(unitsForTrackingType(TRACKING_TYPE.reps)).toEqual([]);
    expect(unitsForTrackingType(TRACKING_TYPE.weight_reps)).toEqual(['lb', 'kg']);
    expect(unitsForTrackingType(TRACKING_TYPE.duration)).toEqual(['min']);
    expect(unitsForTrackingType(TRACKING_TYPE.time_sets)).toEqual(['sec']);
    expect(unitsForTrackingType(TRACKING_TYPE.distance)).toEqual([
      'in',
      'cm',
      'ft',
      'm',
      'yd',
      'mi',
    ]);
    expect(unitsForTrackingType(TRACKING_TYPE.count)).toEqual([
      'lb',
      'kg',
      'in',
      'cm',
      'ft',
      'm',
      'yd',
      'mi',
      'sec',
      'min',
      'count',
    ]);
  });

  it('logs four types set by set and three as one row', () => {
    expect(SET_TRACKING_TYPES).toEqual([
      TRACKING_TYPE.reps,
      TRACKING_TYPE.weight_reps,
      TRACKING_TYPE.time_sets,
      TRACKING_TYPE.distance,
    ]);
    expect(TRACKING_TYPES.filter((type) => !hasSetRows(type))).toEqual([
      TRACKING_TYPE.check,
      TRACKING_TYPE.count,
      TRACKING_TYPE.duration,
    ]);
  });

  it('sets the builder’s limits', () => {
    expect(PROGRAM_NAME_MAX).toBe(60);
    expect(WORKOUT_NAME_MAX).toBe(30);
    expect(SLOT_LABEL_MAX).toBe(30);
    expect(MAX_WORKOUT_ITEMS).toBe(30);
    expect(TARGET_REPS_MAX).toBe(20);
  });

  it('suggests the prototype’s four labels, each within the label limit', () => {
    expect(SLOT_LABEL_SUGGESTIONS).toEqual(['Morning', 'After school', 'After lunch', 'Evening']);
    for (const label of SLOT_LABEL_SUGGESTIONS)
      expect(label.length).toBeLessThanOrEqual(SLOT_LABEL_MAX);
  });

  it('names every refusal a write can answer with', () => {
    expect(PROGRAM_REFUSALS).toEqual([
      'name_taken',
      'invalid',
      'not_found',
      'once_per_day',
      'retry',
    ]);
    expect(ROW_REFUSALS).toEqual([
      'program_changed',
      'not_scheduled',
      'closed_day',
      'bad_value',
      'slot_taken',
      'own_hidden',
      'not_found',
      'retry',
    ]);
    expect(ON_PROGRAM_STATES).toEqual(['yes', 'not-this-day', 'never']);
  });
});

describe('RowValues and Superset', () => {
  it('accepts a Check row: done, with nothing measured', () => {
    expect(rowValuesSchema.parse({ quantities: [] })).toEqual({ quantities: [] });
  });

  it('holds reps to a whole number from 1 to 1000', () => {
    expect(rowValuesSchema.safeParse({ reps: 0, quantities: [] }).success).toBe(false);
    expect(rowValuesSchema.safeParse({ reps: 7.5, quantities: [] }).success).toBe(false);
    expect(rowValuesSchema.safeParse({ reps: 8, quantities: [] }).success).toBe(true);
    expect(rowValuesSchema.safeParse({ reps: 1000, quantities: [] }).success).toBe(true);
    expect(rowValuesSchema.safeParse({ reps: 1001, quantities: [] }).success).toBe(false);
  });

  it('does not coerce reps: this is typed data, not a form', () => {
    // The strength set's own rule coerces, under which `true` is 1 rep and `'8'` is 8.
    expect(rowValuesSchema.safeParse({ reps: true, quantities: [] }).success).toBe(false);
    expect(rowValuesSchema.safeParse({ reps: '8', quantities: [] }).success).toBe(false);
    expect(rowValuesSchema.safeParse({ reps: null, quantities: [] }).success).toBe(false);
  });

  it('reads a prescription’s reps as a number only when they are a whole number', () => {
    expect(wholeReps('8')).toBe(8);
    expect(wholeReps('10 per side')).toBeNull();
    expect(wholeReps('8.5')).toBeNull();
    expect(wholeReps('0')).toBeNull();
    expect(wholeReps('1001')).toBeNull();
    expect(wholeReps(null)).toBeNull();
  });

  it('holds a quantity to a known slot, a known unit and a storable magnitude', () => {
    const one = (over: object) => ({
      quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25, ...over }],
    });
    expect(rowValuesSchema.safeParse(one({})).success).toBe(true);
    expect(rowValuesSchema.safeParse(one({ value: 0 })).success).toBe(true);
    expect(rowValuesSchema.safeParse(one({ value: -1 })).success).toBe(false);
    expect(rowValuesSchema.safeParse(one({ value: MAX_STORABLE_QUANTITY + 1 })).success).toBe(
      false,
    );
    expect(rowValuesSchema.safeParse(one({ unit: 'stone' })).success).toBe(false);
    expect(rowValuesSchema.safeParse(one({ slot: 'height' })).success).toBe(false);
    // A logged quantity always has a value; "no target" exists only on a prescription.
    expect(rowValuesSchema.safeParse(one({ value: null })).success).toBe(false);
  });

  it('accepts no superset, or a group key with a 1-based order', () => {
    expect(supersetSchema.parse(null)).toBeNull();
    expect(supersetSchema.safeParse({ group: 'a', order: 1 }).success).toBe(true);
    expect(supersetSchema.safeParse({ group: 'a', order: 0 }).success).toBe(false);
    expect(supersetSchema.safeParse({ group: '', order: 1 }).success).toBe(false);
    expect(
      supersetSchema.safeParse({ group: 'g'.repeat(SLOT_LABEL_MAX + 1), order: 1 }).success,
    ).toBe(false);
  });
});

describe('WorkoutDraft', () => {
  const draft = (over: object) => ({ ...heavyADraft, ...over });
  const withItem = (over: object) => draft({ items: [{ ...heavyADraft.items[0], ...over }] });
  const accepts = (value: unknown) => workoutDraftSchema.safeParse(value).success;

  it('bounds the name', () => {
    expect(accepts(draft({ name: 'n'.repeat(WORKOUT_NAME_MAX) }))).toBe(true);
    expect(accepts(draft({ name: 'n'.repeat(WORKOUT_NAME_MAX + 1) }))).toBe(false);
    expect(accepts(draft({ name: 'Heavy\u0000A' }))).toBe(false);
  });

  it('loads a workout with no name, and refuses to save one', () => {
    // The editor loads `workoutDraftSchema`; `saveWorkout` parses `saveWorkoutSchema`.
    expect(accepts(draft({ name: '' }))).toBe(true);
    expect(saveWorkoutSchema.safeParse(draft({ name: '' })).success).toBe(false);
    expect(saveWorkoutSchema.safeParse(draft({ name: '   ' })).success).toBe(false);
    expect(saveWorkoutSchema.parse(heavyADraft)).toEqual(heavyADraft);
  });

  it('bounds the items, the sets and the texts by their named limits', () => {
    const cards = (n: number) =>
      distinctIds(n).map((id) => ({ ...heavyADraft.items[0], prescriptionClientId: id }));
    expect(accepts(draft({ items: cards(MAX_WORKOUT_ITEMS) }))).toBe(true);
    expect(accepts(draft({ items: cards(MAX_WORKOUT_ITEMS + 1) }))).toBe(false);
    expect(accepts(withItem({ sets: MAX_SETS_PER_MOVEMENT }))).toBe(true);
    expect(accepts(withItem({ sets: MAX_SETS_PER_MOVEMENT + 1 }))).toBe(false);
    expect(accepts(withItem({ sets: 0 }))).toBe(false);
    expect(accepts(withItem({ notes: 'n'.repeat(FREE_TEXT_NOTE_MAX) }))).toBe(true);
    expect(accepts(withItem({ notes: 'n'.repeat(FREE_TEXT_NOTE_MAX + 1) }))).toBe(false);
    expect(accepts(withItem({ restAfter: 'r'.repeat(SLOT_LABEL_MAX + 1) }))).toBe(false);
    expect(accepts(withItem({ targetReps: 'r'.repeat(TARGET_REPS_MAX) }))).toBe(true);
    expect(accepts(withItem({ targetReps: 'r'.repeat(TARGET_REPS_MAX + 1) }))).toBe(false);
    expect(accepts(draft({ description: 'd'.repeat(FREE_TEXT_NOTE_MAX + 1) }))).toBe(false);
  });

  it('reads every blank optional text as none, the same way', () => {
    const blank = withItem({ notes: '   ', targetReps: '', restAfter: ' ' });
    const parsed = workoutDraftSchema.parse({ ...blank, description: '  ' });
    expect(parsed.description).toBeNull();
    expect(parsed.items[0]).toMatchObject({ notes: null, targetReps: null, restAfter: null });
    expect(workoutDraftSchema.parse(withItem({ targetReps: ' 8 ' })).items[0]?.targetReps).toBe(
      '8',
    );
  });

  it('refuses instructions on two lines', () => {
    expect(accepts(withItem({ notes: 'Feet flat.\nTwo seconds down.' }))).toBe(false);
  });

  it('gives each card its own prescriptionClientId', () => {
    const [first] = heavyADraft.items;
    expect(accepts(draft({ items: [first, first] }))).toBe(false);
  });

  it('lets a prescribed quantity carry no value, and holds a new workout’s id to null', () => {
    const noTarget = [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: null }];
    expect(accepts(withItem({ quantities: noTarget }))).toBe(true);
    expect(accepts(draft({ workoutPublicId: null }))).toBe(true);
    expect(accepts(draft({ workoutPublicId: 'w2' }))).toBe(false);
  });
});

describe('WeekDraft and ProgramView', () => {
  const week = familyProgram.week;
  const saves = (days: unknown) =>
    weekDraftSchema.safeParse({ programPublicId: A_PROGRAM, days }).success;

  it('needs every weekday, and only weekdays', () => {
    expect(saves(week)).toBe(true);
    const { 0: _sunday, ...sixDays } = week;
    expect(saves(sixDays)).toBe(false);
    expect(saves({ ...week, 7: [] })).toBe(false);
    expect(Object.keys(week).map(Number)).toEqual([...WEEKDAYS]);
  });

  it('bounds a slot’s label, lets it be absent, and reads a blank one as absent', () => {
    const days = (label: string | null) => ({
      ...week,
      0: [{ workoutPublicId: A_WORKOUT, label }],
    });
    expect(saves(days(null))).toBe(true);
    expect(saves(days('l'.repeat(SLOT_LABEL_MAX)))).toBe(true);
    expect(saves(days('l'.repeat(SLOT_LABEL_MAX + 1)))).toBe(false);
    const blank = weekDraftSchema.parse({ programPublicId: A_PROGRAM, days: days('  ') });
    expect(blank.days[0]).toEqual([{ workoutPublicId: A_WORKOUT, label: null }]);
  });

  it('lets a workout run at most once on a day', () => {
    const slot = { workoutPublicId: A_WORKOUT, label: null };
    expect(saves({ ...week, 0: [slot, { ...slot, label: 'Evening' }] })).toBe(false);
    // The same workout on two different days is the ordinary case.
    expect(saves({ ...week, 0: [slot], 2: [slot] })).toBe(true);
  });

  it('holds a program page’s week to the workouts it lists', () => {
    const stray = { workoutPublicId: fixtureIds.workout('w5'), label: null };
    expect(
      programViewSchema.safeParse({ ...familyProgram, week: { ...week, 0: [stray] } }).success,
    ).toBe(false);
    // So, with "once a day", a day never holds more slots than the program has workouts.
    for (const slots of Object.values(week)) {
      expect(slots.length).toBeLessThanOrEqual(familyProgram.workouts.length);
    }
  });

  it('bounds a program’s name', () => {
    const named = (name: string) => programViewSchema.safeParse({ ...familyProgram, name }).success;
    expect(named('n'.repeat(PROGRAM_NAME_MAX))).toBe(true);
    expect(named('n'.repeat(PROGRAM_NAME_MAX + 1))).toBe(false);
    expect(named('')).toBe(false);
  });
});

describe('the inputs of the actions that have no draft of their own', () => {
  it('createProgram and renameProgram take a name', () => {
    const create = (name: string) =>
      createProgramSchema.safeParse({ clientId: fixtureIds.entry(1001), name }).success;
    expect(create('Family program')).toBe(true);
    expect(create('')).toBe(false);
    expect(create('   ')).toBe(false);
    expect(create('n'.repeat(PROGRAM_NAME_MAX + 1))).toBe(false);
    expect(createProgramSchema.safeParse({ clientId: 'c1', name: 'Family program' }).success).toBe(
      false,
    );
    expect(
      renameProgramSchema.parse({ programPublicId: A_PROGRAM, name: '  Off season  ' }),
    ).toEqual({ programPublicId: A_PROGRAM, name: 'Off season' });
    expect(renameProgramSchema.safeParse({ programPublicId: A_PROGRAM, name: '' }).success).toBe(
      false,
    );
  });

  it('newItem takes a typed movement name and one of the seven types', () => {
    const item = (name: string, trackingType: string = TRACKING_TYPE.check) =>
      newItemSchema.safeParse({ name, trackingType }).success;
    expect(item('Up on time')).toBe(true);
    expect(item('')).toBe(false);
    // The rules every typed movement name passes: a letter, and no comma.
    expect(item('123')).toBe(false);
    expect(item('Row, inverted')).toBe(false);
    expect(item('Up on time', 'habit')).toBe(false);
  });
});

describe('the dialog drafts', () => {
  it('AssignDraft needs at least one athlete, at most a household, each once, and a day', () => {
    const assign = (profilePublicIds: string[], from = A_DAY) =>
      assignDraftSchema.safeParse({ programPublicId: A_PROGRAM, profilePublicIds, from }).success;
    expect(assign([A_PROFILE])).toBe(true);
    expect(assign([])).toBe(false);
    expect(assign(distinctIds(MAX_HOUSEHOLD_ATHLETES))).toBe(true);
    expect(assign(distinctIds(MAX_HOUSEHOLD_ATHLETES + 1))).toBe(false);
    expect(assign([A_PROFILE, A_PROFILE])).toBe(false);
    expect(assign([A_PROFILE], '14 Nov')).toBe(false);
    expect(assign(['a1'])).toBe(false);
  });

  it('TakeOff names a program and an athlete by public id', () => {
    const takeOff = (programPublicId: string) =>
      takeOffSchema.safeParse({ programPublicId, profilePublicId: A_PROFILE }).success;
    expect(takeOff(A_PROGRAM)).toBe(true);
    expect(takeOff('p1')).toBe(false);
  });

  it('ProgramOrder is the athlete’s current programs, each once', () => {
    const order = (programPublicIds: string[]) =>
      programOrderSchema.safeParse({ profilePublicId: A_PROFILE, programPublicIds }).success;
    // A permutation of the day's `currentPrograms` is what the writer accepts.
    const current = todayTwoPrograms.currentPrograms.map((p) => p.programPublicId);
    expect(current).toHaveLength(2);
    expect(order(current)).toBe(true);
    expect(order([...current].reverse())).toBe(true);
    expect(order([A_PROGRAM, A_PROGRAM])).toBe(false);
    expect(order([])).toBe(false);
    expect(order(['p1'])).toBe(false);
  });

  it('CopyDraft takes any set of weekdays, none included, and an optional label', () => {
    const copy = (over: object) =>
      copyDraftSchema.safeParse({
        clientId: fixtureIds.workoutClient('w1001'),
        workoutPublicId: A_WORKOUT,
        toProgramPublicId: A_PROGRAM,
        weekdays: [],
        label: null,
        ...over,
      }).success;
    expect(copy({})).toBe(true);
    expect(copy({ weekdays: [...WEEKDAYS], label: 'Evening' })).toBe(true);
    expect(copy({ label: '' })).toBe(true);
    expect(copy({ weekdays: [7] })).toBe(false);
    expect(copy({ weekdays: [1, 1] })).toBe(false);
    expect(copy({ label: 'l'.repeat(SLOT_LABEL_MAX + 1) })).toBe(false);
  });
});

describe('DayPlan', () => {
  const accepts = (over: object) =>
    dayPlanSchema.safeParse({ ...todayTwoPrograms, ...over }).success;

  it('accepts only the three on-program states', () => {
    for (const onProgram of ON_PROGRAM_STATES) expect(accepts({ onProgram })).toBe(true);
    expect(accepts({ onProgram: 'no' })).toBe(false);
  });

  it('needs the viewed day, the athlete’s today, and a household-sized switcher', () => {
    expect(accepts({ day: 'today' })).toBe(false);
    expect(accepts({ today: undefined })).toBe(false);
    const [athlete] = todayTwoPrograms.athletes;
    expect(accepts({ athletes: Array(MAX_HOUSEHOLD_ATHLETES + 1).fill(athlete) })).toBe(false);
  });

  it('lets a program the athlete has come off have no place in the current order', () => {
    const [first] = todayTwoPrograms.programs;
    expect(accepts({ programs: [{ ...first, order: null }] })).toBe(true);
    expect(accepts({ programs: [{ ...first, order: -1 }] })).toBe(false);
    expect(accepts({ currentPrograms: undefined })).toBe(false);
  });

  it('needs each item’s prescribed numbers and each workout’s progress', () => {
    const [workout] = todayTwoPrograms.workouts;
    const [item] = workout?.items ?? [];
    const withWorkout = (over: object) => accepts({ workouts: [{ ...workout, ...over }] });
    expect(withWorkout({})).toBe(true);
    expect(withWorkout({ progress: undefined })).toBe(false);
    expect(withWorkout({ progress: { done: -1, total: 10 } })).toBe(false);
    expect(withWorkout({ items: [{ ...item, target: undefined }] })).toBe(false);
    expect(withWorkout({ items: [{ ...item, target: { reps: null, quantities: [] } }] })).toBe(
      true,
    );
    expect(withWorkout({ items: [{ ...item, target: { reps: 0, quantities: [] } }] })).toBe(false);
  });
});

describe('the row writes', () => {
  const write = (over: object) =>
    rowWriteSchema.safeParse({
      clientId: fixtureIds.entry(1001),
      profilePublicId: A_PROFILE,
      day: A_DAY,
      workoutPublicId: A_WORKOUT,
      prescriptionPublicId: fixtureIds.prescription('w2', 'dbbench'),
      set: 1,
      values: { reps: 8, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25 }] },
      ...over,
    }).success;

  it('RowWrite numbers sets from 1, up to the sets an item may have', () => {
    expect(write({})).toBe(true);
    expect(write({ set: 0 })).toBe(false);
    expect(write({ set: MAX_SETS_PER_MOVEMENT })).toBe(true);
    expect(write({ set: MAX_SETS_PER_MOVEMENT + 1 })).toBe(false);
    expect(write({ values: { reps: 0, quantities: [] } })).toBe(false);
    expect(write({ day: '2026-11-31' })).toBe(false);
  });

  it('RowWrite may leave out what was not typed: an empty ✓ sends no numbers', () => {
    // An absent `reps`, or a slot with no quantity, means "the prescription's" (plan D13).
    expect(write({ values: { quantities: [] } })).toBe(true);
    expect(write({ values: { reps: 8, quantities: [] } })).toBe(true);
    expect(write({ values: {} })).toBe(false);
  });

  it('RowUntick names an entry; RowRetick also carries the hide token it was answered with', () => {
    const row = { profilePublicId: A_PROFILE, day: A_DAY, entryPublicId: AN_ENTRY };
    expect(rowUntickSchema.safeParse(row).success).toBe(true);
    expect(rowRetickSchema.safeParse(row).success).toBe(false);
    expect(rowRetickSchema.safeParse({ ...row, hiddenAt: A_HIDE_TOKEN }).success).toBe(true);
    // A token that went through a `Date` has three fractional digits and matches no row.
    expect(
      rowRetickSchema.safeParse({ ...row, hiddenAt: '2026-11-14T15:04:05.123Z' }).success,
    ).toBe(false);
  });

  it('RowAmend names the entry and its new values, and no day', () => {
    expect(
      rowAmendSchema.parse({
        profilePublicId: A_PROFILE,
        entryPublicId: AN_ENTRY,
        values: { quantities: [] },
        day: A_DAY,
      }),
    ).toEqual({ profilePublicId: A_PROFILE, entryPublicId: AN_ENTRY, values: { quantities: [] } });
  });

  it('RowResult is the entry with the values written, or one of the named refusals', () => {
    const written = {
      reps: 8,
      quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25 }],
    };
    const ok = { ok: true, entryPublicId: AN_ENTRY, values: written };
    expect(rowResultSchema.parse(ok)).toEqual(ok);
    expect(rowResultSchema.safeParse({ ...ok, hiddenAt: A_HIDE_TOKEN }).success).toBe(true);
    // The values are part of every success: the screen shows what was stored, not what it sent.
    expect(rowResultSchema.safeParse({ ok: true, entryPublicId: AN_ENTRY }).success).toBe(false);
    for (const reason of ROW_REFUSALS) {
      expect(rowResultSchema.safeParse({ ok: false, reason }).success).toBe(true);
    }
    expect(rowResultSchema.safeParse({ ok: false, reason: 'offline' }).success).toBe(false);
    expect(rowResultSchema.safeParse({ ok: false }).success).toBe(false);
  });
});

describe('the actions interfaces', () => {
  it('lets the wiring leave out exactly the members the plan marks optional', async () => {
    // Types only, so the proof is that this compiles: the required members alone satisfy each
    // interface, and a screen reads an unwired member as `undefined` and hides its control.
    const refused = { ok: false, reason: ROW_REFUSAL.retry } as const;
    const day = {
      logRow: async () => refused,
      untickRow: async () => refused,
      retickRow: async () => refused,
    } satisfies DayActions;
    const dayActions: DayActions = day;
    expect(dayActions.amendRow).toBeUndefined();
    expect(dayActions.reorderPrograms).toBeUndefined();

    const done = { ok: true } as const;
    const program = {
      createProgram: async (input: CreateProgram) => ({ ...done, programPublicId: input.clientId }),
      renameProgram: async () => done,
      saveWorkout: async () => ({ ...done, workoutPublicId: A_WORKOUT }),
      saveWeek: async () => done,
      copyWorkout: async () => ({ ...done, workoutPublicId: A_WORKOUT }),
      newItem: async () => ({
        ...done,
        itemPublicId: fixtureIds.item('grip'),
        trackingType: TRACKING_TYPE.check,
        existed: true,
      }),
    } satisfies ProgramActions;
    const programActions: ProgramActions = program;
    expect(programActions.putOn).toBeUndefined();
    expect(programActions.takeOff).toBeUndefined();
    await expect(
      programActions.saveWeek({ programPublicId: A_PROGRAM, days: familyProgram.week }),
    ).resolves.toEqual(done);
  });
});
