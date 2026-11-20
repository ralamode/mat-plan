import { SEED_ATHLETE_TWO_ROUTINE, SEED_FULL_ROUTINE } from '@mat-plan/db';
import {
  ACTIVITY_TYPE_KEYS,
  buildDefaultRoutine,
  makeRoutineKey,
  type RoutineConfig,
  STRENGTH_KEY,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { LIFE_ACTIVITIES } from '@/lib/life/life-activities';

import {
  buildRoutineBlocks,
  lifeActivitiesForKeys,
  NEUTRAL_DEFAULT_KEYS,
  resolveProfileRoutine,
  ROUTINE_CATALOG,
  routineCatalogItems,
  savedOrder,
} from './catalog';

const PRACTICE = makeRoutineKey('life', ACTIVITY_TYPE_KEYS.wrestling_practice);
const WAKE = makeRoutineKey('life', ACTIVITY_TYPE_KEYS.wake);
const routine = (order: RoutineConfig['order']): RoutineConfig => ({ version: 1, order });

/** What the day page shows for a stored routine: its Life items, as `page.tsx` and the Life section read them. */
const lifeShown = (raw: unknown) =>
  lifeActivitiesForKeys(
    buildRoutineBlocks(resolveProfileRoutine(raw).order).flatMap((b) =>
      b.kind === 'life' ? b.keys : [],
    ),
  ).map((a) => a.key);

describe('ROUTINE_CATALOG — after the trim (FAM-1 12f PR 5, D28)', () => {
  it('is exactly strength, then Wrestling practice: no check-in key, no Wake, no bodyweight', () => {
    expect(ROUTINE_CATALOG).toEqual([STRENGTH_KEY, PRACTICE]);
  });
});

/**
 * The plan's routine table, one case per row: no athlete's day page changes. Q5's second read
 * (2026-11-19) found production holds three of these shapes: none, Athlete Two's, and strength with
 * check-in keys and no Life key.
 */
describe('the day page shows the same Life items for every stored routine (the plan’s table)', () => {
  it.each([
    ['none (every athlete added in the app)', null, []],
    ['the full routine (the seed)', SEED_FULL_ROUTINE, [ACTIVITY_TYPE_KEYS.wrestling_practice]],
    ['Athlete Two’s (check-ins, strength, Wake)', SEED_ATHLETE_TWO_ROUTINE, []],
    [
      'only keys that left (Wake, a check-in)',
      routine([{ key: WAKE }, { key: 'checkin:rice_bucket' }]),
      [],
    ],
    [
      'strength and check-in keys, no Life key (found in production, Q5)',
      routine([
        { key: STRENGTH_KEY },
        { key: 'checkin:rice_bucket' },
        { key: 'checkin:calisthenics:pushups' },
      ]),
      [],
    ],
    [
      'Wrestling practice alone',
      routine([{ key: PRACTICE }]),
      [ACTIVITY_TYPE_KEYS.wrestling_practice],
    ],
  ])('%s', (_name, stored, shown) => {
    expect(lifeShown(stored)).toEqual(shown);
  });

  it('a routine of strength plus check-in keys resolves to strength alone, never the whole catalog', () => {
    // The board's extra test: falling back to the whole catalog here would hand this athlete practice.
    const resolved = resolveProfileRoutine(
      routine([{ key: STRENGTH_KEY }, { key: 'checkin:rice_bucket' }]),
    );
    expect(resolved.order.map((i) => i.key)).toEqual([STRENGTH_KEY]);
  });

  it('Athlete Two’s seed resolves to strength with its conditional marker', () => {
    expect(resolveProfileRoutine(SEED_ATHLETE_TWO_ROUTINE).order).toEqual([
      { key: STRENGTH_KEY, conditional: true },
    ]);
  });

  it('the full seed resolves to the catalog’s keys, in order (its check-ins and Wake drop)', () => {
    expect(resolveProfileRoutine(SEED_FULL_ROUTINE).order.map((i) => i.key)).toEqual(
      ROUTINE_CATALOG,
    );
  });
});

describe('buildRoutineBlocks', () => {
  it('a contiguous run of life keys is one block; strength splits runs; other namespaces are skipped', () => {
    // Two life keys stand in for a longer Life list: `buildRoutineBlocks` does not check membership.
    expect(
      buildRoutineBlocks([
        { key: 'life:a' },
        { key: 'checkin:rice_bucket' },
        { key: 'life:b' },
        { key: STRENGTH_KEY },
        { key: PRACTICE },
        { key: 'finisher:sled' },
      ]),
    ).toEqual([
      { kind: 'life', keys: ['a', 'b'] },
      { kind: 'strength' },
      { kind: 'life', keys: [ACTIVITY_TYPE_KEYS.wrestling_practice] },
    ]);
  });

  it('an empty routine → no blocks', () => {
    expect(buildRoutineBlocks([])).toEqual([]);
  });
});

describe('routineCatalogItems — what the editor lists', () => {
  it('lists Wrestling practice, with its label from LIFE_ACTIVITIES, and never strength or Wake', () => {
    const practice = LIFE_ACTIVITIES.find((a) => a.key === ACTIVITY_TYPE_KEYS.wrestling_practice)!;
    expect(routineCatalogItems()).toEqual([{ key: PRACTICE, label: practice.label }]);
  });
});

describe('savedOrder — what Save sends', () => {
  it('carries strength, with its conditional marker, at its place among the listed items', () => {
    const initial = routine([{ key: STRENGTH_KEY, conditional: true }, { key: PRACTICE }]);
    expect(savedOrder(initial, [{ key: PRACTICE }])).toEqual(
      routine([{ key: STRENGTH_KEY, conditional: true }, { key: PRACTICE }]),
    );
  });

  it('keeps a carried item’s place when the listed items come first', () => {
    const initial = routine([{ key: PRACTICE }, { key: STRENGTH_KEY, conditional: true }]);
    expect(savedOrder(initial, [{ key: PRACTICE }]).order).toEqual([
      { key: PRACTICE },
      { key: STRENGTH_KEY, conditional: true },
    ]);
  });

  it('a removed listed item leaves; strength stays', () => {
    const initial = routine([{ key: STRENGTH_KEY }, { key: PRACTICE }]);
    expect(savedOrder(initial, []).order).toEqual([{ key: STRENGTH_KEY }]);
  });

  it('an added listed item joins after what was there', () => {
    const initial = routine([{ key: STRENGTH_KEY }]);
    expect(savedOrder(initial, [{ key: PRACTICE }]).order).toEqual([
      { key: STRENGTH_KEY },
      { key: PRACTICE },
    ]);
  });

  it('saves strength alone, as the never-empty member, when nothing is left', () => {
    // The reachable path: an athlete who stored practice alone removes it.
    expect(savedOrder(routine([{ key: PRACTICE }]), [])).toEqual(
      buildDefaultRoutine([STRENGTH_KEY]),
    );
  });
});

describe('NEUTRAL_DEFAULT_KEYS — the first-run fallback', () => {
  it('is strength alone, and a NULL config resolves to it, not to the whole catalog', () => {
    expect(NEUTRAL_DEFAULT_KEYS).toEqual([STRENGTH_KEY]);
    expect(resolveProfileRoutine(null)).toEqual(buildDefaultRoutine([STRENGTH_KEY]));
  });
});
