import { describe, expect, it } from 'vitest';

import type { SetDTO } from '@/lib/dal/entries';

import { formatSetLine, isEditableSet } from './set-display';

const set = (o: Partial<SetDTO>): SetDTO => ({
  publicId: 'set-1',
  idx: 1,
  reps: 5,
  weight: 135,
  weightLabel: null,
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
