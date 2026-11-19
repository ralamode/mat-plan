import { describe, expect, it } from 'vitest';

import { addDays } from '../day';
import { TRACKING_TYPE, TRACKING_TYPES } from '../movements';
import { QUANTITY_SLOT } from '../quantity-slots';
import {
  DAY_PLAN_FIXTURES,
  everyTypeOnce,
  familyProgram,
  FIXTURE_TODAY,
  heavyADraft,
  PROGRAM_VIEW_FIXTURES,
} from './fixtures';
import { programsByStay } from './day-shapes';
import { slotQuantity, TRACKING_TYPE_FIELDS } from './pieces';
import { hasStarted } from './program-shapes';

/**
 * The small rules the lanes share rather than each writing its own (FAM-1 contract change C1):
 * which quantity is a tracking type's, whether an athlete has started on a program, and which of
 * an athlete's current programs stay.
 */

describe('slotQuantity: the tracking type’s quantity out of a list', () => {
  const load = { slot: QUANTITY_SLOT.primary, unit: 'lb', value: 25 } as const;
  const run = { slot: QUANTITY_SLOT.distance, unit: 'yd', value: 40 } as const;
  const vest = { slot: QUANTITY_SLOT.vest, unit: 'lb', value: 10 } as const;

  it.each(TRACKING_TYPES)('%s: the quantity in the slot TRACKING_TYPE_FIELDS names', (type) => {
    const { slot } = TRACKING_TYPE_FIELDS[type];
    const found = slotQuantity({ trackingType: type }, [vest, run, load]);
    if (slot === null) expect(found).toBeNull();
    else expect(found?.slot).toBe(slot);
  });

  it('reads a Distance from the distance slot and every other measured type from primary', () => {
    const of = (trackingType: (typeof TRACKING_TYPES)[number]) =>
      slotQuantity({ trackingType }, [load, run]);
    expect(of(TRACKING_TYPE.distance)).toBe(run);
    expect(of(TRACKING_TYPE.weight_reps)).toBe(load);
    expect(of(TRACKING_TYPE.count)).toBe(load);
    expect(of(TRACKING_TYPE.duration)).toBe(load);
    expect(of(TRACKING_TYPE.time_sets)).toBe(load);
  });

  it('answers null for a type that holds no quantity, whatever the list has', () => {
    expect(slotQuantity({ trackingType: TRACKING_TYPE.check }, [load, run])).toBeNull();
    expect(slotQuantity({ trackingType: TRACKING_TYPE.reps }, [load, run])).toBeNull();
  });

  it('answers null when the list has none in the slot, or is empty', () => {
    expect(slotQuantity({ trackingType: TRACKING_TYPE.distance }, [load])).toBeNull();
    expect(slotQuantity({ trackingType: TRACKING_TYPE.weight_reps }, [run, vest])).toBeNull();
    expect(slotQuantity({ trackingType: TRACKING_TYPE.count }, [])).toBeNull();
  });

  it('hands back the quantity itself, a prescribed one with no value included', () => {
    // `value: null` is "log in this unit, no target" (plan D2): whether that is a target is the
    // caller's question, so it is returned as it is, and never copied.
    const open = { slot: QUANTITY_SLOT.primary, unit: 'lb', value: null } as const;
    expect(slotQuantity({ trackingType: TRACKING_TYPE.count }, [open])).toBe(open);
  });

  it('takes the item a caller has: a day’s item, or a workout draft’s', () => {
    for (const item of everyTypeOnce.workouts.flatMap((workout) => workout.items)) {
      const { slot } = TRACKING_TYPE_FIELDS[item.trackingType];
      const expected = item.target.quantities.find((q) => q.slot === slot) ?? null;
      expect(slotQuantity(item, item.target.quantities)).toBe(expected);
      // Every type with a slot has a prescribed quantity in this fixture, so this is not vacuous.
      expect(expected === null).toBe(slot === null);
    }
    for (const item of heavyADraft.items) {
      const found = slotQuantity(item, item.quantities);
      expect(found === null).toBe(item.quantities.length === 0);
    }
  });

  it('finds the one quantity of every logged row and every PREVIOUS in the fixtures', () => {
    let logged = 0;
    for (const plan of Object.values(DAY_PLAN_FIXTURES)) {
      for (const item of plan.workouts.flatMap((workout) => workout.items)) {
        for (const row of item.rows) {
          for (const values of [row.logged?.values, row.previous]) {
            if (!values) continue;
            // A row holds its type's one quantity or none, so the lookup returns all there is.
            expect(slotQuantity(item, values.quantities)).toBe(values.quantities[0] ?? null);
            logged += 1;
          }
        }
      }
    }
    expect(logged).toBeGreaterThan(0);
  });

  it('is exported from the root barrel', async () => {
    const barrel = await import('../index');
    expect(barrel.slotQuantity).toBe(slotQuantity);
  });
});

