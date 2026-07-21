import { z } from 'zod';

import { seedPublicId } from './catalog-seed';
import { movementPatternSchema, movementSlug } from './movements';
import { unitSchema } from './units';

/**
 * Full `movements` catalog (spec.md §4/§4a) — the single source seeded at V1-2 and
 * validated by the coverage test. The kids' Strength-A block plus Ray's REAL Push/Pull/Legs
 * program (source: job-search-context `docs/movement-templates.md` — his actual PPL split,
 * not a placeholder). Between the two, **every one of the 11 MOVEMENT_PATTERNS is covered**
 * (the coverage test asserts ≥1 movement per pattern). Still refinable later — new movements
 * are pure data (spec.md §4b), no deploy. Ray's "Squats" and "Pull-ups/Chin-ups" REUSE the
 * kids' `back_squat` (…052) and `pull-up` (…053) rows — deduped, not re-created.
 *
 * INVARIANT: `slug === movementSlug(name)` for every row (the coverage test pins it), so
 * the seed's natural key (`slug`) matches what the DAL's find-or-create + V1-1b's backfill
 * derive from a free-text name. `back_squat` is exactly the slug V1-1b's backfill produces
 * from "Back Squat" → the seed's `ON CONFLICT (slug) DO NOTHING` reuses that row.
 * `pattern`, `unitDefault` are `as const satisfies` the shared enums → bad value = typecheck fail.
 */

export const movementSeedRowSchema = z.object({
  publicId: z.string(),
  slug: z.string(),
  name: z.string(),
  pattern: movementPatternSchema,
  unitDefault: unitSchema.nullable(),
  isBodyweight: z.boolean(),
});

export type MovementSeedRow = z.infer<typeof movementSeedRowSchema>;

export const MOVEMENT_SEED_ROWS = [
  // ── Kids' Strength-A block ──────────────────────────────────────────────────────
  {
    publicId: seedPublicId('050'),
    slug: 'box_jump',
    name: 'Box Jump',
    pattern: 'jump',
    unitDefault: null,
    isBodyweight: true,
  },
  {
    publicId: seedPublicId('051'),
    slug: 'front_squat',
    name: 'Front Squat',
    pattern: 'squat',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('052'),
    slug: 'back_squat',
    name: 'Back Squat',
    pattern: 'squat',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('053'),
    slug: 'pull-up',
    name: 'Pull-Up',
    pattern: 'vertical_pull',
    unitDefault: null,
    isBodyweight: true,
  },
  {
    publicId: seedPublicId('054'),
    slug: 'bb_bench',
    name: 'BB Bench',
    pattern: 'horizontal_push',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('055'),
    slug: 'nordic_ham_curl',
    name: 'Nordic Ham Curl',
    pattern: 'hinge',
    unitDefault: null,
    isBodyweight: true,
  },
  {
    publicId: seedPublicId('056'),
    slug: 'pallof_press',
    name: 'Pallof Press',
    pattern: 'core',
    unitDefault: null,
    isBodyweight: false,
  },
  // ── Ray's real Push/Pull/Legs program (docs/movement-templates.md) ───────────────
  // "Squats" reuses back_squat (…052); "Pull-ups/Chin-ups" reuses pull-up (…053) — not re-listed.
  // Push:
  {
    publicId: seedPublicId('057'),
    slug: 'dumbbell_bench_press',
    name: 'Dumbbell Bench Press',
    pattern: 'horizontal_push',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('058'),
    slug: 'overhead_shoulder_press',
    name: 'Overhead Shoulder Press',
    pattern: 'vertical_push',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('059'),
    slug: 'dips',
    name: 'Dips',
    pattern: 'horizontal_push',
    unitDefault: null,
    isBodyweight: true,
  },
  {
    publicId: seedPublicId('05a'),
    slug: 'lateral_raises',
    name: 'Lateral Raises',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('05b'),
    slug: 'tricep_extensions',
    name: 'Tricep Extensions',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  // Pull:
  {
    publicId: seedPublicId('05c'),
    slug: 'bent-over_rows',
    name: 'Bent-over Rows',
    pattern: 'horizontal_pull',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('05d'),
    slug: 'rear_delt_raises',
    name: 'Rear Delt Raises',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('05e'),
    slug: 'hammer_curls',
    name: 'Hammer Curls',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('05f'),
    slug: 'barbell_curls',
    name: 'Barbell Curls',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  // Legs:
  {
    publicId: seedPublicId('060'),
    slug: 'romanian_deadlift',
    name: 'Romanian Deadlift',
    pattern: 'hinge',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('061'),
    slug: 'walking_lunge',
    name: 'Walking Lunge',
    pattern: 'lunge',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('062'),
    slug: 'bulgarian_split_squat',
    name: 'Bulgarian Split Squat',
    pattern: 'lunge',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('063'),
    slug: 'calf_raises',
    name: 'Calf Raises',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
  },
  {
    publicId: seedPublicId('064'),
    slug: 'sled_push',
    name: 'Sled Push',
    pattern: 'carry',
    unitDefault: 'lb',
    isBodyweight: false,
  },
] as const satisfies readonly MovementSeedRow[];

/** Runtime guard the coverage test also pins: seed slug must equal `movementSlug(name)`. */
export function movementSlugMatchesName(row: MovementSeedRow): boolean {
  return row.slug === movementSlug(row.name);
}
