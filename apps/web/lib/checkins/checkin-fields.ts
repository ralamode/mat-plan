import {
  ACTIVITY_INPUT_SHAPE,
  ACTIVITY_METRIC_MAP,
  ACTIVITY_TYPE_KEYS,
  ACTIVITY_TYPE_SEED_ROWS,
  METRIC_DEFINITION_SEED_ROWS,
  METRIC_VALUE_TYPE,
  type ActivityTypeKey,
  type MetricKey,
  type MetricValueType,
  type Unit,
} from '@mat-plan/shared';

/**
 * The check-in field registry (V1-5) — the form is DERIVED from the seeded catalogs,
 * not hand-coded per habit. Two sources, both read straight from reference data:
 *
 *   1. Habits   — every `activity_type` with input_shape='boolean' → one checkbox,
 *                 carrying NEITHER a movement nor a metric (the "neither-source" row
 *                 V1-5 introduces; `entries_value_source_check` is at-most-one).
 *   2. Brush teeth — every metric in `ACTIVITY_METRIC_MAP.brush_teeth` → one control,
 *                 typed by the metric's `value_type`.
 *
 * Scope claim, stated precisely: adding a habit needs NO component/action/DAL change.
 * It is NOT spec §4b's 🟢 "no deploy" tier — these catalogs are compiled TypeScript, so
 * a new row still means a PR + redeploy + `db:seed`. A runtime DB-driven catalog is V1-10.
 *
 * Pure and dependency-light on purpose: no DB, no `server-only`, no React. The RSC page
 * imports it and passes the fields to the client form as a PROP, so the catalog crosses
 * as JSON and never lands in the client bundle.
 */

/** `scale_10` metrics are pinned 1–10 (spec.md §4a: pressure/reaction). */
export const SCALE_10_MIN = 1;
export const SCALE_10_MAX = 10;

/**
 * `entries.value_num` is `numeric(8,3)` → max 99999.999. Clamping here turns an
 * out-of-range value into a typed error envelope instead of a Postgres 22003
 * overflow escaping the action to error.tsx.
 */
export const VALUE_NUM_MAX = 99999.999;

export type CheckinField = {
  /** `rice_bucket` (bare habit) | `brush_teeth:stance` (metric field). */
  key: string;
  activityKey: ActivityTypeKey;
  metricKey: MetricKey | null;
  label: string;
  /** `<legend>` for the fieldset this field renders in. */
  groupLabel: string;
  /** Display only — the DAL writes the unit resolved from the DB catalog row. */
  unit: Unit;
  /** `null` for a bare habit checkbox (no metric backs it). */
  valueType: MetricValueType | null;
  min?: number;
  max?: number;
};

const METRIC_BY_KEY = new Map(METRIC_DEFINITION_SEED_ROWS.map((m) => [m.key, m]));

const HABITS_GROUP_LABEL = 'Habits';

function habitField(a: (typeof ACTIVITY_TYPE_SEED_ROWS)[number]): CheckinField {
  return {
    key: a.key,
    activityKey: a.key,
    metricKey: null,
    label: a.label,
    groupLabel: HABITS_GROUP_LABEL,
    // Every boolean activity is seeded with defaultUnit='bool'; the type is nullable
    // catalog-wide, so narrow explicitly rather than asserting.
    unit: a.defaultUnit ?? 'bool',
    valueType: null,
  };
}

function metricField(activityKey: ActivityTypeKey, metricKey: MetricKey): CheckinField {
  const activity = ACTIVITY_TYPE_SEED_ROWS.find((a) => a.key === activityKey)!;
  const metric = METRIC_BY_KEY.get(metricKey)!;
  const bounds =
    metric.valueType === METRIC_VALUE_TYPE.scale_10
      ? { min: SCALE_10_MIN, max: SCALE_10_MAX }
      : metric.valueType === METRIC_VALUE_TYPE.count
        ? { min: 0, max: VALUE_NUM_MAX }
        : {};

  return {
    key: `${activityKey}:${metricKey}`,
    activityKey,
    metricKey,
    label: metric.label,
    groupLabel: activity.label,
    unit: metric.unit,
    valueType: metric.valueType,
    ...bounds,
  };
}

/**
 * Rendered order is catalog-seed order, so the DOM is stable for the e2e + screenshots.
 *
 * Only `brush_teeth` is rendered here. That is a deliberate V1-5 render scope, NOT a
 * general extension seam: V1-6 (calisthenics) also needs aggregation rollups, and V1-7
 * (wake / wrestling_practice) needs a third field source entirely — `wake` has an empty
 * ACTIVITY_METRIC_MAP entry and `wrestling_practice` needs event_at semantics plus a
 * non-numeric value shape. Neither is one line here.
 */
export const CHECKIN_FIELDS: readonly CheckinField[] = [
  ...ACTIVITY_TYPE_SEED_ROWS.filter((a) => a.inputShape === ACTIVITY_INPUT_SHAPE.boolean).map(
    habitField,
  ),
  ...ACTIVITY_METRIC_MAP[ACTIVITY_TYPE_KEYS.brush_teeth].map((m) =>
    metricField(ACTIVITY_TYPE_KEYS.brush_teeth, m),
  ),
];

/** A field renders as a checkbox when it is a bare habit or a `bool` metric. */
export function isCheckbox(f: CheckinField): boolean {
  return f.valueType === null || f.valueType === METRIC_VALUE_TYPE.bool;
}

/**
 * The two form-field names for a check-in field. ONE definition, imported by both the
 * form and the Server Action, so the two sides cannot drift (AGENTS.md constants rule).
 */
export const valueInputName = (key: string) => `v:${key}`;
export const clientIdInputName = (key: string) => `c:${key}`;
