import { SEED_SCARLETT_ROUTINE } from '@mat-plan/db';
import {
  buildDefaultRoutine,
  parseRoutineKey,
  resolveRoutine,
  routineConfigSchema,
  routineKeySchema,
  type RoutineConfig,
  validateRoutineForWrite,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { ROUTINE_CATALOG } from './catalog';

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

  it('a fully-stale config (every item dropped) falls back to the default, never a blank routine', () => {
    const allStale = { version: 1, order: [{ key: 'checkin:gone_a' }, { key: 'life:gone_b' }] };
    expect(resolveRoutine(allStale, CATALOG)).toEqual(buildDefaultRoutine(CATALOG));
  });

  it('tolerates an unknown additive top-level field (forward-compat for PR 3), keeping the order', () => {
    const withFuture = { version: 1, order: [{ key: 'strength' }], checkinAllowlist: ['x'] };
    expect(resolveRoutine(withFuture, CATALOG).order).toEqual([{ key: 'strength' }]);
  });

  it('de-dupes a repeated key (first-wins) so a corrupt config never renders duplicate controls', () => {
    const dup = {
      version: 1,
      order: [{ key: 'checkin:rice_bucket' }, { key: 'strength' }, { key: 'checkin:rice_bucket' }],
    };
    expect(resolveRoutine(dup, CATALOG).order).toEqual([
      { key: 'checkin:rice_bucket' },
      { key: 'strength' },
    ]);
  });
});

describe('validateRoutineForWrite — STRICT (rejects, never silently drops)', () => {
  it('accepts a clean config and returns it verbatim (conditional marker preserved)', () => {
    const cfg = {
      version: 1,
      order: [{ key: 'checkin:rice_bucket' }, { key: 'strength', conditional: true }],
    };
    expect(validateRoutineForWrite(cfg, CATALOG)).toEqual(cfg);
  });

  it('rejects a non-config (null / wrong version / unknown field / bad item) → null', () => {
    expect(validateRoutineForWrite(null, CATALOG)).toBeNull();
    expect(
      validateRoutineForWrite({ version: 2, order: [{ key: 'strength' }] }, CATALOG),
    ).toBeNull();
    expect(
      validateRoutineForWrite({ version: 1, order: [{ key: 'strength' }], extra: 1 }, CATALOG),
    ).toBeNull();
    expect(
      validateRoutineForWrite(
        { version: 1, order: [{ key: 'strength', conditional: false }] },
        CATALOG,
      ),
    ).toBeNull();
  });

  it('rejects an EMPTY order (would resolve back to the full default on read)', () => {
    expect(validateRoutineForWrite({ version: 1, order: [] }, CATALOG)).toBeNull();
  });

  it('rejects a duplicate key (where resolveRoutine would forgivingly dedupe)', () => {
    const dup = { version: 1, order: [{ key: 'strength' }, { key: 'strength' }] };
    expect(validateRoutineForWrite(dup, CATALOG)).toBeNull();
  });

  it('rejects a non-catalog key (where resolveRoutine would forgivingly drop it)', () => {
    const stale = { version: 1, order: [{ key: 'strength' }, { key: 'checkin:gone' }] };
    expect(validateRoutineForWrite(stale, CATALOG)).toBeNull();
  });
});

describe('parseRoutineKey — no-colon guard', () => {
  it('returns a clean sentinel for a colon-less non-strength key (no truncated namespace)', () => {
    expect(parseRoutineKey('foo')).toEqual({ namespace: 'foo', catalogKey: null });
  });
});

// Binds the SEEDED routine (packages/db) to the REAL app catalog (CHECKIN_FIELDS / LIFE_ACTIVITY_KEYS,
// which live app-side): a stale seed key is grammar-valid but silently DROPPED on render, weakening the
// A≠B demo — this catches that drift at CI time.
describe('the seeded routine binds to the live app catalog', () => {
  it('every key in Scarlett’s seed resolves against ROUTINE_CATALOG (nothing dropped)', () => {
    const resolved = resolveRoutine(SEED_SCARLETT_ROUTINE, ROUTINE_CATALOG);
    expect(resolved.order.length).toBe(SEED_SCARLETT_ROUTINE.order.length);
    expect(resolved).not.toEqual(buildDefaultRoutine(ROUTINE_CATALOG)); // A≠B holds against the live catalog
  });
});

/**
 * ONB-0 — `resolveRoutine`'s third parameter. MEMBERSHIP (arg 2) and the FALLBACK (arg 3) are different
 * questions: membership must stay the whole catalog or an authored item is stripped on read, while the
 * fallback is what a profile with no usable config renders.
 */
describe('resolveRoutine — membership vs the fallback (two lists)', () => {
  const FALLBACK = ['strength'] as const;

  it("omitting the third arg keeps TODAY's behaviour exactly (back-compat for every existing caller)", () => {
    expect(resolveRoutine(null, CATALOG)).toEqual(buildDefaultRoutine(CATALOG));
  });

  it('uses the FALLBACK, not the catalog, on every no-usable-config path', () => {
    const expected = buildDefaultRoutine(FALLBACK);
    expect(resolveRoutine(null, CATALOG, FALLBACK)).toEqual(expected);
    expect(resolveRoutine('nope', CATALOG, FALLBACK)).toEqual(expected);
    expect(resolveRoutine({ version: 2, order: [] }, CATALOG, FALLBACK)).toEqual(expected);
    // Fully-stale config → the fallback too (the second fallback site inside the function).
    expect(
      resolveRoutine({ version: 1, order: [{ key: 'life:gone' }] }, CATALOG, FALLBACK),
    ).toEqual(expected);
  });

  it('keeps membership WIDE: a catalog key outside the fallback still resolves', () => {
    const stored = { version: 1, order: [{ key: 'checkin:brush_teeth:stance' }] };
    expect(resolveRoutine(stored, CATALOG, FALLBACK).order.map((i) => i.key)).toEqual([
      'checkin:brush_teeth:stance',
    ]);
  });

  it('filters the fallback through membership — `default ⊆ catalog` is enforced, not assumed', () => {
    // A fallback key the catalog does not offer would render a block on Today that the editor never
    // lists, so the next save would delete it.
    const resolved = resolveRoutine(null, CATALOG, ['strength', 'life:not_in_catalog']);
    expect(resolved.order.map((i) => i.key)).toEqual(['strength']);
  });

  it('never returns a BLANK routine: an empty or wholly-stale fallback falls back to the catalog', () => {
    expect(resolveRoutine(null, CATALOG, [])).toEqual(buildDefaultRoutine(CATALOG));
    expect(resolveRoutine(null, CATALOG, ['nothing:real'])).toEqual(buildDefaultRoutine(CATALOG));
  });
});
