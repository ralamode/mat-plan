import { z } from 'zod';

import {
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
} from './seed-ids';
import { SESSION_TYPE_LABELS, SESSION_TYPES, type SessionType } from './sessions';

/**
 * Programming contract (V1-10) — the shared grammar for `program_block` → `prescription` →
 * `prescription_target` (spec.md §4). A block is a household's authored training plan: each prescription is
 * a movement on a `day_role` (ordered by `idx`, with prescribed `sets`/`target_reps`), and each
 * `prescription_target` is a per-kid **suggested load** — HUMAN-AUTHORED, never the LLM (AGENTS.md: the LLM
 * never authors loads/weights). Slice 1 (this PR) ships the grammar + an EMPTY seed; the strength-form
 * prefill (slice 2) and Ray's real block/loads (a data-only PR) come later.
 */

/**
 * The day roles a prescription can be filed under. A SUPERSET of `SESSION_TYPES` (spread, not re-listed) plus
 * the split strength days (`strength_a`/`strength_b`) that `SESSION_TYPES` can't express — spec.md §4's
 * `sc_lift → session(strength_a)` needs them, and the prescriptions natural key `(block, day_role, idx)`
 * REQUIRES them (two strength days must be distinguishable or their `idx=0` rows collide). Deliberately its
 * OWN concept, not `session_type` reused: `session_type` is what a logged session IS; `day_role` is what a
 * program day PRESCRIBES, and growing one must not perturb the other. The DB CHECK inlines these literals
 * (a migration can't import a const), so `db:verify` pins the CHECK's accepted set to this array.
 */
export const DAY_ROLES = [...SESSION_TYPES, 'strength_a', 'strength_b', 'strength_c'] as const;
export type DayRole = (typeof DAY_ROLES)[number];
export const dayRoleSchema = z.enum(DAY_ROLES);

/**
 * Which `session_type` a `day_role` prefills (slice 2): the split strength days fold to `strength`; every
 * other day_role maps 1:1 to the same-named session_type. Explicit map (TS-exhaustive over `DayRole`) so the
 * day↔session alignment is stated once here, not implied by a shared enum.
 */
export const DAY_ROLE_TO_SESSION_TYPE: Record<DayRole, SessionType> = {
  strength: 'strength',
  conditioning: 'conditioning',
  skill: 'skill',
  push: 'push',
  pull: 'pull',
  legs: 'legs',
  core: 'core',
  strength_a: 'strength',
  strength_b: 'strength',
  strength_c: 'strength',
};

/**
 * Display labels for the day roles (V1-10 slice 2) — the single source for the "Today's program" card
 * header. DERIVED from `SESSION_TYPE_LABELS` (never re-typed): `SESSION_TYPE_LABELS` alone collapses
 * strength_a/b/c → "Strength", so the split days append their letter suffix. Built as a map (not a
 * function) so it is exhaustive over `DayRole` at compile time, like `DAY_ROLE_TO_SESSION_TYPE`.
 */
export const DAY_ROLE_LABELS: Record<DayRole, string> = Object.fromEntries(
  DAY_ROLES.map((role) => {
    const base = SESSION_TYPE_LABELS[DAY_ROLE_TO_SESSION_TYPE[role]];
    // 'strength_a' → ' A'; a 1:1 role (its own name) gets no suffix.
    const split = role.startsWith('strength_')
      ? ` ${role.slice('strength_'.length).toUpperCase()}`
      : '';
    return [role, `${base}${split}`];
  }),
) as Record<DayRole, string>;

/**
 * A per-profile suggested load on a prescription — HUMAN-AUTHORED (never the LLM). `load` is verbatim and
 * lossless (`"65"`, `"BW"`, `"50ft"`), mirroring `entries.raw_load`; the profile is referenced by its
 * `public_id`. Per-kid REPS are deliberately NOT here in slice 1 — `prescription.target_reps` is the greyed
 * rep suggestion for both kids; a per-kid reps override is added only when a real case needs it.
 */
export const prescriptionTargetSeedRowSchema = z.object({
  profilePublicId: z.string(),
  load: z.string().nullable(),
  // Per-kid REPS override (mirrors `load`'s nullability): null → use the prescription's shared `target_reps`;
  // non-null → this kid deviates (e.g. Liam "4" vs Scarlett "5, last AMRAP" on the same Pull-Up). Verbatim text.
  reps: z.string().nullable(),
});
export type PrescriptionTargetSeedRow = z.infer<typeof prescriptionTargetSeedRowSchema>;

