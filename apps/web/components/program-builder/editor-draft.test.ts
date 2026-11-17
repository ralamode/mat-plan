import {
  MAX_SETS_PER_MOVEMENT,
  SLOT_LABEL_MAX,
  QUANTITY_SLOT,
  quantityCeiling,
  saveWorkoutSchema,
  TRACKING_TYPE_FIELDS,
  TRACKING_TYPES,
  unitsForTrackingType,
  type Unit,
  type WorkoutDraft,
} from '@mat-plan/shared';
import { heavyADraft, newWorkoutEmpty } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { EDITOR_ERRORS, quantityLabel } from './builder-text';
import { newCard, readDraft, toCards, type EditorCard } from './editor-draft';

const typed = (cards: EditorCard[], name = heavyADraft.name) => ({
  name,
  description: heavyADraft.description ?? '',
  cards,
});
/** heavy-a-draft's cards with one card's fields changed. */
const withCard = (index: number, patch: Partial<EditorCard>) =>
  toCards(heavyADraft).map((card, i) => (i === index ? { ...card, ...patch } : card));
const errorsOf = (result: ReturnType<typeof readDraft>) =>
  result.ok ? [] : result.errors.map(({ field, message }) => [field, message]);
const saved = (result: ReturnType<typeof readDraft>) => {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.errors)}`);
  return result.draft;
};
const WEIGHT = quantityLabel('weight_reps')!;

/**
 * One item of every tracking type, built from a heavy-a item, with the fields each type uses: a
 * draft the contract accepts, so the editor must save it untouched.
 */
const everyType: WorkoutDraft = {
  ...heavyADraft,
  items: TRACKING_TYPES.map((trackingType, i) => {
    const { sets, reps, slot } = TRACKING_TYPE_FIELDS[trackingType];
    return {
      ...heavyADraft.items[0]!,
      prescriptionClientId: `00000000-0000-7000-8000-0000000090${String(i).padStart(2, '0')}`,
      itemName: trackingType,
      trackingType,
      sets: sets ? 3 : null,
      targetReps: reps ? '8' : null,
      quantities: slot ? [{ slot, unit: unitsForTrackingType(trackingType)[0]!, value: 10 }] : [],
      superset: null,
      restAfter: null,
    };
  }),
};

describe('the editor’s draft', () => {
  it('loads and saves heavy-a-draft unchanged, and what it saves passes saveWorkoutSchema', () => {
    const draft = saved(readDraft(heavyADraft, typed(toCards(heavyADraft))));
    expect(draft).toEqual(heavyADraft);
    expect(saveWorkoutSchema.safeParse(draft).success).toBe(true);
  });

  it('saves one item of every tracking type untouched, with sets only where the type has them', () => {
    const draft = saved(
      readDraft(everyType, { name: 'Every type', description: '', cards: toCards(everyType) }),
    );
    expect(draft.items).toEqual(everyType.items);
    expect(saveWorkoutSchema.safeParse(draft).success).toBe(true);
  });

  it('an item loaded with no quantity cannot be saved without a unit, which is the unit’s refusal (C16)', () => {
    const bare = {
      ...everyType,
      items: everyType.items.map((item) => ({ ...item, quantities: [] })),
    };
    const cards = toCards(bare);
    const result = readDraft(bare, { name: 'Bare', description: '', cards });
    // Every type whose unit the prescription names (no fixed one) is refused on its unit select;
    // a type with a fixed unit, or no quantity, is not.
    const needsOne = cards.filter((card) => {
      const fields = TRACKING_TYPE_FIELDS[card.item.trackingType];
      return fields.slot !== null && fields.unit === null;
    });
    expect(needsOne.length).toBeGreaterThan(0);
    expect(errorsOf(result)).toEqual(
      needsOne.map((card) => ['unit', EDITOR_ERRORS.unit(quantityLabel(card.item.trackingType)!)]),
    );
    // Given its unit, each saves as "log in this unit, no target"; a fixed unit saves as itself.
    const chosen = cards.map((card) =>
      needsOne.includes(card)
        ? { ...card, unit: unitsForTrackingType(card.item.trackingType)[0]! }
        : card,
    );
    const draft = saved(readDraft(bare, { name: 'Bare', description: '', cards: chosen }));
    draft.items.forEach((item, k) => {
      const fields = TRACKING_TYPE_FIELDS[item.trackingType];
      expect(item.quantities).toEqual(
        fields.slot ? [{ slot: fields.slot, unit: chosen[k]!.unit, value: null }] : [],
      );
    });
    // A number typed with no unit chosen: one refusal, on the unit.
    const count = cards.find((card) => card.item.trackingType === 'count')!;
    expect(
      errorsOf(
        readDraft(bare, { name: 'Bare', description: '', cards: [{ ...count, value: '5' }] }),
      ),
    ).toEqual([['unit', EDITOR_ERRORS.unit(quantityLabel('count')!)]]);
    // Not a number and no unit: the unit first, so Save focuses the select.
    expect(
      errorsOf(
        readDraft(bare, { name: 'Bare', description: '', cards: [{ ...count, value: 'abc' }] }),
      ),
    ).toEqual([
      ['unit', EDITOR_ERRORS.unit(quantityLabel('count')!)],
      ['value', EDITOR_ERRORS.value(quantityLabel('count')!)],
    ]);
  });

  it('a loaded number in a unit its type can’t hold is never shown or converted (plan D27)', () => {
    const typed = (trackingType: string) =>
      everyType.items.find((item) => item.trackingType === trackingType)!;
    const withQuantity = (trackingType: string, unit: string, value: number) =>
      ({
        ...everyType,
        items: [
          { ...typed(trackingType), quantities: [{ slot: QUANTITY_SLOT.primary, unit, value }] },
        ],
      }) as WorkoutDraft;
    // A Duration stored in seconds: it keeps its own unit (it has no select), the number goes, and
    // the card says what it was. Saved as it stands: "log in minutes, no target".
    const duration = withQuantity('duration', 'sec', 30);
    const [durationCard] = toCards(duration);
    expect(durationCard).toMatchObject({
      unit: 'min',
      value: '',
      dropped: { value: 30, unit: 'sec' },
    });
    expect(
      saved(readDraft(duration, { name: 'D', description: '', cards: [durationCard!] })).items[0]!
        .quantities,
    ).toEqual([{ slot: QUANTITY_SLOT.primary, unit: 'min', value: null }]);
    // A Count stored in `bool`: unset, so Save's unit refusal lands on the select.
    const count = withQuantity('count', 'bool', 5);
    const [countCard] = toCards(count);
    expect(countCard).toMatchObject({ unit: null, value: '', dropped: { value: 5, unit: 'bool' } });
    expect(errorsOf(readDraft(count, { name: 'C', description: '', cards: [countCard!] }))).toEqual(
      [['unit', EDITOR_ERRORS.unit(quantityLabel('count')!)]],
    );
    // A unit it can't hold with no number: nothing a person typed is lost, so no note.
    expect(
      toCards({
        ...everyType,
        items: [
          {
            ...typed('count'),
            quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'bool', value: null }],
          },
        ],
      } as WorkoutDraft)[0],
    ).toMatchObject({ unit: null, value: '', dropped: null });
    // A unit the type holds loads as it was, with nothing dropped.
    const [fine] = toCards(withQuantity('duration', 'min', 20));
    expect(fine).toMatchObject({ unit: 'min', value: '20', dropped: null });
  });

  it('a new workout needs a name, and saves with no items', () => {
    expect(errorsOf(readDraft(newWorkoutEmpty, { name: ' ', description: '', cards: [] }))).toEqual(
      [['name', EDITOR_ERRORS.name]],
    );
    expect(
      saved(readDraft(newWorkoutEmpty, { name: ' Heavy  B ', description: '', cards: [] })),
    ).toEqual({ ...newWorkoutEmpty, name: 'Heavy B', description: null, items: [] });
  });

  it('Sets is a whole number from 1 to the limit, both ends included', () => {
    for (const sets of ['', '0', '2.5', String(MAX_SETS_PER_MOVEMENT + 1)]) {
      expect(errorsOf(readDraft(heavyADraft, typed(withCard(0, { sets }))))).toEqual([
        ['sets', EDITOR_ERRORS.sets],
      ]);
    }
    for (const sets of [1, MAX_SETS_PER_MOVEMENT]) {
      expect(
        saved(readDraft(heavyADraft, typed(withCard(0, { sets: ` ${sets} ` })))).items[0]!.sets,
      ).toBe(sets);
    }
  });

  it('Reps is a whole number or blank; "10 per side" belongs in the instructions', () => {
    expect(errorsOf(readDraft(heavyADraft, typed(withCard(0, { reps: '10 per side' }))))).toEqual([
      ['reps', EDITOR_ERRORS.reps],
    ]);
    expect(
      saved(readDraft(heavyADraft, typed(withCard(0, { reps: '' })))).items[0]!.targetReps,
    ).toBeNull();
  });

  it('a quantity is a plain number up to its unit’s ceiling; blank keeps the unit with no target', () => {
    for (const value of ['-5', '1e3', '25 lb', '2.5555']) {
      expect(errorsOf(readDraft(heavyADraft, typed(withCard(0, { value }))))).toEqual([
        ['value', EDITOR_ERRORS.value(WEIGHT)],
      ]);
    }
    const ceiling = quantityCeiling('lb')!;
    expect(
      errorsOf(readDraft(heavyADraft, typed(withCard(0, { value: String(ceiling + 1) })))),
    ).toEqual([['value', EDITOR_ERRORS.ceiling(WEIGHT, ceiling, 'lb')]]);
    expect(
      saved(readDraft(heavyADraft, typed(withCard(0, { value: String(ceiling) })))).items[0]!
        .quantities,
    ).toEqual([{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: ceiling }]);
    expect(
      saved(readDraft(heavyADraft, typed(withCard(0, { value: '', unit: 'kg' })))).items[0]!
        .quantities,
    ).toEqual([{ slot: QUANTITY_SLOT.primary, unit: 'kg', value: null }]);
  });

  it('instructions are one line: a typed line break is a space, and blank is null', () => {
    expect(
      saved(readDraft(heavyADraft, typed(withCard(0, { notes: 'Feet flat.\nTwo down. ' }))))
        .items[0]!.notes,
    ).toBe('Feet flat. Two down.');
    expect(
      saved(readDraft(heavyADraft, typed(withCard(0, { notes: '  ' })))).items[0]!.notes,
    ).toBeNull();
  });

  it('every refusal is listed, in screen order', () => {
    const cards = withCard(4, { sets: '', value: 'x' });
    expect(errorsOf(readDraft(heavyADraft, typed(cards, '')))).toEqual([
      ['name', EDITOR_ERRORS.name],
      ['sets', EDITOR_ERRORS.sets],
      ['value', EDITOR_ERRORS.value(quantityLabel('time_sets')!)],
    ]);
  });
});

describe('the contract’s last word', () => {
  it('a draft the contract refuses is never sent, and blames no field', () => {
    // Two cards with one id: every field is fine, and `workoutDraftSchema` still refuses it.
    const [first] = toCards(heavyADraft);
    expect(readDraft(heavyADraft, typed([first!, first!]))).toEqual({ ok: false, errors: [] });
  });
});

describe('quantityLabel', () => {
  it('names a field exactly where the type has a quantity; a fixed unit names its own', () => {
    for (const type of TRACKING_TYPES) {
      expect(quantityLabel(type) !== null).toBe(TRACKING_TYPE_FIELDS[type].slot !== null);
    }
    expect(quantityLabel('duration')).toBe('Minutes');
  });
});

describe('a superset’s rest', () => {
  const withRest = (rest: string) =>
    toCards(heavyADraft).map((card, i) =>
      i === 1 ? { ...card, item: { ...card.item, restAfter: rest } } : card,
    );
  it('is cleaned as a note, and bounded at SLOT_LABEL_MAX, both ends', () => {
    expect(saved(readDraft(heavyADraft, typed(withRest('  2   min ')))).items[1]!.restAfter).toBe(
      '2 min',
    );
    expect(
      saved(readDraft(heavyADraft, typed(withRest('x'.repeat(SLOT_LABEL_MAX))))).items[1]!
        .restAfter,
    ).toBe('x'.repeat(SLOT_LABEL_MAX));
    expect(
      errorsOf(readDraft(heavyADraft, typed(withRest('x'.repeat(SLOT_LABEL_MAX + 1))))),
    ).toEqual([['rest', EDITOR_ERRORS.rest]]);
  });
});

describe('a card for a picked item', () => {
  const option = (
    trackingType: Parameters<typeof newCard>[0]['trackingType'],
    unitDefault: Unit | null,
  ) => ({
    publicId: '00000000-0000-7000-8000-000000009001',
    name: 'Bear crawl',
    trackingType,
    unitDefault,
  });
  it('has no numbers; its unit is the type’s, else the item’s own when the type allows it', () => {
    const card = newCard(option('weight_reps', 'kg'), '00000000-0000-7000-8000-000000009002');
    expect(card.item).toMatchObject({
      prescriptionClientId: '00000000-0000-7000-8000-000000009002',
      itemPublicId: '00000000-0000-7000-8000-000000009001',
      itemName: 'Bear crawl',
      trackingType: 'weight_reps',
    });
    // Left alone, it saves "log in the item's own unit, no target" (invariant 13's exception).
    const read = readDraft(
      { ...heavyADraft, items: [] },
      { name: 'W', description: '', cards: [{ ...card, sets: '3' }] },
    );
    expect(saved(read).items[0]!.quantities).toEqual([
      { slot: QUANTITY_SLOT.primary, unit: 'kg', value: null },
    ]);
    expect(card).toMatchObject({ sets: '', reps: '', value: '', notes: '', unit: 'kg' });
    expect(card.item).toMatchObject({
      sets: null,
      targetReps: null,
      quantities: [],
      superset: null,
    });
    expect(newCard(option('weight_reps', 'min'), 'x').unit).toBeNull();
    expect(newCard(option('duration', null), 'x').unit).toBe('min');
    expect(newCard(option('reps', 'kg'), 'x').unit).toBeNull();
  });
});
