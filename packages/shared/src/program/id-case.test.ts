import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { WEEKDAYS } from '../day';
import { uuidSchema } from '../id';
import {
  dayPlanSchema,
  rowAmendSchema,
  rowResultSchema,
  rowRetickSchema,
  rowUntickSchema,
  rowWriteSchema,
} from './day-shapes';
import {
  everyTypeOnce,
  familyProgram,
  fixtureIds,
  heavyADraft,
  programsList,
  todayTwoPrograms,
} from './fixtures';
import { lowerCaseUuidSchema } from './pieces';
import {
  assignDraftSchema,
  copyDraftSchema,
  createProgramSchema,
  programListSchema,
  programOrderSchema,
  programViewSchema,
  renameProgramSchema,
  saveWorkoutSchema,
  takeOffSchema,
  weekDraftSchema,
  weekRepeatsAWorkout,
  workoutDraftSchema,
} from './program-shapes';

/**
 * Contract change C25: an id has one spelling after the parse.
 *
 * Postgres reads `0193A2B4-…` and `0193a2b4-…` as one uuid; a `Set`, a `Map` and `===` read them as
 * two. So every id in this contract is handed back in lower case, and a list that must not repeat
 * an id refuses the same id written in two cases.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The fixtures' ids are all digits (`00000000-0000-7000-8000-…`), so upper-casing one changes
 * nothing. These give every id in a value the same six letters in its first group, in one case or
 * the other; the rest of the id is kept, so two ids stay two.
 */
const LETTERS = 'abcdef00';
function spell<T>(value: T, letters: string): T {
  if (typeof value === 'string') {
    return (UUID.test(value) ? letters + value.slice(letters.length) : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => spell(v, letters)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, spell(v, letters)])) as T;
  }
  return value;
}
const lower = <T>(value: T): T => spell(value, LETTERS);
const upper = <T>(value: T): T => spell(value, LETTERS.toUpperCase());

