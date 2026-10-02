import {
  ENTRY_STATUS,
  ENTRY_STATUS_LABELS,
  ENTRY_STATUSES,
  QUANTITY_SLOT,
  UNIT_DIMENSION,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import type { SetDTO, SetQuantityDTO } from '@/lib/dal/entries';

import {
  formatSetLine,
  isEditableSet,
  LOCKED_REASON,
  lockedReason,
  movementLockedReason,
} from './set-display';

/** A quantity, built from the shared consts rather than re-typed literals (AGENTS.md). */
const qty = (o: Partial<SetQuantityDTO>): SetQuantityDTO => ({
  slot: QUANTITY_SLOT.primary,
  dimension: UNIT_DIMENSION.mass,
  unit: 'lb',
  value: 135,
  ...o,
});

// Defaults to a `done` set carrying one primary mass — the overwhelmingly common shape — so every
// pre-existing case reads the same as before and only the special cases opt in.
const set = (o: Partial<SetDTO>): SetDTO => ({
  publicId: 'set-1',
  idx: 1,
  reps: 5,
  isBodyweight: false,
  isBand: false,
  quantities: [qty({})],
  status: ENTRY_STATUS.done,
  ...o,
});

describe('formatSetLine', () => {
  it('renders a numeric set as reps × value + the unit STORED ON THE ROW', () => {
    // GAP-3: the unit is no longer passed in from the entry — it travels on the quantity, which is
    // what stops a household preference change from silently reinterpreting history (ADR 0004 §6).
    expect(formatSetLine(set({ reps: 5, quantities: [qty({ value: 135, unit: 'lb' })] }))).toBe(
      '5 × 135 lb',
    );
    expect(formatSetLine(set({ reps: 5, quantities: [qty({ value: 60, unit: 'kg' })] }))).toBe(
      '5 × 60 kg',
    );
  });

  it('renders a bodyweight set as BW, with no quantity at all', () => {
    expect(formatSetLine(set({ reps: 8, isBodyweight: true, quantities: [] }))).toBe('8 × BW');
  });

  it('renders a band set as band', () => {
    expect(formatSetLine(set({ reps: 12, isBand: true, quantities: [] }))).toBe('12 × band');
  });

  it('renders BW+8 (vest) — the shape ADR 0004 called "not representable today"', () => {
    expect(
      formatSetLine(
        set({
          reps: 8,
          isBodyweight: true,
          quantities: [qty({ slot: QUANTITY_SLOT.vest, value: 8, unit: 'lb' })],
        }),
      ),
    ).toBe('8 × BW +8 lb vest');
  });

  it('renders a box-jump height — a LENGTH as the primary quantity', () => {
    expect(
      formatSetLine(
        set({
          reps: 3,
          quantities: [qty({ dimension: UNIT_DIMENSION.length, value: 30, unit: 'in' })],
        }),
      ),
    ).toBe('3 × 30 in');
  });

  it('renders a sled push — two dimensions on one set (`123 (50ft)`)', () => {
    expect(
      formatSetLine(
        set({
          reps: 1,
          quantities: [
            qty({ value: 123, unit: 'lb' }),
            qty({
              slot: QUANTITY_SLOT.distance,
              dimension: UNIT_DIMENSION.length,
              value: 50,
              unit: 'ft',
            }),
          ],
        }),
      ),
    ).toBe('1 × 123 lb +50 ft distance');
  });

  it('degrades nulls to ? rather than rendering "null"', () => {
    expect(formatSetLine(set({ reps: null, quantities: [] }))).toBe('? × ?');
  });
});

describe('isEditableSet — only plain numeric reps+weight sets are editable (correctness B1)', () => {
  it('a single primary MASS set is editable', () => {
    expect(isEditableSet(set({ reps: 5 }))).toBe(true);
    expect(isEditableSet(set({ reps: 8, quantities: [qty({ value: 0 })] }))).toBe(true); // 0 is a real weight
  });

  it('a bodyweight or band set is NOT editable (the edit form submits a bare number)', () => {
    expect(isEditableSet(set({ isBodyweight: true, quantities: [] }))).toBe(false);
    expect(isEditableSet(set({ isBand: true, quantities: [] }))).toBe(false);
  });

  // GAP-3: these were excluded before because they were SPELLED as a text label. They are excluded
  // now because of what they ARE — a length and a duration. Dropping weight_label without this would
  // have made every previously-labeled set silently editable, which is a data-integrity regression.
  it('a LENGTH or TIME primary is NOT editable (a numeric edit would misrepresent it)', () => {
    expect(
      isEditableSet(set({ quantities: [qty({ dimension: UNIT_DIMENSION.length, unit: 'in' })] })),
    ).toBe(false);
    expect(
      isEditableSet(set({ quantities: [qty({ dimension: UNIT_DIMENSION.time, unit: 'sec' })] })),
    ).toBe(false);
  });

  it('a MULTI-quantity set is NOT editable (one number can’t round-trip two slots)', () => {
    expect(
      isEditableSet(
        set({
          quantities: [qty({}), qty({ slot: QUANTITY_SLOT.vest, value: 8 })],
        }),
      ),
    ).toBe(false);
  });

  it('a null-reps or quantity-less set is NOT editable (can’t round-trip the required schema)', () => {
    expect(isEditableSet(set({ reps: null }))).toBe(false);
    expect(isEditableSet(set({ reps: 5, quantities: [] }))).toBe(false);
  });
});

// GAP-1 P1-1b (BUG-2a). A sub-failure set is NUMERIC, so every other `isEditableSet` guard passes it.
// Without the status clause the V1-9 inline edit would change its reps and leave `status` behind — the
// row would still export as `sub-failure` while claiming reps it never achieved.
describe('isEditableSet — status guard (GAP-1 P1-1b / BUG-2a)', () => {
  it('refuses a sub_failure set even though it is numeric', () => {
    expect(isEditableSet(set({ status: ENTRY_STATUS.sub_failure }))).toBe(false);
  });

  it('still allows an ordinary done numeric set', () => {
    expect(isEditableSet(set({ status: ENTRY_STATUS.done }))).toBe(true);
  });

  it('refuses a skipped set (defence in depth — no writer produces one)', () => {
    expect(isEditableSet(set({ status: ENTRY_STATUS.skipped }))).toBe(false);
  });

  it('leaves the bodyweight refusal intact (the guards compose, not replace)', () => {
    expect(
      isEditableSet(set({ isBodyweight: true, quantities: [], status: ENTRY_STATUS.done })),
    ).toBe(false);
  });
});

describe('formatSetLine — status is NOT rendered here (GAP-1 P1-1b, S8)', () => {
  it('renders a sub_failure set identically to a done one', () => {
    // Status is a distinct visual affordance, not part of the load string: appending "(sub-failure)"
    // here would produce an un-styleable blob that leaks into EditableSet's read line and any future
    // aria-label. PR 1c renders it as a badge, mirroring the entry-level status badge on page.tsx.
    const done = formatSetLine(set({ status: ENTRY_STATUS.done }));
    const sub = formatSetLine(set({ status: ENTRY_STATUS.sub_failure }));
    expect(sub).toBe(done);
    expect(sub).toBe('5 × 135 lb');
  });
});

// GAP-1 P1-1c. The label map lives in `packages/shared`, not app-local, because `sub-failure` is the
// CSV export byte (V1-13 D7) — the badge and the exporter must emit the identical string.
describe('ENTRY_STATUS_LABELS (GAP-1 P1-1c)', () => {
  it('humanizes sub_failure to the CSV byte `sub-failure`', () => {
    expect(ENTRY_STATUS_LABELS[ENTRY_STATUS.sub_failure]).toBe('sub-failure');
  });

  it('covers every status, so a new one cannot render as a raw enum', () => {
    for (const s of ENTRY_STATUSES) expect(ENTRY_STATUS_LABELS[s]).toBeTruthy();
  });
});

describe('lockedReason — WHY a set has no Change (V1-24 3a-i)', () => {
  // One fixture per isEditableSet clause, plus the editable baseline.
  const cases = [
    { name: 'editable', s: set({}), reason: null },
    {
      name: 'bodyweight',
      s: set({ isBodyweight: true, quantities: [] }),
      reason: LOCKED_REASON.mode,
    },
    { name: 'band', s: set({ isBand: true, quantities: [] }), reason: LOCKED_REASON.mode },
    { name: 'BW + vest', s: set({ isBodyweight: true }), reason: LOCKED_REASON.mode },
    {
      name: 'sub-failure',
      s: set({ status: ENTRY_STATUS.sub_failure }),
      reason: LOCKED_REASON.status,
    },
    {
      name: 'timed',
      s: set({ quantities: [qty({ dimension: UNIT_DIMENSION.time, unit: 'sec' })] }),
      reason: LOCKED_REASON.notMass,
    },
    {
      name: 'distance',
      s: set({ quantities: [qty({ dimension: UNIT_DIMENSION.length, unit: 'in' })] }),
      reason: LOCKED_REASON.notMass,
    },
    { name: 'no reps', s: set({ reps: null }), reason: LOCKED_REASON.shape },
    { name: 'no quantity', s: set({ quantities: [] }), reason: LOCKED_REASON.shape },
    {
      name: 'two quantities',
      s: set({
        quantities: [
          qty({}),
          qty({ slot: QUANTITY_SLOT.distance, dimension: UNIT_DIMENSION.length, unit: 'ft' }),
        ],
      }),
      reason: LOCKED_REASON.shape,
    },
  ];

  it.each(cases)('$name → $reason', ({ s, reason }) => {
    expect(lockedReason(s)).toBe(reason);
  });

  // THE pin: a reason exists exactly when isEditableSet refuses. Change one, change the other.
  it.each(cases)('$name: isEditableSet agrees with lockedReason', ({ s }) => {
    expect(isEditableSet(s)).toBe(lockedReason(s) === null);
  });

  it('a movement shows ONE reason: the shared one, or the generic line when they differ', () => {
    const bw = set({ isBodyweight: true, quantities: [] });
    const timed = set({ quantities: [qty({ dimension: UNIT_DIMENSION.time, unit: 'sec' })] });
    expect(movementLockedReason([set({}), set({})])).toBeNull();
    expect(movementLockedReason([set({}), bw, bw])).toBe(LOCKED_REASON.mode);
    expect(movementLockedReason([bw, timed])).toBe(LOCKED_REASON.shape);
  });
});
