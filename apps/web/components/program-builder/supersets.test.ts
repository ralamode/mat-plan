import { heavyADraft } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { normalizeSupersets, supersetLabels, type SupersetMember } from './supersets';

const items = heavyADraft.items;
const names = (list: readonly { itemName: string }[]) => list.map((item) => item.itemName);
const shape = (list: readonly SupersetMember[]) =>
  list.map(({ superset, restAfter }) => [
    superset?.group ?? null,
    superset?.order ?? null,
    restAfter,
  ]);
const swap = <T>(list: readonly T[], i: number, j: number) => {
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

describe('normalizeSupersets', () => {
  it('leaves a well-formed workout as it is (heavy-a-draft)', () => {
    expect(normalizeSupersets(items)).toEqual({ items: [...items], droppedRests: [] });
  });

  it('a swap inside a group renumbers it and keeps the rest on its last item', () => {
    const { items: out } = normalizeSupersets(swap(items, 0, 1));
    expect(names(out).slice(0, 2)).toEqual(['Pull-up', 'DB bench press']);
    expect(shape(out).slice(0, 2)).toEqual([
      ['a', 1, null],
      ['a', 2, '90 s after each round'],
    ]);
  });

  it('a group split by a move dissolves, and its rest is dropped and reported', () => {
    // Pull-up down: bench (a), goblet (b), pull-up (a), sprawls (b).
    const { items: out, droppedRests } = normalizeSupersets(swap(items, 1, 2));
    expect(shape(out).slice(0, 4)).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
    expect(droppedRests).toEqual(['90 s after each round', '60 s after each round']);
  });

  it('a group left with one item dissolves (a remove)', () => {
    const { items: out, droppedRests } = normalizeSupersets(items.filter((_, i) => i !== 1));
    expect(shape(out)[0]).toEqual([null, null, null]);
    expect(droppedRests).toEqual([]);
    const afterRest = normalizeSupersets(items.filter((_, i) => i !== 0));
    expect(afterRest.droppedRests).toEqual(['90 s after each round']);
  });

  it('a key that comes back after another group is a new group', () => {
    const [a1, a2, b1, b2] = items;
    const { items: out } = normalizeSupersets([a1!, a2!, b1!, b2!, a1!, a2!]);
    expect(out.map((item) => item.superset?.group)).toEqual(['a', 'a', 'b', 'b', 'a-2', 'a-2']);
  });
});

describe('supersetLabels', () => {
  it('letters are ordinal: A1 A2 B1 B2, and an item on its own has none', () => {
    expect(supersetLabels(items)).toEqual(['A1', 'A2', 'B1', 'B2', null]);
  });

  it('when group a is gone, group b reads A1, A2', () => {
    expect(supersetLabels(items.slice(2))).toEqual(['A1', 'A2', null]);
  });
});
