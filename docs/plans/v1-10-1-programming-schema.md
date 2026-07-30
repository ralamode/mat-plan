# V1-10 PR 1 — programming data model (program_block / prescription / prescription_target)

> **Programming** — the back half of what V1-18 (routine builder) started. The routine says WHICH activities a
> kid does and in what order; programming says WHAT strength work is prescribed (movements, sets, target reps,
> per-kid suggested loads) so the strength form can PREFILL it (weekday auto-select + greyed suggestions the
> coach confirms). Model is already specified — [spec.md §4](../spec.md) "Program / prescription". This PR is
> **slice 1: the data model only**, DB-only, ships dark. Base: `main`. **Significant migration → committed
> plan + adversarial panel (incl. DB-safety) before code.**

## The inviolable rule this PR is built around

**The LLM never authors loads/weights** (AGENTS.md — injury risk). So per-kid loads live in a **real table
(`prescription_target`), human-authored**, and the seed **ships EMPTY** (mechanism only) — exactly the V1-6b-1
precedent (`CALISTHENICS_RAMP_SCHEDULE` shipped `[]`; real numbers are a later data-only PR). Slice 1 stands up
the tables + seed mechanism + `db:verify` proof; Ray fills real blocks/loads in a data PR; slice 2 prefills.

## Slicing (this is slice 1 of ~2–3)

- **Slice 1 (this PR)** — the three tables + migration `0007` + shared row schemas/types + empty seed mechanism
  - `db:verify`. DB-only, no app code, ships dark.
