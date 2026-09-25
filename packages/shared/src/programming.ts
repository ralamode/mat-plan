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
 * A day role that may legitimately be ABSENT (GAP-1 P0-1) — for a session on a non-programmed day.
 *
 * The blank→undefined transform is load-bearing, and is the exact trap `logStrengthSessionSchema`
 * already documents for `sessionType`: `FormData.get()` returns `null` when a field is absent and `''`
 * when the form's "Not a programmed day" option is selected, and a bare `z.enum().optional()` REJECTS
 * BOTH — making the happy path unreachable. Mirrors `freeTextNoteSchema`'s shape rather than
 * re-deriving it.
 */
export const optionalDayRoleSchema = z.preprocess(
  (v) => (v === null || v === '' ? undefined : v),
  dayRoleSchema.optional(),
);

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
 * The day roles that belong to a STRENGTH session — the only ones the log form offers, and the only
 * ones its schema accepts. DERIVED from `DAY_ROLE_TO_SESSION_TYPE` rather than re-listed, so adding a
 * `strength_d` needs one edit, and a conditioning role can never leak into a strength session's picker.
 */
export const STRENGTH_DAY_ROLES = DAY_ROLES.filter(
  (role) => DAY_ROLE_TO_SESSION_TYPE[role] === 'strength',
);

/**
 * Display labels for the day roles (V1-10 slice 2) — the single source for the "Today's program" card
 * header. The 1:1 roles SPREAD `SESSION_TYPE_LABELS` (never re-typed); only the split strength days,
 * which `SESSION_TYPE_LABELS` collapses to a single "Strength", add their letter — and they take the
 * "Strength" noun from that same map. An annotated object literal, NOT a computed `Object.fromEntries`
 * + cast: this way TypeScript actually enforces exhaustiveness over `DayRole` (a cast would assert the
 * checking away), exactly like `DAY_ROLE_TO_SESSION_TYPE` above. It also avoids deriving the label by
 * string-surgery on the role name, which would silently collide the day a `conditioning_a` appears.
 */
export const DAY_ROLE_LABELS: Record<DayRole, string> = {
  ...SESSION_TYPE_LABELS,
  strength_a: `${SESSION_TYPE_LABELS.strength} A`,
  strength_b: `${SESSION_TYPE_LABELS.strength} B`,
  strength_c: `${SESSION_TYPE_LABELS.strength} C`,
};

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

/** No prescribed sets, reps or load — the sheet shows only what was done (spec §7). */
function open(): Pick<PrescriptionSeedRow, 'sets' | 'targetReps' | 'targets'> {
  return { sets: null, targetReps: null, targets: both(null) };
}

/** The one fixed prescription in the program: 3 x 10 per side. */
function fixed(): Pick<PrescriptionSeedRow, 'sets' | 'targetReps' | 'targets'> {
  return { sets: 3, targetReps: '10 per side', targets: both(null) };
}

/**
 * The program seed — **Ray's youth daily A/B program**, the one the kids actually run
 * ([spec](../../../docs/samples/youth-daily-program/README.md)).
 *
 * ## It runs EVERY calendar day, alternating A → B → A
 *
 * There is no rest day; load is managed by rotating which movements appear. Day A carries box jumps
 * and inverted rows, Day B carries KB swings, and the four core movements plus the hip thrusts run
 * every session — so the athlete does a jump *or* a swing daily while each individual movement lands
 * every other session.
 *
 * ⚠️ **The letter is derived from the CALENDAR, not from completed sessions** — `resolveDayRole`.
 * The spec is emphatic that it should come from a completed-session count and names the failure mode
 * (`date % 2` doubles up box jumps after a missed day). **Ray accepted that deliberately**
 * (2026-09-24): *"I don't mind if they miss a day and end up doing the same thing twice, that's on
 * them. The way this works is by streak and consistency, stacking days."* True session-indexing is
 * backlog row YDP-1, blocked on SCHED-1. Do not "fix" this without asking.
 *
 * ## No prescribed reps and no prescribed loads — by design
 *
 * `sets` and `targetReps` are NULL on every rotating and core movement. The paper sheet deliberately
 * shows no goal numbers, only what was done, *"which reduced the 'I failed today' effect"*. Ten set
 * columns exist as headroom, not a target, and the set count is genuinely variable day to day. The
 * one exception is the hip thrusts, whose prescription really is fixed.
 *
 * ## `strength_a` / `strength_b` are reused as Day A / Day B
 *
 * Deliberate, and temporary. Proper `ydp_a`/`ydp_b` roles need a migration altering two CHECKs; Ray
 * chose (2026-09-24) to have the kids logging tonight instead. The consequence is stated rather than
 * hidden: **this block REPLACES the Kids S&C Foundation block**, which is archived verbatim at
 * [docs/programs/kids-sc-foundation-archived.md](../../../docs/programs/kids-sc-foundation-archived.md)
 * and can be re-seeded when it returns. Both cannot be active at once, because `programDayRows` picks
 * the newest block per day-role.
 */
export const PROGRAM_SEED: readonly ProgramBlockSeedRow[] = [
  {
    householdPublicId: SEED_HOUSEHOLD_PUBLIC_ID,
    slug: 'youth_daily_program', // === movementSlug('Youth Daily Program')
    name: 'Youth Daily Program',
    notes:
      'Runs every day, alternating A and B. No prescribed reps or loads — log what you actually did. Add sets before adding reps; progress box height rather than jump reps, and bell weight once 3x15 is crisp.',
    prescriptions: [
      // ── Day A ── core four, then the A-only rotating pair, then the every-day hip thrusts ──
      { dayRole: 'strength_a', movementSlug: 'push-ups', idx: 0, ...open() },
      { dayRole: 'strength_a', movementSlug: 'pull-up', idx: 1, ...open() },
      { dayRole: 'strength_a', movementSlug: 'leg_raises', idx: 2, ...open() },
      { dayRole: 'strength_a', movementSlug: 'v-sit_crunches', idx: 3, ...open() },
      { dayRole: 'strength_a', movementSlug: 'box_jump', idx: 4, ...open() },
      { dayRole: 'strength_a', movementSlug: 'inverted_rows', idx: 5, ...open() },
      { dayRole: 'strength_a', movementSlug: 'single-leg_hip_thrusts', idx: 6, ...fixed() },

      // ── Day B ── the same core four, KB swings instead of the A pair ──
      // Deliberately lighter on pulling: that is what gives the medial elbow and finger flexors a
      // recovery window between Day A row sessions.
      { dayRole: 'strength_b', movementSlug: 'push-ups', idx: 0, ...open() },
      { dayRole: 'strength_b', movementSlug: 'pull-up', idx: 1, ...open() },
      { dayRole: 'strength_b', movementSlug: 'leg_raises', idx: 2, ...open() },
      { dayRole: 'strength_b', movementSlug: 'v-sit_crunches', idx: 3, ...open() },
      { dayRole: 'strength_b', movementSlug: 'kb_swings', idx: 4, ...open() },
      { dayRole: 'strength_b', movementSlug: 'single-leg_hip_thrusts', idx: 5, ...fixed() },
    ],
  },
];
