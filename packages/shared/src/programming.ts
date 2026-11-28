import { z } from 'zod';

import {
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
} from './seed-ids';
import { keyBySelf, PROFILE_KIND } from './enums';
import {
  LEGACY_SESSION_TYPE_LABELS,
  LEGACY_SESSION_TYPES,
  SESSION_TYPE_LABELS,
  type SessionType,
} from './sessions';

/**
 * Programming contract (V1-10) — the shared grammar for `program_block` → `prescription` →
 * `prescription_target` (spec.md §4). A block is a household's authored training plan: each prescription is
 * a movement on a `day_role` (ordered by `idx`, with prescribed `sets`/`target_reps`), and each
 * `prescription_target` is a per-kid **suggested load** — HUMAN-AUTHORED, never the LLM (AGENTS.md: the LLM
 * never authors loads/weights). Slice 1 (this PR) ships the grammar + an EMPTY seed; the strength-form
 * prefill (slice 2) and Ray's real block/loads (a data-only PR) come later.
 */

/**
 * The day roles a prescription can be filed under. A SUPERSET of `LEGACY_SESSION_TYPES` (spread, not re-listed) plus
 * the split strength days (`strength_a`/`strength_b`) that `SESSION_TYPES` can't express — spec.md §4's
 * `sc_lift → session(strength_a)` needs them, and the prescriptions natural key `(block, day_role, idx)`
 * REQUIRES them (two strength days must be distinguishable or their `idx=0` rows collide). Deliberately its
 * OWN concept, not `session_type` reused: `session_type` is what a logged session IS; `day_role` is what a
 * program day PRESCRIBES, and growing one must not perturb the other. The DB CHECK inlines these literals
 * (a migration can't import a const), so `db:verify` pins the CHECK's accepted set to this array.
 */
/**
 * 🔴 **The kid-only program read, defined ONCE** — `PROF-1` a-g, Q15 stopgap
 * _(maintainer, 2026-10-22)_.
 *
 * Until `ASSIGN-READ` gives every athlete their own assignments, an athlete reads the household's
 * newest program block **only if they are a child**. The adult in the household logs freely and gets their own
 * program later; today they would otherwise inherit the kids' PPL block, which is not his training.
 *
 * ⚠️ **This constant is DELETED by `ASSIGN-READ` (D4)**, along with its one runtime reader,
 * `packages/db/src/queries/program-day.ts`'s block subquery, and its `db:verify` proof in
 * `scripts/verify/schema.ts`. There is no predicate function: the
 * query compares `profiles.kind` to it inline (the `readsHouseholdProgram` wrapper had no caller and
 * went with LEGACY-1 PR A).
 * It is a stopgap with a named end, not a rule of the domain, which is why it lives beside the day
 * roles rather than in `enums.ts` with the durable ones.
 *
 * 🔴 **Kind is read at QUERY time, so flipping a kid to adult empties `prescribed` in every PAST
 * month of their export, and flipping back restores it.** That is deliberate — the program a
 * non-child should not have been reading is not retroactively theirs — and it is asserted by a
 * `db:verify` flip case and stated on the edit form. `docs/features/programming.md` carries it as an
 * invariant.
 */
export const PROGRAM_READ_KIND = PROFILE_KIND.kid;

export const DAY_ROLES = [
  ...LEGACY_SESSION_TYPES,
  'strength_a',
  'strength_b',
  'strength_c',
] as const;
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
 * header. The 1:1 roles SPREAD `LEGACY_SESSION_TYPE_LABELS` (never re-typed; not the full map, which
 * has `workout` since FAM-1 step 3); only the split strength days,
 * which `SESSION_TYPE_LABELS` collapses to a single "Strength", add their letter — and they take the
 * "Strength" noun from that same map. An annotated object literal, NOT a computed `Object.fromEntries`
 * + cast: this way TypeScript actually enforces exhaustiveness over `DayRole` (a cast would assert the
 * checking away), exactly like `DAY_ROLE_TO_SESSION_TYPE` above. It also avoids deriving the label by
 * string-surgery on the role name, which would silently collide the day a `conditioning_a` appears.
 */
