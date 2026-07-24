import {
  ACTIVITY_INPUT_SHAPE,
  ACTIVITY_METRIC_MAP,
  ACTIVITY_TYPE_KEYS,
  ACTIVITY_TYPE_SEED_ROWS,
  METRIC_DEFINITION_SEED_ROWS,
  METRIC_VALUE_TYPE,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import {
  CHECKIN_FIELDS,
  clientIdInputName,
  isCheckbox,
  SCALE_10_MAX,
  SCALE_10_MIN,
  valueInputName,
  VALUE_NUM_MAX,
} from './checkin-fields';

// The registry's whole claim is "derived from seed data, not hand-coded". Every
// assertion below therefore compares against the SEED ARRAYS themselves — a catalog
// change flips the test, and no synthetic fixture or injectable seam is needed.

describe('CHECKIN_FIELDS — habit fields derive from the activity catalog', () => {
  it('renders exactly the boolean-shaped activities, in catalog order', () => {
    const habitKeys = CHECKIN_FIELDS.filter((f) => f.metricKey === null).map((f) => f.activityKey);
    const expected = ACTIVITY_TYPE_SEED_ROWS.filter(
      (a) => a.inputShape === ACTIVITY_INPUT_SHAPE.boolean,
    ).map((a) => a.key);

    expect(habitKeys).toEqual(expected);
    expect(habitKeys.length).toBeGreaterThan(0); // guards a vacuous pass
  });

  it('labels each habit from its catalog row and carries no metric', () => {
    for (const f of CHECKIN_FIELDS.filter((x) => x.metricKey === null)) {
      const row = ACTIVITY_TYPE_SEED_ROWS.find((a) => a.key === f.activityKey)!;
      expect(f.label).toBe(row.label);
      expect(f.unit).toBe(row.defaultUnit);
      expect(f.valueType).toBeNull();
      expect(isCheckbox(f)).toBe(true);
    }
  });
});

describe('CHECKIN_FIELDS — brush-teeth fields derive from the metric catalog', () => {
  const brushFields = CHECKIN_FIELDS.filter(
    (f) => f.activityKey === ACTIVITY_TYPE_KEYS.brush_teeth,
  );

  it('renders one field per mapped metric', () => {
    expect(brushFields.map((f) => f.metricKey)).toEqual([
      ...ACTIVITY_METRIC_MAP[ACTIVITY_TYPE_KEYS.brush_teeth],
    ]);
  });

  it('takes label, unit and value_type from the metric row', () => {
    for (const f of brushFields) {
      const m = METRIC_DEFINITION_SEED_ROWS.find((x) => x.key === f.metricKey)!;
      expect(f.label).toBe(m.label);
      expect(f.unit).toBe(m.unit);
      expect(f.valueType).toBe(m.valueType);
    }
  });

  it('derives the control from value_type, not from a hand-written list', () => {
    for (const f of brushFields) {
      expect(isCheckbox(f)).toBe(f.valueType === METRIC_VALUE_TYPE.bool);
    }
  });

  it('bounds scale_10 metrics to the shared 1–10 constants', () => {
    const scaled = brushFields.filter((f) => f.valueType === METRIC_VALUE_TYPE.scale_10);
    expect(scaled.length).toBeGreaterThan(0);
    for (const f of scaled) {
      expect(f.min).toBe(SCALE_10_MIN);
      expect(f.max).toBe(SCALE_10_MAX);
    }
  });

  // Domain ruling (V1-5): the daily "brush your teeth" skill rep is LADDER drills.
  // `footwork` remains a separate metric in the catalog, just not mapped here.
  it('uses the `ladder` metric, not `footwork`', () => {
    const keys = brushFields.map((f) => f.metricKey);
    expect(keys).toContain('ladder');
    expect(keys).not.toContain('footwork');
  });
});

describe('field-name encoding', () => {
  it('produces a unique, stable name pair per field', () => {
    const names = CHECKIN_FIELDS.flatMap((f) => [valueInputName(f.key), clientIdInputName(f.key)]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keys a metric field by activity and metric so `shot` is unambiguous', () => {
    // `shot` belongs to BOTH brush_teeth and shots (ACTIVITY_METRIC_MAP) — the key,
    // not the label, is what disambiguates them.
    const shot = CHECKIN_FIELDS.find((f) => f.metricKey === 'shot')!;
    expect(shot.key).toBe(`${ACTIVITY_TYPE_KEYS.brush_teeth}:shot`);
  });
});

describe('CHECKIN_FIELDS — calisthenics (V1-6a)', () => {
  const calisFields = CHECKIN_FIELDS.filter(
    (f) => f.activityKey === ACTIVITY_TYPE_KEYS.calisthenics,
  );

  it('renders one field per mapped calisthenics metric, in map order', () => {
    expect(calisFields.map((f) => f.metricKey)).toEqual([
      ...ACTIVITY_METRIC_MAP[ACTIVITY_TYPE_KEYS.calisthenics],
    ]);
  });

  it('are count fields bounded 0..VALUE_NUM_MAX under the Calisthenics legend', () => {
    for (const f of calisFields) {
      expect(f.valueType).toBe(METRIC_VALUE_TYPE.count);
      expect(isCheckbox(f)).toBe(false);
      expect(f.groupLabel).toBe('Calisthenics');
      expect(f.min).toBe(0);
      expect(f.max).toBe(VALUE_NUM_MAX);
    }
  });

  it('ACCUMULATE (stay editable) — unlike V1-5 habits/brush-teeth, which are log-once', () => {
    expect(calisFields.every((f) => f.accumulates)).toBe(true);
    // V1-5's shot is also a `sum` metric but must stay log-once until the shots/goal work.
    const shot = CHECKIN_FIELDS.find((f) => f.metricKey === 'shot')!;
    expect(shot.accumulates).toBe(false);
    // Habits + scale_10 brush-teeth are log-once too.
    expect(CHECKIN_FIELDS.filter((f) => f.metricKey === null).every((f) => !f.accumulates)).toBe(
      true,
    );
    expect(CHECKIN_FIELDS.find((f) => f.metricKey === 'pressure')!.accumulates).toBe(false);
  });
});
