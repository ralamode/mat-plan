import { describe, expect, it } from 'vitest';

import { TRACKING_TYPE, TRACKING_TYPES, type TrackingType } from '../movements';
import { MAX_SETS_PER_MOVEMENT } from '../strength-session';
import { heavyADraft, newWorkoutEmpty, WORKOUT_DRAFT_FIXTURES } from './fixtures';
import { stamped, workoutDraft } from './fixtures/build';
import { seedWorld } from './fixtures/world';
import { hasSetRows, SET_TRACKING_TYPES, TRACKING_TYPE_FIELDS } from './pieces';
import { saveWorkoutSchema, workoutDraftSchema, type WorkoutDraft } from './program-shapes';

/**
 * The sets rule on save (FAM-1 contract change C2): `saveWorkoutSchema` holds each item's `sets` to
 * its tracking type, and `workoutDraftSchema`, which the editor loads, does not.
 */

/** Heavy A with one card, of this type and with this set count. */
const withOne = (trackingType: TrackingType, sets: number | null): WorkoutDraft => ({
  ...heavyADraft,
  items: [{ ...heavyADraft.items[0], trackingType, sets }],
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
