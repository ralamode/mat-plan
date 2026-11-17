import { z } from 'zod';

import { seedPublicId } from './catalog-seed';
import { movementPatternSchema, movementSlug, trackingTypeSchema } from './movements';
import { unitSchema } from './units';

/**
 * Full `movements` catalog (spec.md §4/§4a) — the single source seeded at V1-2 and
 * validated by the coverage test. A youth strength block plus a push / pull / legs split.
 * Between the two, **every one of the 11 MOVEMENT_PATTERNS is covered** (the coverage test
 * asserts ≥1 movement per pattern). Still refinable later — new movements are pure data
 * (spec.md §4b), no deploy. The split's "Squats" and "Pull-ups/Chin-ups" REUSE the strength
 * block's `back_squat` (…052) and `pull-up` (…053) rows — deduped, not re-created.
 *
 * ⚠️ **Being replaced.** `CAT-3` (docs/specs/cat-3-movement-library.md) replaces this const with a
 * reviewed catalog in `packages/shared/src/catalog/`, keyed by slug with no committed public ids.
 * Do not add rows here.
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
  /**
   * How the item is logged (FAM-1 plan D1, §2). ⚠️ **Set once, never by editing this line.** A fresh
   * database takes it from here; production took it from migration 0022's one-time typing, which
   * lists the same slugs (db:verify proves the two agree). The seed's `ON CONFLICT DO NOTHING` never
   * retypes an existing row, so changing a type here later changes nothing in production: a retype
   * needs its own migration (D25).
   */
  trackingType: trackingTypeSchema,
});

export type MovementSeedRow = z.infer<typeof movementSeedRowSchema>;

