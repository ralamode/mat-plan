import { describe, expect, it } from 'vitest';

import { TRACKING_TYPE, TRACKING_TYPES, type TrackingType } from '../movements';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { UNIT_CODES } from '../units';
import { heavyADraft, newWorkoutEmpty, WORKOUT_DRAFT_FIXTURES } from './fixtures';
import { stamped, workoutDraft } from './fixtures/build';
import { seedWorld } from './fixtures/world';
import {
  fillRowValues,
  hasSetRows,
  itemUnit,
  prescribedTarget,
  SET_TRACKING_TYPES,
  TRACKING_TYPE_FIELDS,
  unitsForTrackingType,
} from './pieces';
import { saveWorkoutSchema, workoutDraftSchema, type WorkoutDraft } from './program-shapes';

/**
 * The sets rule on save (FAM-1 contract change C2): `saveWorkoutSchema` holds each item's `sets` to
 * its tracking type, and `workoutDraftSchema`, which the editor loads, does not.
 */

/**
 * What a card of this type carries so that it can be logged: a quantity in the type's slot, in a
 * unit the type allows, with no target; nothing for a type with no quantity (a Check, Reps).
 */
const quantitiesFor = (trackingType: TrackingType): WorkoutDraft['items'][number]['quantities'] => {
  const { slot } = TRACKING_TYPE_FIELDS[trackingType];
  return slot === null ? [] : [{ slot, unit: unitsForTrackingType(trackingType)[0], value: null }];
};

/** Heavy A with one card, of this type and with this set count. */
const withOne = (trackingType: TrackingType, sets: number | null): WorkoutDraft => ({
  ...heavyADraft,
  items: [{ ...heavyADraft.items[0], trackingType, sets, quantities: quantitiesFor(trackingType) }],
});

/** The same card with these quantities, and the set count its type needs. */
const withQuantities = (
  trackingType: TrackingType,
  quantities: WorkoutDraft['items'][number]['quantities'],
): WorkoutDraft => ({
  ...heavyADraft,
  items: [
    {
      ...heavyADraft.items[0],
      trackingType,
      sets: hasSetRows(trackingType) ? 3 : null,
      quantities,
    },
  ],
});
const saves = (draft: unknown) => saveWorkoutSchema.safeParse(draft).success;
const loads = (draft: unknown) => workoutDraftSchema.safeParse(draft).success;

describe('saveWorkoutSchema: the sets rule', () => {
  it.each(TRACKING_TYPES)('%s: a set count exactly when the type is logged set by set', (type) => {
    const setBased = TRACKING_TYPE_FIELDS[type].sets;
    expect(saves(withOne(type, 3))).toBe(setBased);
    expect(saves(withOne(type, null))).toBe(!setBased);
  });

  it('refuses a set-based item with no set count', () => {
    expect([...SET_TRACKING_TYPES]).toEqual([
      TRACKING_TYPE.reps,
      TRACKING_TYPE.weight_reps,
      TRACKING_TYPE.time_sets,
      TRACKING_TYPE.distance,
    ]);
    for (const type of SET_TRACKING_TYPES) expect(saves(withOne(type, null))).toBe(false);
  });

  it('refuses a set count on a Check, a Count or a Duration', () => {
    expect(saves(withOne(TRACKING_TYPE.check, 3))).toBe(false);
    expect(saves(withOne(TRACKING_TYPE.duration, 3))).toBe(false);
    expect(saves(withOne(TRACKING_TYPE.count, 1))).toBe(false);
  });

  it('still loads both as a draft: the editor holds a card mid-edit', () => {
    for (const type of TRACKING_TYPES) {
      expect(loads(withOne(type, null))).toBe(true);
      expect(loads(withOne(type, 3))).toBe(true);
    }
  });

  it('holds a set count to 1..MAX_SETS_PER_MOVEMENT, a whole number', () => {
    const type = TRACKING_TYPE.weight_reps;
    expect(saves(withOne(type, 1))).toBe(true);
    expect(saves(withOne(type, MAX_SETS_PER_MOVEMENT))).toBe(true);
    expect(saves(withOne(type, MAX_SETS_PER_MOVEMENT + 1))).toBe(false);
    expect(saves(withOne(type, 0))).toBe(false);
    expect(saves(withOne(type, 2.5))).toBe(false);
  });

  it('names the card and the field that broke the rule', () => {
    const [first, second, third] = heavyADraft.items;
    expect(hasSetRows(second.trackingType)).toBe(true);
    const draft = { ...heavyADraft, items: [first, { ...second, sets: null }, third] };
    const parsed = saveWorkoutSchema.safeParse(draft);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['items', 1, 'sets']]);

    const both = {
      ...heavyADraft,
      items: [
        { ...first, sets: null },
        { ...second, trackingType: TRACKING_TYPE.check, sets: 3 },
      ],
    };
    expect(saveWorkoutSchema.safeParse(both).error?.issues.map((issue) => issue.path)).toEqual([
      ['items', 0, 'sets'],
      ['items', 1, 'sets'],
    ]);
  });

  it('still needs a name, and still hands back the draft it was given', () => {
    expect(saves({ ...heavyADraft, name: '' })).toBe(false);
    expect(saveWorkoutSchema.parse(heavyADraft)).toEqual(heavyADraft);
    expect(saves({ ...newWorkoutEmpty, name: 'Mobility' })).toBe(true);
  });
});

