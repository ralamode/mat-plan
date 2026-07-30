import { z } from 'zod';

import { SESSION_TYPES, type SessionType } from './sessions';

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
export const DAY_ROLES = [...SESSION_TYPES, 'strength_a', 'strength_b'] as const;
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

/**
 * The program seed — **ships EMPTY**: slice 1 stands up the tables + the seed mechanism, and real blocks with
 * human-authored per-kid loads land in a later data-only PR (the `CALISTHENICS_RAMP_SCHEDULE = []` idiom). An
 * empty seed keeps the "LLM never authors loads" rule intact — there is nothing for the model to invent here.
 */
export const PROGRAM_SEED: readonly ProgramBlockSeedRow[] = [];