/**
 * One movement in a block's day. The movement is referenced by its `slug` (the `movements` natural key the
 * seed resolves against), `idx` orders it within the `day_role`, and `sets`/`target_reps` are the prescription
 * shared across kids; per-kid loads live in `targets`.
 */
export const prescriptionSeedRowSchema = z.object({
  dayRole: dayRoleSchema,
  movementSlug: z.string(),
  idx: z.number().int().nonnegative(),
  sets: z.number().int().positive().nullable(),
  targetReps: z.string().nullable(),
  targets: z.array(prescriptionTargetSeedRowSchema),
});
export type PrescriptionSeedRow = z.infer<typeof prescriptionSeedRowSchema>;

/**
 * A named, household-scoped program block. `slug` is the idempotency key (paired with the household) and MUST
 * equal `movementSlug(name)` so a re-seed can't create a duplicate block on whitespace/casing drift (the
 * `movements.slug` idiom, not a raw free-text name).
 */
export const programBlockSeedRowSchema = z.object({
  householdPublicId: z.string(),
  slug: z.string(),
  name: z.string(),
  notes: z.string().nullable(),
  prescriptions: z.array(prescriptionSeedRowSchema),
});
export type ProgramBlockSeedRow = z.infer<typeof programBlockSeedRowSchema>;

// Seed builders (module-private) — keep PROGRAM_SEED readable. `both` = the same load for both kids with the
// prescription's shared reps; `perKid` = explicit per-kid load, plus a per-kid `reps` override only where a
// kid deviates from `target_reps`. Every value below is transcribed VERBATIM from Ray's program doc — the
// human authored every load (the LLM never authors loads).
const LIAM = SEED_PROFILE_PUBLIC_ID;
const SCARLETT = SEED_PROFILE_2_PUBLIC_ID;
function both(load: string | null): PrescriptionTargetSeedRow[] {
  // Both kids, same load, shared reps — just `perKid` with the same load and no override (one row shape).
  return perKid({ load }, { load });
}
function perKid(
  liam: { load: string | null; reps?: string },
  scarlett: { load: string | null; reps?: string },
): PrescriptionTargetSeedRow[] {
  return [
    { profilePublicId: LIAM, load: liam.load, reps: liam.reps ?? null },
    { profilePublicId: SCARLETT, load: scarlett.load, reps: scarlett.reps ?? null },
  ];
}

/**
 * The program seed — Ray's **Kids S&C Foundation** block, WEEK 1 strength days (source:
 * docs/plans/v1-10-two-week-program-source.md). One block, three strength day-roles; loads/reps transcribed verbatim as the greyed
 * *starting suggestion* (Week 2 is a coach bump, not a second prescription — "confirm against the last logged
 * working set"). Conditioning days + the daily brush-the-teeth routine are out of scope (routine/check-ins +
 * a future conditioning model). `target_reps` is the base prescribed reps; a per-kid `reps` overrides it where
 * a kid deviates. Lossless `target_reps` text carries `/side`, `/leg`, distances, times, and the trap-bar
 * back-off note (no separate scheme/notes column — slice 1 cut them; a cue field is backlogged for slice 2).
 */