/** Every uuid in a value, in the order met. */
function idsIn(value: unknown): string[] {
  if (typeof value === 'string') return UUID.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(idsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(idsIn);
  return [];
}

const A_PROFILE = fixtureIds.athlete('a1');
const A_PROGRAM = fixtureIds.program('p1');
const A_WORKOUT = fixtureIds.workout('w2');
const AN_ENTRY = fixtureIds.entry(1);
const A_CLIENT_ID = fixtureIds.entry(7001);
const week = familyProgram.week;
const A_DAY = '2026-11-14';
const [firstCard, secondCard] = heavyADraft.items;
if (!firstCard || !secondCard) throw new Error('heavy-a-draft needs two cards');
const aPrescription = todayTwoPrograms.workouts
  .flatMap((workout) => workout.items)
  .find((item) => item.prescriptionPublicId)?.prescriptionPublicId;
if (!aPrescription) throw new Error('today-two-programs has no live item');

/** Every schema of the contract that reads an id, with an input it accepts. */
const READS_AN_ID: Array<[string, z.ZodType, unknown]> = [
  ['createProgram', createProgramSchema, { clientId: A_CLIENT_ID, name: 'Spring' }],
  ['renameProgram', renameProgramSchema, { programPublicId: A_PROGRAM, name: 'Spring' }],
  ['the editor’s load', workoutDraftSchema, heavyADraft],
  ['saveWorkout', saveWorkoutSchema, heavyADraft],
  ['saveWeek', weekDraftSchema, { programPublicId: A_PROGRAM, days: week }],
  [
    'copyWorkout',
    copyDraftSchema,
    {
      clientId: A_CLIENT_ID,
      workoutPublicId: A_WORKOUT,
      toProgramPublicId: A_PROGRAM,
      weekdays: [1],
      label: null,
    },
  ],
  [
    'assign',
    assignDraftSchema,
    { programPublicId: A_PROGRAM, profilePublicIds: [A_PROFILE], from: A_DAY },
  ],
  ['takeOff', takeOffSchema, { programPublicId: A_PROGRAM, profilePublicId: A_PROFILE }],
  [
    'reorderPrograms',
    programOrderSchema,
    { profilePublicId: A_PROFILE, programPublicIds: [A_PROGRAM, fixtureIds.program('p2')] },
  ],
  ['the Programs list', programListSchema, programsList],
  ['a program page', programViewSchema, familyProgram],
  ['a day', dayPlanSchema, todayTwoPrograms],
  ['a day with every type', dayPlanSchema, everyTypeOnce],
  [
    'logRow',
    rowWriteSchema,
    {
      clientId: A_CLIENT_ID,
      profilePublicId: A_PROFILE,
      day: A_DAY,
      workoutPublicId: A_WORKOUT,
      prescriptionPublicId: aPrescription,
      set: 1,
      values: { quantities: [] },
    },
  ],
  [
    'untickRow',
    rowUntickSchema,
    { profilePublicId: A_PROFILE, day: A_DAY, entryPublicId: AN_ENTRY },
  ],
  [
    'retickRow',
    rowRetickSchema,
    {
      profilePublicId: A_PROFILE,
      day: A_DAY,
      entryPublicId: AN_ENTRY,
      hiddenAt: '2026-11-14T15:04:05.123456Z',
    },
  ],
  [
    'amendRow',
    rowAmendSchema,
    { profilePublicId: A_PROFILE, entryPublicId: AN_ENTRY, values: { quantities: [] } },
  ],
  [
    'a row’s answer',
    rowResultSchema,
    { ok: true, entryPublicId: AN_ENTRY, values: { quantities: [] } },
  ],
];

describe('an id has one spelling after the parse (C25)', () => {
  it('takes a uuid in either case and hands it back in lower case', () => {
    const quiet = lower(A_PROGRAM);
    const shouted = upper(A_PROGRAM);
    // The premise: the two differ, they are one id to anything that folds case, and the app-wide
    // schema keeps whichever case it was given.
    expect(shouted).not.toBe(quiet);
    expect(shouted.toLowerCase()).toBe(quiet);
    expect(uuidSchema.parse(shouted)).toBe(shouted);
    expect(lowerCaseUuidSchema.parse(shouted)).toBe(quiet);
    expect(lowerCaseUuidSchema.parse(quiet)).toBe(quiet);
    // Still a uuid check: lower-casing is all it adds.
    expect(lowerCaseUuidSchema.safeParse('P1').success).toBe(false);
    expect(lowerCaseUuidSchema.safeParse(` ${quiet}`).success).toBe(false);
    expect(lowerCaseUuidSchema.nullable().parse(null)).toBeNull();
  });

  it.each(READS_AN_ID)('%s: an upper-case id parses to the lower-case one', (_, schema, input) => {
    // The premise: the input holds an id, and the two spellings of it differ.
    expect(idsIn(input).length).toBeGreaterThan(0);
    expect(idsIn(upper(input))).not.toEqual(idsIn(lower(input)));
    expect(idsIn(upper(input)).map((id) => id.toLowerCase())).toEqual(idsIn(lower(input)));
    // 🔴 Every id the parse hands back is lower case, wherever it sits in the shape, and the
    // whole answer is the one the lower-case input gets.
    const parsed = schema.parse(upper(input));
    expect(idsIn(parsed)).toEqual(idsIn(lower(input)));
    expect(parsed).toEqual(schema.parse(lower(input)));
  });

  it('🔴 no shape reads an id with the case-keeping schema', () => {
    // The table above covers the schemas that exist. This covers the next field added: the two
    // shape files have one way to say "an id", and it is `lowerCaseUuidSchema`.
    for (const file of ['./program-shapes.ts', './day-shapes.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/\buuidSchema\b/);
      expect(source, file).not.toMatch(/\.uuid(v\d)?\(/);
      expect(source, file).toMatch(/\blowerCaseUuidSchema\b/);
    }
  });
});

describe('an id written in two cases is one id (C25)', () => {
  it('refuses two cards whose ids differ only in case, on load and on save', () => {
    const one = lower(firstCard);
    const other = lower(secondCard);
    const twin = { ...other, prescriptionClientId: upper(one.prescriptionClientId) };
    // The premise: the same two cards under their own ids are a draft that saves, in either case.
    expect(saveWorkoutSchema.safeParse({ ...heavyADraft, items: [one, other] }).success).toBe(true);
    expect(
      saveWorkoutSchema.safeParse({ ...heavyADraft, items: [one, upper(other)] }).success,
    ).toBe(true);
    for (const schema of [workoutDraftSchema, saveWorkoutSchema]) {
      const result = schema.safeParse({ ...heavyADraft, items: [one, twin] });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(
        'each card has its own prescriptionClientId',
      );
    }
  });

  it('refuses a workout twice on a day, a program twice in an order, an athlete twice in a Put on', () => {
    const slot = { workoutPublicId: lower(A_WORKOUT), label: null };
    const saves = (first: unknown[]) =>
      weekDraftSchema.safeParse({ programPublicId: A_PROGRAM, days: { ...week, 0: first } })
        .success;
    expect(saves([slot])).toBe(true);
    expect(saves([slot, { ...slot, workoutPublicId: upper(A_WORKOUT) }])).toBe(false);

    const orders = (programPublicIds: string[]) =>
      programOrderSchema.safeParse({ profilePublicId: A_PROFILE, programPublicIds }).success;
    expect(orders([lower(A_PROGRAM), upper(fixtureIds.program('p2'))])).toBe(true);
    expect(orders([lower(A_PROGRAM), upper(A_PROGRAM)])).toBe(false);

    const assigns = (profilePublicIds: string[]) =>
      assignDraftSchema.safeParse({ programPublicId: A_PROGRAM, profilePublicIds, from: A_DAY })
        .success;
    expect(assigns([lower(A_PROFILE), upper(fixtureIds.athlete('a2'))])).toBe(true);
    expect(assigns([lower(A_PROFILE), upper(A_PROFILE)])).toBe(false);
  });

  it('holds a program page’s week to its workouts whatever case the week names them in', () => {
    // `programViewSchema` checks each slot against a Set of the page's workouts.
    const page = lower(familyProgram);
    expect(programViewSchema.safeParse({ ...page, week: upper(page.week) }).success).toBe(true);
    // And still refuses a slot for a workout the page does not list.
    const stray = { workoutPublicId: upper(fixtureIds.workout('w5')), label: null };
    expect(
      programViewSchema.safeParse({ ...page, week: { ...page.week, 0: [stray] } }).success,
    ).toBe(false);
  });
});

describe('weekRepeatsAWorkout: why a refused week was refused (C25)', () => {
  const programPublicId = A_PROGRAM;
  const slot = (workoutPublicId: unknown, label: string | null = null) => ({
    workoutPublicId,
    label,
  });
  const withSunday = (...slots: unknown[]) => ({ programPublicId, days: { ...week, 0: slots } });
  const heavy = lower(A_WORKOUT);
  const light = lower(fixtureIds.workout('w3'));

  it('finds one workout twice on a day, in one spelling or two', () => {
    expect(weekRepeatsAWorkout(withSunday(slot(heavy), slot(heavy, 'Evening')))).toBe(true);
    expect(weekRepeatsAWorkout(withSunday(slot(heavy), slot(upper(A_WORKOUT))))).toBe(true);
    expect(weekRepeatsAWorkout(withSunday(slot(upper(A_WORKOUT)), slot(light), slot(heavy)))).toBe(
      true,
    );
  });

  it('finds a repeat on any day of the week, not only the first', () => {
    for (const day of WEEKDAYS) {
      // Every other day is as the program page holds it; only this one names a workout twice.
      const days = { ...week, [day]: [slot(heavy), slot(upper(A_WORKOUT), 'Evening')] };
      expect(weekRepeatsAWorkout({ programPublicId, days }), `day ${day}`).toBe(true);
      expect(weekDraftSchema.safeParse({ programPublicId, days }).success, `day ${day}`).toBe(
        false,
      );
      // And with that day set right again, the week is no repeat.
      const once = { ...week, [day]: [slot(heavy)] };
      expect(weekRepeatsAWorkout({ programPublicId, days: once }), `day ${day}`).toBe(false);
    }
  });

  it('agrees with the schema: a week it calls a repeat never parses', () => {
    for (const twice of [
      withSunday(slot(heavy), slot(heavy)),
      withSunday(slot(heavy), slot(upper(A_WORKOUT))),
    ]) {
      expect(weekRepeatsAWorkout(twice)).toBe(true);
      expect(weekDraftSchema.safeParse(twice).success).toBe(false);
    }
    // And the week a program page holds is no repeat, and parses.
    const asSaved = { programPublicId, days: week };
    expect(weekRepeatsAWorkout(asSaved)).toBe(false);
    expect(weekDraftSchema.safeParse(asSaved).success).toBe(true);
  });

  it('is not fooled by two different workouts, or one workout on two days', () => {
    expect(weekRepeatsAWorkout(withSunday(slot(heavy), slot(upper(light))))).toBe(false);
    expect(
      weekRepeatsAWorkout({
        programPublicId,
        days: { ...week, 0: [slot(heavy)], 2: [slot(heavy)] },
      }),
    ).toBe(false);
  });

  it('counts any repeat, whatever else is wrong with the draft', () => {
    const tooLong = 'x'.repeat(500);
    expect(weekRepeatsAWorkout(withSunday(slot(heavy, tooLong), slot(heavy)))).toBe(true);
    expect(weekRepeatsAWorkout({ days: { 0: [slot(heavy), slot(heavy)] } })).toBe(true);
  });

  it('never calls a slot with no id, or with an id that is no uuid, a repeat', () => {
    expect(weekRepeatsAWorkout(withSunday({}, {}))).toBe(false);
    expect(weekRepeatsAWorkout(withSunday(null, null))).toBe(false);
    expect(weekRepeatsAWorkout(withSunday(slot('w2'), slot('w2')))).toBe(false);
    expect(weekRepeatsAWorkout(withSunday(slot(7), slot(7)))).toBe(false);
  });

  it('takes anything', () => {
    for (const junk of [
      undefined,
      null,
      7,
      'week',
      [],
      {},
      { days: null },
      { days: 'x' },
      { days: { 0: 'x' } },
    ]) {
      expect(weekRepeatsAWorkout(junk)).toBe(false);
    }
  });
});
