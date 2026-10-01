import { describe, expect, it } from 'vitest';

import {
  dissolveSmallSupersets,
  groupSelected,
  type SupersetTaggable,
  ungroupSuperset,
} from './strength-form-supersets';

const mv = (clientId: string, extra: Partial<SupersetTaggable> = {}): SupersetTaggable => ({
  clientId,
  ...extra,
});

describe('strength-form superset transforms (V1-8-3d)', () => {
  it('groups 2+ selected movements with a shared id and 1-based order', () => {
    const out = groupSelected([mv('a'), mv('b'), mv('c')], new Set(['a', 'c']), 'ss1');
    expect(out.find((m) => m.clientId === 'a')).toMatchObject({
      supersetClientId: 'ss1',
      supersetOrder: 1,
    });
    expect(out.find((m) => m.clientId === 'c')).toMatchObject({
      supersetClientId: 'ss1',
      supersetOrder: 2,
    });
    expect(out.find((m) => m.clientId === 'b')?.supersetClientId).toBeUndefined();
  });

  it('is a no-op when fewer than 2 are selected', () => {
    const ms = [mv('a'), mv('b')];
    expect(groupSelected(ms, new Set(['a']), 'ss1')).toEqual(ms);
  });

  it('ungroups a superset — strips all its members', () => {
    const ms = [
      mv('a', { supersetClientId: 'ss1', supersetOrder: 1 }),
      mv('b', { supersetClientId: 'ss1', supersetOrder: 2 }),
    ];
    expect(ungroupSuperset(ms, 'ss1').every((m) => m.supersetClientId === undefined)).toBe(true);
  });

  it('dissolves a superset that dropped to 1 member (the remove case)', () => {
    const remaining = [mv('a', { supersetClientId: 'ss1', supersetOrder: 1 })];
    expect(dissolveSmallSupersets(remaining)[0]).toMatchObject({
      supersetClientId: undefined,
      supersetOrder: undefined,
    });
  });

  it('keeps a 3-member superset grouped after removing one (order gap is fine)', () => {
    const remaining = [
      mv('a', { supersetClientId: 'ss1', supersetOrder: 1 }),
      mv('c', { supersetClientId: 'ss1', supersetOrder: 3 }), // order-2 'b' removed → [1,3]
    ];
    expect(dissolveSmallSupersets(remaining).every((m) => m.supersetClientId === 'ss1')).toBe(true);
  });

  it('dissolves only the shrunk superset when two exist', () => {
    const remaining = [
      mv('a', { supersetClientId: 'ss1', supersetOrder: 1 }), // ss1 now has 1 → dissolve
      mv('b', { supersetClientId: 'ss2', supersetOrder: 1 }),
      mv('c', { supersetClientId: 'ss2', supersetOrder: 2 }), // ss2 has 2 → keep
    ];
    const out = dissolveSmallSupersets(remaining);
    expect(out.find((m) => m.clientId === 'a')?.supersetClientId).toBeUndefined();
    expect(out.find((m) => m.clientId === 'b')?.supersetClientId).toBe('ss2');
  });
});
