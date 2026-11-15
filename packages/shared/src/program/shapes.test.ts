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
  WORKOUT_NAME_MAX,
} from '../programming';
import { QUANTITY_SLOT } from '../quantity-slots';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { FREE_TEXT_NOTE_MAX } from '../text';
import { MAX_STORABLE_QUANTITY } from '../units';
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
import { hasSetRows, rowValuesSchema, SET_TRACKING_TYPES, supersetSchema } from './pieces';
import {
  assignDraftSchema,
  copyDraftSchema,
  programOrderSchema,
  programViewSchema,
  takeOffSchema,
  weekDraftSchema,
  workoutDraftSchema,
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
      'retry',
    ]);
    expect(ON_PROGRAM_STATES).toEqual(['yes', 'not-this-day', 'never']);
  });
});

describe('RowValues and Superset', () => {
  it('accepts a Check row: done, with nothing measured', () => {
    expect(rowValuesSchema.parse({ quantities: [] })).toEqual({ quantities: [] });
  });

  it('holds reps to a whole number above zero', () => {
    expect(rowValuesSchema.safeParse({ reps: 0, quantities: [] }).success).toBe(false);
    expect(rowValuesSchema.safeParse({ reps: 7.5, quantities: [] }).success).toBe(false);
    expect(rowValuesSchema.safeParse({ reps: 8, quantities: [] }).success).toBe(true);
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

  it('accepts no superset, or a named group with a 1-based order', () => {
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

  it('bounds the name, and lets a workout that has no name yet be loaded', () => {
    expect(accepts(draft({ name: 'n'.repeat(WORKOUT_NAME_MAX) }))).toBe(true);
    expect(accepts(draft({ name: 'n'.repeat(WORKOUT_NAME_MAX + 1) }))).toBe(false);
    expect(accepts(draft({ name: '' }))).toBe(true);
    expect(accepts(draft({ name: 'Heavy\u0000A' }))).toBe(false);
  });

  it('bounds the items, the sets and the texts by their named limits', () => {
    const item = heavyADraft.items[0];
    expect(accepts(draft({ items: Array(MAX_WORKOUT_ITEMS).fill(item) }))).toBe(true);
    expect(accepts(draft({ items: Array(MAX_WORKOUT_ITEMS + 1).fill(item) }))).toBe(false);
    expect(accepts(withItem({ sets: MAX_SETS_PER_MOVEMENT }))).toBe(true);
    expect(accepts(withItem({ sets: MAX_SETS_PER_MOVEMENT + 1 }))).toBe(false);
    expect(accepts(withItem({ sets: 0 }))).toBe(false);
    expect(accepts(withItem({ notes: 'n'.repeat(FREE_TEXT_NOTE_MAX) }))).toBe(true);
    expect(accepts(withItem({ notes: 'n'.repeat(FREE_TEXT_NOTE_MAX + 1) }))).toBe(false);
    expect(accepts(withItem({ restAfter: 'r'.repeat(SLOT_LABEL_MAX + 1) }))).toBe(false);
    expect(accepts(withItem({ targetReps: 'r'.repeat(SLOT_LABEL_MAX + 1) }))).toBe(false);
    expect(accepts(draft({ description: 'd'.repeat(FREE_TEXT_NOTE_MAX + 1) }))).toBe(false);
  });

  it('reads blank instructions as none, and refuses instructions on two lines', () => {
    expect(workoutDraftSchema.parse(withItem({ notes: '   ' })).items[0]?.notes).toBeNull();
    expect(accepts(withItem({ notes: 'Feet flat.\nTwo seconds down.' }))).toBe(false);
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

  it('needs every weekday, and only weekdays', () => {
    expect(weekDraftSchema.safeParse({ programPublicId: A_PROGRAM, days: week }).success).toBe(
      true,
    );
    const { 0: _sunday, ...sixDays } = week;
    expect(weekDraftSchema.safeParse({ programPublicId: A_PROGRAM, days: sixDays }).success).toBe(
      false,
    );
    expect(
      weekDraftSchema.safeParse({ programPublicId: A_PROGRAM, days: { ...week, 7: [] } }).success,
    ).toBe(false);
    expect(Object.keys(week).map(Number)).toEqual([...WEEKDAYS]);
  });

  it('bounds a slot’s label and lets it be absent', () => {
    const days = (label: string | null) => ({
      ...week,
      0: [{ workoutPublicId: A_WORKOUT, label }],
    });
    const accepts = (label: string | null) =>
      weekDraftSchema.safeParse({ programPublicId: A_PROGRAM, days: days(label) }).success;
    expect(accepts(null)).toBe(true);
    expect(accepts('l'.repeat(SLOT_LABEL_MAX))).toBe(true);
    expect(accepts('l'.repeat(SLOT_LABEL_MAX + 1))).toBe(false);
  });

  it('bounds a program’s name', () => {
    const named = (name: string) => programViewSchema.safeParse({ ...familyProgram, name }).success;
    expect(named('n'.repeat(PROGRAM_NAME_MAX))).toBe(true);
    expect(named('n'.repeat(PROGRAM_NAME_MAX + 1))).toBe(false);
    expect(named('')).toBe(false);
  });
});

describe('the dialog drafts', () => {
  it('AssignDraft needs at least one athlete, at most a household, and a day', () => {
    const assign = (profilePublicIds: string[], from = A_DAY) =>
      assignDraftSchema.safeParse({ programPublicId: A_PROGRAM, profilePublicIds, from }).success;
    expect(assign([A_PROFILE])).toBe(true);
    expect(assign([])).toBe(false);
    expect(assign(Array(MAX_HOUSEHOLD_ATHLETES).fill(A_PROFILE))).toBe(true);
    expect(assign(Array(MAX_HOUSEHOLD_ATHLETES + 1).fill(A_PROFILE))).toBe(false);
    expect(assign([A_PROFILE], '14 Nov')).toBe(false);
    expect(assign(['a1'])).toBe(false);
  });

  it('TakeOff and ProgramOrder name public ids', () => {
    expect(
      takeOffSchema.safeParse({ programPublicId: A_PROGRAM, profilePublicId: A_PROFILE }).success,
    ).toBe(true);
    expect(
      takeOffSchema.safeParse({ programPublicId: 'p1', profilePublicId: A_PROFILE }).success,
    ).toBe(false);
    expect(
      programOrderSchema.safeParse({ profilePublicId: A_PROFILE, programPublicIds: [A_PROGRAM] })
        .success,
    ).toBe(true);
    expect(
      programOrderSchema.safeParse({ profilePublicId: A_PROFILE, programPublicIds: ['p1'] })
        .success,
    ).toBe(false);
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
    expect(copy({ weekdays: [7] })).toBe(false);
    expect(copy({ label: 'l'.repeat(SLOT_LABEL_MAX + 1) })).toBe(false);
  });
});

describe('DayPlan', () => {
  it('accepts only the three on-program states', () => {
    for (const onProgram of ON_PROGRAM_STATES) {
      expect(dayPlanSchema.safeParse({ ...todayTwoPrograms, onProgram }).success).toBe(true);
    }
    expect(dayPlanSchema.safeParse({ ...todayTwoPrograms, onProgram: 'no' }).success).toBe(false);
  });

  it('needs a calendar day and a household-sized switcher', () => {
    expect(dayPlanSchema.safeParse({ ...todayTwoPrograms, day: 'today' }).success).toBe(false);
    const athlete = todayTwoPrograms.athletes[0];
    expect(
      dayPlanSchema.safeParse({
        ...todayTwoPrograms,
        athletes: Array(MAX_HOUSEHOLD_ATHLETES + 1).fill(athlete),
      }).success,
    ).toBe(false);
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

  it('RowResult is the entry, or one of the named refusals', () => {
    expect(rowResultSchema.safeParse({ ok: true, entryPublicId: AN_ENTRY }).success).toBe(true);
    expect(
      rowResultSchema.safeParse({ ok: true, entryPublicId: AN_ENTRY, hiddenAt: A_HIDE_TOKEN })
        .success,
    ).toBe(true);
    expect(rowResultSchema.safeParse({ ok: true }).success).toBe(false);
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
      createProgram: async () => ({ ...done, programPublicId: A_PROGRAM }),
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
