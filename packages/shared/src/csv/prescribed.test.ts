import { describe, expect, it } from 'vitest';

import {
  effectiveReps,
  formatPrescribedForExport,
  liveMatchesByKey,
  type PrescribedRowForMatch,
} from './prescribed';

/**
 * The `prescribed` column's renderer and live-match composer (V1-22 chunk 2).
 *
 * ⚠️ **These render bytes that already exist in every exported month**, so the tests below are
 * byte-pins, not taste. The composer was hoisted verbatim out of `export.ts`, truthiness included;
 * a "cleanup" that tidies `p.sets ?` into `p.sets != null` must fail here rather than quietly
 * rewrite history.
 */

const parts = (over: Partial<Parameters<typeof formatPrescribedForExport>[0]> = {}) => ({
  sets: null,
  targetReps: null,
  load: null,
  reps: null,
  ...over,
});

describe('formatPrescribedForExport', () => {
  it('renders an open() prescription as the empty string — the DOMINANT shape', () => {
    // 🔴 11 of the 13 seeded prescriptions are `open()`: no sets, no target reps, no load. `''` is a
    // REAL rendered value and must survive all the way to the column; it is NOT "no prescription",
    // which is NULL. Every truthiness guard between here and the DB collapses these eleven.
    expect(formatPrescribedForExport(parts())).toBe('');
  });

  it('renders sets × reps, and appends the load', () => {
    expect(formatPrescribedForExport(parts({ sets: 3, targetReps: '10', load: '45' }))).toBe(
      '3x10 @ 45',
    );
  });

  it('renders reps alone when there are no sets', () => {
    expect(formatPrescribedForExport(parts({ targetReps: 'AMRAP' }))).toBe('AMRAP');
  });

  it('lets the per-kid reps override beat the shared target', () => {
    // V1-13b: `prescription_targets.reps` is one athlete's override of `prescriptions.target_reps`.
    expect(formatPrescribedForExport(parts({ sets: 3, targetReps: '10', reps: '8' }))).toBe('3x8');
  });

  it('keeps a comma inside the rendered reps, which a CSV quoting change would disturb', () => {
    expect(
      formatPrescribedForExport(parts({ sets: 3, targetReps: '4, last AMRAP', load: '65' })),
    ).toBe('3x4, last AMRAP @ 65');
  });

  describe('the hoisted truthiness, pinned so a tidy-up fails instead of rewriting bytes', () => {
    it('treats sets = 0 as no sets', () => {
      // Unreachable in the data (`prescriptions_sets_check`: sets is null or sets > 0), but the TYPE
      // permits it, and `p.sets ?` vs `p.sets != null` differ here. Pinned, not relied on.
      expect(formatPrescribedForExport(parts({ sets: 0, targetReps: '5' }))).toBe('5');
    });

    it("treats load = '' as no load — no dangling '@'", () => {
      expect(formatPrescribedForExport(parts({ sets: 3, targetReps: '5', load: '' }))).toBe('3x5');
    });
  });
});

describe('effectiveReps', () => {
  it('returns null rather than the empty string when neither is set', () => {
    // 🔴 The two readers want different empties: the CSV concatenates `''`, while
    // `ProgramDayDTO.targetReps` is `string | null` and the day card null-checks it. Coalescing
    // here would quietly change the DTO's contract to share a one-line helper. What is shared is
    // the PRECEDENCE, which is the part that must not drift.
    expect(effectiveReps({ reps: null, targetReps: null })).toBeNull();
  });

  it('prefers the per-kid override', () => {
    expect(effectiveReps({ reps: '8', targetReps: '10' })).toBe('8');
  });
});

describe('liveMatchesByKey', () => {
  const row = (movementId: number, over = {}): PrescribedRowForMatch => ({
    ...parts(over),
    movementId,
  });

  it('maps a movement to its rendered prescription', () => {
    const map = liveMatchesByKey([row(7, { sets: 3, targetReps: '10' })]);
    expect(map.get(7)).toBe('3x10');
  });

  it('keeps an empty rendering as an entry, distinct from an absent one', () => {
    // The difference between "this day programs the movement, and the prescription is open" and
    // "this day does not program it at all". Both end up `''` in the CSV, but only the first is a
    // match — and the writer's docblock turns on that distinction.
    const map = liveMatchesByKey([row(7)]);
    expect(map.get(7)).toBe('');
    expect(map.has(9)).toBe(false);
  });

  /**
   * 🔴 **The ambiguity rule, which had NO test before this function existed to be called.** It lived
   * inline inside a private `async` function in the `server-only` DAL, so nothing could reach it.
   * The same movement twice in one day is warm-up + working sets, and the column's purpose is being
   * *not* reconciled with actuals — so a wrong plan is worse than no plan.
   */
  it('renders a movement programmed TWICE in one day as ambiguous, never an arbitrary pick', () => {
    const map = liveMatchesByKey([
      row(7, { sets: 2, targetReps: '5', load: '45' }),
      row(7, { sets: 3, targetReps: '8', load: '95' }),
    ]);
    expect(map.get(7)).toBeNull();
  });

  it('does not let one ambiguous movement poison another', () => {
    const map = liveMatchesByKey([
      row(7, { sets: 2, targetReps: '5' }),
      row(7, { sets: 3, targetReps: '8' }),
      row(9, { sets: 4, targetReps: '6' }),
    ]);
    expect(map.get(7)).toBeNull();
    expect(map.get(9)).toBe('4x6');
  });
});
