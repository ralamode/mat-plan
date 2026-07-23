# mat-plan — Status

Living progress tracker toward the **MVP = end of v1** (kids log a full day online + CSV export keeps
the Claude workflow alive). Updated as each PR merges. Roadmap detail in [plan.md](./plan.md).

**Last updated:** 2026-07-22

## Where we are right now

📍 **v1 underway — V1-5 in review (V1-1a/b/c, V1-2, V1-3, V1-4 all merged).** This PR ships
**V1-5 — the check-ins / habits form** ([plan](./plans/v1-5-checkins-form.md)), the **consumer of
V1-1c**: the first writer to insert `kind = NULL`, and the first to write a **neither-source** row
(no `movement_id`, no `metric_key` — a bare habit names only its `activity_type`). **No migration** —
every column already exists. The form is **derived from the seeded catalogs** (a registry over
`activity_types.input_shape` + `ACTIVITY_METRIC_MAP` + `metric_definitions`), so a new habit needs no
component/action/DAL edit; the RSC page passes the field list as a prop, keeping the catalog out of
the client bundle. The action **walks that registry rather than enumerating the body**, so unknown
POST keys are inert and `unit`/`activity_type_id` are resolved server-side from the DB row. Also
lands: `EntryDTO.kind` → nullable (the old `as EntryKind` cast lied), `entryLabel` `bool`/`scale_10`/
bare-habit branches, and the **`ladder`** metric (domain fix — the daily brush-teeth rep is ladder
drills; `footwork` stays a separate metric). Plan hardened by a four-lens adversarial panel that
falsified two of its headline claims and halved its scope. Prior: v0's slice, V1-1a/b/c, V1-2/3/4.

## Progress toward MVP (v1)

- **Code PRs merged:** 18 / 27 ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰ ~67% (+2 out-of-band: constants convention, Vitest harness)
- **Phase:** v0 ✅ complete → v1 🔵 in progress (V1-1a/b/c + V1-2/3/4 merged; V1-5 in review)

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

| PR    | Scope                                                                           | Status |
| ----- | ------------------------------------------------------------------------------- | ------ |
| V1-1  | generalize schema + forward-migrate (a/b/c/d; a/b/c merged, d deferred)         | ✅     |
| V1-2  | seed catalogs + coverage test ([plan](./plans/v1-2-seed-catalogs.md))           | ✅     |
| V1-3  | profile tiles ([plan](./plans/v1-3-profile-tiles.md))                           | ✅     |
| V1-4  | bodyweight/measurement on generalized model ([plan](./plans/v1-4-weigh-ins.md)) | ✅     |
| V1-5  | checkins/habits dynamic form ([plan](./plans/v1-5-checkins-form.md))            | 🔵     |
| V1-6  | calisthenics totals + ramp targets                                              | ⚪     |
| V1-7  | life activities (wake/practice)                                                 | ⚪     |
| V1-8  | kids' strength via session                                                      | ⚪     |
| V1-9  | fix-a-set / edit (LWW)                                                          | ⚪     |
| V1-10 | block-template prefill                                                          | ⚪     |
| V1-11 | copy-set-to-other-kid                                                           | ⚪     |
| V1-12 | a11y pass                                                                       | ⚪     |
| V1-13 | CSV export endpoint (golden-file)                                               | ⚪     |
| V1-14 | full-day E2E + rate-limit/Sentry/Dependabot                                     | ⚪     |

## Changelog (merged PRs)

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