describe('hasStarted: an athlete has started when their since is today or earlier', () => {
  const today = FIXTURE_TODAY;

  it('is true from the first day on, and false before it', () => {
    expect(hasStarted({ since: addDays(today, -7) }, today)).toBe(true);
    expect(hasStarted({ since: addDays(today, -1) }, today)).toBe(true);
    expect(hasStarted({ since: today }, today)).toBe(true);
    // Put on, starting tomorrow: listed, not started.
    expect(hasStarted({ since: addDays(today, 1) }, today)).toBe(false);
  });

  it('compares calendar days across a month and a year', () => {
    expect(hasStarted({ since: '2026-09-30' }, '2026-10-01')).toBe(true);
    expect(hasStarted({ since: '2026-10-01' }, '2026-09-30')).toBe(false);
    expect(hasStarted({ since: '2026-12-31' }, '2027-01-01')).toBe(true);
    expect(hasStarted({ since: '2027-01-01' }, '2026-12-31')).toBe(false);
  });

  it('takes a program page’s athlete as it is, against the page’s today', () => {
    expect(familyProgram.athletes.length).toBeGreaterThan(0);
    for (const view of Object.values(PROGRAM_VIEW_FIXTURES)) {
      for (const athlete of view.athletes) {
        expect(hasStarted(athlete, view.today)).toBe(athlete.since <= view.today);
        // Someone already taken off had started: a last day is only ever set on a started athlete.
        if (athlete.lastDay) expect(hasStarted(athlete, view.today)).toBe(true);
      }
    }
  });

  it('is exported from the root barrel', async () => {
    const barrel = await import('../index');
    expect(barrel.hasStarted).toBe(hasStarted);
  });
});

describe('programsByStay: a day’s current programs, split by whether they stay (C37)', () => {
  type Program = { name: string; endsToday?: boolean };
  const stays = (name: string): Program => ({ name });
  const ends = (name: string): Program => ({ name, endsToday: true });
  const names = (split: ReturnType<typeof programsByStay<Program>>) => ({
    staying: split.staying.map((p) => p.name),
    ending: split.ending.map((p) => p.name),
  });

  it('gives two empty lists for no programs', () => {
    expect(programsByStay([])).toEqual({ staying: [], ending: [] });
  });

  it('keeps every program as staying when none ends today', () => {
    expect(names(programsByStay([stays('a'), stays('b')]))).toEqual({
      staying: ['a', 'b'],
      ending: [],
    });
  });

  it('splits a mixed list, wherever the ending ones sit', () => {
    expect(names(programsByStay([ends('a'), stays('b'), ends('c'), stays('d')]))).toEqual({
      staying: ['b', 'd'],
      ending: ['a', 'c'],
    });
  });

  it('gives every program as ending when all end today', () => {
    expect(names(programsByStay([ends('a'), ends('b')]))).toEqual({
      staying: [],
      ending: ['a', 'b'],
    });
  });

  it('keeps the order it was given in both lists, and the members themselves', () => {
    const list = [stays('c'), ends('z'), stays('a'), ends('m'), stays('b')];
    const { staying, ending } = programsByStay(list);
    expect(staying).toEqual([list[0], list[2], list[4]]);
    expect(ending).toEqual([list[1], list[3]]);
    // The same objects, not copies: a caller's own fields come back untouched.
    expect(staying[0]).toBe(list[0]);
    expect(ending[1]).toBe(list[3]);
    // And the list it was given is not changed: a fixture's is frozen.
    expect(list.map((p) => p.name)).toEqual(['c', 'z', 'a', 'm', 'b']);
  });

  it('🔴 splits on `true` alone: a false or missing flag stays', () => {
    const loose: Program[] = [
      { name: 'a', endsToday: false },
      { name: 'b', endsToday: undefined },
      ends('c'),
    ];
    expect(names(programsByStay(loose))).toEqual({ staying: ['a', 'b'], ending: ['c'] });
  });

  it('gives a plan’s own list back as staying then ending, in every day fixture', () => {
    let ending = 0;
    for (const plan of Object.values(DAY_PLAN_FIXTURES)) {
      const split = programsByStay(plan.currentPrograms);
      expect([...split.staying, ...split.ending]).toEqual(plan.currentPrograms);
      expect(Object.isFrozen(plan.currentPrograms)).toBe(true);
      ending += split.ending.length;
    }
    // Not vacuous: two fixtures hold a program ending today.
    expect(ending).toBe(2);
  });

  it('is exported from the root barrel', async () => {
    const barrel = await import('../index');
    expect(barrel.programsByStay).toBe(programsByStay);
  });
});
