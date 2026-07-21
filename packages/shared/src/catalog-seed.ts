import type { ActivityCategory } from './activity-categories';
import type { ActivityInputShape } from './activity-shapes';
import type { MetricAggregation, MetricValueType } from './metrics';
import type { Unit } from './units';

/**
 * Minimal catalog rows that V1-1b's entry backfill + DAL dual-write reference: the
 * `weigh_in` / `sc_lift` activity types and the `bodyweight` metric. The FULL catalog
 * (every activity_type / movement / metric_definition) is seeded at V1-2 — these three
 * rows are the single source of truth BOTH this phase and V1-2 reuse (AGENTS.md
 * constants convention: define once, import everywhere).
 *
 * V1-2 MUST reuse these exact keys AND public_ids: its full-catalog seed is
 * `ON CONFLICT DO NOTHING` on the natural key (`activity_types.key` /
 * `metric_definitions.key`), so re-declaring these rows there is a safe no-op — no
 * duplicate, no drift. Fixed UUIDv7s (seed namespace `019826b4-0000-7000-8000-…`,
 * alongside SEED_HOUSEHOLD_PUBLIC_ID `…010` / SEED_PROFILE_PUBLIC_ID `…001`) keep the
 * rows stable-by-identity across re-seeds.
 */

/**
 * Shared seed-namespace prefix + helper (single source — AGENTS.md constants
 * convention). Every fixed-identity seed row's public_id is `seedPublicId('<hex>')`
 * so the `019826b4-0000-7000-8000-…` UUIDv7 namespace is defined ONCE and the full
 * catalog (V1-2) can't drift its suffix scheme from these reused rows. `<hex>` is the
 * trailing 3 hex digits (12-digit final segment): `020`/`021` activity types, `030`
 * metrics, `050`+ movements, alongside SEED_HOUSEHOLD `010` / SEED_PROFILE `001`.
 */
export const SEED_PUBLIC_ID_PREFIX = '019826b4-0000-7000-8000-000000000';
export function seedPublicId(suffix: string): string {
  return `${SEED_PUBLIC_ID_PREFIX}${suffix}`;
}

export const SEED_ACTIVITY_TYPE_WEIGH_IN_PUBLIC_ID = seedPublicId('020');
export const SEED_ACTIVITY_TYPE_SC_LIFT_PUBLIC_ID = seedPublicId('021');
export const SEED_METRIC_BODYWEIGHT_PUBLIC_ID = seedPublicId('030');

/** Natural keys (activity_type.key / metric_definition.key) the backfill + DAL branch on. */
export const SEED_ACTIVITY_TYPE_KEYS = {
  weighIn: 'weigh_in',
  scLift: 'sc_lift',
} as const;

export const SEED_METRIC_KEYS = {
  bodyweight: 'bodyweight',
} as const;

type CatalogActivityTypeSeed = {
  publicId: string;
  key: string;
  label: string;
  category: ActivityCategory;
  inputShape: ActivityInputShape;
  defaultUnit: Unit | null;
};

type CatalogMetricDefinitionSeed = {
  publicId: string;
  key: string;
  label: string;
  unit: Unit;
  valueType: MetricValueType;
  aggregation: MetricAggregation;
};

/** The two activity types the v0 write paths map onto (weigh-in + S&C lift). */
export const CATALOG_ACTIVITY_TYPE_SEED_ROWS = [
  {
    publicId: SEED_ACTIVITY_TYPE_WEIGH_IN_PUBLIC_ID,
    key: SEED_ACTIVITY_TYPE_KEYS.weighIn,
    label: 'Weigh-in',
    category: 'measurement',
    inputShape: 'single_metric',
    defaultUnit: 'lb',
  },
  {
    publicId: SEED_ACTIVITY_TYPE_SC_LIFT_PUBLIC_ID,
    key: SEED_ACTIVITY_TYPE_KEYS.scLift,
    label: 'S&C lift',
    category: 'strength',
    inputShape: 'set_list',
    defaultUnit: null,
  },
] as const satisfies readonly CatalogActivityTypeSeed[];

/** The one metric the v0 bodyweight write path maps onto. */
export const CATALOG_METRIC_DEFINITION_SEED_ROWS = [
  {
    publicId: SEED_METRIC_BODYWEIGHT_PUBLIC_ID,
    key: SEED_METRIC_KEYS.bodyweight,
    label: 'Bodyweight',
    unit: 'lb',
    valueType: 'number',
    aggregation: 'last',
  },
] as const satisfies readonly CatalogMetricDefinitionSeed[];
