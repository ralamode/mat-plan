import { describe, expect, it } from 'vitest';

import { formatValueUnit } from './format-value-unit';

describe('formatValueUnit', () => {
  it('renders the value with its unit', () => {
    expect(formatValueUnit(84.5, 'lb')).toBe('84.5 lb');
    expect(formatValueUnit(30, 'in')).toBe('30 in');
    expect(formatValueUnit(20, 'sec')).toBe('20 sec');
  });

  /**
   * ⚠️ The contract that keeps this separable from `@mat-plan/shared/csv`'s `formatQuantity`, which
   * emits a BARE number for a mass and `20s` for seconds because those are the corpus's bytes.
   * Reusing the CSV formatter here would drop the unit off every weight on screen; reusing this one
   * there would corrupt the export. Pinned so a future "let's share these" refactor fails here.
   */
  it('keeps the unit on a mass — unlike the CSV formatter, deliberately', () => {
    expect(formatValueUnit(84.5, 'lb')).toBe('84.5 lb');
    expect(formatValueUnit(5, 'kg')).toBe('5 kg'); // the CSV path THROWS on kg; display must not
  });

  it('does not pad or round — the DTO value is already a JS number', () => {
    // `92` must not render as `92.0`: that is the CSV path's `formatNumeric` problem (pg returns
    // `numeric` as a string), and it does not exist here.
    expect(formatValueUnit(92, 'lb')).toBe('92 lb');
    expect(formatValueUnit(71.4, 'lb')).toBe('71.4 lb');
  });
});
