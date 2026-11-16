import { describe, expect, it } from 'vitest';

import { DEFAULT_TRACKING_TYPE, TRACKING_TYPES } from '@mat-plan/shared';

import { movements } from './schema';

/**
 * `DEFAULT_TRACKING_TYPE` (shared) and the `movements.tracking_type` column default (schema) are one
 * fact in two packages (FAM-1 contract change C2). The schema still spells the default as a
 * literal; this holds the two equal until it reads the const, and after.
 */
describe('movements.tracking_type: the default', () => {
  it('is DEFAULT_TRACKING_TYPE, as the schema declares the column', () => {
    expect(movements.trackingType.hasDefault).toBe(true);
    expect(movements.trackingType.default).toBe(DEFAULT_TRACKING_TYPE);
    expect(movements.trackingType.notNull).toBe(true);
  });

  it('is one of the seven tracking types the column’s CHECK admits', () => {
    expect(TRACKING_TYPES).toContain(movements.trackingType.default);
  });
});
