import { describe, expect, it } from 'vitest';

import { formatPrescribedForExport } from '../csv/prescribed';
import { TRACKING_TYPE, TRACKING_TYPES, type TrackingType } from '../movements';
import { QUANTITY_SLOT } from '../quantity-slots';
import { prescribedText, type PrescribedTextParts } from './prescribed-text';

/**
 * The one renderer for prescribed text (FAM-1 plan §4).
 *
 * ⚠️ **These are byte-pins.** The row writer freezes this text on every logged row, so a "tidier"
 * format here changes what later rows store while earlier rows keep the old bytes. The expected
 * strings are the accepted prototype's (`presc(it)` in `docs/prototypes/beta-0/index.html`).
 */

const parts = (
  trackingType: TrackingType,
  over: Partial<PrescribedTextParts> = {},
): PrescribedTextParts => ({ trackingType, sets: null, targetReps: null, quantities: [], ...over });

const primary = (value: number | null, unit: 'lb' | 'kg' | 'sec' | 'min' | 'count') => ({
  slot: QUANTITY_SLOT.primary,
  unit,
  value,
});
const distance = (value: number | null, unit: 'yd' | 'm') => ({
  slot: QUANTITY_SLOT.distance,
  unit,
  value,
});

describe('prescribedText: each tracking type, in the prototype’s format', () => {
  /** One prescription per type, with the text the prototype shows for it. */
  const cases: Record<TrackingType, [PrescribedTextParts, string]> = {
    check: [parts(TRACKING_TYPE.check), ''],
    count: [parts(TRACKING_TYPE.count, { quantities: [primary(10, 'lb')] }), '10 lb'],
    reps: [parts(TRACKING_TYPE.reps, { sets: 3, targetReps: '10' }), '3 × 10'],
    weight_reps: [
      parts(TRACKING_TYPE.weight_reps, {
        sets: 4,
        targetReps: '8',
        quantities: [primary(25, 'lb')],
      }),
      '4 × 8 @ 25 lb',
    ],
    duration: [parts(TRACKING_TYPE.duration, { quantities: [primary(5, 'min')] }), '5 min'],
    time_sets: [
      parts(TRACKING_TYPE.time_sets, { sets: 3, quantities: [primary(30, 'sec')] }),
      '3 × 30 s',
    ],
    distance: [
      parts(TRACKING_TYPE.distance, { sets: 6, quantities: [distance(40, 'yd')] }),
      '6 × 40 yd',
    ],
  };

  it.each(TRACKING_TYPES)('%s', (type) => {
    const [prescription, text] = cases[type];
    expect(prescribedText(prescription)).toBe(text);
  });
});

describe('prescribedText: the edges of each type', () => {
  it('writes seconds as s, and every other unit as its code', () => {
    const timed = (unit: 'sec' | 'min') =>
      prescribedText(parts(TRACKING_TYPE.time_sets, { sets: 2, quantities: [primary(45, unit)] }));
    expect(timed('sec')).toBe('2 × 45 s');
    expect(timed('min')).toBe('2 × 45 min');
    expect(
      prescribedText(
        parts(TRACKING_TYPE.weight_reps, {
          sets: 5,
          targetReps: '5',
          quantities: [primary(60, 'kg')],
        }),
      ),
    ).toBe('5 × 5 @ 60 kg');
    expect(prescribedText(parts(TRACKING_TYPE.count, { quantities: [primary(7, 'count')] }))).toBe(
      '7 count',
    );
  });

  it('keeps a decimal load and drops nothing from it', () => {
    expect(
      prescribedText(
        parts(TRACKING_TYPE.weight_reps, {
          sets: 3,
          targetReps: '8',
          quantities: [primary(27.5, 'lb')],
        }),
      ),
    ).toBe('3 × 8 @ 27.5 lb');
  });

  it('leaves out the load when Weight × reps has none, with no dangling @', () => {
    expect(prescribedText(parts(TRACKING_TYPE.weight_reps, { sets: 4, targetReps: '8' }))).toBe(
      '4 × 8',
    );
  });

  it('treats a quantity with no value as no target: the unit alone is not a prescription', () => {
    // `value: null` means "log in this unit, no target" (plan D2).
    expect(prescribedText(parts(TRACKING_TYPE.count, { quantities: [primary(null, 'lb')] }))).toBe(
      '',
    );
    expect(
      prescribedText(parts(TRACKING_TYPE.duration, { quantities: [primary(null, 'min')] })),
    ).toBe('');
    expect(
      prescribedText(
        parts(TRACKING_TYPE.weight_reps, {
          sets: 4,
          targetReps: '8',
          quantities: [primary(null, 'lb')],
        }),
      ),
    ).toBe('4 × 8');
  });

  it('writes one set of a distance as the distance alone', () => {
    // The prototype's default for a new Distance item: 1 set of 400 m.
    expect(
      prescribedText(parts(TRACKING_TYPE.distance, { sets: 1, quantities: [distance(400, 'm')] })),
    ).toBe('400 m');
    expect(
      prescribedText(parts(TRACKING_TYPE.distance, { quantities: [distance(400, 'm')] })),
    ).toBe('400 m');
  });

  it('reads a Distance from the distance slot, not the primary one', () => {
    expect(
      prescribedText(parts(TRACKING_TYPE.distance, { sets: 2, quantities: [primary(40, 'lb')] })),
    ).toBe('2 ×');
  });

  it('writes the reps alone when there is no set count, and the sets alone when there are no reps', () => {
    expect(prescribedText(parts(TRACKING_TYPE.reps, { targetReps: '10' }))).toBe('10');
    expect(prescribedText(parts(TRACKING_TYPE.reps, { sets: 3 }))).toBe('3 ×');
    expect(prescribedText(parts(TRACKING_TYPE.reps))).toBe('');
  });

  it('ignores the fields a type does not use', () => {
    const everything = { sets: 3, targetReps: '10', quantities: [primary(5, 'min')] };
    expect(prescribedText(parts(TRACKING_TYPE.check, everything))).toBe('');
    expect(prescribedText(parts(TRACKING_TYPE.duration, everything))).toBe('5 min');
    expect(prescribedText(parts(TRACKING_TYPE.reps, everything))).toBe('3 × 10');
  });
});

describe('prescribedText and the export’s renderer', () => {
  it('leaves the CSV’s own spelling alone', () => {
    // `3x10 @ 45` is bytes in every exported month. The new renderer builds on that function and
    // must not have changed it; `csv/prescribed.test.ts` holds the full set of pins.
    expect(formatPrescribedForExport({ sets: 3, targetReps: '10', load: '45', reps: null })).toBe(
      '3x10 @ 45',
    );
  });
});