describe('the sets rule and the prototype’s data', () => {
  it('holds for every WorkoutDraft fixture', () => {
    for (const fixture of Object.values(WORKOUT_DRAFT_FIXTURES)) {
      for (const item of fixture.items) {
        expect(item.sets !== null).toBe(hasSetRows(item.trackingType));
      }
      expect(saves({ ...fixture, name: fixture.name || 'A name' })).toBe(true);
    }
  });

  it('holds for every workout of every program in the prototype’s world', () => {
    // The fixtures are the prototype's data (plan §8), so this is the prototype's own programs:
    // each of their workouts, as the editor would load it, saves under the rule.
    const world = stamped(seedWorld());
    const drafts = world.programs.flatMap((program) =>
      program.workouts.map((workout) => workoutDraft(world, program.id, workout.wid)),
    );
    const items = drafts.flatMap((draft) => draft.items);
    expect(items.length).toBeGreaterThan(20);
    expect(new Set(items.map((item) => item.trackingType)).size).toBe(TRACKING_TYPES.length);
    for (const draft of drafts) expect(saveWorkoutSchema.safeParse(draft).error).toBeUndefined();
  });
});

/**
 * The unit rule on save (FAM-1 contract change C16): an item whose type has a quantity names the
 * unit it logs in. Without one `fillRowValues` refuses every number, so the item could be saved and
 * never logged.
 */
