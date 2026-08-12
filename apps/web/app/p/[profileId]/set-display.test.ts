import { ENTRY_STATUS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import type { SetDTO } from '@/lib/dal/entries';

import { formatSetLine, isEditableSet } from './set-display';

// Defaults to a `done` set — the overwhelmingly common shape — so every pre-existing case reads the
// same as before and only the GAP-1 P1-1b cases opt into a status.
const set = (o: Partial<SetDTO>): SetDTO => ({
  publicId: 'set-1',
  idx: 1,
  reps: 5,
  weight: 135,
  weightLabel: null,
  status: ENTRY_STATUS.done,
  ...o,
});

describe('formatSetLine', () => {
  it('renders a numeric set as reps × weight + unit', () => {
    expect(formatSetLine(set({ reps: 5, weight: 135 }), 'lb')).toBe('5 × 135 lb');
  });

  it('prefers weightLabel over the numeric weight (the historic read seam)', () => {
    expect(formatSetLine(set({ reps: 8, weight: null, weightLabel: 'BW' }), 'lb')).toBe('8 × BW');
  });

  it('degrades nulls to ? rather than rendering "null"', () => {
    expect(formatSetLine(set({ reps: null, weight: null, weightLabel: null }), 'kg')).toBe(
      '? × ? kg',
    );
  });
});

describe('isEditableSet — only numeric reps+weight sets are editable (correctness B1)', () => {
  it('a numeric reps+weight set (no label) is editable', () => {
    expect(isEditableSet(set({ reps: 5, weight: 135, weightLabel: null }))).toBe(true);
    expect(isEditableSet(set({ reps: 8, weight: 0, weightLabel: null }))).toBe(true); // 0 is a real weight
  });

  it('a labeled set is NOT editable (edited weight_num would be masked by the label)', () => {
    expect(isEditableSet(set({ reps: 8, weight: null, weightLabel: 'BW' }))).toBe(false);
    expect(isEditableSet(set({ reps: 5, weight: 135, weightLabel: '50ft' }))).toBe(false);
  });

  it('a null-reps or null-weight set is NOT editable (can’t round-trip the required schema)', () => {
    expect(isEditableSet(set({ reps: null, weight: 135 }))).toBe(false);
    expect(isEditableSet(set({ reps: 5, weight: null }))).toBe(false);
  });
});

// GAP-1 P1-1b (BUG-2a). A sub-failure set is NUMERIC, so every other `isEditableSet` guard passes it.
// Without the status clause the V1-9 inline edit would change its reps and leave `status` behind — the
// row would still export as `sub-failure` while claiming reps it never achieved. These pin both the
// refusal and the fact that the read LINE is deliberately unaffected (the badge is PR 1c's job).
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

  it('leaves the labeled-set refusal intact (the guards compose, not replace)', () => {
    expect(isEditableSet(set({ weightLabel: 'BW', status: ENTRY_STATUS.done }))).toBe(false);
  });
});

describe('formatSetLine — status is NOT rendered here (GAP-1 P1-1b, S8)', () => {
  it('renders a sub_failure set identically to a done one', () => {
    // Status is a distinct visual affordance, not part of the load string: appending "(sub-failure)"
    // here would produce an un-styleable blob that leaks into EditableSet's read line and any future
    // aria-label. PR 1c renders it as a badge, mirroring the entry-level status badge on page.tsx.
    const done = formatSetLine(set({ status: ENTRY_STATUS.done }), 'lb');
    const sub = formatSetLine(set({ status: ENTRY_STATUS.sub_failure }), 'lb');
    expect(sub).toBe(done);
    expect(sub).toBe('5 × 135 lb');
  });
});