export const DAY_ROLE_LABELS: Record<DayRole, string> = {
  ...LEGACY_SESSION_TYPE_LABELS,
  strength_a: `${SESSION_TYPE_LABELS.strength} A`,
  strength_b: `${SESSION_TYPE_LABELS.strength} B`,
  strength_c: `${SESSION_TYPE_LABELS.strength} C`,
};

/**
 * The limits of a program a household builds itself (FAM-1 plan D5; the accepted prototype's
 * counters). App-input limits: step 0a names them so the builder, the writers and the contract shapes
 * in `./program/` read one number each. The columns they bound carry a length CHECK pinned to the same
 * number by `db:verify` (workouts and week slots since step 4a-i; prescriptions from 4b).
 *
 * `SLOT_LABEL_MAX` also bounds the two other short texts an author types beside a workout: a
 * superset's group name and its "rest after" (FAM-1 plan §4). Sets per item reuse
 * `MAX_SETS_PER_MOVEMENT` (`strength-session.ts`, where it is the only export left), and
 * instructions reuse `FREE_TEXT_NOTE_MAX`.
 */
export const PROGRAM_NAME_MAX = 60;
export const WORKOUT_NAME_MAX = 30;
export const SLOT_LABEL_MAX = 30;
export const MAX_WORKOUT_ITEMS = 30;
/**
 * A prescription's reps, which are text (`prescriptions.target_reps`): `8`, `10 per side`. Its own
 * limit, not the label's, so the two can move apart.
 */
export const TARGET_REPS_MAX = 20;

/**
 * The two kinds of program block (ADR 0007 Amendment 2 §1; FAM-1 step 4a-i). `program_blocks.kind`'s
 * CHECK is pinned to this list by `db:verify`.
 *
 * - `legacy`: today's `day_role` block, written only by the seed. It keeps the newest-block read
 *   (`programDayRows`) and is never migrated. The column's default, so the seed's insert omits it.
 * - `template`: a program a household builds in the app, reached only through an assignment. The
 *   program writer sets it **explicitly** (`insertProgramBlockOwnedBy`), never by default.
 *
 * (Named `PROGRAM_BLOCK_KINDS`, not the ADR's `BLOCK_KINDS`: that name is taken, Amendment 3.)
 */
export const PROGRAM_BLOCK_KINDS = ['legacy', 'template'] as const;
export type ProgramBlockKind = (typeof PROGRAM_BLOCK_KINDS)[number];
export const programBlockKindSchema = z.enum(PROGRAM_BLOCK_KINDS);
/** Branch on a NAMED member (`PROGRAM_BLOCK_KIND.template`), never a bare string. */
export const PROGRAM_BLOCK_KIND = keyBySelf(PROGRAM_BLOCK_KINDS);

/**
 * What the week editor offers for a slot's label (FAM-1 plan D8). Suggestions only: a label is
 * optional free text, shown as the slot's heading and **never sorted on**. A day's order is the
 * author's (the athlete's program order, then the week's own order).
 */
export const SLOT_LABEL_SUGGESTIONS = [
  'Morning',
  'After school',
  'After lunch',
  'Evening',
] as const;

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
  // non-null → this kid deviates (one sibling pulls strict reps where the other goes to failure on the same
  // movement). Verbatim text, human-authored.
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
  // The database bounds every block's name (`program_blocks_name_length_check`); a seed name past it
  // would fail the fixture seed with 23514 instead of here.
  // Mirrors the CHECK on the RAW value the seed inserts: at most PROGRAM_NAME_MAX, and not blank.
  name: z
    .string()
    .max(PROGRAM_NAME_MAX)
    .refine((s) => s.trim() !== ''),
  notes: z.string().nullable(),
  prescriptions: z.array(prescriptionSeedRowSchema),
});
export type ProgramBlockSeedRow = z.infer<typeof programBlockSeedRowSchema>;

