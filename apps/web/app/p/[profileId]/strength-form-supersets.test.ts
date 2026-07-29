import { describe, expect, it } from 'vitest';

import {
  dissolveSmallSupersets,
  dropUntouchedMovements,
  groupSelected,
  isUntouchedMovement,
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

describe('dropUntouchedMovements / isUntouchedMovement (V1-9 log ergonomics)', () => {
  const draft = (movementName: string, sets: { reps: string; weight: string }[]) => ({
    clientId: 'c',
    movementName,
    unit: 'lb',
    sets,
  });
  const blank = () => draft('', [{ reps: '', weight: '' }]);
  const filled = () => draft('Back squat', [{ reps: '10', weight: '75' }]);

  it('treats a blank name + all-blank sets as untouched', () => {
    expect(isUntouchedMovement(blank())).toBe(true);
    expect(isUntouchedMovement(draft('  ', [{ reps: ' ', weight: '' }]))).toBe(true); // whitespace only
  });

  it('does NOT treat a partially-typed card as untouched (never silently discard input)', () => {
    expect(isUntouchedMovement(draft('Back squat', [{ reps: '', weight: '' }]))).toBe(false); // name only
    expect(isUntouchedMovement(draft('', [{ reps: '10', weight: '' }]))).toBe(false); // a rep only
    expect(isUntouchedMovement(draft('', [{ reps: '', weight: '75' }]))).toBe(false); // a weight only
  });

  it('drops only the untouched cards, keeps filled + partial', () => {
    const partial = draft('Bench', [{ reps: '', weight: '' }]);
    const out = dropUntouchedMovements([filled(), blank(), partial]);
    expect(out.map((m) => m.movementName)).toEqual(['Back squat', 'Bench']); // blank dropped, partial kept
  });

  it('returns [] when every card is untouched (so the min(1) schema error still fires)', () => {
    expect(dropUntouchedMovements([blank(), blank()])).toEqual([]);
  });
});
