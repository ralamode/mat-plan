import { DEFAULT_BODYWEIGHT_UNIT } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { formatValueUnit } from './format-value-unit';

describe('formatValueUnit', () => {
  it('renders the value with its unit', () => {
    // Codes stay codes for the units a lifter reads as codes.
    expect(formatValueUnit(84.5, DEFAULT_BODYWEIGHT_UNIT)).toBe('84.5 lb');
    expect(formatValueUnit(20, 'sec')).toBe('20 sec');
    expect(formatValueUnit(40, 'min')).toBe('40 min');
    expect(formatValueUnit(5, 'kg')).toBe('5 kg');
  });

  it('spells the five LENGTH codes, singular at 1 (V1-30b-ii)', () => {
    // `20 m` and `30 in` read as nothing aloud, and `in` is also an English word — a history line
    // said "30 in" with no noun at all.
    expect(formatValueUnit(30, 'in')).toBe('30 inches');
    expect(formatValueUnit(1, 'in')).toBe('1 inch');
    expect(formatValueUnit(20, 'm')).toBe('20 metres');
    expect(formatValueUnit(1, 'm')).toBe('1 metre');
    expect(formatValueUnit(6, 'ft')).toBe('6 feet');
    expect(formatValueUnit(1, 'ft')).toBe('1 foot');
    expect(formatValueUnit(40, 'yd')).toBe('40 yards');
    expect(formatValueUnit(75, 'cm')).toBe('75 centimetres');
    // All FIVE singulars, not three — a typo in `yd`/`cm` used to ship green.
    expect(formatValueUnit(1, 'yd')).toBe('1 yard');
    expect(formatValueUnit(1, 'cm')).toBe('1 centimetre');
  });

  /**
   * ⚠️ The contract that keeps this separable from `@mat-plan/shared/csv`'s `formatQuantity`, which
   * emits a BARE number for a mass and `20s` for seconds because those are the corpus's bytes.
   * Reusing the CSV formatter here would drop the unit off every weight on screen; reusing this one
   * there would corrupt the export. Pinned so a future "let's share these" refactor fails here.
   */
  it('keeps the unit on a mass — unlike the CSV formatter, deliberately', () => {
    expect(formatValueUnit(84.5, DEFAULT_BODYWEIGHT_UNIT)).toBe('84.5 lb');
    expect(formatValueUnit(5, 'kg')).toBe('5 kg'); // the CSV writes `5kg` (no space); display keeps the space
  });

  it('does not pad or round — the DTO value is already a JS number', () => {
    // `92` must not render as `92.0`: that is the CSV path's `formatNumeric` problem (pg returns
    // `numeric` as a string), and it does not exist here.
    expect(formatValueUnit(92, DEFAULT_BODYWEIGHT_UNIT)).toBe('92 lb');
    expect(formatValueUnit(92.3, DEFAULT_BODYWEIGHT_UNIT)).toBe('92.3 lb');
  });
});
