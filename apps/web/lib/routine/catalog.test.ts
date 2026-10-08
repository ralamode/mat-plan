import { SEED_FULL_ROUTINE } from '@mat-plan/db';
import {
  ACTIVITY_TYPE_KEYS,
  buildDefaultRoutine,
  makeRoutineKey,
  parseRoutineKey,
  STRENGTH_KEY,
  STRENGTH_LABEL,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { CHECKIN_FIELDS } from '@/lib/checkins/checkin-fields';
import { LIFE_ACTIVITIES, LIFE_ACTIVITY_KEYS } from '@/lib/life/life-activities';

import {
  buildRoutineBlocks,
  checkinFieldsForKeys,
  NEUTRAL_DEFAULT_KEYS,
  resolveProfileRoutine,
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

/**
 * ONB-0 — the neutral first-run default. Before this, a profile with `routine_config = NULL` fell back
 * to the WHOLE catalog, so a brand-new household's first screen was ~17 controls belonging to the
 * maintainer's household (3 habits, 7 metrics grouped under the label "Brush teeth", 4 calisthenics
 * counters, 2 life controls).
 */
describe('NEUTRAL_DEFAULT_KEYS — the first-run fallback', () => {
  // The ONE literal-pinning assertion in this file (AGENTS.md's sanctioned exception). Everything else
  // asserts through a const, and a `⊆ ROUTINE_CATALOG` / "in catalog order" check would be tautological
  // against a hand-written list — this is what actually fails if someone widens the default.
  it('is strength alone — which, with the pinned weigh-in, is "weigh-in + strength only"', () => {
    expect([...NEUTRAL_DEFAULT_KEYS]).toEqual(['strength']);
  });

  it('is a STRICT subset of the catalog (the narrowing actually happened)', () => {
    expect(NEUTRAL_DEFAULT_KEYS.length).toBeGreaterThan(0);
    expect(NEUTRAL_DEFAULT_KEYS.length).toBeLessThan(ROUTINE_CATALOG.length);
  });

  it('contains no household-chosen activity — asserted through the catalog, not re-typed keys', () => {
    const excluded = new Set<string>([
      ACTIVITY_TYPE_KEYS.rice_bucket,
      ACTIVITY_TYPE_KEYS.brain_rep,
      ACTIVITY_TYPE_KEYS.splits,
      ACTIVITY_TYPE_KEYS.brush_teeth,
      // CAT-1: these twin the push-ups / pull-up / v-sit movements and double-count adherence.
      ACTIVITY_TYPE_KEYS.calisthenics,
    ]);
    const fieldByKey = new Map(CHECKIN_FIELDS.map((f) => [f.key, f]));

    for (const key of NEUTRAL_DEFAULT_KEYS) {
      const { namespace, catalogKey } = parseRoutineKey(key);
      // No life activity either: `wrestling_practice`'s one tap writes DEFAULT_PRACTICE_MINUTES, the
      // maintainer's club's session length, with no number on the button and no in-app undo.
      expect(namespace).not.toBe('life');
      if (namespace !== 'checkin' || catalogKey === null) continue;
      expect(excluded.has(fieldByKey.get(catalogKey)?.activityKey ?? '')).toBe(false);
    }
  });
});

describe('resolveProfileRoutine — the ONE pairing of membership with the first-run default', () => {
  it('a NULL config resolves to the neutral default, NOT the whole catalog', () => {
    expect(resolveProfileRoutine(null)).toEqual(buildDefaultRoutine(NEUTRAL_DEFAULT_KEYS));
    // The regression this row exists for, stated as the inequality it really is.
    expect(resolveProfileRoutine(null)).not.toEqual(buildDefaultRoutine(ROUTINE_CATALOG));
    const keys = resolveProfileRoutine(null).order.map((i) => i.key);
    expect(keys.some((k) => k.includes(ACTIVITY_TYPE_KEYS.brush_teeth))).toBe(false);
  });

  it('MEMBERSHIP stays the whole catalog — an authored household key still renders', () => {
    // The maintainer's-household guard: narrowing membership (instead of only the fallback) would have
    // silently stripped this item on the next read, which is a data-visible regression, not a fix.
    const authored = {
      version: 1,
      order: [{ key: makeRoutineKey('checkin', 'brush_teeth:pressure') }, { key: STRENGTH_KEY }],
    };
    expect(resolveProfileRoutine(authored).order.map((i) => i.key)).toEqual([
      'checkin:brush_teeth:pressure',
      STRENGTH_KEY,
    ]);
  });
});

describe("SEED_FULL_ROUTINE — the seeded profile's explicit pre-ONB-0 routine", () => {
  // `packages/db` cannot import this (app-side) catalog, so the seed literal is hand-written. This is
  // the tie that stops it drifting: a new habit / metric / life activity extends ROUTINE_CATALOG
  // automatically, and without this assertion the fixture would just quietly get a narrower Today —
  // which is the exact e2e surface the explicit config was added to protect.
  it('equals ROUTINE_CATALOG exactly, in order', () => {
    expect(SEED_FULL_ROUTINE.order.map((i) => i.key)).toEqual([...ROUTINE_CATALOG]);
  });
});
