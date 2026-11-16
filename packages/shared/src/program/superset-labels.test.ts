import { describe, expect, it } from 'vitest';

import { MAX_WORKOUT_ITEMS } from '../programming';
import { DAY_PLAN_FIXTURES, heavyADraft, heavyASupersets } from './fixtures';
import { supersetLabels, type Superset } from './pieces';

/**
 * The letters a screen shows for supersets (FAM-1 contract change C2): `supersetSchema`'s rule, as
 * one function for the workout editor and the day page.
 */

/** Items from a compact spelling: a group key per item, or `null` for an item on its own. */
const items = (...groups: (string | null)[]): { superset: Superset }[] => {
  const seen = new Map<string, number>();
  return groups.map((group) => {
    if (group === null) return { superset: null };
    const order = (seen.get(group) ?? 0) + 1;
    seen.set(group, order);
    return { superset: { group, order } };
  });
};

describe('supersetLabels', () => {
  it('labels Heavy A as the prototype shows it: A1, A2, B1, B2, and none for the last item', () => {
    expect(heavyADraft.items.map((item) => item.superset?.group ?? null)).toEqual([
      'a',
      'a',
      'b',
      'b',
      null,
    ]);
    expect(supersetLabels(heavyADraft.items)).toEqual(['A1', 'A2', 'B1', 'B2', null]);
  });

  it('reads group b as A1 and A2 when group a is not shown (the prototype’s case)', () => {
    // The letter is ordinal among the items SHOWN, never the key: `b` is the first group here.
    const shown = heavyADraft.items.filter((item) => item.superset?.group !== 'a');
    expect(shown.map((item) => item.superset?.group ?? null)).toEqual(['b', 'b', null]);
    expect(supersetLabels(shown)).toEqual(['A1', 'A2', null]);
  });

  it('never shows the key: the first group to appear is A, whatever it is called', () => {
    expect(supersetLabels(items('zz', 'zz', 'a', 'a'))).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(supersetLabels(items('B', 'B', 'A', 'A'))).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(supersetLabels(items('7f3c-uuid', '7f3c-uuid'))).toEqual(['A1', 'A2']);
  });

  it('labels two groups with single items before, between and after them', () => {
    expect(supersetLabels(items(null, 'a', 'a', null, 'b', 'b', 'b', null))).toEqual([
      null,
      'A1',
      'A2',
      null,
      'B1',
      'B2',
      'B3',
      null,
    ]);
  });

  it('keeps one letter for a group whose items are not neighbours', () => {
    // It labels what it is given. Whether a group must be a run of neighbours is the editor's rule.
    expect(supersetLabels(items('a', 'b', 'a', null, 'b'))).toEqual(['A1', 'B1', 'A2', null, 'B2']);
  });

  it('labels a group of one A1', () => {
    expect(supersetLabels(items('a'))).toEqual(['A1']);
    expect(supersetLabels(items(null, 'a', null, 'b'))).toEqual([null, 'A1', null, 'B1']);
  });

  it('numbers by place among the items shown, not by the stored order', () => {
    // A closed day lists logged items only: the second item of a group, shown alone, reads A1.
    const second = { superset: { group: 'a', order: 2 } };
    const third = { superset: { group: 'a', order: 3 } };
    expect(supersetLabels([second])).toEqual(['A1']);
    expect(supersetLabels([second, third])).toEqual(['A1', 'A2']);
  });

  it('goes on to AA after Z, and never throws', () => {
    // More than 26 groups needs a draft of single-item groups: a saved workout has at most
    // MAX_WORKOUT_ITEMS / 2 of them. The function still answers, as a spreadsheet names columns.
    const keys = Array.from({ length: MAX_WORKOUT_ITEMS }, (_, i) => `g${i}`);
    const labels = supersetLabels(items(...keys));
    expect(labels).toHaveLength(MAX_WORKOUT_ITEMS);
    expect(labels.slice(0, 3)).toEqual(['A1', 'B1', 'C1']);
    expect(labels.slice(24)).toEqual(['Y1', 'Z1', 'AA1', 'AB1', 'AC1', 'AD1']);
    expect(new Set(labels).size).toBe(MAX_WORKOUT_ITEMS);

    const many = supersetLabels(
      items(...Array.from({ length: 26 + 26 * 26 + 1 }, (_, i) => `g${i}`)),
    );
    expect(many[26 + 25]).toBe('AZ1');
    expect(many[26 + 26]).toBe('BA1');
    expect(many[26 + 26 * 26 - 1]).toBe('ZZ1');
    expect(many[26 + 26 * 26]).toBe('AAA1');
  });

  it('answers a parallel array, and an empty one for no items', () => {
    expect(supersetLabels([])).toEqual([]);
    expect(supersetLabels(items(null, null))).toEqual([null, null]);
    const input = items('a', null, 'a');
    const before = structuredClone(input);
    expect(supersetLabels(input)).toHaveLength(input.length);
    expect(input).toEqual(before);
  });

  it('labels every day fixture: a label exactly where there is a superset, letters in order', () => {
    let labelled = 0;
    for (const plan of Object.values(DAY_PLAN_FIXTURES)) {
      for (const workout of plan.workouts) {
        const labels = supersetLabels(workout.items);
        workout.items.forEach((item, i) => {
          expect(labels[i] === null).toBe(item.superset === null);
        });
        const letters = [...new Set(labels.flatMap((label) => label?.replace(/\d+$/, '') ?? []))];
        expect(letters).toEqual(['A', 'B', 'C', 'D'].slice(0, letters.length));
        labelled += labels.filter(Boolean).length;
      }
    }
    expect(labelled).toBeGreaterThan(0);
    // The named fixture for supersets on a day.
    const heavyA = heavyASupersets.workouts.find((workout) =>
      workout.items.some((item) => item.superset),
    );
    expect(supersetLabels(heavyA!.items).filter(Boolean)).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  it('is exported from the root barrel', async () => {
    expect((await import('../index')).supersetLabels).toBe(supersetLabels);
  });
});
