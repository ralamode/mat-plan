# V1-10 PR 1b — seed Ray's real 2-week program (+ the schema deltas it needs)

> The DATA PR that lights up the (empty) programming tables from slice 1 (#66). Ray authored two weeks of the
> **Kids S&C Foundation** block (`docs/plans/v1-10-two-week-program-source.md`); this seeds its **strength days** and adds the small
> schema/catalog pieces the real data requires. The LLM authors NONE of the loads — they're transcribed verbatim
> from Ray's doc. Base: `main`. **Has a migration (0008) → committed plan + adversarial panel before code.**

## Scope (from Ray's answers)

- **Seed the 3 strength days only** (A/B/C). Conditioning days (Tue/Thu) are interval-based (sled sprints,
  Zone-2 aerobic — not movement-per-set), so they don't fit the `prescription` (movement-per-row) model; the
  brush-the-teeth routine (rice bucket, splits, shots, gymnastics…) is already V1-18 routine + check-ins.
  → **Backlog:** design a conditioning-day model (a later slice).
- **Week 1 loads only**, as the greyed _starting suggestion_. Ray's own rule is "confirm against the last
  logged working set"; Week 2 is a coach bump, not a second fixed prescription. So one block, Week-1 numbers.

## Schema deltas (migration 0008 — empty tables, so instant/clean)

**S1 — `prescription_targets.reps` (text, nullable) — the per-kid REPS override.** Ray's kids differ in reps on
some lifts, not just load (Pull-Up: Athlete One `4×4`, Athlete Two `4×5` last-set AMRAP; Weighted Chin likewise). Slice 1
cut per-kid reps as speculative (panel simplicity #1 / correctness F7); the real data un-cuts it. Semantics:
`null` → use the prescription's shared `target_reps` (the common case); non-null → this kid's override. TEXT
(lossless: `"4"`, `"5, last AMRAP"`), mirroring `target_reps`. Sets stay shared (Ray's diffs are reps-only).

**S2 — widen the `day_role` CHECK to include `strength_c`.** Ray runs THREE strength days; `DAY_ROLES` currently
stops at `strength_b`. `DAY_ROLES = [...SESSION_TYPES, 'strength_a', 'strength_b', 'strength_c']`; the migration
drops + re-adds `prescriptions_day_role_check` with the new literal (forward-only, per DB-safety F4 in slice 1).
`db:verify`'s bidirectional `assertCheckCoversConst` keeps the CHECK ↔ const exact.

**Migration mechanics:** update `schema.ts` (the CHECK list) + `DAY_ROLES`, `drizzle-kit generate` → 0008 =
`ADD COLUMN reps` + `DROP/ADD CONSTRAINT prescriptions_day_role_check`. Both instant on empty tables (no
backfill, no NOT VALID). Hand-prepend the `lock_timeout`/`statement_timeout` preamble (the 0004–0007 idiom).
Drift-clean. Squawk deferred.

## Catalog delta — 11 new movements (definitions, NOT loads)

Added to `MOVEMENT_SEED_ROWS` (name + slug + `pattern` + `is_bodyweight`) — exercise metadata I can author.
Reuse existing where the movement is the same (`dips` for Weighted Dips via the load field; `back_squat`,
`front_squat`, `box_jump`, `bb_bench`, `nordic_ham_curl`, `pallof_press`, `bulgarian_split_squat`,
`romanian_deadlift` already exist). New:

| slug                 | pattern         | bodyweight |
| -------------------- | --------------- | ---------- |
| `pull_up`            | vertical_pull   | ✓          |
| `chin_up`            | vertical_pull   | ✓          |
| `med_ball_slam`      | hinge           | ✗          |
| `trap_bar_deadlift`  | hinge           | ✗          |
| `db_overhead_press`  | vertical_push   | ✗          |
| `one_arm_db_row`     | horizontal_pull | ✗          |
| `ab_rollout`         | core            | ✓          |
| `broad_jump`         | jump            | ✓          |
| `barbell_hip_thrust` | hinge           | ✗          |
| `farmer_carry`       | carry           | ✗          |
| `hollow_body_hold`   | core            | ✓          |

The strict `seedProgram` resolver (R1 fix) THROWS on any movement slug not in the catalog, so a missing one
fails the seed loudly — the movement seed runs before `seedProgram`, so these are all present first.

## The seed (`PROGRAM_SEED`) — one block, 3 strength days

`ProgramBlockSeedRow`: `householdPublicId = SEED_HOUSEHOLD_PUBLIC_ID`, `slug = 'kids_sc_foundation'`
(= `movementSlug(name)`), `name = 'Kids S&C Foundation'`. Prescriptions grouped by `day_role`:
`strength_a` (Squat + Vertical Power), `strength_b` (Hinge + Explosive), `strength_c` (Posterior + Carries),
each an ordered (`idx`) list of movements with shared `sets` + `target_reps`, and per-kid `targets`
(`{ profilePublicId, load, reps? }`). **Loads transcribed VERBATIM from Ray's doc** (e.g. Front Squat →
Athlete One `"60"`, Athlete Two `"65"`; Back Squat → both `"~75-85"`; Pull-Up → Athlete One `{load:"BW"}`, Athlete Two
`{load:"BW +5", reps:"5, last AMRAP"}`; Pallof → both `"band"`). `reps` set only where a kid differs.
Per-kid profiles: `SEED_PROFILE_PUBLIC_ID` (Athlete One), `SEED_PROFILE_2_PUBLIC_ID` (Athlete Two) — both in the root
household (the same-household invariant holds).

## Verify + tests (now exercise REAL data)

- `db:verify`: the empty-seed count assertion flips to "the seeded block resolves" — assert `program_blocks` ≥ 1,
  the `kids_sc_foundation` block's prescriptions resolve their movements, and the per-kid targets carry the
  expected loads. Keep the test-only-fixture resolver/idempotency/rejection probes (unchanged). Assert
  `strength_c` is accepted by the CHECK and `reps` round-trips.
- The web contract test's forward-guards (`slug === movementSlug(name)`, no dup `(day_role, idx)` slots, no
  repeated profile per prescription) STOP being vacuous — they now validate Ray's real `PROGRAM_SEED`.
- `prescriptionTargetSeedRowSchema` gains `reps: z.string().nullable().optional()` (or `.nullable()` with the
  seed omitting it where shared).

## Smart-programming note (for the record — no code here)

Per-kid baseline reps/loads on `prescription_target` is the **coach-authored starting point**; future adaptive
programming is a deterministic **progression engine** (`packages/engine`, pure + golden-tested — spec §4) that
reads logged `entry_set` history + Ray's knob-order rule and advances a `progression_state` (per kid, per
movement) FROM that baseline. The prefill shows the engine's target if present, else the baseline; the coach
always confirms. So adding the baseline now is the seed the learning layer reads — future-compatible, not
rework. **Backlog:** capturing RIR/RPE per `entry_set` (Ray's program is RIR-driven) to feed autoregulation.

## Out of scope

Slice 2 (the strength-form prefill UI), the conditioning-day model, `progression_state`/the engine, RIR logging,
Week-2-as-data (it's coach progression). Real loads beyond Week 1 (data, not code).

## Backlog items this PR opens

1. **Conditioning-day model** — prescribe interval/aerobic sessions (Tue/Thu) for a future prefill.
2. **RIR/RPE per set** — log it on `entry_set` to feed adaptive progression.

---

## Adversarial panel review log — reconciled

_(4 lenses — correctness/data-integrity · simplicity/scope · code-reuse/DRY · DB-safety.)_

**Movements (the big correction).** `movementSlug` only collapses whitespace → `_`; it PRESERVES hyphens/digits.
So the earlier underscored slugs were wrong. **Reuse** existing rows: `pull-up` (…053) for BOTH Pull-Up AND
Weighted Chin (the catalog header already dedups chins→pull-up), `overhead_shoulder_press` (…058) for DB OHP,
`dips` (…059) for Weighted Dips. **8 genuinely-new** rows (`seedPublicId('065')`…`('06c')`), full
`MovementSeedRow` shape (`slug === movementSlug(name)`, `unitDefault` `'lb'` for loaded / `null` for
bodyweight, `pattern` ∈ `MOVEMENT_PATTERNS`): `med-ball_slam`(hinge), `trap-bar_deadlift`(hinge,lb),
`1-arm_db_row`(horizontal_pull,lb), `ab_rollout`(core), `broad_jump`(jump), `barbell_hip_thrust`(hinge,lb),
`farmer_carry`(carry,lb), `hollow-body_hold`(core).

**Block naming (F1).** `name: 'Kids S&C Foundation'`, `slug: 'kids_s&c_foundation'` (the real `movementSlug`
output — `&`/space survive; my earlier `kids_sc_foundation` was wrong and would fail the slug forward-guard).

**strength_c (F4, DRY #3/#9).** Add to `DAY_ROLES` AND `DAY_ROLE_TO_SESSION_TYPE` (`strength_c: 'strength'` —
else `tsc` fails) AND the schema CHECK literal list. NO bespoke verify probe — the bidirectional
`assertCheckCoversConst('prescriptions_day_role_check', DAY_ROLES)` already pins it.

**reps (S1, DRY #4/#5, F6/F7).** `prescriptionTargetSeedRowSchema.reps: z.string().nullable()` (mirror `load`
exactly, no `.optional()`); thread `reps: target.reps ?? null` into `seedProgram`'s target insert (F6 — else it
silently drops); verify folds `reps: 'text'` into `V1_10_COLUMNS` + adds `pt.reps` to the existing graph query
(no new helper). **Convention (F7, documented):** `prescription.target_reps` = the base prescribed reps;
`prescription_target.reps` overrides it for a kid who deviates (both null → both use the base). Set target_reps
to what reads as "the prescription"; where the two kids differ, override the deviating kid.

**verify (F5).** Flip BOTH empty-count asserts (`PROGRAM_SEED.length`, `seededBlocks`) to "the seeded
`kids_s&c_foundation` block resolves its movements + per-kid loads/reps"; the test-only `verify_test_block`
fixture + rejection probes are untouched.

**Migration 0008 (DB-safety — SOUND, additive/empty-table/forward-only).** `ADD COLUMN reps text` (hand-add
`IF NOT EXISTS`, the 0006 idiom) + widen the `day_role` CHECK (drizzle emits DROP/ADD — **F1: eyeball the
generated 0008 for the DROP/ADD pair**, `assertCheckCoversConst` is the backstop). Timeout preamble; Squawk
deferred; instant on empty tables (no NOT VALID/backfill). Re-seed is insert-once (a load correction won't
propagate via re-seed — the `ramp_targets` stance; documented).

**Seed-id sourcing (DRY).** `PROGRAM_SEED` (in shared) needs the household + kid `public_id`s, which live in
`packages/db/src/seed.ts` (shared can't import db). Hoist `SEED_HOUSEHOLD_PUBLIC_ID` /
`SEED_PROFILE_PUBLIC_ID` / `SEED_PROFILE_2_PUBLIC_ID` to `packages/shared` (single source), re-exported from
`seed.ts` so `verify.ts`'s import still resolves.

**RIR prescription (simplicity #7).** "RIR 1–2" / "never a grind" / "last set to failure" have no home
(slice 1 cut `notes`). **Documented as not-stored this PR**; the safety/AMRAP notes that ARE rep-scoped ride
in the lossless `target_reps` text ("5, last set to failure"). **Backlog:** a prescription cue/RIR field for
slice-2 prefill display. Also backlogged (Ray's Q1 + the smart-programming note): the conditioning-day model,
and RIR/RPE-per-`entry_set` logging.

**Affirmed:** the `reps` column (not a load-text hack), one bundled migration, Week-1-only, no slice-2 code,
load values as verbatim one-off strings. **Transcription caveats (lossless `target_reps` text):** trap-bar
"top 4×3 + 2 back-offs", `/side`, `/leg`, distances ("40 yd"), times ("30–40 s") — all packed into
`target_reps`; the trap-bar back-off sets aren't separately modeled.
