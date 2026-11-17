import { describe, expect, it } from 'vitest';

import { TRACKING_TYPE } from '../movements';
import { heavyADraft } from './fixtures';
import {
  copyDraftSchema,
  createProgramSchema,
  emptyWeek,
  newItemSchema,
  renameProgramSchema,
  saveWorkoutSchema,
  weekDraftSchema,
} from './program-shapes';

/**
 * Every text a person types into the program builder, with a control character inside it.
 *
 * A NUL that parses reaches Postgres, which refuses it, and the action then THROWS instead of
 * answering `invalid` (`shortTextSchema`'s doc comment in `pieces.ts`). So the write schemas refuse
 * one in every typed field, not only in the fields that happened to be built on a strict helper.
 * A field added to a write schema belongs in this table.
 */
const NUL = 'Feet\u0000flat';
const ESC = 'Feet\u001bflat';
const [item] = heavyADraft.items;
if (!item) throw new Error('heavy-a-draft has no items');
const programPublicId = heavyADraft.programPublicId;
/** Any valid id: these cases are about the text beside it. */
const anyId = programPublicId;

const typed: Array<[string, (text: string) => boolean]> = [
  [
    'a program name, on create',
    (t) => createProgramSchema.safeParse({ clientId: anyId, name: t }).success,
  ],
  [
    'a program name, on rename',
    (t) => renameProgramSchema.safeParse({ programPublicId, name: t }).success,
  ],
  [
    'a new item name',
    (t) => newItemSchema.safeParse({ name: t, trackingType: TRACKING_TYPE.check }).success,
  ],
  ['a workout name', (t) => saveWorkoutSchema.safeParse({ ...heavyADraft, name: t }).success],
  [
    'a workout description',
    (t) => saveWorkoutSchema.safeParse({ ...heavyADraft, description: t }).success,
  ],
  [
    'an item’s instructions',
    (t) => saveWorkoutSchema.safeParse({ ...heavyADraft, items: [{ ...item, notes: t }] }).success,
  ],
  [
    'an item’s reps',
    (t) =>
      saveWorkoutSchema.safeParse({
        ...heavyADraft,
        items: [{ ...item, targetReps: t.slice(0, 10) }],
      }).success,
  ],
  [
    'an item’s rest',
    (t) =>
      saveWorkoutSchema.safeParse({ ...heavyADraft, items: [{ ...item, restAfter: t }] }).success,
  ],
  [
    'a superset’s group key',
    (t) =>
      saveWorkoutSchema.safeParse({
        ...heavyADraft,
        items: [{ ...item, superset: { group: t, order: 1 } }],
      }).success,
  ],
  [
    'a week slot’s label',
    (t) =>
      weekDraftSchema.safeParse({
        programPublicId,
        days: { ...emptyWeek(), 1: [{ workoutPublicId: anyId, label: t }] },
      }).success,
  ],
  [
    'a copied workout’s label',
    (t) =>
      copyDraftSchema.safeParse({
        clientId: anyId,
        workoutPublicId: anyId,
        toProgramPublicId: anyId,
        weekdays: [1],
        label: t,
      }).success,
  ],
];

describe('the write schemas refuse a control character in every typed text', () => {
  it.each(typed)('%s', (_name, accepts) => {
    expect(accepts('Feet flat')).toBe(true);
    expect(accepts(NUL)).toBe(false);
    expect(accepts(ESC)).toBe(false);
  });
});

describe('the one string in a write schema that is NOT typed', () => {
  /**
   * `items[].itemName` rides along in a saved draft so the editor can show the card, and is a LABEL
   * read from the catalog (`movementLabelSchema`): an old name may hold a comma or a tab, so it is
   * not tightened here. It is safe only because the writer never stores it: `saveWorkout` takes the
   * item by `itemPublicId` and reads its name and type from the database. Lane P's step 6a owes the
   * proof of that; this case exists so the gap is a decision, not an oversight.
   */
  it('an item’s name on a saved draft accepts what the catalog may hold, by design', () => {
    const withName = (itemName: string) =>
      saveWorkoutSchema.safeParse({ ...heavyADraft, items: [{ ...item, itemName }] }).success;
    expect(withName('Push-ups, strict')).toBe(true);
    expect(withName(NUL)).toBe(true);
  });
});