- **Slice 2** — the prefill: resolve weekday → `day_role` → this kid's prescriptions + `prescription_target`s,
  prefill the strength form with GREYED suggested sets/reps/load the coach confirms before logging. Needs a
  seeded block to demo (Ray's real block = a data PR, or a demo block).
- **Later** — block/day selection UI, progression (`ladder`/`rung`/`progression_state`) — a separate system.

## Design decisions

**D1 — `program_blocks` (household-scoped content).** `id` bigint identity PK, `public_id` uuid unique,
`household_id` FK → `households.id` (+ covering index — a block is per-household authored content, the Clerk-era
authz seam, mirroring `profiles`; NOT a global reference catalog like `movements`), `name` text, `notes` text
null, `...timestamps`. **Config data → NO `client_id`**; idempotency = a partial-unique natural key
`(household_id, name) WHERE deleted_at IS NULL` (the `ramp_targets`/`day_readiness` idiom, not the
`sessions`/`supersets` client_id idiom).

**D2 — `prescriptions` (a block's per-day movement rows).** `id`, `public_id`, `block_id` FK → `program_blocks`
(+ covering index), `day_role` text, `movement_id` FK → `movements` (+ covering index), `position` integer
(order within the day — `position` NOT `order`, a reserved word, matching how the schema avoids it), `sets`
integer null, `target_reps` text null (free-form: `"3"`, `"8-12"`, `"AMRAP"` — lossless like `entries.raw_reps`),
`scheme` text null (`"5/3/1"`, `"straight"`), `superset_label` text null (V1-8 superset reuse), `notes` text null,
`...timestamps`. Config → no `client_id`; natural key `(block_id, day_role, position) WHERE deleted_at IS NULL`.
CHECKs: `position >= 0`; `sets IS NULL OR sets > 0`.
**`day_role` — reuse `SESSION_TYPES`** (text + CHECK against the existing shared enum: `strength|conditioning|
skill|push|pull|legs|core`) so a prescription's day aligns with the session_type it prefills — **no new enum**
(DRY; the same const the `sessions` table CHECKs). Open Q: does Ray need `strength_a`/`strength_b` (two strength
days), which SESSION_TYPES can't express? Flagged for the panel — an enum extension is cheap if so.

**D3 — `prescription_targets` (per-profile suggested load — human-authored, NEVER LLM).** `id`, `public_id`,
`prescription_id` FK → `prescriptions` (+ covering index), `profile_id` FK → `profiles` (+ covering index),
`load` text null (verbatim, lossless — `"65"`, `"BW"`, `"50ft"` — mirrors `entries.raw_load`), `reps` text null
(per-kid specialization of `target_reps`), `...timestamps`. Config → no `client_id`; natural key
`(prescription_id, profile_id) WHERE deleted_at IS NULL`. This is the greyed-suggestion source slice 2 reads.

**D4 — Migration `0007` (net-new, clean by construction).** Three `CREATE TABLE IF NOT EXISTS` with inline
FKs + covering indexes + partial-unique + CHECKs (no NOT-VALID/backfill — empty tables), hand-prepended
`lock_timeout`/`statement_timeout` preamble (the 0004–0006 idiom). `drizzle-kit generate` then hand-add the
guards; drift check = generate leaves a clean tree. **Squawk stays deferred** (repo-wide V1-1a decision).
One migration/PR. FK order: `program_blocks` → `prescriptions` → `prescription_targets`.

**D5 — Shared contract (`packages/shared/src/programming.ts`).** zod **seed-row schemas** +
`z.infer` types for all three tables (mirroring `activityTypeSeedRowSchema` etc.), `day_role` validated via the
existing `SESSION_TYPES`/`sessionTypeSchema` (imported, not re-listed). An **empty seed export**
`PROGRAM_SEED: readonly ProgramBlockSeed[] = []` (the `CALISTHENICS_RAMP_SCHEDULE = []` idiom) so the mechanism
is present + correct with zero rows today. No app-facing DAL/DTO in slice 1.

**D6 — Seed (`packages/db/src/seed.ts`).** Expand `PROGRAM_SEED` → `program_blocks` (resolve `household_id`) →
`prescriptions` (resolve `block_id` + `movement_id` by slug) → `prescription_targets` (resolve `prescription_id`

- `profile_id`), each `onConflictDoNothing` on its natural key (partial-unique arbiter repeats the `WHERE
deleted_at IS NULL` predicate — the V1-5 partial-index lesson). **0 rows today**; skip empty inserts (Drizzle
  rejects empty VALUES — the ramp guard). Idempotent: re-seed no-ops.

**D7 — `db:verify`.** Assert the three tables exist with the expected columns + `data_type`s; a sample
`block → prescription → per-profile target` graph round-trips (insert + reselect + FK join returns the target);
the FK, partial-unique natural-key, and CHECK (`position >= 0`, `sets > 0`, `day_role ∈ SESSION_TYPES`)
rejections all fire; a re-seed is idempotent (0 rows in / 0 rows out today). Mirrors the `ramp_targets` verify.

**D8 — Does this trigger the `routine_config` → `routine_items` promotion (tech-debt)?** **No.** The promotion
trigger was "the first time V1-10 needs to query INTO the routine." Programming is its OWN model (blocks/
prescriptions), separate from the per-kid routine JSONB; slice 1 never joins or queries the routine. The routine
stays JSONB. (Slice 2's weekday→day_role resolution reads programming tables, still not the routine blob.)

## File-by-file

| Path                                           | Change                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/shared/src/programming.ts` **(new)** | seed-row zod schemas + types; `PROGRAM_SEED: [] `; reuse `SESSION_TYPES` for `day_role`. |
| `packages/shared/src/index.ts`                 | export the new module.                                                                   |
| `packages/db/src/schema.ts`                    | `programBlocks`, `prescriptions`, `prescriptionTargets` tables (D1–D3).                  |
| `packages/db/migrations/0007_*.sql` **(new)**  | create the three tables + timeout header + IF NOT EXISTS (D4).                           |
| `packages/db/src/seed.ts`                      | expand `PROGRAM_SEED` (empty today), idempotent by natural key (D6).                     |
| `packages/db/scripts/verify.ts`                | table/column/constraint asserts + round-trip + rejections + idempotency (D7).            |
| `docs/plan.md`, `docs/status.md`               | V1-10 slice 1 in flight; note the slicing.                                               |

## Out of scope (→ later slices)

The prefill / weekday auto-select / greyed suggestions (slice 2, needs app code + a seeded block), a
block-authoring UI, `ladder`/`rung`/`progression_state` (the V2 progression engine), real block/load DATA (a
Ray-authored data-only PR — the LLM never authors loads), and any `routine_config` promotion (D8: not needed).

## Open questions for the panel

1. **`day_role` = reuse `SESSION_TYPES`, a new `DAY_ROLES` enum, or free text?** SESSION_TYPES is DRY + aligns
   day↔session, but can't express `strength_a`/`strength_b` (two strength days). Least-bad for slice 1?
2. **Ship all three tables in slice 1, or split** (`program_blocks`+`prescriptions` in 1a, `prescription_targets`
   in 1b)? They're cohesive + net-new-empty (low risk); is one migration right, or is 3 tables too big a bite?
3. **`load`/`target_reps`/`reps` as TEXT** (lossless, mirrors `entries.raw_load`/`raw_reps`) vs numeric — right
   call given BW/`"50ft"`/`"8-12"` values?
4. **`program_block` household-scoped** (FK `households.id`) vs a global reference catalog — consistent with the
   codebase's content-vs-reference split?
5. Anything in D4/D7 that weakens the "clean by construction" migration claim or the idempotent-seed proof?

---

## Adversarial panel review log — reconciled (the REVISED model below supersedes D1–D8 where they differ)

_(5 lenses — correctness/data-integrity · simplicity/scope · architecture/consistency · code-reuse/DRY ·
DB-safety. Every substantive finding folded in — this is a migration, expensive to change post-merge.)_

### Revised model (post-panel)

**`program_blocks`** — `id`, `public_id`, `household_id` FK (+idx), **`slug`** text, `name` text, `notes` text
null, `...timestamps`. NK `(household_id, slug) WHERE deleted_at IS NULL`. **slug not raw name** (correctness
F4: free-text `name` lets whitespace/casing dupe on re-seed — mirror `movements.slug`; slug = a shared
slugifier of `name`, reusing `movementSlug` if generic).

**`prescriptions`** — `id`, `public_id`, `block_id` FK (+idx), `day_role` text (CHECK ∈ `DAY_ROLES`),
`movement_id` FK (+idx), **`idx`** int (renamed from `position` — matches `entry_sets.idx`; arch F3),
`sets` int null, `target_reps` text null, `...timestamps`. NK `(block_id, day_role, idx) WHERE deleted_at IS
NULL`. CHECKs `idx >= 0`, `sets IS NULL OR sets > 0`. **DROPPED for slice 1** (no reader until V2 — simplicity
#2/#6, re-add cheap to a small table): `scheme`, `superset_label`, `notes`.

**`prescription_targets`** — `id`, `public_id`, `prescription_id` FK (+idx), `profile_id` FK (+idx), `load`
text null, `...timestamps`. NK `(prescription_id, profile_id) WHERE deleted_at IS NULL`. **DROPPED `reps`**
(simplicity #1 + correctness F7: no per-kid-reps case; `prescriptions.target_reps` covers the greyed
suggestion for both kids, and dropping it removes the `target_reps` vs `reps` precedence ambiguity).

### Key decisions & the finding each resolves

- **`day_role` = a DEDICATED `DAY_ROLES` const, NOT `SESSION_TYPES`** (arch F1 _blocking_ · correctness F5 ·
  DB-safety F4; overrides simplicity Q1). Reusing SESSION_TYPES is a category error AND collides the NK — two
  strength days (`strength_a`/`strength_b`, which spec.md:153's `sc_lift` example uses) both map to
  `'strength'` at the same `idx`. Fix: `DAY_ROLES = [...SESSION_TYPES, 'strength_a', 'strength_b']` (DRY — spreads
  SESSION_TYPES, doesn't re-list) + `dayRoleSchema` + a `DAY_ROLE_TO_SESSION_TYPE` map (strength_a/b → strength,
  else identity) for slice-2 prefill. Decided NOW because the CHECK is forward-only frozen (DB-safety F4) — a
  later role needs a new migration, so ship the known superset.
- **Prescription NK keeps `idx` (a SLOT arbiter), re-seed is INSERT-ONLY** (correctness F1). Keeping `idx`
  (not `movement_id`) is right — a movement can legitimately appear twice in a day (warm-up + working set). The
  price: `onConflictDoNothing` can't replace/reorder a slot on re-seed (identical to the ramp precedent). DOCUMENT
  it (block edits are a future authoring path, not re-seed) and `db:verify` asserts an intra-batch duplicate-slot
  fails loudly, not silently.
- **Same-household invariant (target.profile ∈ block.household) is WRITER-enforced + documented, not schema**
  (correctness F2). Mirrors the superset same-session precedent (schema.ts:344 — invariant in the writer, not the
  schema). Slice 1 has no writer (empty seed); the slice-2 DAL enforces it via a BOLA household join (arch F4), and
  the data-PR seed resolves profiles within the block's household. Composite-FK hardening (`household_id` +
  `(id, household_id)` FKs) noted as a future option; NOT denormalized now (avoids speculative complexity).
- **Seed rows use `newId()`, not fixed `seedPublicId`** (correctness F6) — a NK conflict discards the fresh id
  cleanly; a fixed id + a moved-slot row would throw a `public_id` UNIQUE violation the NK arbiter can't catch.
- **`db:verify` proves the RESOLVER, not just the DDL** (correctness F3 · DB-safety F1). Factor a
  `seedProgram(db, blocks)` helper (seed.ts) that `seed()` calls with the empty `PROGRAM_SEED`; `db:verify` calls
  it with a **test-only** non-empty fixture (own test household/slug, no `onConflict` collision with real data) so
  resolve-by-slug / resolve-by-public_id / the `WHERE deleted_at IS NULL` ON CONFLICT arbiter are all exercised.
  Assert `0` real seeded rows FIRST, then the fixture round-trip + FK join + re-run idempotency + intra-batch
  dup-slot loud-fail + partial-unique BOTH directions (live dup rejected; soft-deleted doesn't block re-insert).
- **CHECKs declared in `schema.ts` (0004 path), inline-generated — none hand-added** (DB-safety F2) so the drift
  snapshot stays clean. Migration: bare `CREATE TABLE` (NOT `IF NOT EXISTS` — arch F2, matches 0004/0005), the
  hand-prepended `lock_timeout`/`statement_timeout` preamble only. Per-insert empty-array guard ×3 (DB-safety F3).
- **DRY:** seed-row zod schemas COMPOSE `dayRoleSchema` + `z.string()` movement slug (mirror
  `movementSeedRowSchema`); the seed resolves FKs via the existing `select({id}).where(eq(naturalKey,…))` idiom
  (household by public_id, movement by `movements.slug`, profile by public_id); a small `insertIfAny` helper DRYs
  the 3 guarded inserts; `db:verify` reuses `assertCheckCoversConst('prescriptions_day_role_check', DAY_ROLES)`,
  a new `columnsOf(table)` helper (the `information_schema.columns` cast is already duplicated 2×), `expectRejectedBy`,
  and `newId()` for fixtures. Plain `text` loads confirmed house style (no new length const). (DRY #1's opportunistic
  `sessions_session_type_check` backfill SKIPPED — out of scope for a programming PR.)
- **Pre-merge proof is PGlite `db:verify`** (DB-safety F5); Docker-PG + Neon-branch + Squawk remain deferred per
  V1-1a. Redundant `idx_prescriptions_block` KEPT (correctness — consistent with `idx_ramp_targets_profile`).

**Affirmed, don't re-litigate:** household-scoped blocks; config-table idiom (no client_id, partial-unique NK);
text loads; empty seed in `shared`; separation from ladder/rung + routine_config JSONB (D8 — no promotion); one
additive migration, clean by construction. **Spec deviation:** slice 1 trims `reps`/`scheme`/`superset_label`/
`notes(presc)` from spec.md §4's full model — deferred until a consumer exists, re-add is cheap on a small table.