export const MOVEMENT_SEED_ROWS = [
  // ── Strength block A ────────────────────────────────────────────────────────────
  {
    publicId: seedPublicId('050'),
    slug: 'box_jump',
    name: 'Box Jump',
    pattern: 'jump',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('051'),
    slug: 'front_squat',
    name: 'Front Squat',
    pattern: 'squat',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('052'),
    slug: 'back_squat',
    name: 'Back Squat',
    pattern: 'squat',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('053'),
    slug: 'pull-up',
    name: 'Pull-Up',
    pattern: 'vertical_pull',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('054'),
    slug: 'bb_bench',
    name: 'BB Bench',
    pattern: 'horizontal_push',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('055'),
    slug: 'nordic_ham_curl',
    name: 'Nordic Ham Curl',
    pattern: 'hinge',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('056'),
    slug: 'pallof_press',
    name: 'Pallof Press',
    pattern: 'core',
    unitDefault: null,
    isBodyweight: false,
    trackingType: 'reps',
  },
  // ── A push / pull / legs split ───────────────────────────────────────────────────
  // "Squats" reuses back_squat (…052); "Pull-ups/Chin-ups" reuses pull-up (…053) — not re-listed.
  // Push:
  {
    publicId: seedPublicId('057'),
    slug: 'dumbbell_bench_press',
    name: 'Dumbbell Bench Press',
    pattern: 'horizontal_push',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('058'),
    slug: 'overhead_shoulder_press',
    name: 'Overhead Shoulder Press',
    pattern: 'vertical_push',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('059'),
    slug: 'dips',
    name: 'Dips',
    pattern: 'horizontal_push',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('05a'),
    slug: 'lateral_raises',
    name: 'Lateral Raises',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('05b'),
    slug: 'tricep_extensions',
    name: 'Tricep Extensions',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  // Pull:
  {
    publicId: seedPublicId('05c'),
    slug: 'bent-over_rows',
    name: 'Bent-over Rows',
    pattern: 'horizontal_pull',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('05d'),
    slug: 'rear_delt_raises',
    name: 'Rear Delt Raises',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('05e'),
    slug: 'hammer_curls',
    name: 'Hammer Curls',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('05f'),
    slug: 'barbell_curls',
    name: 'Barbell Curls',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  // Legs:
  {
    publicId: seedPublicId('060'),
    slug: 'romanian_deadlift',
    name: 'Romanian Deadlift',
    pattern: 'hinge',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('061'),
    slug: 'walking_lunge',
    name: 'Walking Lunge',
    pattern: 'lunge',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('062'),
    slug: 'bulgarian_split_squat',
    name: 'Bulgarian Split Squat',
    pattern: 'lunge',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('063'),
    slug: 'calf_raises',
    name: 'Calf Raises',
    pattern: 'isolation',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('064'),
    slug: 'sled_push',
    name: 'Sled Push',
    pattern: 'carry',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  // ── V1-10: movements from a youth strength-and-conditioning block (docs/plans/v1-10-two-week-program-source.md).
  //    Pull-Up / Weighted
  //    Chin reuse `pull-up` (…053), DB OHP reuses `overhead_shoulder_press` (…058), Weighted Dips reuse `dips`
  //    (…059) via the load field — only genuinely-distinct movements are added here.
  {
    publicId: seedPublicId('065'),
    slug: 'med-ball_slam',
    name: 'Med-Ball Slam',
    pattern: 'hinge',
    unitDefault: null,
    isBodyweight: false,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('066'),
    slug: 'trap-bar_deadlift',
    name: 'Trap-Bar Deadlift',
    pattern: 'hinge',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('067'),
    slug: '1-arm_db_row',
    name: '1-Arm DB Row',
    pattern: 'horizontal_pull',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('068'),
    slug: 'ab_rollout',
    name: 'Ab Rollout',
    pattern: 'core',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('069'),
    slug: 'broad_jump',
    name: 'Broad Jump',
    pattern: 'jump',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'distance',
  },
  {
    publicId: seedPublicId('06a'),
    slug: 'barbell_hip_thrust',
    name: 'Barbell Hip Thrust',
    pattern: 'hinge',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('06b'),
    slug: 'farmer_carry',
    name: 'Farmer Carry',
    pattern: 'carry',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    publicId: seedPublicId('06c'),
    slug: 'hollow-body_hold',
    name: 'Hollow-Body Hold',
    pattern: 'core',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'time_sets',
  },

  // ── Youth daily A/B program (2026-09-24) ────────────────────────────────────────
  // A program run every calendar day. Source:
  // docs/samples/youth-daily-program/README.md. All bodyweight with an OPTIONAL worn load, except
  // KB swings where the bell weight is required — which is why `isBodyweight` differs on that one.
  {
    publicId: seedPublicId('070'),
    slug: 'push-ups',
    name: 'Push-Ups',
    pattern: 'horizontal_push',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('071'),
    slug: 'leg_raises',
    name: 'Leg Raises',
    pattern: 'core',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('072'),
    slug: 'v-sit_crunches',
    name: 'V-Sit Crunches',
    pattern: 'core',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    publicId: seedPublicId('073'),
    slug: 'inverted_rows',
    name: 'Inverted Rows',
    pattern: 'horizontal_pull',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
  {
    // The ONE Day-B movement with a required load — the spec marks bell weight required, not optional.
    publicId: seedPublicId('074'),
    slug: 'kb_swings',
    name: 'KB Swings',
    pattern: 'hinge',
    unitDefault: 'lb',
    isBodyweight: false,
    trackingType: 'weight_reps',
  },
  {
    // The maintainer (2026-09-24): hip thrusts are a REP MOVEMENT. The paper sheet's three completion
    // checkboxes are a paper affordance, not a data shape.
    publicId: seedPublicId('075'),
    slug: 'single-leg_hip_thrusts',
    name: 'Single-Leg Hip Thrusts',
    pattern: 'hinge',
    unitDefault: null,
    isBodyweight: true,
    trackingType: 'reps',
  },
] as const satisfies readonly MovementSeedRow[];

/** Runtime guard the coverage test also pins: seed slug must equal `movementSlug(name)`. */
export function movementSlugMatchesName(row: MovementSeedRow): boolean {
  return row.slug === movementSlug(row.name);
}

/**
 * TEN-2a — **the authorship discriminator, in one place.** A `movements` row is **app-authored**
 * (someone typed it into the strength form) **iff its `public_id` is NOT in this set** — exact set
 * membership against the rows above.
 *
 * ⚠️ **NOT a `SEED_PUBLIC_ID_PREFIX` prefix test**, which is the mistake this const exists to
 * prevent. `SEED_PUBLIC_ID_PREFIX` is the **global** seed namespace shared by every seeded table
 * (`001` profile, `010` household, `020`/`021` activity types, `030` metrics, `050`+ movements), so
 * "inside the prefix" means "in the seed namespace of _any_ table" — a `movements` row carrying
 * `seedPublicId('010')` would pass a prefix test and be called reference data. TEN-2b's backfill and
 * its correction **delete** rows on this test, so getting it wrong is destructive.
 *
 * Sound by construction, in both directions: `movementSeedRowSchema` requires a non-nullable
 * `pattern` and `db:verify` parses every row above through it, so every seeded row has a `pattern`;
 * `findOrCreateMovement` writes neither `pattern` nor `unitDefault`, so every app-authored row has
 * `pattern IS NULL`. That is the cross-check, not the test. Nor is it forgeable: `newId()` (UUIDv7)
 * is the only other source of a `movements.public_id`.
 *
 * Single home on purpose — `db:verify`, TEN-2b's backfill, TEN-2b's correction and TEN-2c's split all
 * need this rule, and a re-derived predicate is how four copies drift.
 */
export const MOVEMENT_SEED_PUBLIC_IDS: ReadonlySet<string> = new Set(
  MOVEMENT_SEED_ROWS.map((row) => row.publicId),
);
