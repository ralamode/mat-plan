import { SLOT_LABEL_MAX } from '@mat-plan/shared';
import { heavyADraft } from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { normalizeSupersets, type SupersetMember } from './supersets';

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

/** A member for a hand-built list: a name, a group key (or none), a rest. */
const m = (n: string, group: string | null, restAfter: string | null = null) => ({
  n,
  superset: group ? { group, order: 1 } : null,
  restAfter,
});

describe('normalizeSupersets', () => {
  it('leaves a well-formed workout as it is (heavy-a-draft)', () => {
    expect(normalizeSupersets(items)).toEqual({
      items: [...items],
      ended: 0,
      left: [],
      droppedRests: [],
    });
  });

  it('a swap inside a group renumbers it and keeps the rest on its last item', () => {
    const { items: out } = normalizeSupersets(swap(items, 0, 1));
    expect(names(out).slice(0, 2)).toEqual(['Pull-up', 'DB bench press']);
    expect(shape(out).slice(0, 2)).toEqual([
      ['a', 1, null],
      ['a', 2, '90 s after each round'],
    ]);
  });

  it('a pair split by a move ends, and its rest is dropped and reported', () => {
    // Pull-up down: bench (a), goblet (b), pull-up (a), sprawls (b).
    const result = normalizeSupersets(swap(items, 1, 2));
    expect(shape(result.items).slice(0, 4)).toEqual(Array(4).fill([null, null, null]));
    expect(result.ended).toBe(2);
    expect(result.left).toEqual([]);
    expect(result.droppedRests).toEqual(['90 s after each round', '60 s after each round']);
  });

  it('a pair left with one item ends', () => {
    const result = normalizeSupersets(items.filter((_, i) => i !== 1));
    expect(shape(result.items)[0]).toEqual([null, null, null]);
    expect(result.ended).toBe(1);
  });

  it('a group of three that loses one member keeps its rest', () => {
    // A3 moved down past X: [A1, A2, X, A3(rest)]. Group a survives as A1, A2.
    const result = normalizeSupersets([
      m('A1', 'a'),
      m('A2', 'a'),
      m('X', null),
      m('A3', 'a', '90 s'),
    ]);
    expect(shape(result.items)).toEqual([
      ['a', 1, null],
      ['a', 2, '90 s'],
      [null, null, null],
      [null, null, null],
    ]);
    expect(result).toMatchObject({ ended: 0, left: [3], droppedRests: [] });
  });

  it('an item pushed out of a group of three is said to have left it', () => {
    // X moved down into the group: [A1, X, A2, A3(rest)]. A1 leaves; A2, A3 keep the rest.
    const result = normalizeSupersets([
      m('A1', 'a'),
      m('X', null),
      m('A2', 'a'),
      m('A3', 'a', '90 s'),
    ]);
    expect(shape(result.items)).toEqual([
      [null, null, null],
      [null, null, null],
      ['a', 1, null],
      ['a', 2, '90 s'],
    ]);
    expect(result).toMatchObject({ ended: 0, left: [0], droppedRests: [] });
  });

  it('a key that comes back after another group is a new group, within the label limit', () => {
    const [a1, a2, b1, b2] = items;
    const { items: out } = normalizeSupersets([a1!, a2!, b1!, b2!, a1!, a2!]);
    expect(out.map((item) => item.superset?.group)).toEqual(['a', 'a', 'b', 'b', 'a-2', 'a-2']);
    const long = 'k'.repeat(SLOT_LABEL_MAX);
    const again = normalizeSupersets([
      m('1', long),
      m('2', long),
      m('3', 'b'),
      m('4', 'b'),
      m('5', long),
      m('6', long),
    ]);
    expect(again.items.map((item) => item.superset!.group.length)).toEqual(
      Array(6)
        .fill(SLOT_LABEL_MAX)
        .map((n, i) => (i === 2 || i === 3 ? 1 : n)),
    );
  });
});
