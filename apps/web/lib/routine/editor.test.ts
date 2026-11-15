import type { RoutineItem } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { moveDown, moveUp, toggle } from './editor';

describe('toggle — add/remove an item (matched by key), never a duplicate', () => {
  it('appends an absent item at the END (the coach then reorders)', () => {
    expect(toggle([{ key: 'strength' }], { key: 'life:wake' })).toEqual([
      { key: 'strength' },
      { key: 'life:wake' },
    ]);
  });

  it('removes a present key (matched by key, ignoring the passed item’s other fields)', () => {
    expect(toggle([{ key: 'strength' }, { key: 'life:wake' }], { key: 'strength' })).toEqual([
      { key: 'life:wake' },
    ]);
  });

  it('re-adds with the ORIGINAL conditional marker when the caller passes it (no silent strip)', () => {
    // The editor resolves the add-item from the kid's initial order, so a removed day-conditional
    // strength comes back day-conditional.
    const removed = toggle([{ key: 'strength', conditional: true }], { key: 'strength' }); // -> []
    expect(removed).toEqual([]);
    expect(toggle(removed, { key: 'strength', conditional: true })).toEqual([
      { key: 'strength', conditional: true },
    ]);
  });

  it('never introduces a duplicate (toggling a present key removes, does not re-add)', () => {
    const once = toggle([{ key: 'strength' }], { key: 'strength' }); // -> []
    expect(once).toEqual([]);
    const twice = toggle(once, { key: 'strength' }); // -> [{strength}]
    expect(twice).toEqual([{ key: 'strength' }]);
    expect(toggle(twice, { key: 'strength' })).toEqual([]); // back to empty, never [{s},{s}]
  });

  it('does not mutate its argument', () => {
    const order: RoutineItem[] = [{ key: 'strength' }];
    toggle(order, { key: 'life:wake' });
    expect(order).toEqual([{ key: 'strength' }]);
  });
});

describe('moveUp / moveDown — adjacent swap, conditional preserved', () => {
  const order: RoutineItem[] = [
    { key: 'checkin:rice_bucket' },
    { key: 'strength', conditional: true },
    { key: 'life:wake' },
  ];

  it('moveUp swaps with the previous item, carrying the conditional marker along', () => {
    expect(moveUp(order, 1)).toEqual([
      { key: 'strength', conditional: true },
      { key: 'checkin:rice_bucket' },
      { key: 'life:wake' },
    ]);
  });

  it('moveDown swaps with the next item, carrying the conditional marker along', () => {
    expect(moveDown(order, 1)).toEqual([
      { key: 'checkin:rice_bucket' },
      { key: 'life:wake' },
      { key: 'strength', conditional: true },
    ]);
  });

  it('moveUp at the top and moveDown at the bottom are no-ops (return an equal copy)', () => {
    expect(moveUp(order, 0)).toEqual(order);
    expect(moveDown(order, order.length - 1)).toEqual(order);
  });

  it('out-of-range indices are no-ops', () => {
    expect(moveUp(order, 99)).toEqual(order);
    expect(moveDown(order, -1)).toEqual(order);
  });

  it('does not mutate its argument', () => {
    const copy = [...order];
    moveUp(order, 1);
    moveDown(order, 1);
    expect(order).toEqual(copy);
  });

  it('a reorder round-trip (up then down) restores the original, marker intact', () => {
    expect(moveDown(moveUp(order, 1), 0)).toEqual(order);
  });
});

/**
 * FAM-1 step 0b made the two reorders generic so the program builder can import them for a list that
 * is not a routine. The element type is the caller's, and it comes back unchanged: the assignments
 * below are the compile-time half (held by `pnpm typecheck`), the assertions the runtime half.
 */
describe('moveUp / moveDown — generic over the element', () => {
  type WorkoutRow = { id: number; label: string };
  const rows: readonly WorkoutRow[] = [
    { id: 1, label: 'Squat' },
    { id: 2, label: 'Plank' },
    { id: 3, label: 'Run' },
  ];

  it('reorders a list of another element type, returning that type', () => {
    const up: WorkoutRow[] = moveUp(rows, 2);
    const down: WorkoutRow[] = moveDown(rows, 0);
    expect(up.map((r) => r.id)).toEqual([1, 3, 2]);
    expect(down.map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it('moves the same object, not a copy of it', () => {
    expect(moveUp(rows, 1)[0]).toBe(rows[1]);
    expect(moveDown(rows, 1)[2]).toBe(rows[1]);
  });

  it('reorders primitives, and is a no-op at either bound', () => {
    const names: string[] = moveDown(['a', 'b', 'c'], 1);
    expect(names).toEqual(['a', 'c', 'b']);
    expect(moveUp(['a', 'b'], 0)).toEqual(['a', 'b']);
    expect(moveDown(['a', 'b'], 1)).toEqual(['a', 'b']);
  });
});
