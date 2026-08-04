# mat-plan — Status

Living progress tracker toward the **MVP = end of v1** (kids log a full day online + CSV export keeps
the Claude workflow alive). Updated as each PR merges. Roadmap detail in [plan.md](./plan.md).

**Last updated:** 2026-07-30

## Where we are right now

📍 **v1 (the MVP) — mid-build. The data foundation + core logging surfaces are in; the weekly-ramp
data layer just landed.** The MVP finish line is: **kids log a full day online + CSV export keeps the
Claude workflow alive.**

**Merged & live** — the generalized data model (V1-1a/b/c), full seed catalog (V1-2), per-kid Today
via profile tiles (V1-3), bodyweight/measurements (V1-4), habits + brush-teeth check-ins (V1-5),
calisthenics inputs + daily accumulate totals (V1-6a, #42), the **`ramp_targets` table + weekly
SQL-adherence proof** (V1-6b-1, #48 — DB layer only; ADR 0002 = `ramp_target`, a coach-authored fixed
weekly calendar, not the future progression engine; ships the schedule empty, real coach numbers are a
later data-only PR), **timezone / local-calendar-date correctness** (V1-6c, #50 — "today" follows the
active IANA local calendar date via a `tz` cookie + `localDayIso`, not UTC; all three writers thread the
rendered day; instants stay UTC), and the **calisthenics ramp "This week" adherence UI** (V1-6b-2, #51 —
read DAL + `<progress>`; the adherence query single-sourced in `packages/db` and run by both the DAL and
`db:verify`; **"adherence computed" closed**), and the two **one-tap "Life" activities** (V1-7, #52 — wake
= a `timing` event with local minutes in `value_num` rendered tz-free; wrestling practice = one-tap
`practice_minutes`; the generality proof — no migration, reuses the V1-5 write path).

**Merged (#53)** — **V1-8-1**: the **`supersets` table + `entries.superset_id`/`superset_order`** (migration
`0005`) + a `db:verify` proof — the data model for **strength sessions with supersets**, built to carry
**arbitrary N-movement adult PPL pairings** (spec §4; v2 reuses it — no kids-only shortcut). **DB-only**.
Hardened by the **5-lens panel incl. DB-safety** (R1–R12: added `uq_entries_superset_order` + a
member-is-movement CHECK, cut `supersets.position`, same-session = writer invariant, decoupled from V1-1d)
and a code-review round. ADR 0003 captures the model.

**Merged (#54)** — **V1-8-2**: the **flat multi-movement strength SESSION write path** — one submission logs a
`sessions` row grouping N movement entries (each its own `entry` → `entry_set`), rendered **flat**. The strength
write core is **single-sourced in `packages/db`** (`writeStrengthSession`, the `weeklyAdherenceRows` pattern) so
the app DAL and `db:verify` run the identical insert path; reads switched the set-fetch dispatch to `movement_id`
(decoupling from the V1-1d `kind` drop); the single-movement path was retired. Hardened by a **4-lens panel** +
a code-review round (10 findings — fixed a reversed-order + a silent-drop path, relocated the single-source
obligation). See [v1-8-2-session-write-path.md](./plans/v1-8-2-session-write-path.md).

**Merged (#55)** — **V1-8-3a**: **session read grouping** — a logged strength session reads as one grouped
**block** (a `SESSION_TYPE_LABELS` header + movement count, movements nested in insertion order) instead of N
loose rows. Pure read change (a `sessions` LEFT JOIN + `sessionId`/`sessionType` on `EntryDTO`, a
`{kind:'session'}` grouping variant + a shared `<MovementLine>`), hardened by a 4-lens panel + a code-review
round. See [v1-8-3-session-grouping-and-supersets.md](./plans/v1-8-3-session-grouping-and-supersets.md).

**Merged (#56, #59)** — **V1-8-3b/3c/3d — V1-8 COMPLETE**: session **feel** (#56), then the superset **write
core** + **UI/read bracketing** (#59 — landed 3c+3d in one commit after a stacked-base merge slip). Supersets
now work end-to-end: tick "Superset" on 2+ movement cards → "Group as superset" → they log as a group and read
as a labeled **SUPERSET** bracket on the day's log (in alternating order). Same interaction for the kids' light
superset and Ray's v2 PPL pairings. See [v1-8-3-remainder-feel-and-supersets.md](./plans/v1-8-3-remainder-feel-and-supersets.md).

**In flight** — **V1-10 PR 2**: **the day's program on Today** — the payoff of the programming data. On a
strength day a **read-only "Today's program" card** renders above the **UNCHANGED** strength form: that
`day_role`'s movements in the coach's `idx` order, with each kid's `sets × target_reps · load` **verbatim**
(Liam's "BW" vs Scarlett's "BW +5-10"). The weekday → `day_role` map (Mon/Wed/Fri → Strength A/B/C) is a
documented app-config **stopgap** (tech-debt; Clerk/multi-household is the promotion trigger). The query
(`programDayRows`) is single-sourced in `packages/db` and `db:verify`-proven — `idx` order, per-kid loads, a
target-less kid → NULL load (never the sibling's), **BOLA** (another household's profile gets nothing), and a
two-block household resolving deterministically to one. Pure app code, **no migration**; the strength form is
byte-untouched. The panel unanimously **rejected the planned editable prefill** — ~90% of the authored loads
are text a numeric field can't hold, and pre-filling the `required` weight field would let a PRESCRIBED load
log as a PERFORMED one without a human typing it. See [v1-10-2-strength-prefill.md](./plans/v1-10-2-strength-prefill.md).

**Merged (#67)** — **V1-10 PR 1b**: **programming — seed Ray's real block** — the DATA PR that lit up the
(empty) programming tables. Seeds the **Kids S&C Foundation** block: 3 strength days (A/B/C), 21 prescriptions,
per-kid loads (+ per-kid reps where the kids differ) — all transcribed VERBATIM from Ray's 2-week program doc
(the LLM authors no loads). Migration `0008` adds `prescription_targets.reps` (per-kid override) + widens the
`day_role` CHECK for `strength_c`; 8 new catalog movements. Shipped dark — PR 2 is the surface. Opens backlog:
conditioning-day model, RIR/RPE-per-set logging, a prescription cue field.
See [v1-10-1b-seed-real-program.md](./plans/v1-10-1b-seed-real-program.md).

**Merged (#66)** — **V1-10 PR 1**: **programming — data model** — three net-new tables `program_blocks → prescriptions → prescription_targets` (spec.md §4), migration `0007`, shared seed-row schemas + a dedicated `DAY_ROLES` enum, an empty seed mechanism + a `db:verify` proof driving a test-only fixture through the real `seedProgram` resolver. DB-only, ships dark.

**Merged (#65)** — **V1-18 PR 2**: **per-kid routine builder — coach editor** — a parent-facing `/p/[profileId]/routine` screen to AUTHOR a kid's routine: a checklist of the catalog activities + ▲▼ reorder + Save. One hidden JSON field → `editRoutineAction` → a strict `validateRoutineForWrite` (rejects empty / non-catalog / duplicate, reusing `resolveRoutine`'s rule) → a DAL-local `updateProfileRoutine`. Weigh-in stays pinned (a caption); URL-only entry. **PR 3 (check-in allowlist) folded in** — unchecking a `checkin:*` key IS the allowlist. Copy-from-kid deferred. See [v1-18-2-routine-editor.md](./plans/v1-18-2-routine-editor.md).

**Merged (#63, #64)** — **V1-18 PR 1a + 1b**: **per-kid routine builder — data + render** — the nullable `routine_config` JSONB column + shared `routineConfigSchema` + A≠B seed (1a, #63), then Today renders each kid's OWN routine order (`profile.routine`, resolved by the DAL), reusing the existing forms via a contiguous-run collapse (1b, #64). Weigh-in pinned first; a NULL config = today's exact order (ships dark). Seeded Scarlett shows the reorder/split/life-subset; Liam (default) is byte-stable.

**Merged (#62)** — **V1-17**: **performed-order log** — the day's "Logged entries" list reads oldest-first
(`listEntriesForDay` → `asc(created_at), asc(id)`) so it flows top-down in the order things were done (wake →
bodyweight → rice bucket). Pure read change, no migration; the fold keeps its newest-first contract via a
call-site reverse. See [v1-17-performed-order.md](./plans/v1-17-performed-order.md).

**Merged (#60)** — **V1-9**: **fix-a-set / edit UX** — a mistyped **reps/weight** on a logged strength set gets an
inline **Edit** affordance (numeric sets only; labeled/null sets stay read-only) → corrects in place → Today
reflects the fix. Ownership-scoped UPDATE single-sourced in `packages/db` (proven by `db:verify`), LWW on
`updated_at` (server-`now()`; client-ts compare is v1.5 — see tech-debt), and a shared `SetRepsWeightFields` +
hoisted `INPUT_CLASS` so the edit inputs reuse the log form's exactly. See [v1-9-edit-set.md](./plans/v1-9-edit-set.md).

**Remaining to the MVP:** V1-10 (programming; PR 2 in flight) → V1-11/12 (copy-set · a11y) →
**V1-13 CSV export** (the MVP's whole point) → **V1-14** (full-day E2E + rate-limit/Sentry) = MVP done.
_(Backlogged alongside: **V1-9a** per-exercise notes, **V1-9b** delete/clear-day.)_ _(Interleaved: **V1-7a** practice-minutes input, **V1-8a** weighted
calisthenics / max-strength.)_

**Newly brainstormed (post-MVP, backlogged):** **V1-15 day navigation** (page back through previous
days, read-only history; then a week-dot strip, then a month calendar) and **V1-16 progress dashboard**
(range views + restrained Recharts, a series = `foldAggregation` per time-bucket) — 3-lens synthesis in
[day-navigation-and-dashboard-brainstorm.md](./plans/day-navigation-and-dashboard-brainstorm.md).
V1-15 depends on V1-6c's tz-aware "today."

**DX / infra landed alongside** (not v1 features): the ephemeral + **local sandbox DBs** (`pnpm dev`,
#43/#46), **adaptive tri-viewport screenshots** (#45), and the **adversarial review process** (4
standing lenses — correctness · simplicity · architecture · code-reuse — plus a DB-safety reviewer for
migrations).

## Progress toward MVP (v1)

- **Feature PRs merged:** the full V1-8 strength/superset arc is in (V1-1a/b/c · V1-2 · V1-3 · V1-4 · V1-5 ·
  V1-6a · V1-6b-1 · V1-6c · V1-6b-2 · V1-7 · V1-8-1 · V1-8-2 · V1-8-3a/3b/3c/3d). Data foundation + strength
  logging complete; the back third is editing (V1-9), and — critically — **CSV export (V1-13)** + hardening (V1-14).
- **Phase:** v0 ✅ complete → v1 🔵 in progress. In flight: **V1-10 PR 2** (program card) → **V1-12** (a11y, enforced). **V1-11 deferred past the MVP** by its panel ([why](./plans/v1-11-copy-movement-to-sibling.md)).

## Phases

| Phase     | Goal                                                                     | Status         |
| --------- | ------------------------------------------------------------------------ | -------------- |
| Bootstrap | Repo + planning docs                                                     | ✅ done        |
| **v0**    | Thin vertical slice (one feature UI→ServerAction→Drizzle→Neon, CI-gated) | ✅ done        |
| **v1**    | Online kids logger (all data types, CSV export) — **MVP**                | 🔵 in review   |
| AI-1      | NL logging via structured outputs + eval                                 | ⚪ not started |
| v1.5      | Offline PWA + sync + Clerk auth                                          | ⚪ not started |
| v2        | Ray's PPL + progression engine                                           | ⚪ not started |
| v3        | AI depth + MCP/REST API                                                  | ⚪ not started |

Legend: ⚪ not started · 🔵 in review · 🟡 in progress · ✅ done

## v0 backlog (13 PRs)

| PR    | Scope                                                       | Status  |
| ----- | ----------------------------------------------------------- | ------- |
| V0-1  | pnpm workspace + Next.js scaffold + AGENTS pointers + hooks | ✅ done |
| V0-1b | shadcn/ui + design tokens + DESIGN.md                       | ✅ done |
| V0-2  | GH Actions CI + branch protection                           | ✅ done |
| V0-3  | Vercel connect + preview deploys                            | ✅ done |
| V0-4  | env validation + access-gate + security headers             | ✅ done |
| V0-5  | Neon + Drizzle + first migration + DAL skeleton             | ✅ done |
| V0-6  | migrate-on-deploy (GH Actions single migrator)              | ✅ done |
| V0-7  | Today view (RSC via DAL)                                    | ✅ done |
| V0-8  | log bodyweight (Server Action + zod)                        | ✅ done |
| V0-9  | log strength entry (transactional nested write)             | ✅ done |
| V0-10 | loading/empty/error primitives + boundary                   | ✅ done |
| V0-11 | CI Postgres + Playwright smoke                              | ✅ done |
| V0-12 | unit + integration test + DoD                               | ✅ done |

## v1 backlog (14 PRs) — completes the MVP

| PR      | Scope                                                                                                                         | Status |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| V1-1    | generalize schema + forward-migrate (a/b/c/d; a/b/c merged, d deferred)                                                       | ✅     |
| V1-2    | seed catalogs + coverage test ([plan](./plans/v1-2-seed-catalogs.md))                                                         | ✅     |
| V1-3    | profile tiles ([plan](./plans/v1-3-profile-tiles.md))                                                                         | ✅     |
| V1-4    | bodyweight/measurement on generalized model ([plan](./plans/v1-4-weigh-ins.md))                                               | ✅     |
| V1-5    | checkins/habits dynamic form ([plan](./plans/v1-5-checkins-form.md))                                                          | ✅     |
| V1-6a   | calisthenics inputs + daily totals ([plan](./plans/v1-6a-calisthenics-totals.md))                                             | ✅     |
| V1-6b-1 | ramp_targets table + migration + seed + `db:verify` proof ([plan](./plans/v1-6b-calisthenics-ramp.md))                        | ✅     |
| V1-6c   | timezone / local-calendar-date correctness ([plan](./plans/v1-6c-timezone-local-date.md))                                     | ✅     |
| V1-6b-2 | read DAL + `<progress>` adherence UI ([plan](./plans/v1-6b-2-adherence-ui.md))                                                | ✅     |
| V1-7    | life activities (wake/practice) ([plan](./plans/v1-7-life-activities.md))                                                     | ✅     |
| V1-8-1  | supersets table + `db:verify` proof ([plan](./plans/v1-8-strength-sessions.md))                                               | ✅     |
| V1-8-2  | flat strength session write path ([plan](./plans/v1-8-2-session-write-path.md))                                               | ✅     |
| V1-8-3a | session read grouping ([plan](./plans/v1-8-3-session-grouping-and-supersets.md))                                              | ✅     |
| V1-8-3b | session feel ([plan](./plans/v1-8-3-remainder-feel-and-supersets.md))                                                         | ✅     |
| V1-8-3c | superset write core ([plan](./plans/v1-8-3c-superset-write.md))                                                               | ✅     |
| V1-8-3d | superset UI + read bracketing ([plan](./plans/v1-8-3d-superset-ui.md))                                                        | ✅     |
| V1-9    | fix-a-set / edit (LWW) ([plan](./plans/v1-9-edit-set.md))                                                                     | ✅     |
| V1-10   | programming — data model (#66) · real block seeded (#67) · Today's program card ([plan](./plans/v1-10-2-strength-prefill.md)) | 🔵     |
| V1-11   | copy-set-to-other-kid                                                                                                         | ⚪     |
| V1-12   | a11y + tap-target pass, ENFORCED in CI ([plan](./plans/v1-12-a11y-pass.md))                                                   | 🔵     |
| V1-13   | CSV export endpoint (golden-file)                                                                                             | ⚪     |
| V1-14   | full-day E2E + rate-limit/Sentry/Dependabot                                                                                   | ⚪     |

## Changelog (merged PRs)

- **2026-07-23** — **V1-6b-1** (in review): the `ramp_targets` table + migration + seed mechanism +
  a `db:verify` adherence proof ([plan](./plans/v1-6b-calisthenics-ramp.md)). **Significant migration
  PR — DB-only (no DAL, no UI).** Migration `0004` adds `ramp_targets` (per-profile, per-week
  calisthenics TARGET, so weekly adherence is computable in **SQL** — the contrast with V1-6a's daily
  in-memory rollup), mirroring `day_readiness`: FK covering indexes, a partial natural-key UNIQUE
  `(profile_id, metric_key, week_start) WHERE deleted_at IS NULL`, a `target_value >= 0` CHECK, **no
  `client_id`** (config; idempotency = the natural key). Net-new empty table → clean by construction
  (inline FKs/indexes/CHECK, no NOT-VALID/backfill); the lock/statement-timeout preamble is
  hand-prepended (drift guard clean). `CALISTHENICS_RAMP_SCHEDULE` ships **`[]`** (real coach numbers
  are a later data-only PR; `onConflictDoNothing` would make placeholders sticky); its metric domain is
  **derived** from a newly hoisted `CALISTHENICS_METRIC_KEYS` (kills a constants-rule duplication;
  `ACTIVITY_METRIC_MAP.calisthenics` now consumes it, V1-2 coverage test still green). The seed expands
  `schedule × kid profiles × metric keys` (0 rows today, mechanism correct; filtered to `kind='kid'`).
  `db:verify` headline: weekly SQL `SUM(pushups)=50` / `MAX(vsit_skill_step)=5` **match the shared
  `foldAggregation` golden vectors**, decoys (next-week / skipped / soft-deleted) excluded, the
  ramp_target ⋈ entries join returns the target, all four constraint rejections fire, every calisthenics
  metric is guarded `∈ {sum,max}` — with `expectRejectedBy` extracted and the two existing inline copies
  refactored onto it. `ramp_target` vs `goal`/`prescription_target`/`ladder` settled in
  [ADR 0002](./decisions/0002-calisthenics-ramp-targets.md). **Squawk stays deferred** (V1-1a decision;
  "clean by construction" only holds under `--assume-in-transaction`). **V1-6b split** into b-1 (this)
  - b-2 (read DAL + `<progress>` UI); "adherence computed" **closes at b-2** — this PR does not mark the
    row done. Five-lens panel: ship `[]`, drop Squawk, fix the self-colliding verify week, derive the
    metric keys, extract `expectRejectedBy`, guard sum/max — all accepted; DTO/profile-scope/`pickAggregate`
    deferred to b-2.

- **2026-07-23** — **V1-6a** (in review): calisthenics inputs + daily totals
  ([plan](./plans/v1-6a-calisthenics-totals.md)). **No migration** — reuses V1-5's kind-NULL `count`
  write path. Appends `calisthenics` to the check-in registry (4 count inputs); the fields
  **accumulate** (each submit is a bout, a "Calisthenics today" card sums them via the sum/max fold —
  the digital paper-tally), so they stay editable rather than going inert. New shared
  `foldAggregation(aggregation, values)` kernel + golden vectors (the contract V1-6b's SQL adherence
  and V1-13's CSV pivot pin against); `aggregation` added to the `metric_definitions` join +
  `EntryDTO`; a pure `calisthenicsTotals(entries)` read helper. Scoped to calisthenics — V1-5's `shot`
  (also `sum`) is left log-once until the shots/10K-goal work gives it a total. `METRIC_AGGREGATION`
  named map exported. **V1-6 split** into V1-6a (this) + V1-6b (the `ramp_target` migration).
  Three-lens panel: its "cut accumulate" push was **rejected** on product ground truth (the kids'
  paper tally), while the two real defects it found — a clear-on-success input-loss race and a
  double-counting e2e retry — were **fixed** (input disabled while pending; the e2e asserts end-state
  without re-filling). Boundary tests + golden vectors + a warm-smoke e2e step; 92 vitest pass.

- **2026-07-23** — **tooling** (`chore/local-dev-db`): `pnpm dev` now defaults to a **persistent local
  embedded Postgres** instead of live Neon, so playing with the app locally never writes to prod (where
  the duplicate test rows came from). The launcher (`apps/web/scripts/dev-local.ts`) starts an
  `embedded-postgres` on a fixed port (`54329`) with a fixed, gitignored data dir (`apps/web/.local-db/`),
  migrates + seeds it (idempotent), then runs `next dev` with `DATABASE_URL` injected to override
  `.env.local` (Next env-precedence) — `ACCESS_GATE_PASSWORD` is left to `.env.local` so the gate login
  still works. The data dir **persists across restarts** (play-data survives; the seed's ON CONFLICT
  means no dupes). `pnpm dev:prod` is the deliberate opt-in for the old live-Neon behavior (prints a
  warning); `pnpm db:local:reset` wipes the sandbox. Reuses PR #43's plumbing via a new shared
  `apps/web/scripts/embedded-pg.ts` helper (embedded-PG lifecycle + first-run detection, migrate+seed,
  local-DB guard, free-port, process-group teardown) that **both** `screenshot-ephemeral.ts` and
  `dev-local.ts` now consume — no copy-paste. Mirrors the screenshot flow's "prod is the deliberate
  exception" philosophy. No app/schema change; docs + lessons updated.
- **2026-07-23** — **tooling** (`chore/screenshot-ephemeral-db`): the screenshot flow now targets a
  **throwaway embedded Postgres by default** instead of the running app's live Neon DB. New
  `pnpm --filter web screenshot:ephemeral <route>` boots an `embedded-postgres` instance (real PG
  binary on an ephemeral TCP port — no Docker/creds), migrates + seeds it via the `packages/db`
  scripts, runs `next start` against it, captures, and tears everything down. `--state already-logged`
  seeds fixture rows so **data-dependent** UI (an "already logged today" check-in) can be captured
  without ever writing to prod. Pointing at a non-local DB now requires an explicit `--use-live-db` /
  `SCREENSHOT_ALLOW_LIVE_DB=1` opt-in (the old live-Neon behavior). Realizes the embedded-postgres
  "future fix" note in [lessons.md](./lessons.md); `ui-screenshot` skill updated. No app/schema change.
- **2026-07-22** — **V1-5** (in review): the check-ins / habits form
  ([plan](./plans/v1-5-checkins-form.md)). **No migration.** The **consumer of V1-1c**: first writer
  of `kind = NULL` and of the **neither-source** row (bare habit — no `movement_id`, no `metric_key`).
  A pure registry (`lib/checkins/checkin-fields.ts`) derives the fields from the seeded catalogs —
  habits from `input_shape='boolean'`, brush-teeth from `ACTIVITY_METRIC_MAP` — with the control
  chosen by the metric's `value_type`; **no activity or metric key appears in JSX**. The RSC page
  passes the field list as a **prop**, so the catalog crosses as JSON and stays out of the client
  bundle. `logCheckinsAction` **walks the registry rather than the request body** (unknown POST keys
  inert; `unit`/`activity_type_id` resolved from the DB row via the widened
  `getMetricDefinition`/`getActivityTypeByKey`), accumulates **all** field errors, and bounds the
  submitted day to ±1 of `todayIso()` — the form carries the day it rendered, so an evening habit
  can't land on the wrong UTC date. `logCheckinEntries` does one multi-row INSERT (no tx — a single
  statement is atomic) and returns **per-item** `{clientId, id, created}`, so an all-conflict batch
  reports "already logged" instead of a false success (`client_id` UNIQUE is global, not
  profile-scoped). `EntryDTO.kind` → **nullable** (the `as EntryKind` cast lied);
  `entryLabel` gains `bool` / `scale_10` / bare-habit branches over **disjoint** discriminants.
  Domain fix: the daily brush-teeth rep is **`ladder`** drills — new metric row; `footwork` stays a
  distinct (now unmapped) metric. `spec.md` §4 corrected: the tagged union is **at-most-one**, not
  exactly-one. `db:verify` pins the shape-CHECK trap in **both** directions. Plan authored Staff-SWE,
  then hardened by a **four-lens adversarial panel** that falsified two headline claims (a
  `z.literal(1)` that could never parse a FormData string; a branch-ordering rationale resting on
  legacy `entryLabel` branches that are dead in the DB) and cut scope ~2×.

- **2026-07-21** — **V1-1c** (in review): constraint relaxation to unblock metric-only / boolean
  check-ins ([plan](./plans/v1-1-generalize-schema.md)). **Metadata-only migration** (`0003`): relax
  `entries.kind` to **NULLABLE** (the sole blocker of a kind-less check-in insert) + add the
  discriminant invariant `activity_type_id IS NOT NULL` (CHECK `NOT VALID`→`VALIDATE`, mirroring
  `household_id`; V1-1b backfilled all rows so `VALIDATE` is clean). **No column drop, no app change** —
  the legacy `kind`/`movement_name` columns + the `entries_kind_check`/`entries_shape_check` guards
  **stay** (they still guard the live `kind` dual-writer; Postgres CHECKs pass on a `kind=NULL` row —
  though `entries_shape_check` needs `value_num` populated, which every seeded numeric metric carries).
  The physical `DROP COLUMN` + CHECK drops become **V1-1d**, after V1-5–V1-8 take the app off `kind`.
  Proven on PGlite `db:verify` (kind-less check-in round-trips; no-`activity_type_id` row rejected by
  name) + the drift guard. **Independent of V1-4 (#39)** (pure migration). Backlog `a/b/c` → `a/b/c/d`.
- **2026-07-20** — **V1-4** (in review): bodyweight/measurement entries on the generalized model —
  **read path only** ([plan](./plans/v1-4-weigh-ins.md)). `listEntriesForDay` LEFT JOINs
  `metric_definitions` (legacy `metric_key IS NULL` rows survive; UNIQUE key → no fan-out; row
  count + `desc(created_at)` order unchanged) and `EntryDTO` gains nullable `metricKey`/`metricLabel`/
  `valueType`. The Today-view label moves to a pure, route-agnostic `lib/entries/entry-label.ts`
  (reusable by the later history/CSV surfaces) that **dispatches on the model discriminant** — a
  `value_type` `switch` (only `number`/`count` implemented; an explicit seam for V1-5 `bool`/`scale_10`
  and V1-6 `aggregation`), not a per-`kind` string ladder. Rendered output is **byte-identical**
  (`Bodyweight — 72.5 lb`), so the e2e smoke is untouched. A **required** contract test pins the seeded
  `bodyweight` label to the canonical shared const. The **write path/forms/actions are deferred to
  V1-5** (this PR touches no write code). Plan was authored Staff-SWE then slimmed ~3× by the
  adversarial panel.
- **2026-07-20** — **V1-3** (in review): profile tiles + Today scoped to a profile
  ([plan](./plans/v1-3-profile-tiles.md)). `/` is now the "Who's logging today?" **picker** (a tile per
  household profile); tapping a tile routes to `/p/[profileId]` (the profile's UUIDv7 `public_id`), a
  Today view scoped to it. The log forms/actions moved under `app/p/[profileId]/`; they carry
  `profileId` in a hidden field that the Server Actions **re-validate server-side** via
  `getProfileByPublicId` (the ownership seam v1.5's Clerk plugs into — tiles are a UX switch, not a
  security boundary). A malformed/unknown id → `notFound()` (the not-found UI; the app is force-dynamic
  so Next streams a 200, not a 500). Seed now provisions two kid profiles (**Liam + Scarlett**) under
  the root household. First RTL/jsdom component test lands (`profile-tile`). No migration (`avatar`
  already existed from V1-1a).
- **2026-07-21** — **V1-2** (in review): seed the FULL catalog + coverage test
  ([plan](./plans/v1-2-seed-catalogs.md)). **Reference-data only** — no `schema.ts` change, no
  migration. New single-source `packages/shared` catalog modules: `ACTIVITY_TYPE_SEED_ROWS` (11),
  `METRIC_DEFINITION_SEED_ROWS` (16), `MOVEMENT_SEED_ROWS` (21 = 7 kids' Strength-A + Ray's **real**
  Push/Pull/Legs from `movement-templates.md`), and `ACTIVITY_METRIC_MAP` (typed against both key
  sets). Each row `as const satisfies` the shared enums (bad value = typecheck fail); public_ids from
  one `seedPublicId()` namespace helper; V1-1b's 3 rows (weigh_in/sc_lift/bodyweight) are spread, not
  redefined. `db:seed` seeds all three arrays `ON CONFLICT (natural key) DO NOTHING` (idempotent). The
  PGlite coverage block proves every `ACTIVITY_METRIC_MAP` key resolves, exactly one canonical `shot`,
  `pullup_max`=max, every movement `slug === movementSlug(name)`, every MOVEMENT_PATTERN covered, one
  round-tripped entry per `input_shape` (no bespoke column — no json/jsonb, no per-activity column),
  and the CHECK↔shared-const parity for input_shape + movement pattern + metric value_type/aggregation.
  Catalog validated against two real training days (2026-07-20 Strength A + 2026-07-21 Conditioning).
- **2026-07-20** — **V1-1b** (in review): entry-generalization phase of V1-1 (additive + backfill,
  [plan](./plans/v1-1-generalize-schema.md)). Generalized `entries` with `session_id` /
  `activity_type_id` / `movement_id` / `metric_key` (+ `value_text`/`context`/`scheme`), each FK with a
  covering index; the **at-most-one** tagged-union CHECK (`movement_id IS NULL OR metric_key IS NULL`,
  hand-added `NOT VALID`→`VALIDATE` so the drift snapshot stays clean). Migration `0002` seeds three
  minimal catalog rows (`weigh_in`/`sc_lift`/`bodyweight` — the single source `packages/shared`
  `catalog-seed.ts` that V1-2's full catalog reuses) and idempotently backfills the v0 rows
  (bodyweight→bodyweight metric + weigh_in; strength→a find-or-created movement + sc_lift). DAL
  **dual-write** (`lib/dal/catalog.ts` + `entries.ts`) so new logs populate the generalized columns;
  free-text→movement find-or-create is the v0→v1 bridge (picker is V1-8). Legacy `kind`/`movement_name`
  **stay** (V1-1c drops them); Squawk + Neon-branch CI still deferred. Proven on PGlite `db:verify`
  (backfill resolution + at-most-one CHECK + schema-CHECK↔shared-const parity) + the drift guard.
- **2026-07-20** — **V1-1a** (#29): additive (expand-only) start of the V1-1 schema
  generalization ([plan](./plans/v1-1-generalize-schema.md), split a/b/c). New tables — `households`
  (authz root), the `activity_type`/`movement`/`metric_definition` catalogs, `session`,
  `day_readiness` — plus additive `profiles` columns (`household_id` NOT-NULL-via-CHECK backfilled to
  a root household; `birthdate`/`avatar`/`pin_hash` reserved). Structural enums for V1-1b/V1-2 land in
  `packages/shared` (activity categories/shapes, metric value-types/aggregations, movement patterns,
  session types/statuses, gate colors). Migration `0001` is expand-only (no `entries` change);
  Squawk + Neon-branch CI wiring deferred; proven on PGlite `db:verify` + the drizzle drift guard.
- **2026-07-20** — **V0-12** (v0 capstone): finalized the test pyramid — added a `safeInternalPath` open-redirect/XSS-guard unit test, designated the V0-8/V0-9 Server Action tests as the integration tier, and rewrote `definition-of-done.md`'s Test pyramid to match the real CI shape (fast `quality` Vitest job with the DAL mocked + PGlite `db:verify`; Playwright + CI-Postgres in the `e2e` job). Removes stale "once the DB lands" future-tense. **v0 done (13 PRs).**
- **2026-07-20** — **V0-11**: Playwright as a real dep + CI Postgres service container (migrated + seeded); one smoke E2E (log a bodyweight → renders in Today) vs the ephemeral DB, on a shared gate-login `storageState`; `ui-screenshot` graduated to a committed `pnpm screenshot` script. Introduces `docs/plans/` — file-by-file plans for significant PRs, reviewed before code.
- **2026-07-20** — **V0-10**: shared loading/empty/error UI primitives + route error boundary (error.tsx/loading.tsx); DB pool connect timeout; a down DB renders a recoverable error state, verified via Playwright.
- **2026-07-20** — **V0-9**: log a strength entry per-set — one `entry` + N `entry_set` rows in a
  single transaction (idempotent by client_id), rendered with its sets under Today; ON DELETE CASCADE
  verified. Boundary tests + Playwright E2E (squat, 3 sets) vs live Neon.
- **2026-07-20** — **V0-8**: log bodyweight — zod-validated Server Action → idempotent DAL write
  (client-stamped UUIDv7 + partial-index ON CONFLICT) → revalidate → Today; 6 boundary tests +
  Playwright E2E vs live Neon; tests-use-shared-constants convention.
- **2026-07-20** — **V0-7**: Today view — RSC reads the DB via the DAL and renders the default
  profile's day with an empty state; `nodejs` runtime; pure date helpers (unit-tested). First
  DB-backed page, verified in production.
- **2026-07-20** — **V0-6**: migrate-on-deploy (GitHub Actions single migrator, direct/unpooled Neon
  string) + one-time setup guide (`deploy.md`); observability ADR + Core Web Vitals convention;
  documented `.local-secrets/` folder. App went **live** on Vercel + Neon.
- **2026-07-20** — **V0-5**: Neon + Drizzle schema (units/profiles/entries/entry_sets) + first
  migration + idempotent seed + server-only DAL skeleton; unit enum sourced from `@mat-plan/shared`;
  PGlite verify + schema-drift guard wired into CI.
- **2026-07-18** — **Vitest harness** (out-of-band): unit/integration runner pulled forward from
  V0-12; `server-only` stub + `@` alias; first suite covers the access-gate token helpers; wired
  into CI (required Test check) + `pre-push`.
- **2026-07-18** — **Constants convention** (out-of-band): AGENTS.md single-source-of-truth rule for
  constants/enums; applied to the gate (`GATE_PATH`, shared `safeInternalPath` open-redirect guard).
- **2026-07-18** — **V0-4**: env validation (`@t3-oss/env-nextjs`, refuse-boot), access-gate stopgap
  (`proxy.ts` + `/gate` Server Action), nonce-based CSP + hardening headers.
- **2026-07-18** — **V0-3**: Vercel connect + preview deploys + `docs/deploy.md`.
- **2026-07-17** — **V0-2**: GitHub Actions CI (quality: format/lint/typecheck/build + gitleaks) +
  branch protection (require checks, 0 approvals).
- **2026-07-17** — **V0-1b**: shadcn/ui + Radix, CSS-variable design tokens (light/dark),
  `docs/design.md`, Button/Card + themed sample page.
- **2026-07-16** — Architecture diagrams (`docs/architecture.md`): system containers, write path,
  offline sync, ERD, CI topology, roadmap.
- **2026-07-16** — **V0-1**: pnpm workspace + Next.js 16 app (TS · Tailwind v4 · ESLint 9) +
  `packages/{shared,engine,db}` stubs; Prettier + husky (lint-staged, commitlint, pre-push
  typecheck); agent-rule pointers.
- **2026-07-16** — Bootstrap: repo + planning docs (spec, plan, agent rules incl. file-hierarchy &
  semantic-HTML, security, status tracker), organized into `docs/` + `.github/`. Merged to `main`.