export const PROGRAM_SEED: readonly ProgramBlockSeedRow[] = [
  {
    householdPublicId: SEED_HOUSEHOLD_PUBLIC_ID,
    slug: 'kids_s&c_foundation', // === movementSlug('Kids S&C Foundation')
    name: 'Kids S&C Foundation',
    notes:
      'Green / no-practice baseline. Loads are a Week-1 starting point — confirm against each kid’s last logged working set (a load that runs clean for all sets is too light).',
    prescriptions: [
      // ── Strength A (Mon) — Squat + Vertical Power ──
      {
        dayRole: 'strength_a',
        movementSlug: 'box_jump',
        idx: 0,
        sets: 4,
        targetReps: '3',
        targets: perKid({ load: 'BW ~30"' }, { load: 'BW ~36"' }),
      },
      {
        dayRole: 'strength_a',
        movementSlug: 'front_squat',
        idx: 1,
        sets: 5,
        targetReps: '5',
        targets: perKid({ load: '60' }, { load: '65' }),
      },
      {
        dayRole: 'strength_a',
        movementSlug: 'back_squat',
        idx: 2,
        sets: 3,
        targetReps: '5',
        targets: both('~75-85'),
      },
      {
        dayRole: 'strength_a',
        movementSlug: 'pull-up',
        idx: 3,
        sets: 4,
        targetReps: '4-5',
        targets: perKid({ load: 'BW', reps: '4' }, { load: 'BW +5', reps: '5, last AMRAP' }),
      },
      {
        dayRole: 'strength_a',
        movementSlug: 'bb_bench',
        idx: 4,
        sets: 4,
        targetReps: '6',
        targets: both('~60'),
      },
      {
        dayRole: 'strength_a',
        movementSlug: 'nordic_ham_curl',
        idx: 5,
        sets: 4,
        targetReps: '5, last set to failure',
        targets: both('BW'),
      },
      {
        dayRole: 'strength_a',
        movementSlug: 'pallof_press',
        idx: 6,
        sets: 3,
        targetReps: '12/side',
        targets: both('band'),
      },

      // ── Strength B (Wed) — Hinge + Explosive ──
      {
        dayRole: 'strength_b',
        movementSlug: 'med-ball_slam',
        idx: 0,
        sets: 4,
        targetReps: '5',
        targets: both('15-20 lb ball'),
      },
      {
        dayRole: 'strength_b',
        movementSlug: 'trap-bar_deadlift',
        idx: 1,
        sets: 4,
        targetReps: '3 (top triple, then 2 back-offs)',
        targets: both('~145-150'),
      },
      {
        dayRole: 'strength_b',
        movementSlug: 'overhead_shoulder_press',
        idx: 2,
        sets: 4,
        targetReps: '6',
        targets: perKid({ load: '15/DB' }, { load: '20/DB' }),
      },
      {
        dayRole: 'strength_b',
        movementSlug: '1-arm_db_row',
        idx: 3,
        sets: 4,
        targetReps: '8/side',
        targets: perKid({ load: '25' }, { load: '30' }),
      },
      {
        dayRole: 'strength_b',
        movementSlug: 'pull-up',
        idx: 4,
        sets: 3,
        targetReps: '5',
        targets: perKid({ load: 'BW', reps: '5, last AMRAP' }, { load: 'BW +5-10' }),
      },
      {
        dayRole: 'strength_b',
        movementSlug: 'bulgarian_split_squat',
        idx: 5,
        sets: 3,
        targetReps: '8/leg',
        targets: both('15-20'),
      },
      {
        dayRole: 'strength_b',
        movementSlug: 'ab_rollout',
        idx: 6,
        sets: 3,
        targetReps: '8-10, last set to failure',
        targets: both('BW'),
      },

      // ── Strength C (Fri) — Posterior Chain + Carries ──
      {
        dayRole: 'strength_c',
        movementSlug: 'broad_jump',
        idx: 0,
        sets: 4,
        targetReps: '3',
        targets: both('BW'),
      },
      {
        dayRole: 'strength_c',
        movementSlug: 'barbell_hip_thrust',
        idx: 1,
        sets: 4,
        targetReps: '6',
        targets: both('~135'),
      },
      {
        dayRole: 'strength_c',
        movementSlug: 'romanian_deadlift',
        idx: 2,
        sets: 4,
        targetReps: '8',
        targets: both('~95 BB / ~45 DB'),
      },
      {
        dayRole: 'strength_c',
        movementSlug: 'dips',
        idx: 3,
        sets: 3,
        targetReps: '6-8, last set to failure',
        targets: both('BW → +vest/belt'),
      },
      {
        dayRole: 'strength_c',
        movementSlug: 'pull-up',
        idx: 4,
        sets: 4,
        targetReps: '4-5',
        targets: perKid({ load: 'BW', reps: '4, last AMRAP' }, { load: 'BW +5-10', reps: '5' }),
      },
      {
        dayRole: 'strength_c',
        movementSlug: 'farmer_carry',
        idx: 5,
        sets: 4,
        targetReps: '40 yd, to grip failure',
        targets: both('35-45/hand'),
      },
      {
        dayRole: 'strength_c',
        movementSlug: 'hollow-body_hold',
        idx: 6,
        sets: 3,
        targetReps: '30-40 s',
        targets: both('BW'),
      },
    ],
  },
];
