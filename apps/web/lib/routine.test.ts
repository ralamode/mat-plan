import { describe, expect, it } from 'vitest';

import {
  buildDefaultRoutine,
  parseRoutineKey,
  resolveRoutine,
  routineConfigSchema,
  routineKeySchema,
  type RoutineConfig,
} from '@mat-plan/shared';

// A fixture catalog standing in for the app-side derived one (strength → check-ins → life). Includes a
// TWO-COLON metric key to pin the colon-in-tail behaviour that the existing `activityKey:metricKey` scheme
// produces.
const CATALOG = [
  'strength',
  'checkin:rice_bucket',
  'checkin:brush_teeth:stance',
  'life:wake',
] as const;

describe('routineKeySchema — grammar', () => {
  it('accepts the strength singleton and namespaced keys, incl. a colon-bearing tail', () => {
    for (const k of [
      'strength',
      'checkin:rice_bucket',
      'checkin:brush_teeth:stance',
      'life:wake',
      'finisher:sprints',
    ]) {
      expect(routineKeySchema.safeParse(k).success).toBe(true);
    }
  });

  it('rejects a bare bodyweight/weigh-in key and un-namespaced junk (weigh-in is pinned, never in order)', () => {
    for (const k of ['bodyweight', 'weigh_in', 'rice_bucket', 'checkin:', '', ':stance']) {
      expect(routineKeySchema.safeParse(k).success).toBe(false);
    }
  });
});

describe('parseRoutineKey — splits on the FIRST colon (never truncates a two-colon tail)', () => {
  it('keeps the whole metric tail after the namespace', () => {
    expect(parseRoutineKey('checkin:brush_teeth:stance')).toEqual({
      namespace: 'checkin',
      catalogKey: 'brush_teeth:stance', // NOT 'brush_teeth' — the second colon survives
    });
    expect(parseRoutineKey('checkin:rice_bucket')).toEqual({
      namespace: 'checkin',
      catalogKey: 'rice_bucket',
    });
    expect(parseRoutineKey('strength')).toEqual({ namespace: 'strength', catalogKey: null });
  });
});

describe('routineConfigSchema', () => {
  it('parses a valid config with a cosmetic conditional marker', () => {
    const cfg = {
      version: 1,
      order: [{ key: 'strength', conditional: true }, { key: 'life:wake' }],
    };
    expect(routineConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('rejects a non-true conditional, unknown fields, and a bad version', () => {
    expect(
      routineConfigSchema.safeParse({
        version: 1,
        order: [{ key: 'strength', conditional: false }],
      }).success,
    ).toBe(false);
    expect(
      routineConfigSchema.safeParse({ version: 1, order: [{ key: 'strength', extra: 1 }] }).success,
    ).toBe(false);
    expect(routineConfigSchema.safeParse({ version: 2, order: [] }).success).toBe(false);
  });
});

describe('buildDefaultRoutine', () => {
  it('wraps the ordered catalog keys into a routine — default ⊆ catalog by construction', () => {
    const def = buildDefaultRoutine(CATALOG);
    expect(def.order.map((i) => i.key)).toEqual([...CATALOG]);
    expect(def.order.every((i) => (CATALOG as readonly string[]).includes(i.key))).toBe(true);
  });
});

describe('resolveRoutine — forgiving, item-by-item', () => {
  it('null / garbage / wrong-version → the default routine (ships-dark path)', () => {
    const def = buildDefaultRoutine(CATALOG);
    expect(resolveRoutine(null, CATALOG)).toEqual(def);
    expect(resolveRoutine('nope', CATALOG)).toEqual(def);
    expect(resolveRoutine({ version: 2, order: [] }, CATALOG)).toEqual(def);
  });

  it('keeps a valid config, dropping ONLY the stale/invalid items (never nukes the whole routine)', () => {
    const stored = {
      version: 1,
      order: [
        { key: 'checkin:rice_bucket' }, // valid + in catalog → kept
        { key: 'checkin:gone_metric:x' }, // grammar-valid but NOT in catalog → dropped
        { key: 'bogus' }, // grammar-invalid → dropped
        { key: 'strength', conditional: true }, // kept, marker preserved
      ],
    };
    expect(resolveRoutine(stored, CATALOG).order).toEqual([
      { key: 'checkin:rice_bucket' },
      { key: 'strength', conditional: true },
    ]);
  });

  it('a valid authored config resolves DISTINCTLY from the default (A≠B holds at the resolved layer)', () => {
    const scarlett: RoutineConfig = {
      version: 1,
      order: [
        { key: 'checkin:rice_bucket' },
        { key: 'strength', conditional: true },
        { key: 'life:wake' },
      ],
    };
    expect(resolveRoutine(scarlett, CATALOG)).not.toEqual(buildDefaultRoutine(CATALOG));
  });
});
