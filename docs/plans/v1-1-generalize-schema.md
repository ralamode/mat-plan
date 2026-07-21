# V1-1 — generalize the v0 schema toward the full activity model

> Backlog: [plan.md](../plan.md) row V1-1. Branches: `db/v1-1a-additive-catalogs` (merged),
> `db/v1-1b-generalize-entries` (merged), `db/v1-1c-relax-kind` (constraint relaxation), then
> `db/v1-1d-contract` (the physical column drops). Grounds in [spec.md](../spec.md) §4.

## Goal

Move the v0 thin-slice schema (`units` + `profiles` + `entries` + `entry_sets`) toward the full
entity model in [spec.md](../spec.md) §4 — households as the authz root, the `activity_type` /
`movement` / `metric_definition` catalogs, `session`, and `day_readiness` — and generalize `entries`
from a `kind`-discriminated bodyweight/strength row into the spec's tagged union
(`activity_type_id`, `movement_id?`, `metric_key?`), **without ever dropping data**. Because a
production Neon DB already holds the v0 seed profile and (potentially) real rows, this is done as an
**expand → migrate → contract** sequence split across **three PRs / three deploys**, not one.

## Locked decisions (approved by the maintainer)

1. **Entry tagged-union CHECK = AT-MOST-ONE:** `(movement_id IS NULL OR metric_key IS NULL)` — not
   the exactly-one XOR in spec §4 — because boolean/timing activities (rice_bucket, wake, splits)
   reference **neither** a movement nor a metric. Added in **V1-1b** (with the entry columns), not here.
2. **Split into a / b / c / d** (see phase table). Each phase is independently deployable and
   reversible by omission (expand-contract). Originally scoped as a/b/c; the destructive contract was
   later split into **V1-1c (constraint relaxation, metadata-only)** and **V1-1d (the physical
   `DROP COLUMN` + CHECK drops)** so the app can be taken off `kind` (V1-5–V1-8) between them.
3. **Defer the Squawk + Neon-branch CI wiring.** V1-1a does **not** edit `ci.yml`. The migration is
   proven locally via the PGlite `db:verify` harness + the drizzle drift guard; the real-DB gates
   (Squawk lint, Docker-PG apply, Neon-branch apply) are wired in a later infra PR. Consequence: the
   covering indexes in V1-1a are created **inline / non-concurrently** (safe — the tables are
   new/empty), and the `CREATE INDEX CONCURRENTLY` + transaction-stripping runner is out of scope.
4. **Serial path.** V1-1a is the first of the three PRs; b depends on a, c depends on b.

## Phase table

| Phase     | Branch                        | Kind                   | Scope                                                                                                                                                                                                                                                                                                                     | Status                  |
| --------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **V1-1a** | `db/v1-1a-additive-catalogs`  | additive (expand)      | New tables + `profiles` columns + structural enums + reference-table seeds. **No `entries`/`entry_sets` change, no entry backfill, no DAL change.**                                                                                                                                                                       | ✅ merged               |
| **V1-1b** | `db/v1-1b-generalize-entries` | additive + backfill    | Add `entries.session_id / activity_type_id / movement_id / metric_key / value_text / context / scheme`; the **at-most-one CHECK** (decision 1); seed 3 minimal catalog rows; backfill v0 rows; DAL dual-write.                                                                                                            | ✅ merged               |
| **V1-1c** | `db/v1-1c-relax-kind`         | constraint relaxation  | Relax `entries.kind` to **NULLABLE** (unblocks metric-only / boolean check-ins) + add the discriminant invariant `activity_type_id IS NOT NULL` (CHECK NOT VALID → VALIDATE). **No column drop, no app change** — the legacy `kind`/`movement_name` columns + the `entries_kind_check`/`entries_shape_check` guards STAY. | ✅ **this PR**          |
| V1-1d     | `db/v1-1d-contract`           | destructive (contract) | The physical `DROP COLUMN kind` / `movement_name` + drop `entries_kind_check` / `entries_shape_check`, once V1-5–V1-8 take the app off `kind`. Squawk-wired, 2-deploy expand→contract split, Neon RESTORE branch cut first.                                                                                               | ⏳ deferred (after b→c) |

## Acceptance (V1-1a)

