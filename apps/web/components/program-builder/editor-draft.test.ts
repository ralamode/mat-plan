import { MAX_SETS_PER_MOVEMENT, quantityCeiling, saveWorkoutSchema } from '@mat-plan/shared';
import { heavyADraft, newWorkoutEmpty } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { EDITOR_ERRORS, readDraft, toCards, type EditorCard } from './editor-draft';

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

describe('the editor’s draft', () => {
  it('loads and saves heavy-a-draft unchanged, and what it saves passes saveWorkoutSchema', () => {
    const read = readDraft(heavyADraft, typed(toCards(heavyADraft)));
    expect(read).toEqual({ ok: true, draft: heavyADraft });
    expect(saveWorkoutSchema.safeParse(read.ok && read.draft).success).toBe(true);
  });

  it('a new workout needs a name, and saves with no items', () => {
    expect(errorsOf(readDraft(newWorkoutEmpty, { name: ' ', description: '', cards: [] }))).toEqual(
      [['name', EDITOR_ERRORS.name]],
    );
    const read = readDraft(newWorkoutEmpty, { name: ' Heavy  B ', description: '', cards: [] });
    expect(read).toEqual({
      ok: true,
      draft: { ...newWorkoutEmpty, name: 'Heavy B', description: null, items: [] },
    });
  });

  it('Sets is a whole number from 1 to the limit, on a set-based type', () => {
    for (const sets of ['', '0', '2.5', String(MAX_SETS_PER_MOVEMENT + 1)]) {
      expect(errorsOf(readDraft(heavyADraft, typed(withCard(0, { sets }))))).toEqual([
        ['sets', EDITOR_ERRORS.sets],
      ]);
    }
    const read = readDraft(heavyADraft, typed(withCard(0, { sets: ' 5 ' })));
    expect(read.ok && read.draft.items[0]!.sets).toBe(5);
  });

  it('Reps is a whole number or blank; "10 per side" belongs in the instructions', () => {
    expect(errorsOf(readDraft(heavyADraft, typed(withCard(0, { reps: '10 per side' }))))).toEqual([
      ['reps', EDITOR_ERRORS.reps],
    ]);
    const read = readDraft(heavyADraft, typed(withCard(0, { reps: '' })));
    expect(read.ok && read.draft.items[0]!.targetReps).toBeNull();
  });

  it('a quantity is a plain number under its unit’s ceiling; blank keeps the unit with no target', () => {
    for (const value of ['-5', '1e3', '25 lb', '2.5555']) {
      expect(errorsOf(readDraft(heavyADraft, typed(withCard(0, { value }))))).toEqual([
        ['value', EDITOR_ERRORS.value('Weight')],
      ]);
    }
    const ceiling = quantityCeiling('lb')!;
    expect(
      errorsOf(readDraft(heavyADraft, typed(withCard(0, { value: String(ceiling + 1) })))),
    ).toEqual([['value', EDITOR_ERRORS.ceiling('Weight', ceiling, 'pounds')]]);
    const blank = readDraft(heavyADraft, typed(withCard(0, { value: '', unit: 'kg' })));
    expect(blank.ok && blank.draft.items[0]!.quantities).toEqual([
      { slot: 'primary', unit: 'kg', value: null },
    ]);
  });

  it('instructions are one line: a typed line break is a space, and blank is null', () => {
    const read = readDraft(heavyADraft, typed(withCard(0, { notes: 'Feet flat.\nTwo down. ' })));
    expect(read.ok && read.draft.items[0]!.notes).toBe('Feet flat. Two down.');
    const blank = readDraft(heavyADraft, typed(withCard(0, { notes: '  ' })));
    expect(blank.ok && blank.draft.items[0]!.notes).toBeNull();
  });

  it('every refusal is listed, in screen order', () => {
    const cards = withCard(4, { sets: '', value: 'x' });
    expect(errorsOf(readDraft(heavyADraft, typed(cards, '')))).toEqual([
      ['name', EDITOR_ERRORS.name],
      ['sets', EDITOR_ERRORS.sets],
      ['value', EDITOR_ERRORS.value('Seconds')],
    ]);
  });
});
