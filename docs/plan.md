# mat-plan — Phased Plan & PR Backlog

Each phase is small, shippable, and dogfoods CI + Playwright. **v0 and v1 are broken into
individually-reviewable PRs** (reviewed PR-by-PR to learn the codebase). Architecture + standards are
in [spec.md](./spec.md); agent/PR/CI rules in [../AGENTS.md](../AGENTS.md); per-PR checklist in
[definition-of-done.md](./definition-of-done.md). Each PR is one branch → one PR → squash-merge; reference the id (e.g. `V0-1`).

## v0 — thin slice (3 tables, one seeded profile, NO catalogs, NO auth, access-gated)

| ID    | Scope                                                                                                                                                                                          | Acceptance                                                                | Concept                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| V0-1  | pnpm workspace + Next.js App Router/TS-strict/Tailwind; empty `packages/*`; `AGENTS.md` + thin `CLAUDE.md`/`.cursor/rules` pointers; husky + lint-staged + commitlint + prettier + PR template | `pnpm dev` serves a page; lint/typecheck pass; hooks fire                 | Monorepo + App Router + agent rules      |
| V0-1b | shadcn/ui init + design tokens (CSS vars) + `DESIGN.md` (adult-first, kid-ergonomic); one styled sample component                                                                              | A shadcn button/card renders themed; DESIGN.md documents tokens           | Design system + theming                  |
| V0-2  | GH Actions CI: lint + typecheck + build + gitleaks on every PR; branch protection with required checks                                                                                         | Green check on the PR; direct push to `main` blocked                      | CI gating early                          |
| V0-3  | Vercel connect + deploy hello page                                                                                                                                                             | Public URL renders; PR preview deploy                                     | Vercel + previews                        |
| V0-4  | `lib/env.ts` (@t3-oss/env-nextjs) zod validation + `.env.example` + access-gate stopgap + security-headers/CSP middleware                                                                      | App refuses boot on missing env; URL access-gated; headers present        | Env discipline + deliberate auth stopgap |
| V0-5  | Neon + Drizzle (dual strings, `pg`/pooler/Node-runtime + `attachDatabasePool`) + first migration (profile, entry, entry_set) + idempotent seed; DAL skeleton (`lib/dal`, server-only)          | `drizzle-kit migrate` builds schema; seed inserts profile; Squawk gate on | Drizzle schema + migrations + SQL + DAL  |
| V0-6  | Migrate-on-deploy wiring (GH Actions is the single migrator, unpooled string)                                                                                                                  | Fresh deploy auto-applies pending migrations; never in Vercel build       | Migration/deploy discipline              |
| V0-7  | Today view as RSC reading the DB via the DAL (empty state)                                                                                                                                     | Deployed page shows "no entries today" from DB                            | RSC server data fetching                 |
| V0-8  | Log bodyweight: Server Action + form + zod (`packages/shared`), `client_id` stamped                                                                                                            | Submit weight → Neon row → shows in Today                                 | Server Actions + zod + revalidate        |
| V0-9  | Log one strength entry (per-set) → entry + entry_set in one transaction                                                                                                                        | Log squat 3 sets → rows persisted + rendered                              | Transactional nested writes              |
| V0-10 | Shared loading/empty/error primitives + error boundary                                                                                                                                         | Kill DB → error state, not a crash                                        | Error handling as a primitive            |
| V0-11 | CI Postgres (Docker service) + Playwright smoke ([plan](./plans/v0-11-ci-postgres-playwright.md))                                                                                              | `playwright test` green in CI logging a weight vs ephemeral PG            | E2E + the CI-DB cliff, explicit          |
| V0-12 | One unit + one integration test + finalize `DoD.md`                                                                                                                                            | Tests run in CI; DoD documented                                           | Test pyramid + Definition of Done        |

_Exit: one feature works UI → Server Action → Drizzle → Neon in prod, CI-gated with a real DB, behind an access stopgap._

## v1 — online kids logger (generalized model; still no offline, no login)

