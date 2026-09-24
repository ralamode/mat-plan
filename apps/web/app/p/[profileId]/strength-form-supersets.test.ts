import { describe, expect, it } from 'vitest';

import {
  dissolveSmallSupersets,
  dropUntouchedMovements,
  groupSelected,
  isUntouchedMovement,
  type MovementDraft,
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
  const draft = (
    movementName: string,
    sets: { reps: string; weight: string; isBodyweight?: boolean; isBand?: boolean }[],
  ) => ({
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

  // GAP-3 PR 4a — the same regression as the scaffold predicate's. A mode flag is real input, and a
  // card carrying only one must survive to the payload. Pinned here so the flags cannot be dropped
  // from this predicate while the sibling keeps them.
  it('does NOT treat a card whose only input is a MODE as untouched', () => {
    expect(isUntouchedMovement(draft('', [{ reps: '', weight: '', isBodyweight: true }]))).toBe(
      false,
    );
    expect(isUntouchedMovement(draft('', [{ reps: '', weight: '', isBand: true }]))).toBe(false);
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

// GAP-1 P1-1c (BUG-2b). `[].every(...)` is VACUOUSLY TRUE, so before this fix a skipped movement —
// which legitimately carries zero sets — with a blank name was silently discarded on submit: no row,
// no validation message. The same argument applies one level down to a set status.
describe('isUntouchedMovement — a status is a typed field (GAP-1 P1-1c / BUG-2b)', () => {
  const card = (o: Partial<MovementDraft> = {}): MovementDraft => ({
    movementName: '',
    sets: [{ reps: '', weight: '' }],
    ...o,
  });

  it('an ordinary blank card is STILL untouched (the existing drop behaviour is unchanged)', () => {
    expect(isUntouchedMovement(card())).toBe(true);
  });

  it('a SKIPPED card with a blank name and ZERO sets is NOT untouched', () => {
    // The regression. Without the guard, `[].every(...)` → true → dropUntouchedMovements discards it.
    expect(isUntouchedMovement(card({ status: 'skipped', sets: [] }))).toBe(false);
  });

  it('a card whose ONLY input is a SET status is NOT untouched', () => {
    // The other direction — guarding only the movement level would ship the same bug in this PR.
    expect(
      isUntouchedMovement(card({ sets: [{ reps: '', weight: '', status: 'sub_failure' }] })),
    ).toBe(false);
  });

  it('check-then-UNCHECK returns the card to droppable (a mis-tap must not wedge the form)', () => {
    // The toggle sets `undefined`, not 'done'. Presence-checking would leave this card permanently
    // un-droppable, blocking submit behind "Movement N: Enter a movement." with Remove as the only out.
    expect(isUntouchedMovement(card({ status: undefined, sets: [] }))).toBe(true);
  });

  it('an explicit `done` at either level is still untouched (compare to the DEFAULT, not to undefined)', () => {
    expect(isUntouchedMovement(card({ status: 'done' }))).toBe(true);
    expect(isUntouchedMovement(card({ sets: [{ reps: '', weight: '', status: 'done' }] }))).toBe(
      true,
    );
  });

  it('a typed name still wins regardless of status', () => {
    expect(isUntouchedMovement(card({ movementName: 'Back squat', sets: [] }))).toBe(false);
  });

  it('dropUntouchedMovements keeps a skipped blank card so it can produce a real error', () => {
    const kept = dropUntouchedMovements([
      { clientId: 'a', ...card({ status: 'skipped', sets: [] }) },
      { clientId: 'b', ...card() },
    ]);
    expect(kept.map((m) => m.clientId)).toEqual(['a']);
  });
});
