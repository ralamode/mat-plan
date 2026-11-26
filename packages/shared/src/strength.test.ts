import { describe, expect, it } from 'vitest';

import { numericSetSchema } from './strength';

// Moved from the deleted legacy set-schema test (LEGACY-1 C2b): the case that tests a live schema.
describe('numericSetSchema', () => {
  it('keeps the blank→NaN guard: a blank weight is refused, never read as 0', () => {
    expect(numericSetSchema.safeParse({ reps: '5', weight: '' }).success).toBe(false);
    expect(numericSetSchema.safeParse({ reps: '5', weight: '0' }).success).toBe(true);
  });
});