describe('saveWorkoutSchema: the unit rule', () => {
  /** The types whose unit comes from the prescription: a quantity slot and no fixed unit. */
  const UNIT_FROM_PRESCRIPTION = TRACKING_TYPES.filter(
    (type) => TRACKING_TYPE_FIELDS[type].slot !== null && TRACKING_TYPE_FIELDS[type].unit === null,
  );
  /** The types that log in one fixed unit, whatever the prescription holds. */
  const FIXED_UNIT = TRACKING_TYPES.filter((type) => TRACKING_TYPE_FIELDS[type].unit !== null);
  /** The types with nothing measured. */
  const NO_QUANTITY = TRACKING_TYPES.filter((type) => TRACKING_TYPE_FIELDS[type].slot === null);

  it('names the three kinds of type, so a new type has to be placed in one', () => {
    expect(UNIT_FROM_PRESCRIPTION).toEqual([
      TRACKING_TYPE.count,
      TRACKING_TYPE.weight_reps,
      TRACKING_TYPE.distance,
    ]);
    expect(FIXED_UNIT).toEqual([TRACKING_TYPE.duration, TRACKING_TYPE.time_sets]);
    expect(NO_QUANTITY).toEqual([TRACKING_TYPE.check, TRACKING_TYPE.reps]);
  });

  it.each(UNIT_FROM_PRESCRIPTION)('%s: refused with no quantity at all', (type) => {
    const parsed = saveWorkoutSchema.safeParse(withQuantities(type, []));
    expect(parsed.success).toBe(false);
    // On the card's quantities, so an editor can point at its unit select.
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['items', 0, 'quantities']]);
  });

  it.each(UNIT_FROM_PRESCRIPTION)('%s: saved with a unit and no target', (type) => {
    // "Log in this unit, no target" (plan D2): the unit is what the rule asks for, not a number.
    const quantities = quantitiesFor(type);
    expect(quantities[0]?.value).toBeNull();
    expect(saves(withQuantities(type, quantities))).toBe(true);
    expect(saves(withQuantities(type, [{ ...quantities[0], value: 20 }]))).toBe(true);
  });

  it.each(UNIT_FROM_PRESCRIPTION)('%s: a unit in another slot is not its unit', (type) => {
    const { slot } = TRACKING_TYPE_FIELDS[type];
    const other = slot === 'primary' ? 'distance' : 'primary';
    const elsewhere = [{ slot: other, unit: unitsForTrackingType(type)[0], value: 5 }] as const;
    expect(itemUnit(type, elsewhere)).toBeNull();
    expect(saves(withQuantities(type, [...elsewhere]))).toBe(false);
  });

  it.each(FIXED_UNIT)('%s: saved with no quantity, since its unit is fixed', (type) => {
    expect(itemUnit(type, [])).toBe(TRACKING_TYPE_FIELDS[type].unit);
    expect(saves(withQuantities(type, []))).toBe(true);
  });

  it.each(NO_QUANTITY)('%s: saved with no quantity, since nothing is measured', (type) => {
    expect(saves(withQuantities(type, []))).toBe(true);
  });

  it('agrees with itemUnit on every type: saved exactly when the item has a unit or needs none', () => {
    for (const type of TRACKING_TYPES) {
      for (const quantities of [[], quantitiesFor(type)]) {
        const needsUnit = TRACKING_TYPE_FIELDS[type].slot !== null;
        expect(saves(withQuantities(type, quantities))).toBe(
          !needsUnit || itemUnit(type, quantities) !== null,
        );
      }
    }
  });

  it('still loads such a card as a draft: the editor holds it until a unit is chosen', () => {
    for (const type of UNIT_FROM_PRESCRIPTION) expect(loads(withQuantities(type, []))).toBe(true);
  });

  it('reports the unit beside a broken set count on the same card', () => {
    const draft = withQuantities(TRACKING_TYPE.distance, []);
    const broken = { ...draft, items: [{ ...draft.items[0], sets: null }] };
    expect(saveWorkoutSchema.safeParse(broken).error?.issues.map((issue) => issue.path)).toEqual([
      ['items', 0, 'sets'],
      ['items', 0, 'quantities'],
    ]);
  });

  it('every WorkoutDraft fixture saves under the rule, item by item', () => {
    // One card at a time through the schema, so a fixture item that broke the rule is named.
    // (The prototype world's workouts are saved whole by the sets-rule tests above.)
    for (const draft of Object.values(WORKOUT_DRAFT_FIXTURES)) {
      for (const item of draft.items) {
        expect(
          saves({ ...draft, name: draft.name || 'A name', items: [item] }),
          item.itemName,
        ).toBe(true);
      }
    }
  });

  describe('the unit is one the type logs in', () => {
    const WITH_QUANTITY = TRACKING_TYPES.filter((type) => TRACKING_TYPE_FIELDS[type].slot !== null);

    it.each(WITH_QUANTITY)('%s: saved in exactly the units its type allows', (type) => {
      const slot = TRACKING_TYPE_FIELDS[type].slot!;
      const allowed = unitsForTrackingType(type);
      expect(allowed.length).toBeGreaterThan(0);
      for (const unit of UNIT_CODES) {
        expect(
          saves(withQuantities(type, [{ slot, unit, value: null }])),
          `${type} in ${unit}`,
        ).toBe(allowed.includes(unit));
      }
    });

    it('refuses the three the review found: each saved, and none could be logged as prescribed', () => {
      // A Count in `bool`: no number and no empty ✓ can be stored.
      expect(
        saves(
          withQuantities(TRACKING_TYPE.count, [{ slot: 'primary', unit: 'bool', value: null }]),
        ),
      ).toBe(false);
      // A Duration prescribed in seconds: the item logs in minutes, so an empty ✓ is refused.
      expect(
        saves(
          withQuantities(TRACKING_TYPE.duration, [{ slot: 'primary', unit: 'sec', value: 30 }]),
        ),
      ).toBe(false);
      // A Weight × reps in metres: it would log, in the wrong dimension.
      expect(
        saves(
          withQuantities(TRACKING_TYPE.weight_reps, [{ slot: 'primary', unit: 'm', value: 5 }]),
        ),
      ).toBe(false);
    });

    it('🔴 an item that saves with a target can be logged with an empty ✓, for every type and unit', () => {
      // The rule's purpose, checked against the writer's own function: whatever passes the save
      // with a prescribed number is stored by an empty ✓ (`fillRowValues` fills it from the target).
      for (const type of TRACKING_TYPES) {
        const { slot, reps } = TRACKING_TYPE_FIELDS[type];
        const units = slot === null ? [null] : UNIT_CODES;
        for (const unit of units) {
          const quantities = slot === null || unit === null ? [] : [{ slot, unit, value: 1 }];
          if (!saves(withQuantities(type, quantities))) continue;
          const item = { trackingType: type, unit: itemUnit(type, quantities) };
          const target = prescribedTarget(reps ? '5' : null, quantities);
          expect(
            fillRowValues(item, { quantities: [] }, target),
            `${type} in ${unit}`,
          ).not.toBeNull();
        }
      }
    });
  });
});
