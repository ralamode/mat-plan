import {
  buildDefaultRoutine,
  makeRoutineKey,
  STRENGTH_KEY,
  STRENGTH_LABEL,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { CHECKIN_FIELDS } from '@/lib/checkins/checkin-fields';
import { LIFE_ACTIVITIES, LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

import {
  buildRoutineBlocks,
  checkinFieldsForKeys,
  ROUTINE_CATALOG,
  routineCatalogItems,
} from './catalog';

const CHECKIN_KEYS = CHECKIN_FIELDS.map((f) => f.key);
const item = (key: string) => ({ key });

describe('ROUTINE_CATALOG — derived from the live catalogs (anti-drift)', () => {
  it('is strength → check-ins (in CHECKIN_FIELDS order) → life, with no bodyweight', () => {
    expect(ROUTINE_CATALOG).toEqual([
      STRENGTH_KEY,
      ...CHECKIN_KEYS.map((k) => makeRoutineKey('checkin', k)),
      ...LIFE_ACTIVITY_KEYS.map((k) => makeRoutineKey('life', k)),
    ]);
    expect(ROUTINE_CATALOG).not.toContain('bodyweight');
  });
});

describe('buildRoutineBlocks — contiguous-run collapse', () => {
  it('DEFAULT (all check-ins contiguous) → ONE check-ins block = today’s single CheckinForm', () => {
    const blocks = buildRoutineBlocks(buildDefaultRoutine(ROUTINE_CATALOG).order);
    expect(blocks).toEqual([
      { kind: 'strength' },
      { kind: 'checkins', keys: CHECKIN_KEYS },
      { kind: 'life', keys: [...LIFE_ACTIVITY_KEYS] },
    ]);
  });

  it('a scattered routine (a check-in on each side of strength) splits into TWO check-in blocks', () => {
    const blocks = buildRoutineBlocks([
      item('checkin:rice_bucket'),
      item('strength'),
      item('checkin:brush_teeth:stance'), // two-colon tail preserved
      item('life:wake'),
    ]);
    expect(blocks).toEqual([
      { kind: 'checkins', keys: ['rice_bucket'] },
      { kind: 'strength' },
      { kind: 'checkins', keys: ['brush_teeth:stance'] },
      { kind: 'life', keys: ['wake'] },
    ]);
  });

  it('collapses an adjacent run into one block and skips unknown namespaces (finisher:*)', () => {
    const blocks = buildRoutineBlocks([
      item('checkin:rice_bucket'),
      item('checkin:brush_teeth:stance'),
      item('finisher:sprints'), // unknown namespace → skipped
      item('life:wake'),
    ]);
    expect(blocks).toEqual([
      { kind: 'checkins', keys: ['rice_bucket', 'brush_teeth:stance'] },
      { kind: 'life', keys: ['wake'] },
    ]);
  });

  it('an empty routine → no blocks', () => {
    expect(buildRoutineBlocks([])).toEqual([]);
  });
});

describe('checkinFieldsForKeys — maps bare keys back to CheckinField objects in order', () => {
  it('returns the live fields in routine order, dropping unknown keys', () => {
    const first = CHECKIN_KEYS[0];
    const fields = checkinFieldsForKeys([first, 'nope']);
    expect(fields.map((f) => f.key)).toEqual([first]);
  });
});

describe('routineCatalogItems — the labelled catalog for the coach editor', () => {
  const items = routineCatalogItems();

  it('covers every ROUTINE_CATALOG key, in catalog order', () => {
    expect(items.map((i) => i.key)).toEqual([...ROUTINE_CATALOG]);
  });

  it('single-sources labels from the registries (no re-typed strings)', () => {
    const byKey = new Map(items.map((i) => [i.key, i.label]));
    // strength → the shared STRENGTH_LABEL
    expect(byKey.get(STRENGTH_KEY)).toBe(STRENGTH_LABEL);
    // a check-in key → its CheckinField.label
    const cf = CHECKIN_FIELDS[0]!;
    expect(byKey.get(makeRoutineKey('checkin', cf.key))).toBe(cf.label);
    // a life key → its LIFE_ACTIVITIES label
    const la = LIFE_ACTIVITIES[0]!;
    expect(byKey.get(makeRoutineKey('life', la.key))).toBe(la.label);
  });

  it('gives every item a non-empty label', () => {
    for (const i of items) expect(i.label.length).toBeGreaterThan(0);
  });
});
