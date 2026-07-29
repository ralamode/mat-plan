import { buildDefaultRoutine, makeRoutineKey, STRENGTH_KEY } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { CHECKIN_FIELDS } from '@/lib/checkins/checkin-fields';
import { LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

import { buildRoutineBlocks, checkinFieldsForKeys, ROUTINE_CATALOG } from './catalog';

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

  it('a SCATTERED routine (Scarlett) splits into TWO check-in blocks, in routine order', () => {
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
