import { z } from 'zod';

import { CATALOG_METRIC_DEFINITION_SEED_ROWS, seedPublicId } from './catalog-seed';
import { metricAggregationSchema, metricValueTypeSchema } from './metrics';
import { unitSchema } from './units';

/**
 * Full `metric_definitions` catalog (spec.md §4/§4a) — the single source seeded at V1-2
 * and validated by the coverage test. Typed metrics: bodyweight, the calisthenics totals,
 * the brush-teeth checkins, a canonical `shot` (not double-modeled), a first-class
 * `pullup_max` (aggregation=max), and the conditioning metrics.
 *
 * The `bodyweight` row is SPREAD from `catalog-seed.ts` (V1-1b), so it keeps ONE
 * definition + its fixed public_id (`…030`); the seed's `ON CONFLICT (key) DO NOTHING`
 * makes re-declaring it a no-op. `unit`, `valueType`, and `aggregation` are
 * `as const satisfies` the shared enums → a bad value fails typecheck.
 */

export const metricDefinitionSeedRowSchema = z.object({
  publicId: z.string(),
  key: z.string(),
  label: z.string(),
  unit: unitSchema,
  valueType: metricValueTypeSchema,
  aggregation: metricAggregationSchema,
});

export type MetricDefinitionSeedRow = z.infer<typeof metricDefinitionSeedRowSchema>;

export const METRIC_DEFINITION_SEED_ROWS = [
  // Reused from V1-1b (fixed public_id …030) — single source, spread not redefined.
  ...CATALOG_METRIC_DEFINITION_SEED_ROWS,
  {
    publicId: seedPublicId('031'),
    key: 'pushups',
    label: 'Push-ups',
    unit: 'count',
    valueType: 'count',
    aggregation: 'sum',
  },
  {
    publicId: seedPublicId('032'),
    key: 'pullups',
    label: 'Pull-ups',
    unit: 'count',
    valueType: 'count',
    aggregation: 'sum',
  },
  {
    publicId: seedPublicId('033'),
    key: 'vsit_crunch',
    label: 'V-sit crunches',
    unit: 'count',
    valueType: 'count',
    aggregation: 'sum',
  },
  {
    publicId: seedPublicId('034'),
    key: 'vsit_skill_step',
    label: 'V-sit skill step',
    unit: 'count',
    valueType: 'count',
    aggregation: 'max',
  },
  {
    publicId: seedPublicId('035'),
    key: 'stance',
    label: 'Stance',
    unit: 'bool',
    valueType: 'bool',
    aggregation: 'last',
  },
  {
    // Ladder drills — the daily brush-teeth skill rep (spec.md §4a). DISTINCT from
    // `footwork` below: ladder and footwork are separate things, but the daily
    // "brush your teeth" rep is specifically ladder work (domain ruling, V1-5).
    publicId: seedPublicId('040'),
    key: 'ladder',
    label: 'Ladder',
    unit: 'bool',
    valueType: 'bool',
    aggregation: 'last',
  },
  {
    // Kept as its own metric (not renamed to `ladder`): the two are distinct skills.
    // Currently referenced by no activity — available to a later one.
    publicId: seedPublicId('036'),
    key: 'footwork',
    label: 'Footwork',
    unit: 'bool',
    valueType: 'bool',
    aggregation: 'last',
  },
  {
    publicId: seedPublicId('037'),
    key: 'bridge',
    label: 'Bridge',
    unit: 'bool',
    valueType: 'bool',
    aggregation: 'last',
  },
  {
    publicId: seedPublicId('038'),
    key: 'mobility',
    label: 'Mobility',
    unit: 'bool',
    valueType: 'bool',
    aggregation: 'last',
  },
  {
    publicId: seedPublicId('039'),
    key: 'pressure',
    label: 'Pressure',
    unit: 'count',
    valueType: 'scale_10',
    aggregation: 'last',
  },
  {
    publicId: seedPublicId('03a'),
    key: 'reaction',
    label: 'Reaction',
    unit: 'count',
    valueType: 'scale_10',
    aggregation: 'last',
  },
  {
    // Canonical `shot` metric — one definition; 10K = SUM(value_num WHERE metric='shot').
    publicId: seedPublicId('03b'),
    key: 'shot',
    label: 'Shot',
    unit: 'count',
    valueType: 'count',
    aggregation: 'sum',
  },
  {
    publicId: seedPublicId('03c'),
    key: 'pullup_max',
    label: 'Pull-up max',
    unit: 'count',
    valueType: 'count',
    aggregation: 'max',
  },
  {
    publicId: seedPublicId('03d'),
    key: 'practice_minutes',
    label: 'Practice minutes',
    unit: 'min',
    valueType: 'duration',
    aggregation: 'sum',
  },
  {
    // Conditioning metrics from the 2026-07-21 real training day (alactic + Zone-2 base).
    publicId: seedPublicId('03e'),
    key: 'sprint_reps',
    label: 'Alactic sprint reps',
    unit: 'count',
    valueType: 'count',
    aggregation: 'sum',
  },
  {
    publicId: seedPublicId('03f'),
    key: 'aerobic_minutes',
    label: 'Aerobic base (Zone 2) minutes',
    unit: 'min',
    valueType: 'duration',
    aggregation: 'sum',
  },
] as const satisfies readonly MetricDefinitionSeedRow[];

/** Every metric_definition key (keyed-by-self) — the typed key set for ACTIVITY_METRIC_MAP. */
export const METRIC_KEYS = Object.fromEntries(
  METRIC_DEFINITION_SEED_ROWS.map((r) => [r.key, r.key]),
) as { readonly [K in MetricKey]: K };

export type MetricKey = (typeof METRIC_DEFINITION_SEED_ROWS)[number]['key'];