| ID    | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Acceptance                                                              | Concept                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| V1-1  | Generalize schema (household, activity_type, movement, metric_definition, session); forward-migrate v0 rows ([plan](./plans/v1-1-generalize-schema.md); split a/b/c/d — a/b merged, **V1-1c relaxes `kind` NOT NULL** to unblock metric-only entries + adds the `activity_type_id` discriminant; **V1-1d** drops the legacy `kind`/`movement_name` columns)                                                                                               | Migration runs forward on a Neon branch, v0 data preserved              | Non-trivial migration + backfill                |
| V1-2  | Seed catalogs (kid activities + Ray's real PPL) + coverage test ([plan](./plans/v1-2-seed-catalogs.md))                                                                                                                                                                                                                                                                                                                                                   | Idempotent seed; test asserts every activity maps, no bespoke column    | Reference-data discipline                       |
| V1-3  | Profile tiles (no auth); scope Today to profile ([plan](./plans/v1-3-profile-tiles.md))                                                                                                                                                                                                                                                                                                                                                                   | Tap tile → Today scoped                                                 | Per-profile routing/state                       |
| V1-4  | Bodyweight + measurement entries on generalized model (read path) ([plan](./plans/v1-4-weigh-ins.md))                                                                                                                                                                                                                                                                                                                                                     | Log a weigh-in via generalized entry                                    | Mapping UI to a tagged union                    |
| V1-5  | Checkins/habits form driven by metric_definition ([plan](./plans/v1-5-checkins-form.md))                                                                                                                                                                                                                                                                                                                                                                  | Log a brush-teeth day + habit checkboxes                                | Dynamic forms from reference data               |
| V1-6a | Calisthenics inputs + daily totals ([plan](./plans/v1-6a-calisthenics-totals.md)) — accumulate reps per bout, sum/max rollup card. No migration.                                                                                                                                                                                                                                                                                                          | Log push/pull/v-sit totals                                              | Aggregation semantics (read side)               |
| V1-6b | Calisthenics ramp targets + adherence — `ramp_target` table + migration + weekly SQL adherence ([plan](./plans/v1-6b-calisthenics-ramp.md)). Split → **V1-6b-1** (table + migration `0004` + seed mechanism + `db:verify` adherence proof; schedule ships `[]`; DB-only, no app code) + **V1-6b-2** (read DAL + `<progress>` UI). Significant migration PR (own plan + DB-safety panel). "Adherence computed" closes at V1-6b-2.                          | Adherence computed vs weekly targets                                    | Target rows + SQL adherence                     |
| V1-7  | Life activities (timing/boolean): wake, practice — one-tap                                                                                                                                                                                                                                                                                                                                                                                                | One-tap "wrestling practice" logged                                     | The generality proof                            |
| V1-8  | Kids' strength via session (+ light superset), per-set. **Superset model must support arbitrary adult PPL pairings (not kids-only) — v2 reuses it; see [spec.md](./spec.md) §4 `superset`**                                                                                                                                                                                                                                                               | Log a full S&C strength day                                             | Session model                                   |
| V1-8a | _(future)_ Weighted calisthenics + max-strength metrics: log a calisthenics bout with an optional added load (weighted vest/belt — "8 pull-ups @ +10 lb"), **reusing the `entry_set` reps+weight shape (the strength/PPL model)** — no new structure. Derive/surface max-strength metrics (max pull-ups, max-by-weight) onto the **already-seeded `pullup_max` metric (aggregation=max)**. **NOT user-facing initially** — surfaced later on a dashboard. | Weighted bout persists reps + added load; `pullup_max` reflects the max | Metric reuse over new structure                 |
| V1-9  | Fix-a-set / edit UX (LWW update)                                                                                                                                                                                                                                                                                                                                                                                                                          | Mistype a set → correct it → Today reflects fix                         | Mutable-row edit model                          |
| V1-9a | Per-exercise notes: optional free-text note per logged entry — **collapsed by default, revealed by a per-row toggle icon** — on the check-in and strength log forms. Reuses the **existing `entries.notes` column (no migration)**; applies to both check-in metrics and strength movements.                                                                                                                                                              | Toggle a row's note, type it → persists + shows on Today                | Progressive-disclosure UI on an existing column |
| V1-10 | Block-template prefill: seed templates, weekday auto-select, greyed suggested loads                                                                                                                                                                                                                                                                                                                                                                       | Open Today Tuesday → conditioning prefilled                             | Prescription data + prefill                     |
| V1-11 | Copy-set-to-other-kid                                                                                                                                                                                                                                                                                                                                                                                                                                     | Copy a set to sibling's session                                         | Cross-entity convenience write                  |
| V1-12 | A11y + tap-target/numeric-keypad pass                                                                                                                                                                                                                                                                                                                                                                                                                     | axe clean; numeric inputmode; labeled inputs                            | Accessibility for kid/iPad                      |
| V1-13 | CSV export endpoint re-aggregating to the **live** legacy schema                                                                                                                                                                                                                                                                                                                                                                                          | Output diffs clean vs committed expected CSV                            | Data transform + golden-file test               |
| V1-14 | Playwright E2E: log a full day online → assert CSV diffs clean; add Upstash rate-limiting + Sentry + Dependabot-cooldown                                                                                                                                                                                                                                                                                                                                  | E2E green in CI                                                         | Full-flow E2E + hardening                       |

_Exit: kids log a real full day online; CSV keeps the Claude `/retro` workflow alive._

## AI-1 — pull forward (single highest-signal PR)

NL logging via Anthropic structured outputs → human-confirm chip → write, with a 15-case golden eval

- CI accuracy assertion. Only needs the entry schema + a write path (both present after v1). The
  confirm-chip flow **never auto-writes a load.**

## v1.5 — offline + auth (the local-first / distributed-systems phase, isolated)

PWA manifest+SW → Dexie append-outbox → TanStack Query offline reads → per-event-UUID `POST /api/sync`
(LWW comparing client timestamp) → sync-status badge → **Clerk household login** (`pin_hash` column
seeded, no PIN UI) → offline E2E (log a day offline, sync, assert no dupes across two devices). Each a PR.

## v2 — Ray's PPL + progression engine (still all-TS)

Superset model (Ray's real PPL pairings — DB Bench + OHP, Dips + Lateral Raises — **reusing** the
arbitrary-pairing model from V1-8, not a new one); session-grain feel/next-day-soreness; **pure-TS
engine** in `packages/engine` with golden vectors; ladders/rungs + in-UI suggestions; engine
unit-tested. (No FastAPI here.)

## v3 — AI depth + API/MCP (+ optional Python)

In-app retro/summary; LLM progression **adapter** (explain-why first); expand evals; **MCP/REST API
so Claude fetches from the app** (exposes logs _and_ block/program state); optional Python/FastAPI +
pgvector where they earn it. Each AI capability is its own PR; pgvector stays gated.

## i18n — externalize strings (post-MVP, near the bottom)

Replace every hardcoded user-facing string with a **key from an i18n library** (e.g. `next-intl`),
**English as the default locale**, so the app can later be translated. Groundwork/refactor phase — no
new user features.

- Extract all display copy — page/section text, form labels + placeholders, button text, empty/error
  states, and zod **validation messages** — into typed message catalogs (`en` first).
- Add an **ESLint rule** (e.g. `no-literal-string` / `formatjs`) that fails CI on new raw string
  literals in JSX/user-facing paths, so drift can't creep back in.
- Keep it display-only: domain enum **values/identifiers** (`'bodyweight'`, cookie names, routes)
  stay as-is — this is about what the user _reads_, not what the code keys on.
- Locale-aware formatting for dates/numbers/units (ties into the existing `formatDayLong` helper).

_Exit: zero hardcoded user-facing strings; a second locale could be added by dropping in a catalog._

## Backlog / ideas (post-MVP, to brainstorm)

Captured now so they aren't lost — not yet scoped. Revisit after the MVP.

- **Notifications / reminders.** Push reminders to log entries and finish blocks (e.g. "log your
  weigh-in", "conditioning is due today"). Primary surface is **iPad / iPhone / tablet** (installed-PWA
  **web push** works on iOS 16.4+; a thin native shell only if web push proves too limited),
  occasionally Mac. Per-profile schedules + quiet hours; opt-in per kid. Builds on the v1.5 PWA + Clerk
  foundation. Scope + delivery mechanism TBD.
- **Brain-reps content.** Surface daily **motivational quotes / inspiration** for the `brain_rep`
  activity — a rotating quote for the day, maybe a small home widget. Content source, rotation, and
  "already seen" tracking TBD.

## Verification (per phase)

- **v0:** `pnpm test` + `playwright test` green in GH Actions; manually log a bodyweight + a squat
  set on the Vercel URL, confirm rows in Neon.
- **v1:** Playwright drives a full day online; `GET /api/export/csv` diffs clean vs a committed
  expected CSV in the live legacy schema. Hand the URL to the kids; observe a real day logged.
- **AI-1:** NL-parser eval ≥ target accuracy on the 15-case golden set; confirm-chip never
  auto-writes a load (assert via schema/tool constraints).
- **v1.5:** log a full day fully offline, background-sync, assert server state + no dupes across two devices.
- **v2:** engine golden-vector suite green; in-UI suggestion matches the deterministic decision.
- **v3:** MCP/REST exercised by a Claude skill that reproduces a `/retro` matching the CSV-era
  output; LLM adapter never emits a load.

## Resolved decisions (for provenance)

- DB-in-CI → Docker Postgres (CI tests) + Neon branch-per-PR (previews).
- PIN → deferred; `pin_hash` column only.
- Habits CSV → app-only until the v3 API.
- Auth provider → Clerk (COPPA stays deferred; kids have no accounts).
