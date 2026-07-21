import { z } from 'zod';

import { activityCategorySchema } from './activity-categories';
import { activityInputShapeSchema } from './activity-shapes';
import { CATALOG_ACTIVITY_TYPE_SEED_ROWS, seedPublicId } from './catalog-seed';
import { unitSchema } from './units';

/**
 * Full `activity_types` catalog (spec.md §4/§4a) — the single source seeded at V1-2 and
 * validated by the coverage test. What makes the logger portable: every activity (wake,
 * weigh_in, wrestling_practice, calisthenics, sc_lift, …) is a ROW, not code.
 *
 * The first two rows are SPREAD from `catalog-seed.ts` (V1-1b's `weigh_in` / `sc_lift`),
 * so they keep ONE definition + their fixed public_ids (`…020` / `…021`); the seed's
 * `ON CONFLICT (key) DO NOTHING` makes re-declaring them a safe no-op. `category`,
 * `inputShape`, and `defaultUnit` are `as const satisfies` the shared enums, so a bad
 * value fails typecheck (not just at runtime). public_ids follow the shared seed
 * namespace (`seedPublicId('02x')`).
 */

export const activityTypeSeedRowSchema = z.object({
  publicId: z.string(),
  key: z.string(),
  label: z.string(),
  category: activityCategorySchema,
  inputShape: activityInputShapeSchema,
  defaultUnit: unitSchema.nullable(),
});

export type ActivityTypeSeedRow = z.infer<typeof activityTypeSeedRowSchema>;

export const ACTIVITY_TYPE_SEED_ROWS = [
  // Reused from V1-1b (fixed public_ids …020 / …021) — single source, spread not redefined.
  ...CATALOG_ACTIVITY_TYPE_SEED_ROWS,
  {
    publicId: seedPublicId('022'),
    key: 'wake',
    label: 'Wake',
    category: 'routine',
    inputShape: 'timing',
    defaultUnit: 'timing',
  },
  {
    publicId: seedPublicId('023'),
    key: 'rice_bucket',
    label: 'Rice bucket',
    category: 'habit',
    inputShape: 'boolean',
    defaultUnit: 'bool',
  },
  {
    publicId: seedPublicId('024'),
    key: 'wrestling_practice',
    label: 'Wrestling practice',
    category: 'skill',
    inputShape: 'single_metric',
    defaultUnit: 'min',
  },
  {
    publicId: seedPublicId('025'),
    key: 'calisthenics',
    label: 'Calisthenics',
    category: 'conditioning',
    inputShape: 'single_metric',
    defaultUnit: 'count',
  },
  {
    publicId: seedPublicId('026'),
    key: 'brush_teeth',
    label: 'Brush teeth',
    category: 'skill',
    inputShape: 'single_metric',
    defaultUnit: null,
  },
  {
    publicId: seedPublicId('027'),
    key: 'brain_rep',
    label: 'Brain rep',
    category: 'habit',
    inputShape: 'boolean',
    defaultUnit: 'bool',
  },
  {
    publicId: seedPublicId('028'),
    key: 'splits',
    label: 'Splits',
    category: 'habit',
    inputShape: 'boolean',
    defaultUnit: 'bool',
  },
  {
    publicId: seedPublicId('029'),
    key: 'shots',
    label: 'Shots',
    category: 'skill',
    inputShape: 'single_metric',
    defaultUnit: 'count',
  },
  {
    // Added from a 2nd real training day (Tue 2026-07-21 = a Conditioning session).
    publicId: seedPublicId('02a'),
    key: 'conditioning',
    label: 'Conditioning',
    category: 'conditioning',
    inputShape: 'single_metric',
    defaultUnit: 'min',
  },
] as const satisfies readonly ActivityTypeSeedRow[];

/** Every activity_type key (keyed-by-self) — the typed key set for ACTIVITY_METRIC_MAP. */
export const ACTIVITY_TYPE_KEYS = Object.fromEntries(
  ACTIVITY_TYPE_SEED_ROWS.map((r) => [r.key, r.key]),
) as { readonly [K in ActivityTypeKey]: K };

export type ActivityTypeKey = (typeof ACTIVITY_TYPE_SEED_ROWS)[number]['key'];
