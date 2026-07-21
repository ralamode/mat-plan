import { z } from 'zod';

/**
 * Canonical `activity_type.category` codes — the single source of truth for the
 * generalized activity model (spec.md §4). Like `units`, this enum is a DB
 * **reference table** (FK from `activity_types.category`), so it ships an `as const`
 * array + zod enum + `z.infer` type AND a `{code,label}` row set for the seed —
 * one definition, three consumers (zod validator, TS type, `activity_type_categories`
 * seed), zero drift. No native pgEnum. Consumed by the catalogs at V1-1b / V1-2.
 */
export const ACTIVITY_CATEGORIES = [
  'strength',
  'conditioning',
  'skill',
  'habit',
  'measurement',
  'routine',
  'life',
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const activityCategorySchema = z.enum(ACTIVITY_CATEGORIES);

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  strength: 'Strength',
  conditioning: 'Conditioning',
  skill: 'Skill',
  habit: 'Habit',
  measurement: 'Measurement',
  routine: 'Routine',
  life: 'Life',
};

/** Rows for the `activity_type_categories` reference-table seed (idempotent). */
export const ACTIVITY_CATEGORY_ROWS = ACTIVITY_CATEGORIES.map((code) => ({
  code,
  label: ACTIVITY_CATEGORY_LABELS[code],
}));