// Seed builders (module-private) — keep LEGACY_PROGRAM_FIXTURE readable. `both` = the same load for both
// athletes with the prescription's shared reps; `perKid` = explicit per-athlete load, plus a per-athlete
// `reps` override. A fixture: no value here is a real prescription (the LLM never authors loads).
const ATHLETE_ONE = SEED_PROFILE_PUBLIC_ID;
const ATHLETE_TWO = SEED_PROFILE_2_PUBLIC_ID;
function both(load: string | null): PrescriptionTargetSeedRow[] {
  // Both kids, same load, shared reps — just `perKid` with the same load and no override (one row shape).
  return perKid({ load }, { load });
}
function perKid(
  athleteOne: { load: string | null; reps?: string },
  athleteTwo: { load: string | null; reps?: string },
): PrescriptionTargetSeedRow[] {
  return [
    { profilePublicId: ATHLETE_ONE, load: athleteOne.load, reps: athleteOne.reps ?? null },
    { profilePublicId: ATHLETE_TWO, load: athleteTwo.load, reps: athleteTwo.reps ?? null },
  ];
}

/** No prescribed sets, reps or load — the sheet shows only what was done (spec §7). */
function open(): Pick<PrescriptionSeedRow, 'sets' | 'targetReps' | 'targets'> {
  return { sets: null, targetReps: null, targets: both(null) };
}

/** The one fixed prescription in the program: 3 x 10 per side. */
function fixed(): Pick<PrescriptionSeedRow, 'sets' | 'targetReps' | 'targets'> {
  return { sets: 3, targetReps: '10 per side', targets: both(null) };
}

/**
 * **The legacy program fixture** (CAT-3 F1-i): one block in the legacy block tables, for test
 * databases only. It keeps the shape of the youth daily A/B block it replaced (Day A: seven
 * prescriptions, Day B: six, one fixed "3 x 10 per side"), so the proofs that read the legacy tables
 * read the same counts. Since F1-i its movements are test-library slugs (`CATALOG_FIXTURE`): a test
 * database holds no old built-in, so the old slugs would make `seedProgram` throw.
 *
 * It stays a fixture of the legacy block tables, which the export (`programDayRows`) still reads;
 * retiring those is `LEGACY-1`. `strength_a` / `strength_b` are reused as Day A / Day B, and no
 * prescription has reps or a load except the fixed one. The athlete ids are the seed's fixtures.
 *
 * 🔴 **Test databases only** (FAM-1 plan D10). `seed(db, { fixtures: true })` writes this (CI's
 * smoke, the preview database, the local harnesses); production's seed never does.
 */
export const LEGACY_PROGRAM_FIXTURE: readonly ProgramBlockSeedRow[] = [
  {
    householdPublicId: SEED_HOUSEHOLD_PUBLIC_ID,
    slug: 'youth_daily_program', // === movementSlug('Youth Daily Program')
    name: 'Youth Daily Program',
    notes: 'Runs every day, alternating A and B. No prescribed reps or loads: log what you did.',
    prescriptions: [
      // ── Day A ── four every-day movements, the A-only pair, then the fixed one ──
      { dayRole: 'strength_a', movementSlug: 'incline_push-up', idx: 0, ...open() },
      { dayRole: 'strength_a', movementSlug: 'chin-up', idx: 1, ...open() },
      { dayRole: 'strength_a', movementSlug: 'reverse_lunge', idx: 2, ...open() },
      { dayRole: 'strength_a', movementSlug: 'dead_hang', idx: 3, ...open() },
      { dayRole: 'strength_a', movementSlug: 'squat_jump', idx: 4, ...open() },
      { dayRole: 'strength_a', movementSlug: 'dumbbell_row', idx: 5, ...open() },
      { dayRole: 'strength_a', movementSlug: 'single-leg_romanian_deadlift', idx: 6, ...fixed() },

      // ── Day B ── the same four, one B-only movement, then the fixed one ──
      { dayRole: 'strength_b', movementSlug: 'incline_push-up', idx: 0, ...open() },
      { dayRole: 'strength_b', movementSlug: 'chin-up', idx: 1, ...open() },
      { dayRole: 'strength_b', movementSlug: 'reverse_lunge', idx: 2, ...open() },
      { dayRole: 'strength_b', movementSlug: 'dead_hang', idx: 3, ...open() },
      { dayRole: 'strength_b', movementSlug: 'medicine_ball_chest_pass', idx: 4, ...open() },
      { dayRole: 'strength_b', movementSlug: 'single-leg_romanian_deadlift', idx: 5, ...fixed() },
    ],
  },
];
