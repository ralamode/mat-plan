# V1-6b — calisthenics ramp targets + weekly adherence

> Backlog: [plan.md](../plan.md) row V1-6b (V1-6 split → V1-6a / V1-6b). Branches:
> `db/v1-6b-1-ramp-target` (this) + `feat/v1-6b-2-adherence-ui` (follow-up).

> **Scope decision up front (read this first).** V1-6b delivers "adherence computed" — actual WEEKLY
> performance vs a ramp target, in **SQL** (the deliberate contrast with V1-6a's daily _in-memory_
> totals). It is **split into two PRs at a clean seam**, matching the V1-1 a/b/c and V1-6 a/b
> precedents and the AGENTS.md <400-line / one-concern target:
>
> - **V1-6b-1 (this plan):** the `ramp_targets` **table + migration `0004` + seed mechanism + a
>   `db:verify` proof** that weekly SQL adherence matches the `foldAggregation` golden vectors.
>   **ZERO app code** — no DAL, no UI. A **significant migration PR** (the highest-rigor class): full
>   DB-safety rigor, drift guard, expand-only. Ships the ramp schedule **EMPTY** (`[]`).
> - **V1-6b-2 (follow-up, thin):** the read **DAL** + the `<progress>` **UI** + mobile/tablet/desktop
>   screenshots. Reuses the exact adherence SQL this PR pins in `db:verify`.
>
> **Acceptance accounting (fixed).** The backlog clause "adherence computed" is satisfied by b-1 **and**
> b-2 **together** and **closes at b-2**. b-1 delivers the table + seed mechanism + the SQL-adherence
> **proof**; it does **NOT** mark the `plan.md` V1-6b row done. b-2 flips it.

## Goal

Give the app a place to hold, per profile and per week, the calisthenics rep/level a kid is ramping
toward, so weekly adherence (actual vs target) is computable in **SQL** — the shape spec.md §4 names
("modeled as **target rows** so it is computable in SQL"). V1-6b-1 stands up that table (`ramp_targets`)
with the correct constraints + covering indexes + a partial natural-key UNIQUE, wires an **idempotent
seed mechanism** that expands a per-kid weekly ramp schedule into rows, and **proves the adherence math
in `db:verify`**: the same SUM/MAX rollup the future DAL will run, pinned against the shared
`foldAggregation` golden vectors so SQL and TS can't diverge. It ships **no app code** and an **empty
ramp schedule**, so nothing fictional lands in prod — only the mechanism and its proof.

## Acceptance

- **Backlog criterion (plan.md V1-6 / V1-6b), verbatim:** _"Adherence computed vs weekly targets."_
  - **V1-6b-1 delivers:** the table + seed mechanism + the SQL-adherence **proof**. The criterion
    **closes at V1-6b-2** (the DAL + UI). b-1 does **not** mark the row done.
- Done when (V1-6b-1):
  - `ramp_targets` exists (schema + migration `0004`): `id bigint identity PK`, `public_id uuid UNIQUE`,
    `profile_id → profiles(id)`, `metric_key → metric_definitions(key)`, `week_start date`,
    `target_value numeric(8,3)`, `...timestamps`; covering index on each FK; partial natural-key UNIQUE
    `(profile_id, metric_key, week_start) WHERE deleted_at IS NULL`; CHECK `target_value >= 0`. Mirrors
    `day_readiness`. **No `client_id`** (config data; idempotency = the natural key).
  - Migration `0004` carries the `SET lock_timeout='5s'` / `SET statement_timeout='60s'` preamble; the
    table is net-new + empty so every statement is clean by construction (no NOT VALID/VALIDATE, no
    backfill, no destructive op).
  - `CALISTHENICS_RAMP_SCHEDULE` ships **`[]`** (empty); its metric domain is **derived** from
    `CALISTHENICS_METRIC_KEYS` (single source in `activity-metric-map.ts`), not re-listed.
  - The seed expands `schedule × kid profiles × metric keys` → `ramp_targets`, `onConflictDoNothing`
    on the partial natural key (0 rows under `[]`, but the mechanism is present + correct).
  - `db:verify` proves: weekly SQL adherence `SUM(pushups)=50=foldAggregation('sum',[20,30])` and
    `MAX(vsit_skill_step)=5=foldAggregation('max',[3,5,4])`; decoys (next-week / skipped / soft-deleted)
    excluded; the ramp_target ⋈ entries join returns the seeded target; the 4 constraint rejections;
    every calisthenics metric aggregates by sum or max; empty schedule seeds 0 rows (idempotent).
  - The drift guard is clean: `db:generate` after committing leaves the tree untouched.
  - All gates green (typecheck · lint · prettier · vitest · `db:verify` · `next build`).