- **plan.md V1-1 criterion:** "Migration runs forward on a Neon branch, v0 data preserved." V1-1a
  proves the additive half locally (PGlite `db:verify` + drift guard); the Neon-branch apply gate
  lands with the deferred CI infra, and the full "v0 data preserved" claim completes at V1-1b's backfill.
- Done when, in this PR: `db:generate` leaves a clean tree (no drift); `db:verify` applies `0001` to
  PGlite, seeds twice → identical counts, asserts the root household + non-null `profiles.household_id`,
  the category count matches the shared const, and bad `gate_color` / `input_shape` inserts are
  CHECK-rejected; typecheck · lint · test · `next build` · `prettier --check` all green.

## File-by-file changes (V1-1a)

| Path                                              | Change   | What & why                                                                                                                                                       |
| ------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/activity-categories.ts`      | NEW      | `ACTIVITY_CATEGORIES` const + zod enum + type + `ACTIVITY_CATEGORY_ROWS` (`{code,label}`) for the `activity_type_categories` reference-table seed.               |
| `packages/shared/src/activity-shapes.ts`          | NEW      | `ACTIVITY_INPUT_SHAPES` (`set_list\|single_metric\|boolean\|timing`) — text+CHECK structural enum.                                                               |
| `packages/shared/src/metrics.ts`                  | NEW      | `METRIC_VALUE_TYPES` + `METRIC_AGGREGATIONS` — text+CHECK.                                                                                                       |
| `packages/shared/src/movements.ts`                | NEW      | `MOVEMENT_PATTERNS` — text+CHECK.                                                                                                                                |
| `packages/shared/src/sessions.ts`                 | NEW      | `SESSION_TYPES` + `SESSION_STATUSES` (reuses `ENTRY_STATUSES`) — text+CHECK.                                                                                     |
| `packages/shared/src/readiness.ts`                | NEW      | `GATE_COLORS` (`green\|yellow\|red`) — text+CHECK for `day_readiness.gate_color`.                                                                                |
| `packages/shared/src/index.ts`                    | EDIT     | Barrel-export the six new modules.                                                                                                                               |
| `packages/db/src/schema.ts`                       | EDIT     | Add `households`, `activity_type_categories`, `activity_types`, `movements`, `metric_definitions`, `sessions`, `day_readiness`; add additive `profiles` columns. |
| `packages/db/src/types.ts`                        | EDIT     | Row/insert types for the new tables (`$inferSelect`/`$inferInsert`).                                                                                             |
| `packages/db/src/seed.ts`                         | EDIT     | `SEED_HOUSEHOLD_PUBLIC_ID`; seed categories + root household; scope the seed profile to it. Idempotent.                                                          |
| `packages/db/migrations/0001_loose_barracuda.sql` | NEW      | Generated DDL + hand-added `SET` timeouts, reference-data seed, `household_id` backfill, and the NOT-NULL CHECK (NOT VALID → VALIDATE).                          |
| `packages/db/migrations/meta/*`                   | NEW/EDIT | drizzle snapshot + journal for `0001` (the drift-guard artifact).                                                                                                |
| `packages/db/scripts/verify.ts`                   | EDIT     | Extend the PGlite harness with the V1-1a assertions.                                                                                                             |
| `docs/plan.md`, `docs/status.md`, `docs/plans/…`  | EDIT/NEW | Link V1-1 → this plan; status "where we are" + changelog.                                                                                                        |

### New tables (spec §4 shapes)

- `households` — `id` bigint-identity, `public_id` uuid NN UNIQUE, `name` NN, timestamps. Authz root.
- `activity_type_categories` — **reference table**: `code` PK, `label` NN, `created_at`. Seeded from `ACTIVITY_CATEGORY_ROWS`.
- `activity_types` — `key` NN UNIQUE, `label` NN, `category` NN → categories (+idx), `input_shape` NN + CHECK, `default_unit` → units (nullable, +idx), `icon`.
- `movements` — `slug` NN UNIQUE, `name` NN, `pattern` + CHECK (nullable), `unit_default` → units (+idx), `is_bodyweight` NN default false, `video_url`, `cues`.
- `metric_definitions` — `key` NN UNIQUE, `label` NN, `unit` NN → units (+idx), `value_type` NN + CHECK, `aggregation` NN + CHECK.
- `sessions` — `client_id` (partial-unique), `profile_id` → profiles (idx `idx_sessions_profile_date` covers the FK + hot path), `activity_date` NN, `logged_at`, `session_type` + CHECK, `status` NN default 'done' + CHECK, `source`, `feel`. First written at V1-8.
- `day_readiness` — `profile_id` → profiles (+idx), `readiness_date` NN, `gate_color` NN + CHECK, `note`; partial-unique `(profile_id, readiness_date)`.
- `profiles` (EDIT) — add `household_id` → households (+idx `idx_profiles_household`), `birthdate`, `avatar`, `pin_hash` (spec §2 — columns only, no UI). `household_id` enforced NOT NULL via the migration CHECK.

### Migration `0001` hand-added sections

- Top: `SET lock_timeout='5s'` + `SET statement_timeout='60s'` (AGENTS.md DB rule) + a header comment
  recording the deliberate non-concurrent-index deviation (decision 3).
- Bottom (after the generated DDL, so the drizzle snapshot is untouched): seed
  `activity_type_categories` + the root `households` row `ON CONFLICT DO NOTHING`; backfill
  `profiles.household_id` from the root household `WHERE household_id IS NULL`; add
  `profiles_household_id_not_null CHECK (household_id IS NOT NULL) NOT VALID`; `VALIDATE CONSTRAINT`.
  The FK is the drizzle-emitted inline one (NULLs are RI-exempt, so it validates pre-backfill) —
  exactly one FK, reconciled.

## V1-1b (shipped — this PR)

The entry-generalization phase. **Additive + backfill only** — the legacy `entries.kind` /
`movement_name` / `entries_shape_check` **stay** (dropping them is V1-1c, a later deploy). No data dropped.

**What this PR did:**

- **`packages/db/src/schema.ts`** — added seven NULLABLE columns to `entries`: `session_id` →
  `sessions.id`, `activity_type_id` → `activity_types.id`, `movement_id` → `movements.id`,
  `metric_key` → `metric_definitions.key`, plus `value_text` / `context` / `scheme`. Every new FK gets
  a covering index (`idx_entries_session` / `_activity_type` / `_movement` / `_metric_key`). The
  at-most-one CHECK is **NOT** declared here — it's hand-added in the migration so the drift snapshot
  stays clean (same pattern as V1-1a's `profiles` NOT-NULL CHECK).
- **`packages/shared/src/catalog-seed.ts`** (NEW) — the three minimal catalog rows the backfill + DAL
  reference, as `as const` objects with fixed UUIDv7 public_ids (seed namespace): activity types
  `weigh_in` (measurement / single_metric / lb) + `sc_lift` (strength / set_list), metric `bodyweight`
  (lb / number / last). **The single source V1-2's full catalog reuses** (same keys + public_ids; its
  seed is `ON CONFLICT DO NOTHING` on the natural key → no dup). Barrel-exported.
- **`packages/shared/src/movements.ts`** — added `movementSlug(name)` (lower + collapse whitespace to
  `_`), the one derivation shared by the DAL find-or-create and the migration backfill SQL.
- **`packages/db/migrations/0002_freezing_cargill.sql`** — generated ADD COLUMN/FK/index DDL, then
  hand-added (after the generated block): `SET` timeouts + header; seed `lb` unit + the 3 catalog rows
  (`ON CONFLICT DO NOTHING`); `INSERT … SELECT DISTINCT` a movement per legacy `movement_name`;
  idempotent backfill (bodyweight → `metric_key='bodyweight'` + weigh_in; strength → matched
  `movement_id` + sc_lift); the `entries_value_source_check` CHECK (`movement_id IS NULL OR
metric_key IS NULL`) as `NOT VALID` → `VALIDATE`.
- **`packages/db/src/seed.ts`** — also seeds the 3 catalog rows from the shared const (idempotent).
- **`apps/web/lib/dal/catalog.ts`** (NEW) + **`entries.ts`** — DAL dual-write: `logBodyweight` now
  sets `activity_type_id`=weigh_in + `metric_key`='bodyweight'; `logStrengthEntry` sets
  `activity_type_id`=sc_lift + `movement_id`=find-or-create(slug(name)). Cached catalog lookups; the
  free-text→movement find-or-create is the v0→v1 bridge (picker is V1-8). Legacy `value_num`/`raw_*`,
  `client_id` idempotency, and revalidate are unchanged.
- **`packages/db/scripts/verify.ts`** — asserts the new columns + at-most-one CHECK (rejects BOTH
  source cols set; allows NEITHER — at-most-one, not XOR), the backfill resolution (bodyweight→metric,
  strength→movement), and schema-CHECK ↔ shared-const parity (`activity_types_input_shape_check`
  contains every `ACTIVITY_INPUT_SHAPES` member).

**Deviation:** the migration seeds the `lb` unit inline (`ON CONFLICT DO NOTHING`) because the catalog
rows FK `units.code` and units are seeded by `db:seed`, not a migration — so the migration seeds its
own backfill dependency to stay self-sufficient at migrate time (mirrors V1-1a's root-household seed).
Backfilled movement `public_id`s use `gen_random_uuid()` (no in-DB UUIDv7 fn on PG16/Neon) for the
one-time backfill; new movements the DAL creates get a client UUIDv7.

## Test plan

- `pnpm --filter @mat-plan/db db:verify` — PGlite applies `0001`, runs the seed twice (idempotent →
  identical counts), asserts the root household + non-null `profiles.household_id`, the category count
  == `ACTIVITY_CATEGORIES.length`, and CHECK-rejection of a bad `gate_color` and a bad `input_shape`.
- `pnpm --filter @mat-plan/db db:generate` — drift guard: re-generate produces no new migration.
- Root gates: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm format:check` (+ `next build` in CI).
- **Deferred to the CI-infra PR:** Squawk lint of `0001`, apply on empty Docker PG + a Neon branch.

## Risks / rollback

- **Adding a NOT-NULL column to a seeded `profiles`.** → Column added NULLABLE; NOT NULL enforced via
  CHECK (NOT VALID → backfill → VALIDATE), never a table rewrite. Prod's existing seed profile is
  backfilled to the root household.
- **Drift guard vs the hand-edited `.sql`.** → All hand-adds are DML/`VALIDATE`/`SET` **after** the
  generated DDL and are absent from the drizzle snapshot, so `generate` stays clean (proven).
- **No real-DB gate yet (Squawk/Neon deferred).** → The migration is additive-only and PGlite-proven;
  the destructive step is isolated to V1-1c behind Squawk. Rollback = fix-forward (expand-contract is
  reversible by omission); a Neon RESTORE branch is cut before V1-1b's backfill / V1-1c's contract.

## Out-of-scope / deferred (V1-1a)

- Any change to `entries` / `entry_sets`, the entry tagged-union CHECK, and the v0-row backfill — **V1-1b**.
- Dropping legacy `entries.kind` / `movement_name` — **V1-1c** (destructive contract).
- Seeding the `activity_types` / `movements` / `metric_definitions` catalog rows — **V1-2**.
- DAL changes, UI, and the Squawk + Neon-branch CI wiring — later PRs.

## Open questions

_(none — the four decisions above are locked.)_

---

# V1-1c — relax `entries.kind` NOT NULL; add the `activity_type_id` discriminant invariant

> Backlog: [plan.md](../plan.md) row V1-1. Branch: `db/v1-1c-relax-kind`. This is the **constraint
> relaxation** phase (metadata-only), split out of the original "destructive contract" — the physical
> `DROP COLUMN` is now **V1-1d**.

## Goal

A metric-only / boolean check-in (e.g. a `rice_bucket` "stance" check-in) has no `kind` — it's not a
bodyweight or a strength row. The single thing blocking that insert is `entries.kind NOT NULL`. This
PR makes `kind` **nullable** so those entries insert, and adds the discriminant invariant
`activity_type_id IS NOT NULL` (every row must identify its activity — [spec.md](../spec.md) §4;
`schema.ts` already reserved "becomes NOT NULL at V1-1c"). It is **metadata-only**: no column is
dropped, no data moves, and no app code changes. The legacy `kind`/`movement_name` columns and the
`entries_kind_check` / `entries_shape_check` guards **stay** (they still guard the live `kind`
dual-writer — `logBodyweight`/`logStrengthEntry` keep writing `kind`); the physical drop is **V1-1d**,
after V1-5–V1-8 take the app off `kind`.

## Acceptance

- **plan.md V1-1 criterion:** "Migration runs forward on a Neon branch, v0 data preserved." V1-1c is
  backward-compatible (nothing dropped) → v0 data is trivially preserved; the Neon-branch apply is the
  CI `e2e` job's `db:migrate`.
- Done when, in this PR: `db:generate` leaves a clean tree (the `kind`-nullable change matches the
  snapshot; the hand-added `activity_type_id` CHECK is absent from `schema.ts`/snapshot, same as
  `household_id`, so `generate` doesn't re-emit it); `db:verify` proves a `kind`-less metric-only
  check-in inserts + round-trips (`kind IS NULL`, `activity_type_id` set, `movement_id` NULL) and that
  a row without `activity_type_id` is rejected **specifically** by `entries_activity_type_id_not_null`;
  the pre-existing guard assertions still hold; typecheck · lint · test · `format:check` · `next build`
  green.

## File-by-file changes

| Path                                            | Change   | What & why                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                     | EDIT     | `kind: text('kind').notNull()` → `kind: text('kind')` (nullable). Both `check()` calls **unchanged**; `activity_type_id` stays nullable in Drizzle (NOT NULL is a hand-added CHECK). Comments updated: kind relaxed at V1-1c, columns/CHECKs dropped at V1-1d. |
| `packages/db/migrations/0003_slow_mandarin.sql` | NEW      | Generated `ALTER … DROP NOT NULL` on `kind` + hand-added `SET` timeouts, header, and `activity_type_id` NOT-NULL CHECK (`NOT VALID` → `VALIDATE`).                                                                                                             |
| `packages/db/migrations/meta/*`                 | NEW/EDIT | drizzle snapshot `0003` + journal (the drift-guard artifact).                                                                                                                                                                                                  |
| `packages/db/scripts/verify.ts`                 | EDIT     | Add the V1-1c assertions (kind-less check-in inserts; discriminant guard rejects a no-activity row by name); reproduce the V1-1b backfill-sim under deploy-order (relax→backfill→re-add the invariant); fix a stale "dropped at V1-1c" comment → V1-1d.        |
| `docs/plans/v1-1-generalize-schema.md`          | EDIT     | This section + phase-table (V1-1c = relaxation, V1-1d = drops) + review-response log.                                                                                                                                                                          |
| `docs/plan.md`, `docs/status.md`                | EDIT     | Backlog row a/b/c → a/b/c/d; status where-we-are + changelog.                                                                                                                                                                                                  |

### Migration `0003` (hand-added shape)

```sql
SET lock_timeout = '5s';
SET statement_timeout = '60s';
ALTER TABLE "entries" ALTER COLUMN "kind" DROP NOT NULL;              -- generated
ALTER TABLE "entries" ADD CONSTRAINT "entries_activity_type_id_not_null"
  CHECK ("activity_type_id" IS NOT NULL) NOT VALID;                   -- hand-added (mirrors household_id)
ALTER TABLE "entries" VALIDATE CONSTRAINT "entries_activity_type_id_not_null";
```

`VALIDATE` succeeds because V1-1b backfilled `activity_type_id` on every row. Backward-compatible
(nothing removed) → safe to race the concurrent Vercel deploy (expand-before-deploy ordering).

## Test plan

- `pnpm --filter @mat-plan/db db:verify` — PGlite applies `0000`–`0003`; the new V1-1c assertions pass
  alongside the retained V1-1a/b/2 ones.
- `pnpm --filter @mat-plan/db db:generate` — drift guard: clean tree.
- Root gates: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm format:check` (+ `next build` in CI).
- **Real-PG gate:** the CI `e2e` job runs `db:migrate` against a real Postgres — so **do NOT apply the
  `ci-skip-e2e` label** on this PR (that would skip the one real-DB apply of this migration).

## Risks / rollback

- **`entries_shape_check` is NOT fully NULL-permissive (3-valued-logic subtlety).** A `kind=NULL` row
  passes the retained `entries_shape_check` **only when `value_num` is populated** — a NULL `value_num`
  makes the sub-predicate `value_num is not null` **FALSE** (not NULL), forcing both OR-branches FALSE
  and the whole CHECK FALSE (→ reject). So the relaxation unblocks metric-only entries **because every
  seeded metric is numeric** (bool/count/duration/scale_10/number → stored in `value_num`; V1-1b's own
  boolean row used `value_num='1'`) — a real metric entry always carries `value_num`. **Latent gap:** a
  future `value_type='text'` metric (reading in `value_text`, `value_num` NULL) with `kind` NULL would
  still be blocked by `entries_shape_check` until **V1-1d** drops it. No such metric is seeded today; a
  downstream note is filed. (This corrects the draft's over-broad "Postgres CHECKs pass on NULL".)
- **Drift guard vs the hand-edited `.sql`.** → The `activity_type_id` CHECK is hand-added **after** the
  generated statement and is absent from `schema.ts`/the snapshot (same pattern as `household_id`), so
  `generate` stays clean (proven).
- **Rollback** = fix-forward (relaxing a constraint is reversible by re-tightening only if no kind-less
  row exists yet; V1-1c ships before any kind-less writer, so re-adding `NOT NULL` is safe until V1-5).

## Out-of-scope / deferred (V1-1c)

- The physical `DROP COLUMN kind` / `movement_name` and dropping `entries_kind_check` /
  `entries_shape_check` — **V1-1d** (destructive contract; Squawk-wired, 2-deploy split, Neon RESTORE
  branch), after V1-5–V1-8 take the app off `kind`.
- Any DAL / form / `EntryDTO` / `entry-label.ts` change — the dual-writer keeps writing `kind`; the
  kind-less writer arrives with the check-in/habit UI (V1-5).
- Making `entries_shape_check` tolerate `value_text`-only metric readings — folded into V1-1d's drop.

## Review-response log (adversarial panel)

Per critique: lens → **accepted** (what changed) or **rejected** (why). This section reconciles the
panel that hardened the reconciled scope; the draft was wrong on two points (keep-the-CHECKs,
add-activity_type_id) and those are now baked in.

- **Correctness / data-integrity — "don't drop the CHECKs; the only blocker is `kind NOT NULL`."**
  **Accepted.** Postgres CHECKs are NULL-permissive, so `entries_kind_check` (`kind in (…)`) already
  passes on a `kind=NULL` row, and the CHECKs still guard the live `kind` dual-writer — dropping them
  is unnecessary and unsafe here. Only `kind DROP NOT NULL` is required to unblock. **Correction logged
  under Risks:** `entries_shape_check` is only NULL-permissive when `value_num` is set (3VL: a FALSE
  sub-predicate ≠ NULL) — true for every seeded (numeric) metric, so the relaxation achieves the goal;
  the `value_text`-only case is a documented latent gap deferred to V1-1d. The `db:verify` check-in
  fixture therefore carries `value_num` (as a real bool reading does), not the draft's `value_num:null`.
- **Correctness / data-integrity — "a row must still identify its activity."** **Accepted.** Added
  `activity_type_id IS NOT NULL` as `CHECK … NOT VALID → VALIDATE` (mirrors `household_id`), keeping the
  Drizzle column nullable so the snapshot stays simple. V1-1b backfilled it on all rows → `VALIDATE`
  clean. `db:verify` asserts a no-`activity_type_id` row is rejected **by name**
  (`entries_activity_type_id_not_null`), not incidentally by another CHECK.
- **Simplicity / scope — "no phantom V1-1d; if you defer the drop, schedule it."** **Accepted.** Added
  a real **V1-1d** phase row + backlog note; V1-1c is scoped to metadata-only (no `DROP COLUMN`).
- **Correctness — "verify.ts must prove the relaxation, not just assert schema."** **Accepted.** Added
  the positive round-trip (kind-less check-in) + the constraint-name-precise rejection; kept the
  existing `entries_value_source_check` both-set rejection and the `entries_shape_check`
  bodyweight-missing-`value_num` rejection (both still valid — the shape CHECK is retained).
- **DB-safety — "what's the real-PG gate?"** **Accepted.** The CI `e2e` job's `db:migrate` applies this
  migration on real Postgres; the PR forbids the `ci-skip-e2e` label so that apply can't be skipped.
- **Architecture — "boolean activities (rice_bucket/brain_rep/splits/wake) mislabel as Strength
  downstream."** **Accepted as downstream.** The read-path label seam (`entry-label.ts`, V1-4) still
  infers from `kind`; kind-less rows need a metric/activity-driven label. Filed as a note for V1-5/V1-7
  — out of scope for this metadata-only migration.
