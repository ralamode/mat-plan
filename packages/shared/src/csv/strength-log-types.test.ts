import { describe, expect, it } from 'vitest';

import { ENTRY_STATUS } from '../enums';
import { TRACKING_TYPES } from '../movements';
import { fillRowValues, TRACKING_TYPE_FIELDS, unitsForTrackingType } from '../program/pieces';
import { buildStrengthLog } from './strength-log';

/**
 * **Every tracking type, in every unit it takes, as one strength-log row** (FAM-1 14a).
 *
 * Derived, not hand-listed: the cases come from `TRACKING_TYPES` and `unitsForTrackingType`, and each
 * set is built through `fillRowValues`, the rule the row writer stores by. So a new tracking type or
 * unit with no pinned row fails here, and no type can reach the export and throw (a Count in `count`
 * once did, taking the whole export down).
 *
 * The pinned cells are `sets,reps,load,prescribed,notes,workout_name`. A bare number in `load` is only
 * ever pounds (`count:lb`, `weight_reps:lb`); a Count in `count` writes its number in `reps`.
 */
const PINNED: Record<string, string> = {
  'check:': '1,,,,,Heavy A',
  'count:lb': '1,,20,,,Heavy A',
  'count:kg': '1,,20kg,,,Heavy A',
  'count:in': '1,,20in,,,Heavy A',
  'count:cm': '1,,20cm,,,Heavy A',
  'count:ft': '1,,20ft,,,Heavy A',
  'count:m': '1,,20m,,,Heavy A',
  'count:yd': '1,,20yd,,,Heavy A',
  'count:mi': '1,,20mi,,,Heavy A',
  'count:sec': '1,,20s,,,Heavy A',
  'count:min': '1,,20min,,,Heavy A',
  'count:count': '1,20,,,,Heavy A',
  'reps:': '1,8,,,,Heavy A',
  'weight_reps:lb': '1,8,20,,,Heavy A',
  'weight_reps:kg': '1,8,20kg,,,Heavy A',
  'duration:min': '1,,20min,,,Heavy A',
  'time_sets:sec': '1,,20s,,,Heavy A',
  'distance:in': '1,,(20in),,,Heavy A',
  'distance:cm': '1,,(20cm),,,Heavy A',
  'distance:ft': '1,,(20ft),,,Heavy A',
  'distance:m': '1,,(20m),,,Heavy A',
  'distance:yd': '1,,(20yd),,,Heavy A',
  'distance:mi': '1,,(20mi),,,Heavy A',
};

const cases = TRACKING_TYPES.flatMap((type) => {
  const fields = TRACKING_TYPE_FIELDS[type];
  const units =
    fields.slot === null ? [null] : fields.unit ? [fields.unit] : unitsForTrackingType(type);
  return units.map((unit) => ({ type, unit }));
});

describe('a program row of each tracking type, in each unit (FAM-1 14a)', () => {
  it('pins exactly the cases the types and units produce', () => {
    expect(cases.map(({ type, unit }) => `${type}:${unit ?? ''}`).sort()).toEqual(
      Object.keys(PINNED).sort(),
    );
  });

  it.each(cases)('$type in $unit', ({ type, unit }) => {
    const fields = TRACKING_TYPE_FIELDS[type];
    const values = fillRowValues(
      { trackingType: type, unit },
      {
        reps: fields.reps ? 8 : undefined,
        quantities: fields.slot && unit ? [{ slot: fields.slot, unit, value: 20 }] : [],
      },
      null,
    );
    expect(values).not.toBeNull();
    const line = buildStrengthLog([
      {
        date: '2026-11-17',
        dayRole: null,
        sessionType: 'workout',
        movementSlug: 'item',
        status: ENTRY_STATUS.done,
        prescribed: '',
        notes: '',
        workoutName: 'Heavy A',
        sets: [
          {
            reps: values!.reps ?? null,
            isBodyweight: false,
            isBand: false,
            status: ENTRY_STATUS.done,
            quantities: values!.quantities.map((q) => ({ ...q, value: String(q.value) })),
          },
        ],
      },
    ]).split('\n')[1];
    expect(line).toBe(`2026-11-17,workout,item,${PINNED[`${type}:${unit ?? ''}`]}`);
  });
});