## Migration `0004` — expand-only, clean by construction

`CREATE TABLE ramp_targets` with inline FKs, indexes, partial UNIQUE, and the CHECK. On a **net-new
empty table** every statement is safe: no `NOT VALID → VALIDATE` dance (there are no rows to validate),
no backfill, no volatile default, no destructive op. Each ref column (`profile_id`, `metric_key`) gets
a covering index. The 2-line `SET lock_timeout` / `SET statement_timeout` preamble is hand-prepended
after `db:generate` (drizzle-kit never rewrites an existing migration file, so this is drift-safe).

**Squawk stays deferred (NOT wired in this PR).** Two reasons: (1) it contradicts a locked V1-1a
decision to defer Squawk + the Neon-branch gate **together**; (2) the "clean by construction" claim only
holds under `--assume-in-transaction` anyway (drizzle-kit migrate wraps each file in a transaction, but
Squawk doesn't know that without the flag), so a naive Squawk run would false-positive on the
un-CONCURRENTLY indexes. Correct move: leave the whole DB-CI gate (Squawk + Neon branch) deferred as
already decided, not bolt on a half-configured linter here. A **concurrent-index runner is also NOT
built** — unneeded for a new table (CONCURRENTLY matters for indexing a populated table).

## File-by-file changes (V1-6b-1)

| Path                                                       | Change | What & why                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/activity-metric-map.ts`               | EDIT   | Hoist `CALISTHENICS_METRIC_KEYS` (the 4-key tuple) to a named `as const`; `ACTIVITY_METRIC_MAP.calisthenics` now **consumes** it. Kills the constants-rule duplication. Adds `CalisthenicsMetricKey`.                 |
| `packages/shared/src/ramp-schedule.ts`                     | NEW    | `RampWeek` type (targets keyed by the derived metric set), `CalisthenicsRampMetricKey`, and `CALISTHENICS_RAMP_SCHEDULE = []`. Per-profile CONFIG (not catalog) → `ramp-schedule.ts`, not `catalog-ramp.ts`. No zod.  |
| `packages/shared/src/index.ts`                             | EDIT   | Barrel-export `ramp-schedule`.                                                                                                                                                                                        |
| `packages/db/src/schema.ts`                                | EDIT   | Add `rampTargets` table, mirroring `day_readiness` (FK covering indexes + partial natural-key UNIQUE + CHECK).                                                                                                        |
| `packages/db/src/types.ts`                                 | EDIT   | `RampTargetRow` / `NewRampTarget` (convention: a row + insert type per table).                                                                                                                                        |
| `packages/db/migrations/0004_parched_tomas.sql`            | NEW    | Generated `CREATE TABLE` + FKs + indexes + UNIQUE + CHECK, hand-prepended with the lock/statement-timeout preamble. Plus `meta/0004_snapshot.json` + `_journal.json` entry.                                           |
| `packages/db/src/seed.ts`                                  | EDIT   | Expand `CALISTHENICS_RAMP_SCHEDULE × kid profiles × CALISTHENICS_METRIC_KEYS` → `ramp_targets`; `onConflictDoNothing` on the partial natural key. Filter to `kind='kid'`. Empty-array guard (Drizzle rejects `[]`).   |
| `packages/db/scripts/verify.ts`                            | EDIT   | Extract `expectRejectedBy(constraint, fn)`, **refactor the 2 existing inline copies** onto it, then the ramp_targets proof: golden-vector parity, decoy exclusion, ⋈ target, 4 rejections, sum/max guard, 0-row seed. |
| `docs/decisions/0002-calisthenics-ramp-targets.md`         | NEW    | ADR: `ramp_target` vs `goal` / `prescription_target` / `ladder`; the load-axis future.                                                                                                                                |
| `docs/plans/v1-6b-calisthenics-ramp.md`                    | NEW    | This plan.                                                                                                                                                                                                            |
| `docs/plan.md` · `docs/status.md` · `docs/architecture.md` | EDIT   | plan.md V1-6b row → link this plan (NOT done); status pointer + changelog; add `ramp_targets` to the §4 ERD.                                                                                                          |

### The ramp schedule const — shipped EMPTY (`packages/shared/src/ramp-schedule.ts`)

```ts
export type CalisthenicsRampMetricKey = CalisthenicsMetricKey; // derived, not re-listed
export type RampWeek = { weekStart: string; targets: Record<CalisthenicsRampMetricKey, number> };
export const CALISTHENICS_RAMP_SCHEDULE: readonly RampWeek[] = []; // EMPTY — see below
```

Ship `[]`, not placeholder numbers. The real ramp is Ray's domain data — a fixed weekly calendar that
ramps to a **cap**, coach-adjustable — and lands in a later **data-only** follow-up. `migrate.yml` seeds
on merge, and the seed's `onConflictDoNothing` on the natural key would make any placeholder rows
**permanently sticky** (a re-seed with real numbers would be a no-op, not an update). `[]` avoids writing
fiction to prod while still delivering the mechanism. `targets` is a **total** `Record` over the derived
metric keys, so the schedule stays complete-by-compilation as the metric set evolves. **No runtime zod
schema** — `db:verify` doesn't preflight-parse the (empty) schedule, so a zod validator would be dead
ceremony (simplicity lens); the compile-time `Record` type is the guard.

### Seed mechanism (`packages/db/src/seed.ts`)

Filter profiles to **kids** (`kind='kid'` — config data is per-kid, never "all profiles"), fan out
`schedule × kids × CALISTHENICS_METRIC_KEYS`, write `String(target)` for the numeric column, and
`onConflictDoNothing({ target: [profileId, metricKey, weekStart], where: isNull(deletedAt) })` — the
**partial-index arbiter** repeats the `WHERE deleted_at IS NULL` predicate (the V1-5 lesson). Under `[]`
this produces zero rows; a `rampTargetRows.length > 0` guard skips the insert (Drizzle rejects an empty
VALUES list).

### `db:verify` — the headline proof

1. **Reuse extraction first.** `expectRejectedBy(constraintName, fn)` asserts `fn` rejects with
   `cause.constraint === constraintName`. The **two existing inline copies** (V1-1c's activity_type_id
   guard, V1-5's shape-CHECK trap) are refactored onto it — a code-reuse fix, one idiom.
2. **Golden-vector parity (headline).** Seed a TEST profile + a TEST-ONLY week (`2026-01-05`, a Monday,
   not in the empty schedule → can't collide). Insert calisthenics `done` bouts: pushups `20, 30`;
   vsit_skill_step `3, 5, 4`. Plus **decoys** that must be excluded: a next-week bout, a `skipped` bout,
   a soft-deleted bout. Run the adherence aggregate (Drizzle `sum()`/`max()` grouped by metric, filtered
   `activity=calisthenics`, `status='done'`, `deleted_at IS NULL`, `week_start <= activity_date <
week_start+7`) and assert `Number(SUM(pushups)) === 50 === foldAggregation('sum',[20,30])` and
   `Number(MAX(vsit_skill_step)) === 5 === foldAggregation('max',[3,5,4])`; that exactly two metric
   groups appear (decoys excluded); and that the `ramp_target ⋈ entries` join returns the seeded target
   (45) alongside the actual (50).
3. **4 constraint rejections** via the helper: natural-key UNIQUE (dup profile/metric/week);
   `metric_key` FK (bad key); `profile_id` FK (missing profile); `target_value` CHECK (`-1`).
4. **Guard the sum/max assumption:** every calisthenics metric's `aggregation ∈ {sum, max}` (a future
   `avg`/`last` calisthenics metric would silently break the weekly rollup).
5. **Seed idempotency:** the empty schedule seeds **0** ramp_targets after the existing seed-twice run.

## Test plan

`pnpm --filter @mat-plan/db db:verify` (PGlite harness) is the proof surface — it applies migration
`0004`, seeds twice, and runs the ramp_targets block above. No new Vitest (the shared `foldAggregation`
golden vectors already exist under `apps/web`; b-1 pins the **SQL** side against them). Drift guard:
`pnpm --filter @mat-plan/db db:generate` then `git diff --exit-code packages/db/migrations` (clean).
Full gate: `pnpm typecheck && pnpm lint && pnpm --filter web test && npx prettier --check . &&
pnpm --filter @mat-plan/db db:verify && pnpm build`.

## Risks / rollback

| Risk                                                                                | Mitigation                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placeholder ramp numbers would get stuck in prod via `onConflictDoNothing`          | Ship the schedule **`[]`**; the real numbers land in a data-only follow-up (reversible by omission — no rows to un-stick).                                  |
| A future `avg`/`last` calisthenics metric silently breaks the weekly SUM/MAX rollup | `db:verify` asserts every calisthenics metric aggregates by sum or max — adding an `avg`/`last` one fails the gate until the rollup is taught to handle it. |
| SQL adherence drifts from the TS `foldAggregation` kernel                           | `db:verify` pins the SQL SUM/MAX against the exact `foldAggregation` golden vectors — divergence fails the gate.                                            |
| Hand-editing the generated migration causes drift                                   | The preamble is prepended AFTER generate; a second generate produces "nothing to migrate" and the drift guard is clean (verified).                          |
| Partial-UNIQUE arbiter mismatch (the V1-5 trap)                                     | The seed's ON CONFLICT repeats `WHERE deleted_at IS NULL`; `db:verify` asserts the natural-key UNIQUE rejection by name.                                    |

**Rollback:** revert the PR. The migration is expand-only (a new empty table) — reversible by omission;
no data transform, no destructive step.

## Out-of-scope / deferred → **V1-6b-2** (the thin follow-up)

V1-6b-2 is the read DAL + UI. Specified here so it's a thin, mechanical follow-up:

- **Read DAL** (`lib/dal/*`, `server-only`): one function that runs the adherence SQL this PR pinned —
  per (profile, ISO week), `SUM`/`MAX` of actual calisthenics `entries` (`status='done'`, not deleted,
  in `[week_start, week_start+7)`) **joined** to `ramp_targets`, returning a minimal DTO
  `{ metricKey, label, actual, target }`. Returns `[]` gracefully while the schedule is empty (no
  targets → no rows).
- **UI:** a per-metric `<progress value={actual} max={target}>` block on `/p/[profileId]` (semantic,
  a11y-labelled), rendering only metrics that have a target for the week. **Screenshots at three widths**
  (mobile ~390 / tablet ~820 / desktop ~1280) per the AGENTS.md UI rule.
- **Reuse obligations (call them out in the b-2 plan):**
  - **Profile scope:** extract a shared profile-scoping helper for the DAL query, **or** explicitly defer
    to the v1.5 household-scope work — do not hand-roll a third scoping path.
  - **`pickAggregate`:** a shared helper that maps a metric's `aggregation` → the SQL aggregate (`sum` →
    `SUM`, `max` → `MAX`), so the DAL selects the right column per metric instead of hard-coding two
    branches — the SQL-side twin of `foldAggregation`. b-1 already guards `aggregation ∈ {sum,max}`.
  - **DTO / `toAdherence` mapper:** the row → DTO shaping the DAL returns.
- Also deferred: the **data-only** PR that fills `CALISTHENICS_RAMP_SCHEDULE` with the real coach
  calendar; the **load axis** (`target_load`) for weighted calisthenics / max-strength (ADR 0002); any
  V2 progression-engine ladder.

## Open questions

_(none — resolved in the reconciled design below.)_

## Review-response log (adversarial panel)

Five-lens panel (correctness/data-integrity · simplicity/scope · architecture/consistency · DB-safety ·
product) reviewed the V1-6b plan before implementation. Reconciled resolutions:

| #   | Lens                      | Critique                                                                                                                                                                                             | Resolution                                                                                                                                                                                            |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Simplicity; Product       | Seeding placeholder ramp numbers writes fiction to prod, and `onConflictDoNothing` makes it permanently sticky.                                                                                      | **Accepted.** Ship `CALISTHENICS_RAMP_SCHEDULE = []`; real numbers land in a later data-only PR. The seed mechanism is present + correct; it just expands zero rows today.                            |
| 2   | DB-safety; Architecture   | Wiring Squawk into CI here contradicts the locked V1-1a "defer Squawk + Neon together" decision.                                                                                                     | **Accepted (drop Squawk).** Left deferred. Also corrected the plan's "clean by construction" claim: it only holds under `--assume-in-transaction`, hence deferral is the right call.                  |
| 3   | Correctness               | The proposed verify test seeded a ramp_target on a week **inside** the schedule → self-colliding / order-dependent.                                                                                  | **Accepted.** The verify fixture uses a clearly TEST-ONLY out-of-schedule week (`2026-01-05`); with the empty schedule it cannot collide, and it's self-contained.                                    |
| 4   | Architecture (constants)  | Re-listing the 4 calisthenics metric keys in the ramp schedule duplicates `ACTIVITY_METRIC_MAP.calisthenics`.                                                                                        | **Accepted.** Hoisted `CALISTHENICS_METRIC_KEYS` to a named `as const`; the map consumes it and `ramp-schedule.ts` derives from it. One source. (V1-2 coverage test still green.)                     |
| 5   | Architecture (code reuse) | `verify.ts` has two copy-pasted inline constraint-rejection idioms; the new PR would add four more.                                                                                                  | **Accepted.** Extracted `expectRejectedBy(constraint, fn)`; refactored the two existing copies onto it; the four new rejections reuse it.                                                             |
| 6   | Architecture (naming)     | Is this a `goal`, `prescription_target`, or `ladder`? Wrong choice boxes in the V2 progression engine.                                                                                               | **Accepted → ADR 0002.** `ramp_target` (coach-authored weekly calendar), distinct from lifetime `goal`, prescription-bound `prescription_target`, and engine-computed `ladder`.                       |
| 7   | Correctness               | The weekly rollup only computes SUM/MAX; a future `avg`/`last` calisthenics metric would break it silently.                                                                                          | **Accepted.** `db:verify` asserts every calisthenics metric's `aggregation ∈ {sum,max}` — adding an `avg`/`last` one fails the gate.                                                                  |
| 8   | Correctness               | Date-range + numeric-string handling in the adherence SQL is easy to get subtly wrong.                                                                                                               | **Accepted.** `week_start <= activity_date < week_start+7` (`date + int`), `date_trunc`-free where possible; numeric strings `Number()`-coerced before comparison. No assertion on Postgres builtins. |
| 9   | Correctness; Product      | Seeding ramp targets for **all** profiles would give adult/non-calisthenics profiles bogus targets.                                                                                                  | **Accepted.** The seed filters to `kind='kid'`.                                                                                                                                                       |
| 10  | Simplicity; Architecture  | DTO / `toAdherence` mapper / a profile-scope helper / a `pickAggregate` are needed — build them now?                                                                                                 | **Deferred to b-2 (rejected for b-1).** b-1 is DB-only (table + seed + proof); those are read-DAL concerns. The b-2 spec above names them as explicit reuse obligations.                              |
| 11  | DB-safety                 | Build a concurrent-index runner for the new indexes?                                                                                                                                                 | **Rejected.** Unneeded for a net-new empty table (CONCURRENTLY matters when indexing a populated table). Inline indexes are correct here.                                                             |
| 12  | Correctness               | Verified sound, no fix: partial-UNIQUE arbiter repeats its predicate; `String(target)` numeric write; `public_id` UUIDv7; every ref column has a covering index; expand-only reversible-by-omission. | **No change** — recorded so the reviewer knows these were checked and cleared.                                                                                                                        |
