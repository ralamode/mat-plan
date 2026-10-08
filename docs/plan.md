# mat-plan — Phased Plan & PR Backlog

Each phase is small, shippable, and dogfoods CI + Playwright. **v0 and v1 are broken into
individually-reviewable PRs** (reviewed PR-by-PR to learn the codebase). **This file is the backlog — the full scope and acceptance of every
row.** For the forward-looking view of what is in flight and what is next, by pillar, see
[roadmap.md](./roadmap.md); it points back at these ids. Architecture + standards are
in [spec.md](./spec.md); agent/PR/CI rules in [../AGENTS.md](../AGENTS.md); per-PR checklist in
[definition-of-done.md](./definition-of-done.md). Each PR is one branch → one PR → squash-merge; reference the id (e.g. `V0-1`).

## ⭐ Current priority order (Ray, 2026-09-30 — the repo is now PUBLIC)

Making the repo public reframed the backlog: **"someone who is not Ray can use this"** stopped being
a v1.5 concern and became the headline. The list below is Ray's, with the sequencing findings that
came out of writing it down.

> **Sequenced as a milestone:** [Beta](./milestones/beta-1.md) orders these rows (plus the ops,
> tenancy and privacy work a second family needs) into **Beta 0** (one invited family) and **Beta 1**
> (3–5 families), with exit criteria. When the two disagree on order, the milestone wins.

### P0

| #   | What                                                                                                         | Row(s)                    | State                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Anything blocking**                                                                                        | ~~V1-14b~~ ✅             | Merged (#169): a full day round-trips the real export. Nothing blocks; the exit criterion is now a real logged day, not a PR.                                                                                                                           |
| 2   | **Open bugs**                                                                                                | **V1-24 / V1-26 / V1-30** | Planned + panelled. A bodyweight set is uncorrectable and the form ignores the catalog — the pair that caused the 09/28 data loss.                                                                                                                      |
| 3   | **Logged forms look complete**                                                                               | **V1-25 §3**              | UX pass done; planned jointly with V1-24 ([plan](./plans/v1-24-form-is-the-day.md)). 1a ✅ #180 · 1b ✅ #192 · 1c ✅ #200 · **1d next**.                                                                                                                |
| 4   | **Athlete editor** — add/remove from the dashboard, new households start on The Daily Five ([ONB-2](#onb-2)) | **PROF-1 + ONB-2**        | ONB-2's default program is drafted (#198).                                                                                                                                                                                                              |
| 5   | **Edit programs, and choose which days they run**                                                            | **V1-22 + SCHED-1**       | The authoring half of onboarding. Model settled in [ADR 0005](./decisions/0005-programming-model.md); V1-22 A2/A3 is the Authoring milestone, specified in [docs/specs/v1-22-authoring-program-editing.md](./specs/v1-22-authoring-program-editing.md). |
| 6   | **OAuth login (Google / Facebook)**                                                                          | **new — AUTH-1**          | Replaces the shared access code.                                                                                                                                                                                                                        |
| 7   | **Streaks on the athlete card**                                                                              | **MOT-1** (picker half)   |                                                                                                                                                                                                                                                         |

### P1

| What                                                                        | Row          | Note                                                                                             |
| --------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| **Scaffold set count** — settable in the edit screen _and_ at scaffold time | **V1-25 §1** | Two surfaces, one value. The editor is its home (P0 #5); the scaffold-time input is the interim. |

### Everything else — the existing backlog below, unchanged in relative order.

---

### ⚠️ Three sequencing findings, from writing the list down

**1. P0 #4/#5/#6/#7 are one feature, not four.** Adding an athlete, giving them a program, logging
in, and seeing a streak are the single story _"a stranger opens mat-plan and starts using it."_
Shipping any one alone leaves a dead end — an athlete editor with no auth means anyone can add a kid
to your household; OAuth with no editor means you log in and still cannot add yourself.

**2. OAuth (#6) changes the HH-1 decision, which was already made.** HH-1 put the household in the
**path** (`/<household-id>/…`), decided 2026-09-28 _before_ OAuth was a P0. With real auth the
household can come from the **session** instead, and the two answers have different costs:

|                                        | Path (`HH-1` as decided) | Session (what OAuth enables) |
| -------------------------------------- | ------------------------ | ---------------------------- |
| Shareable link between two parents     | ✅                       | ✅ — same household¹         |
| Wrong-account-wrong-kids fails         | loudly                   | loudly on a deep link¹       |
| Touches every route + `revalidatePath` | ✅                       | ❌                           |
| Works before auth lands                | ✅                       | ❌                           |

¹ **Corrected by [ADR 0006](./decisions/0006-household-addressing.md).** Rows 1 and 2 originally read
❌ / **silently**; both were wrong for the case they are about. See the ADR's "shared-link question"
and "what fails loudly, and what does not" for the mechanism and the residual.

**They are not exclusive** — the path can be the address and the session the authorization, which is
the combination HH-1 actually described. But **#6 should not be built assuming session-scoping**
without revisiting HH-1, or the two will disagree about what a URL means.

⚠️ **This question is now owned by [ADR 0006](./decisions/0006-household-addressing.md)** (proposed
2026-10-07), which measures the path option's blast radius rather than asserting it.

**3. Public repo ⇒ the access gate is now the only thing between the internet and two kids' data,
and it is one shared password.** The code being public does not weaken it (the secret is in env, not
in the repo) — but it does mean the gate's shape is now readable by anyone, and a single shared
credential has no revocation story per-person. That is an argument for **#6 sooner rather than
later**, and it is the first time auth has had a security rationale rather than a convenience one.

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

| ID                                                                                                       | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Acceptance                                                                                                                                  | Concept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1-1                                                                                                     | Generalize schema (household, activity_type, movement, metric_definition, session); forward-migrate v0 rows ([plan](./plans/v1-1-generalize-schema.md); split a/b/c/d — a/b merged, **V1-1c relaxes `kind` NOT NULL** to unblock metric-only entries + adds the `activity_type_id` discriminant; **V1-1d** drops the legacy `kind`/`movement_name` columns)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Migration runs forward on a Neon branch, v0 data preserved                                                                                  | Non-trivial migration + backfill                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| V1-2                                                                                                     | Seed catalogs (kid activities + Ray's real PPL) + coverage test ([plan](./plans/v1-2-seed-catalogs.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Idempotent seed; test asserts every activity maps, no bespoke column                                                                        | Reference-data discipline                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| V1-3                                                                                                     | Profile tiles (no auth); scope Today to profile ([plan](./plans/v1-3-profile-tiles.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tap tile → Today scoped                                                                                                                     | Per-profile routing/state                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| V1-4                                                                                                     | Bodyweight + measurement entries on generalized model (read path) ([plan](./plans/v1-4-weigh-ins.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Log a weigh-in via generalized entry                                                                                                        | Mapping UI to a tagged union                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| V1-5                                                                                                     | Checkins/habits form driven by metric_definition ([plan](./plans/v1-5-checkins-form.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Log a brush-teeth day + habit checkboxes                                                                                                    | Dynamic forms from reference data                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| V1-6a                                                                                                    | Calisthenics inputs + daily totals ([plan](./plans/v1-6a-calisthenics-totals.md)) — accumulate reps per bout, sum/max rollup card. No migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Log push/pull/v-sit totals                                                                                                                  | Aggregation semantics (read side)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| V1-6b                                                                                                    | Calisthenics ramp targets + adherence — `ramp_target` table + migration + weekly SQL adherence ([b-1 plan](./plans/v1-6b-calisthenics-ramp.md) · [b-2 plan](./plans/v1-6b-2-adherence-ui.md)). Split → **V1-6b-1** (table + migration `0004` + seed mechanism + `db:verify` adherence proof; schedule ships `[]`; DB-only, no app code) + **V1-6b-2** (read DAL + `<progress>` "This week" UI; adherence query single-sourced in `packages/db`, run by both the DAL and `db:verify`). **Adherence computed → closes at V1-6b-2.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Adherence computed vs weekly targets                                                                                                        | Target rows + SQL adherence                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| V1-6c                                                                                                    | Timezone / local-calendar-date correctness ([plan](./plans/v1-6c-timezone-local-date.md)) — "today" follows the active IANA local calendar date (not UTC); date & weekday always agree; historical dates stable across travel; exact timestamps stay UTC. Cookie-delivered tz + `localDayIso`; all three writers thread the rendered day (shared ±1 bound). No migration, no new dep. **Prerequisite of V1-6b-2.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Afternoon in PT shows today's workout, not tomorrow's                                                                                       | Calendar dates vs instants (the tz seam)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| V1-7                                                                                                     | Life activities (timing/boolean): wake, wrestling practice — one-tap ([plan](./plans/v1-7-life-activities.md)). Wake = a `timing` event (`event_at` + local-minutes in `value_num`, rendered tz-free); practice = one-tap `practice_minutes` (default 90). **No migration** — `event_at`/`value_text` + catalog rows already exist; reuses the V1-5 write path (+1 optional `eventAt`). The generality proof.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | One-tap "wrestling practice" logged                                                                                                         | The generality proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| V1-7a                                                                                                    | _(deferred from V1-7)_ Wrestling-practice **minutes input** — a numeric field (default 90, `inputmode="numeric"`) to override the one-tap default _before_ logging (club sessions are ~90 min but times/clubs vary). Reuses the V1-7 action's item shape + the `VALUE_NUM_MAX` clamp + `entry-label` default; no migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Type "75" then tap Wrestling practice → logs 75 min                                                                                         | Optional override on a one-tap log                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| V1-8                                                                                                     | Kids' strength via session (+ light superset), per-set ([plan](./plans/v1-8-strength-sessions.md) · [ADR 0003](./decisions/0003-superset-log-grouping.md)). **Superset model must support arbitrary adult PPL pairings — v2 reuses it; spec.md §4.** Split → **V1-8-1** (`supersets` table + `entries.superset_id`/`superset_order` migration `0005` + `db:verify` proof; DB-only; ✅ #53) + **V1-8-2** (flat multi-movement session write path + form; write core single-sourced in `packages/db`; ✅ #54) + **V1-8-3a** (session read **grouping** — sessions render as blocks; ✅ #55) + **V1-8-3b** (session **feel**) + **V1-8-3c** (superset **write core** — schema + writer + `db:verify`) + **V1-8-3d** (superset **UI** + read bracketing). 8-3 split 3a + 3b/3c/3d per its panels; [remainder plan](./plans/v1-8-3-remainder-feel-and-supersets.md). Significant migration PR (own plan + DB-safety panel).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Log a full S&C strength day                                                                                                                 | Session model                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| V1-8a                                                                                                    | _(future)_ Weighted calisthenics + max-strength metrics: log a calisthenics bout with an optional added load (weighted vest/belt — "8 pull-ups @ +10 lb"), **reusing the `entry_set` reps+weight shape (the strength/PPL model)** — no new structure. Derive/surface max-strength metrics (max pull-ups, max-by-weight) onto the **already-seeded `pullup_max` metric (aggregation=max)**. **NOT user-facing initially** — surfaced later on a dashboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Weighted bout persists reps + added load; `pullup_max` reflects the max                                                                     | Metric reuse over new structure                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| V1-9                                                                                                     | Fix-a-set / edit UX (LWW update) ([plan](./plans/v1-9-edit-set.md)) — inline-edit a logged strength set's reps/weight; ownership-scoped UPDATE single-sourced in `packages/db`; numeric sets only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Mistype a set → correct it → Today reflects fix                                                                                             | Mutable-row edit model                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| V1-9a                                                                                                    | Per-exercise notes: optional free-text note per logged entry — **collapsed by default, revealed by a per-row toggle icon** — on the check-in and strength log forms. Reuses the **existing `entries.notes` column (no migration)**; **GAP-3 depends on this** — its `is_band` boolean records _that_ a band was used, and this note records _which_; applies to both check-in metrics and strength movements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Toggle a row's note, type it → persists + shows on Today                                                                                    | Progressive-disclosure UI on an existing column                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| V1-9b                                                                                                    | Delete / clear-day — **soft-delete** an entry from the day's "Logged entries" list (a per-row delete affordance), and **clear an entire day** behind a destructive-action guard: a confirmation dialog that only enables "Clear" once the user **types "delete"** (the GitHub-style typed-confirm, since clearing a day is irreversible-feeling + bulk). Reuses the existing `entries.deleted_at` **soft-delete** column + the LWW tombstone model ([spec.md](./spec.md) §sync/edits) — no migration; a profile+day-scoped Server Action, idempotent, `revalidatePath`. A single delete may be a lighter confirm (or an undo); the **typed-"delete"** guard is specifically for **clear-the-whole-day**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Delete a mistaken entry → gone from Today; "Clear day" → type "delete" → the day empties                                                    | Reversible destructive writes + a typed-confirm guard                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| V1-10                                                                                                    | **Programming — the day's program on Today** ([slice-1 plan](./plans/v1-10-1-programming-schema.md) · [seed plan](./plans/v1-10-1b-seed-real-program.md) · [slice-2 plan](./plans/v1-10-2-strength-prefill.md)): program blocks + weekday auto-select + this kid's suggested loads (the LLM never authors loads). Model per spec.md §4 (`program_block → prescription → prescription_target`). **PR 1** (#66) = the data model + migration `0007` + shared schemas + a dedicated `DAY_ROLES` enum + an EMPTY seed mechanism + `db:verify`, ships dark; **PR 1b** (#67) = Ray's real Kids S&C Foundation block (3 strength days, 21 prescriptions, per-kid loads/reps; migration `0008`); **PR 2** = the payoff — a weekday → `day_role` → **read-only "Today's program" reference card** above the UNCHANGED strength form. The panel unanimously rejected an editable prefill: ~90% of the authored loads are text ("BW"/"band"/"~75-85") a numeric field can't hold, and pre-filling the required weight field would let a PRESCRIBED load log as a PERFORMED one without a human typing it. Editable prefill is re-openable only after the log path can store TEXT loads (`rawLoad`) — its own slice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Open Today on a Monday → that day's programmed movements + this kid's loads render above the form                                           | Prescription data + a read-only program surface                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| V1-11                                                                                                    | Copy-set-to-other-kid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Copy a set to sibling's session                                                                                                             | Cross-entity convenience write                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| V1-12                                                                                                    | **A11y + tap-target/numeric-keypad pass** ([plan](./plans/v1-12-a11y-pass.md)) — makes the AGENTS.md a11y bar EXECUTABLE rather than prose: an axe (`wcag2a`+`wcag2aa`, zero-tolerance) scan of `/`, Today and the routine editor at 390px in the existing `e2e` job, plus a bespoke ≥44px tap-target assertion (axe cannot do this — its `target-size` rule is `wcag22aa` and its threshold is 24px). `min-h-11` moves into the `buttonVariants` BASE, deleting 18 literal copies across call sites and making the rule structural instead of opt-in. Fixed: 3 sub-44 buttons, the check-in label's 28px vertical target, and a `gate-form` copy of `INPUT_CLASS`. `inputMode` was already complete — this pins it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | axe clean; every control ≥44px, asserted in CI; numeric inputmode                                                                           | Accessibility, enforced                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V1-13                                                                                                    | **CSV export** re-aggregating to the live legacy schema — **[contract](./csv-export-contract.md)** (authoritative; supersedes spec.md where they differ). Four files at `data/<type>/<athlete>/<YYYY-MM>.csv`, one per kid per month, no athlete column. **Not RFC-4180**: zero quoted fields exist, one real row carries bare `"` inch marks and another an unescaped comma — join raw, never use a CSV library. One row per MOVEMENT (aggregate the per-set rows; collapse a uniform slash-list to a scalar). `prescribed` is the plan and is NEVER reconciled with the actuals. Bodyweight must export as TEXT (`92` vs `92.0` must survive) — a data-model consequence. CI asserts the golden diff **plus** that `sets` equals any slash-list's element count, which the diff alone cannot catch. **PLANNED 2026-09-24** — [v1-13-csv-export.md](./plans/v1-13-csv-export.md), two panels before implementation (engineering + a dedicated contract-fidelity lens that read the real sample bytes). **Nine blocking findings; two would have silently corrupted the workflow.** (a) The app emits `front_squat` where legacy is `front-squat`, so **every movement forks into two series** and the workflow's grouping returns nothing. (b) A `kg` load exports as a bare number the workflow reads as lb — a **2.2x error in the column that drives load progression**; the exporter now REFUSES rather than converts. Also: `SKIPPED` comes from `entries.status` not `entry_sets.status`; `sub-failure` is a 12th shape that was missed; **38% of seeded prescriptions contain a comma** and would split the row; `numeric` returns a string so every load reads `70.000`. Re-scoped to one file at a time — **13a = strength-log end-to-end**, 13b = bodyweight/checkins + zip. **Resolved by Ray:** the `<athlete>` directory is **`profiles.public_id`** — no slug, no migration. A readable directory was only ever needed to keep app exports contiguous with the paper-era tree, and Ray retired that requirement (_"the past data does not matter that much at this point"_), so the stable id the schema already has wins on every remaining axis. Legibility comes back via the importer (**IMP-1**), which maps the old named directories onto the right profile — and Ray's point that **the old named data is the importer's test fixture**. `profiles.slug` cancelled (#145 closed). Bodyweight trims trailing zeros. `calisthenics-log` cut → **V1-13a-fu**.                                                                                             | Output diffs clean vs the committed golden files, and slash-list arity matches `sets`                                                       | Data transform + golden-file test                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| V1-13a-fu                                                                                                | **`calisthenics-log` CSV — the one schema the app DEFINES rather than matches.** Cut from V1-13 by Ray (2026-09-24) as a fast follow, because defining it is its own decision with three unanswered questions, each a silently-wrong column: ~~the program prescribes `leg_raises`, which has no column~~ — **resolved 2026-09-24 (Ray): leg raises are an ordinary REP MOVEMENT**, so they belong in `strength-log` beside the other per-set movements, not in this file's daily-scalar shape. Two questions remain: the program tracks `reps_per_set` across up to 10 sets while the CSV column is a **single daily scalar** (sum? max? undefined); and **`vsit_skill_step` (1-5) has no representation in the data model at all**. Also collides with the contract's `0`-vs-empty rule — the program's `"empty_set_means": "not_performed"` is exactly the ambiguity [csv-export-contract.md](./csv-export-contract.md) L49-50 forbids. Header is fixed by the contract; the mapping is not. Nothing exists on disk, so the app also creates the directory + a README mirroring the other two.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A calisthenics day exports a row the Claude workflow can read                                                                               | Export schema definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| V1-14a                                                                                                   | **Hardening** ([plan](./plans/v1-14a-hardening.md)) — rate-limit the ACCESS GATE (the app's only unauthenticated password oracle) keyed by the Vercel-set client IP, fail-open; Sentry error reporting via `withServerActionInstrumentation` **with a unit-tested PII scrubber** (the documented wiring would ship the `mp_gate` cookie, a kid's bodyweight, and the plaintext access code to a third party); Dependabot cooldown. Mutation rate limits deferred to Clerk/v1.5 — `profileId` is caller-supplied, so a limit keyed on it would constrain only the household. Every var OPTIONAL: absent ⇒ no-op, which is what local dev and CI run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Gate blocks past the limit with a typed envelope; a thrown error reports to Sentry with no cookie/PII; CI unchanged without credentials     | Operational hardening                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ~~V1-14b~~ ✅                                                                                            | **Full-day E2E + CSV diff** — log a full day through the real UI, download the real export, open it with the system `unzip`, assert the bytes. `apps/web/e2e/export-full-day.spec.ts`. **Deliberately NOT a committed golden file:** a golden is a fixture _we_ wrote, which is exactly the insufficiency V1-13's risk table names, and it would pin a date the test cannot control. The expected bytes are derived from the day the app itself declares (`input[name="day"]`) and the values typed into the form. Proven by mutation: breaking `csvMovement` and `collapse` each fail it, while every pre-existing test — including `export-csv.spec.ts` — stays green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | E2E green in CI                                                                                                                             | Full-flow E2E                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ~~V1-15~~ ✅                                                                                             | Day navigation — view previous days (prev/next paging + tappable date; history **read-only** to dodge the V1-6c ±1 write bound). Turns the Today route's day into a URL param and **reuses `listEntriesForDay` + the current view** (factor the Today `<main>` body into a shared day-view). RSC-per-day, **no speculative prefetch** ("don't hammer the API"). Then a "this-week" 7-dot strip; then a month calendar (one bounded `DISTINCT activity_date` query). Forward/programmed days deferred until the ramp schedule is seeded + V1-10. ([brainstorm](./plans/day-navigation-and-dashboard-brainstorm.md)) **NEW EVIDENCE 2026-09-24:** a dated route has a second consumer — the TEST SUITE (the scaffold a11y check self-skipped 4 days in 7; #141 works around it with a timezone shift). GAP-3 also made `listEntriesForDay` two seeks, so re-verify the "no new queries" claim. See the [brainstorm](./plans/day-navigation-and-dashboard-brainstorm.md) → "New evidence". **PLANNED 2026-09-24** — [v1-15-day-navigation.md](./plans/v1-15-day-navigation.md), two panels before implementation. Two findings reshaped it: (1) blanket read-only history was **stricter than the server** — `declared-day.ts` already accepts yesterday (`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | diff                                                                                                                                        | <= 1`) and `editStrengthSetAction`has no day bound at all, so it would have regressed V1-9 on every past day for no safety gain; the writable window now mirrors the server. (2) The **week strip moves into v1** — two chevrons cost 9 taps to reach last Tuesday at 4-7 queries each; the strip is pure date arithmetic (zero new queries) and makes it 2. Also cut: the promised`PROGRAMMED_TZ` deletion, which contradicts read-only history and would turn the scaffold a11y test red. | Page back to Tuesday, see that day's log; reload stable | Day as route param; read-mostly nav |
| V1-16                                                                                                    | Progress dashboard — range view (week/month/3mo/year) with restrained Recharts. A series is just **`foldAggregation` per time-bucket** (pure kernel reuse, coarser `GROUP BY`). v1 tiles: bodyweight trend (line, parent-gated), calisthenics volume + movement picker (bars), stretch max-progression (line — the home V1-8a was waiting for). One range fetch per tab; clamp date span; per-profile `revalidateTag`. Ramp-adherence + strength/est-1RM tiles land as their upstream data does. ([brainstorm](./plans/day-navigation-and-dashboard-brainstorm.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pick "month" → see bodyweight trend + a movement's load over time                                                                           | Aggregation-over-buckets; motivating viz                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| V1-17                                                                                                    | _(Ray, post-V1-8)_ Logged-entries list in **performed order (oldest-first)** ([plan](./plans/v1-17-performed-order.md)) — flipped `listEntriesForDay` to `asc(created_at), asc(id)` so the day reads top-down in the order the kids did things (wake → bodyweight → rice bucket). Pure read change, no migration; oldest-first default (a toggle is a fast-follow). `COALESCE(event_at, …)` was cut by the panel as gold-plating.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Log reads top-down in performed order                                                                                                       | Read ordering by activity time                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| V1-18                                                                                                    | _(Ray, post-V1-8)_ **Per-kid routine builder** ([brief](./plans/v1-18-routine-builder-brief.md) · [eng plan](./plans/v1-18-eng-plan.md)) — REFRAMED from "reorder the 4 sections" into a **per-kid ordered checklist of the activities that kid actually does** (weigh-in pinned first, then their sequence — rice bucket, brush teeth, strength if programmed, finishers…). Per-kid _selection_ AND _order_ — the front half of **V1-10 (programming)**; day-conditional strength defers to V1-10. Hybrid picked via a 4-phase design→eng investigation. **PR 1a** (`db/v1-18-routine-config`, #63) = the migration + shared `routineConfigSchema` + seed, ships dark; **PR 1b** (#64) = render-from-config; **PR 2** (`feat/v1-18-routine-config-ui`, #65) = the coach editor (checklist + ▲▼ + Save), which **folds in PR 3** (unchecking a check-in key IS the per-kid allowlist); copy-from-kid deferred to a later slice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Kid A's Today shows their routine in their order; Kid B's differs; weigh-in first                                                           | Per-kid routine / programming (V1-10 overlap)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| V1-19                                                                                                    | _(Ray)_ **"Start today's program" — one tap builds the log form.** The V1-10 card shows the day's movements; the athlete then hand-types every movement name and adds a set row per set (see the card+form screenshot). This adds a button that POPULATES the strength form from the program: one movement card per prescription, `sets`-count of blank set rows, superset grouping pre-applied where prescribed — **movement names and set STRUCTURE only. Loads and reps stay BLANK.** That boundary is the whole design: the V1-10 panel rejected pre-filling loads because a PRESCRIBED value would log as a PERFORMED one with no human typing it, and ~90% of Ray's authored loads are text (`BW`, `band`, `~75-85`) a numeric field cannot hold. Neither objection touches names or set counts — which is also exactly the cheaper alternative the V1-11 panel proposed when it recommended deferring copy-to-sibling. Reuses the existing `getProgramDay` read; no new query, no migration. Needs a decision on re-tap after a partial log (replace / append / disabled). **PLAN: [v1-19-start-todays-program.md](./plans/v1-19-start-todays-program.md) (2026-09-21) — panels revised this row twice. (1) **Superset pre-grouping is CUT**: `prescriptions` has no superset column, so a prescribed pairing is not expressible; supersets are a PERFORMED concept only. (2) **Structure only — reps prefill is CUT too**, reversing the 2026-09-16 revision below: the V1-10 panel's reason (2) was the CONFIRM-GATE (a blank `required` field IS the human confirmation), which applies to reps identically, and its reason (3) rejected parsing `target_reps` outright. Re-tap replaces with Undo; scaffolded cards render COLLAPSED (7 movements = ~6,600px of blank inputs otherwise). **Superseded 2026-09-16 revision follows:** **Revised 2026-09-16** by [logging-speed-brainstorm.md](./plans/logging-speed-brainstorm.md): reps and loads do NOT share a risk profile — a wrong load is an injury, a wrong rep is a data bug — and `prescription.reps` is free text (`programming.ts:100`), so of Ray's 7-movement Strength B day only **2 of 7** rep prescriptions are clean integers (4 of 7 after GAP-3). Revision: **loads stay blank with a tap-to-fill chip** (S1-legal — the origin is the parent's readable rule, not a model), **clean-integer reps prefill**, and **discovered reps (`AMRAP`, `to failure`, `8-10`) stay blank and get MARKED** as the set that matters. The no-authored-loads boundary is enforced more precisely, not relaxed. | Tap "Start today's program" → the form is pre-built with the day's movements and blank set rows; typing only the numbers logs the session   | Program → form scaffolding (no authored values)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| V1-20                                                                                                    | _(Ray)_ **Coach editor: discoverable + cross-athlete.** `/p/[profileId]/routine` (V1-18 PR 2) is **URL-only today** — nothing links to it. Add a visible entry point per athlete, and — the actual ask — a way to edit **both athletes together**, since the programming order is usually changed for both at once. Two shapes to weigh: a shared editor writing N profiles in one submit, vs. per-kid editors plus "apply to \<sibling\>" (the copy-from-kid affordance V1-18 PR 2 deferred). Note the URL-only entry is currently the ONLY thing limiting who can edit a routine — it is not a security control, but making it discoverable removes that friction, so it should land with or after Clerk, or knowingly accept the gap ([tech-debt](./tech-debt.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | A link reaches the editor for each athlete; one edit can apply the same order to both                                                       | Coach authoring surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V1-21                                                                                                    | _(Ray)_ **Interaction-design review of the entry UI, then comps to choose from.** NOT an implementation PR — a design deliverable. Phase 1: a detailed human interaction-design critique of the logging flow as it stands (the card→form gap, set-row entry on a phone mid-set, superset grouping, one-handed reach, glanceability between sets, error recovery). Phase 2: rounds of wireframes/comps at **mobile / tablet / desktop** for Ray to review and pick the patterns to build. ~~Explicitly upstream of V1-19~~ — **amended 2026-09-21 (V1-19 plan, D10): V1-19 now lands FIRST.** V1-19 is app-only, no migration, revert-able in one commit; V1-21 is a design deliverable needing rounds of comps and Ray's review, a far larger commitment at ~4h/wk — and no athlete has used the app yet, with the dogfood test blocked on exactly the interaction V1-19 fixes. V1-19's collapsed-card work is also EVIDENCE for V1-21 (does disclosure solve the length problem?) rather than waste. V1-21 still asks whether the form-with-set-rows model is the right shape at all. Output: a committed design doc + comps; implementation PRs follow from Ray's choices.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Ray reviews comps at 3 widths and picks the interaction model to implement                                                                  | Design investigation (decide before building)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| V1-22                                                                                                    | **Program editor — author programming without a deploy** (**spec: [v1-22-authoring-program-editing](./specs/v1-22-authoring-program-editing.md)** · chunk plans: [1 ✅ the snapshot column](./plans/v1-22-1-prescribed-snapshot.md) · [scope-A plan](./plans/v1-22-program-editor.md) · model: [ADR 0005](./decisions/0005-programming-model.md)) — _(Ray, 2026-09-23.)_ `PROGRAM_SEED` → `seed.ts` is the **only** writer of `prescriptions`/`prescription_targets`; there is no write path in `apps/web` at all, so **changing one load means editing TypeScript and deploying**. V1-18's editor covers the daily ROUTINE, not the program. Adds `/programs` + `/programs/[block]`: edit a block's movements, sets, target reps, and per-athlete loads, and assign it to one athlete or several. ~~Supersedes V1-20's authoring half~~ — **corrected by the panel: V1-20 is about the ROUTINE editor, which V1-22 does not touch.** V1-22 claims only the program surface and links itself from Today; V1-20 remains cross-athlete _routine_ editing. **Panelled 2026-09-23** (3 lenses incl. DB-safety + the required UX panel) — route corrected to `/p/[profileId]/program` (every BOLA guarantee derives from a profile public id), block _creation_ hard-disabled in A (it would silently hijack every athlete's Today card via `id DESC LIMIT 1`), and A split A1–A4 at ~1,200–1,600 lines. Two scopes: **A** = CRUD on the shipped tables, no migration; **B** = A plus assignment + a third schedule shape + GAP-3 measurement shapes — needed before the [youth daily A/B program](./samples/youth-daily-program/README.md) can be authored at all. Needs BOTH panels (new screen + first config-mutating endpoints). **Scope widened 2026-09-24:** GAP-3's child table makes a movement's **load-slot set** (`vest`/`ankle`/`wrist`) something a coach must declare — slots are **movement-declared, never added per-set by the athlete**, which is what keeps the child table invisible on a 360px log row. That authoring surface lands here ([GAP-3 §7.2c](./plans/gap3-typed-measurements.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A coach changes a kid's programmed load without a deploy                                                                                    | Authoring surface / config CRUD                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CAT-1                                                                                                    | **The routine picker stops offering a metric that duplicates a movement.** _(Left the Authoring spec 2026-10-05 — independent of the write path.)_ `pushups` / `pullups` / `vsit_crunch` (`activity-metric-map.ts`) twin the `push-ups` / `pull-up` / `v-sit_crunches` movements, so the same work is loggable two ways and adherence double-counts. ⚠️ **Three traps the panel found.** (1) Narrow `routineCatalogItems()` only — `ROUTINE_CATALOG` is also the **membership set** and the **write-side** validator, and `resolveRoutine` drops a non-member **silently**, so the editor's unconditional write then persists the loss (acceptance: a stored off-catalog key round-trips). (2) The **default** order is `buildDefaultRoutine(ROUTINE_CATALOG)`, so every NULL-config profile still renders the duplicate and a coach who removes it **can never re-add it** — a one-way door; the default needs the criterion too. (3) `routine-editor.tsx` degrades an off-catalog key's label to the raw key, so the row and its `aria-label` read "Move checkin:calisthenics:pushups up" — split the offer list from the **label map**. The exclusion set is a named const beside `CALISTHENICS_METRIC_KEYS`, not an inline filter: `vsit_skill_step` has **no** movement twin, so "exclude calisthenics" over-excludes. `SEED_ATHLETE_TWO_ROUTINE` also authors one of these keys. **One spec of TEST-1** (the routine editor's add/remove/reorder/persist) is the untested surface this touches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A movement is loggable one way, and adherence stops double-counting                                                                         | Catalog / routine config                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CAT-2                                                                                                    | **The wrestling drills become movements** (seed). _(Left the Authoring spec 2026-10-05 — gated on the movement-list review, not on code.)_ ✅ **Not gated on scheduling — [ADR 0007](./decisions/0007-scheduling-model.md) checked and says so**: a drill seeded as a movement is prescribable into a `day_role` today and into an authored workout row later, and the seed is `ON CONFLICT DO NOTHING` on `movements.slug` either way. `docs/roadmap.md` had claimed this row was waiting on that ADR; it was not. The catalog collision from the other side: drills logged as free text today cannot be programmed or charted. Gated on the human approve/deny pass over the proposed movement library, then a `movements` seed with `ON CONFLICT DO NOTHING`. Needs its own acceptance criteria — it had none in the spec, which is why it left.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A drill is a first-class movement, programmable and chartable                                                                               | Movement catalog / seed                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V1-23                                                                                                    | **Today, focused** ([plan](./plans/v1-23-today-focused.md)) — _(Ray, 2026-09-26, from using the app.)_ **Three PRs.** The panels found the requested changes made the session LONGER (~53 → ~55 taps) and surfaced the real sink: `PROGRAM_SEED` is `open()` on **11 of 13** prescriptions (`sets: null`) and `clampSetCount(null)` returns **1**, so every open movement scaffolds ONE set row — **~10 "Add set" taps a session, ~20% of the total** — while the `0/1` counter lies about progress. **PR 1: a null prescription scaffolds 3 rows** (structure, not a prescribed value — `ScaffoldRow` still carries no load). **PR 2: the day on the date line** (`Today · Fri, Sep 26 · Day B`) + the routine-editor link, relabelled and placed below the logged entries — V1-20's discoverability half; the editor ALREADY removes individual check-in rows, only the link was missing. The day-role select **stays in the form**: it is zero-tap (`resolveDayRole` is total), and position — after the movements, before submit — is what makes the GAP-1 P0-1 provenance assertion real, so a header copy would be the hidden input that note forbids with decorative rendering. **PR 3: the program card collapses** via `<details>` (the anti-`<details>` note is `required`-specific and the card has no controls). **D4 (check-in accordion) CUT** — Radix unmounts on close and the check-in number inputs are uncontrolled, so tidying a group after typing silently drops the value and still reports success. **Follow-ups:** `targetReps` on the movement card (never `load`); remembered set count; the editor's missing confirm + restore-default, and that a kid can remove `strength` and make the session unloggable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Fewer taps to log a real session; the day is answerable at a glance                                                                         | Scaffold defaults + page orientation                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| BUG-1                                                                                                    | **A form submit is silently lost** ([dossier](./bugs/e2e-lost-form-submit.md)) — the click yields no server request, no row, no error. Surfaces as the check-ins e2e flake (first seen 2026-07-24, 12+ CI runs; has falsely reddened 3 unrelated Dependabot PRs). Server timings are 1–26ms, so NOT performance. Five hypotheses killed. Next step is one measurement: attach `page.on('request'/'requestfailed')` and capture a failing iteration to determine whether a POST is made at all. **Suspected real user-facing defect** — a lost tap with no feedback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A failing run is explained by a captured request trace; then a fix                                                                          | Client/server submit race                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| BUG-2                                                                                                    | ~~**CLOSED** — (a) by GAP-1 P1-1b, (b) by P1-1c.~~ **Latent defects that GAP-1 P1-1 made reachable** — neither bites today, both do the moment a non-`done` status is writable. (a) **V1-9 edit leaves a stale status:** `isEditableSet` is `weightLabel === null && reps !== null && weight !== null`, so a numeric `sub_failure` set passes as editable — correcting its reps 3→5 leaves `entry_sets.status='sub_failure'` intact and the set still exports as `sub-failure`. Needs the client guard **and** a mirrored `eq(status,'done')` in `updateStrengthSetById`'s WHERE (that function's docblock requires the two guards stay identical). (b) **A skipped card is silently dropped on submit:** `isUntouchedMovement` returns `m.movementName.trim() === '' && m.sets.every(…)`, and `[].every(…)` is **vacuously true** — so a movement marked Skipped (which carries zero sets) with a blank name is discarded by `dropUntouchedMovements` with no "Enter a movement." message, contradicting its own "ANY field typed is a partial entry" contract. Fix each in the PR that activates it; recorded here so neither is lost if P1-1 slips.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Editing a sub-failure set clears its status (or is refused); a Skipped card with a blank name shows a validation error instead of vanishing | Status/edit interaction; vacuous-truth guard                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| GAP-1                                                                                                    | **Close the CSV recording gaps** ([analysis](./csv-recording-gaps.md) · [P0-2 plan](./plans/gap1-p02-text-loads.md) · [P0-1 plan](./plans/gap1-p01-persist-day-role.md) · [P1-1a skipped](./plans/gap1-p1-1a-skipped-write.md) · [P1-1b sub-failure](./plans/gap1-p1-1b-subfailure-write.md)) — the app cannot record several shapes the CSVs express. P0: `session_type` can only ever be `strength` (`day_role` is never persisted); text loads (`BW`/`band`/`30in`) and timed sets are unwritable, so a bodyweight movement exports `0` instead of `BW`. P1: `SKIPPED` and per-set `sub-failure` are **closed** (P1-1a/b/c — writable, reachable from the form, and badged in the log); `prescribed` needs a logged-entry→prescription link; bodyweight `context` never written. P2: input sanitisation (a movement name containing a comma corrupts the row). Sequenced in the analysis. Note P0-2's text-load path is **partially reversed by GAP-3** ([ADR 0004](./decisions/0004-typed-measurements.md)) — the V1-10 prefill it unblocked is now specified as a **placeholder, not a value** (ONB-1 R8), and P0-2's `PRESCRIPTION_SHAPE` guard is kept and load-bearing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The app can log every shape the contract expresses                                                                                          | Write-path fidelity                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GAP-3                                                                                                    | **Typed measurements — kill the free-text load** ([ADR 0004](./decisions/0004-typed-measurements.md)) — _(Ray, 2026-08-26)_ No field in the log path holds letters. `parseLoad` already blocks the dangerous shapes (`~75`, `35-45/hand`, ranges) but has a permissive fallthrough, so `75 x 4` and `seventy five pounds` are storable — and a single `load` string has to encode three different physical quantities (`30in` a height, `20s` a duration, `123 (50ft)` a weight **and** a distance). Replaced by typed columns, sited by the **varies-per-set test**: weight/reps/duration/band on the **set**; distance/height/per-side on the **prescription** with a nullable set-level override (prescription-only would break ad-hoc logging; folding into movement identity would fragment history exactly as ONB-1 R12a forbids). `band` is its own boolean (not exclusive with bodyweight); which band goes in `entries.notes` via **V1-9a**. **Absorbs UNIT-1:** units come from the reference table, the movement declares the dimension, the household sets the magnitude, and the **resolved unit is stored ON THE ROW** — a household-preference-only design silently reinterprets all history when the preference changes (45 lb → 45 kg). A `units.dimension` column makes `lb`-in-a-height-field unrepresentable rather than discouraged; `UNIT_CODES` has **no length dimension at all** today. Partially reverses GAP-1 P0-2 on purpose. **UNBLOCKED** — the legacy CSV samples landed (#121) and the **shape census** is written: [gap3-typed-measurements.md](./plans/gap3-typed-measurements.md) (#126) inventories all 12 `load` shapes and all 12 `prescribed` shapes with per-shape counts at two grains. Headline for the design: **nothing appears thirty times** — the head is bare `BW` + the per-set slash list (20 of 44 rows), **seven of twelve `load` shapes rest on a single authored cell**, box-jump **height migrates between the two columns** across the two months, and the em dash is a `notes`-only concern. V1-13 should export from the new model rather than have its formatter written twice. **PLANNED + BUILT 2026-09-23** — [gap3-pr3-entry-set-quantities.md](./plans/gap3-pr3-entry-set-quantities.md),                                                                                                                                                                                                                                                                                                                    |
| hardened by a five-lens adversarial panel (correctness · DB-safety · simplicity · architecture · reuse)  |
| whose two BLOCKING findings both landed: `primary` could not be pinned to `mass` (`broad_jump` and       |
| `hollow-body_hold` are already seeded and measure a length and a duration), and the migration aborted    |
| because drizzle emits a composite FK before the `uniqueIndex` it targets — **one fix for both**, a       |
| `(code, dimension)` primary key. **The six-PR arc is now two**: prod's `entry_sets` is empty (verified), |
| so the backfill and contract PRs were deleted and migration `0011` creates the typed tables and drops    |
| `weight_num`/`weight_label`/`seconds` together. Remaining: the form/UX rewrite, which needs the full UX  |
| panel and V1-22's movement-declared slot sets.                                                           | No free-text load is representable; a weighted box jump needs no special case                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Typed measurement model + unit safety                                                                                                       |

_Exit: kids log a real full day online; CSV keeps the Claude `/retro` workflow alive._

## DUALS — tournament day sheets (parent-facing, data-driven)

A surface aimed at a **wrestling parent on a gym floor**, not at logging. Reusable by design: a
tournament is a JSON dropped into `apps/web/lib/duals/events/`, not new code.

| ID      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Acceptance                                                                                        | Theme                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| DUALS-1 | **Day sheet + weight-by-weight matchups** ([plan](./plans/duals-1-public-day-sheet.md)) — _(Ray, 2026-09-25.)_ `/duals/[event]` and `/duals/[event]/[team]`: a team's pool, its round-by-round opponent order and mat, each round expanding to the weight-by-weight roster pairing. Ships the **2026 Tyrant Columbus Day Duals** (9 Assassins + Wrestling Chix squads, 55 teams, 836 wrestlers). Static JSON, no DB, no DAL, **no migration** — tournament data is public and household-less, so it must not enter the household-scoped schema (D1). Stays **behind the existing access gate** (D4 option 2): a club share for Assassins families, not a publication — the data-rights question for a public launch is deferred and recorded. Teams join on **source UUID, never display name** (the bracket truncates "All I See Is Gold Academy Stripes ES6" to a name shared with another team). | A parent opens a link, sees their squad's round order and mats, and taps a round for the matchups | Parent-facing surface / reusable event data |
| DUALS-2 | _(Next.)_ Live results during the event; a public route (reopens D4); a second event JSON to prove the drop-in contract against a differently-shaped tournament.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |                                                                                                   |                                             |

<a id="pick-1"></a>

## PICK-1 — the movement picker

- **PICK-1 — the only way to name a movement is to type it, and a near-miss mints a catalog row
  nothing can remove.** _(the maintainer, 2026-10-06.)_ V1-19's `fillFromProgram` builds the strength
  form from the day's prescriptions in one tap, and that is the whole of the help: for anything the
  program did **not** prescribe — a substitution ("the rack was busy, so Bulgarians"), an extra
  movement, a thing a kid did that nobody planned — **Add movement**
  (`apps/web/app/p/[profileId]/strength-form.tsx:579`) gives a blank card whose **Movement** field is
  a plain `<input type="text">` with `autoComplete="off"` and no catalog behind it (`:812`–`:823`).
  Whatever is typed goes to `findOrCreateMovementId` (`apps/web/lib/dal/catalog.ts:76`), an
  `INSERT … ON CONFLICT DO NOTHING` keyed on `movementSlug(name)` — so "Bulgarian Split Squats"
  against a catalog holding "Bulgarian Split Squat" is a **second row**, that movement's history is
  split across both, and with no delete action in the app the fix is a `db:correct` correction. **This
  is Logging & Measurement's next item**, and it is deliberately **not a P0**: the hazard is latent,
  not live — what is missing is a capability.

  ⚠️ **One correction to the framing that opened this row**, recorded because the rest of it depends
  on the distinction: the ad-hoc case is **not** unreachable. It is reachable only by typing, on a
  phone, between sets, over a silent and unrecoverable catalog hazard. There is no **picker**; there
  has always been a text box.

  **Acceptance, stated so a test can fail it.** On a day whose program does not prescribe it, an
  athlete selects a movement and submits a set for it, and (1) the stored row resolves to the
  **existing** catalog movement rather than a near-duplicate minted by `findOrCreateMovementId`
  (`apps/web/lib/dal/catalog.ts:76`, unrecoverable through the UI — there is no delete action), and
  (2) **no magnitude arrives prefilled**, the same boundary V1-19's structural test already pins for
  the scaffold.

  **The evidence, measured against the production database 2026-10-06.** 49 live entries — **23
  metric, 19 movement-arm, 7 neither-arm**. The 19 movement-arm entries name **8 distinct movements,
  and all 8 are movements the program prescribes**: **zero ad-hoc entries**, which is zero instances of
  the case AI-1 exists for — _"everything NOT in the program"_, its own Goal
  ([plan](./plans/ai-1-nl-logging.md)). Catalog reach: **35 movements in the live `movements` table, 25
  prescribed, 8 ever logged** (the AI-1 plan's "36" counts `slug:` lines in
  `packages/shared/src/catalog-movements.ts`, a different source). And `entries.notes`,
  `entries.context`, `entries.scheme` are **0, 0 and 0 non-empty out of 49** — entirely unused, and
  they are exactly the fields that would carry the context a sentence expresses and a picker cannot
  ("did Bulgarians instead, the rack was busy").

  ⚠️ **The honest limit, because it is the first thing a reader should test.** Movement-arm logging
  spans **two days**, 2026-09-28 → 2026-09-29, 19 entries. The data cannot distinguish _"ad-hoc never
  happens"_ from _"the only path to it is the text box, so it goes unlogged"_ — and zero ad-hoc entries
  against a catalog that is 35 rows wide while 25 are prescribed is consistent with both. That limit
  argues **for** this row, not for the parser: the picker is what makes the ad-hoc case cheap enough to
  observe at all, and only after it ships can anyone say whether typing a sentence still beats tapping.

  **Why it comes before the parser, on the parser's own terms.** AI-1's safety rule — correctly —
  forbids the model from emitting any magnitude: `extractedSessionSchema` has no numeric field but
  `reps`. So once the safety design has done its work, the model's entire output is _which movements_
  plus _how many sets of how many reps_ — a selection from a closed catalog, plus two small integers.
  The AI-1 plan already accepts the consequence (_"a 30-second plank extracts as one set of one rep and
  the human types the 30"_), which means a sentence saves taps on movement **identity**, not on the
  data entry that actually hurts. A picker plus a set-count control and a reps shorthand produces the
  same prefilled form with no API key, no vendor, no spend bound, no Sentry scrubbing, no
  prompt-injection surface through the movement catalog, and no eval harness as a prerequisite.

  **A plan comes later, in its own PR.** This row is the _what_ and the _why it is next_; it does not
  design the control. Read first:
  [strength-logging](./features/strength-logging.md) · [write-path](./features/write-path.md).

<a id="pick-2"></a>

- **PICK-2 — a type-ahead that suggests real words before a new movement is created.** _(Maintainer,
  2026-10-08.)_ PICK-1 makes choosing an **existing** movement the easy path. This row covers the
  path that remains: a name that is not in the catalog. Before `findOrCreateMovementId` creates a row,
  the field suggests (1) the closest catalog movements, so "Bulgarian Split Squats" offers "Bulgarian
  Split Squat", and (2) correct spellings for misspelled words, so "Bulgarain" offers "Bulgarian".
  Suggestions never block: movement names are full of jargon a dictionary does not know ("Zercher",
  "Copenhagen plank"), so the athlete can always keep what they typed.
  - **English only.** Translating the word list waits on the [i18n](#i18n--externalize-strings-post-mvp-near-the-bottom)
    work, and the maintainer judged it probably not needed.
  - **Performance is a design constraint**, not polish: a full English word list shipped to the
    browser would cost LCP on a phone. Whether matching runs server-side or against a trimmed list
    is a question for this row's plan.
  - **Not covered:** movements that are already misspelled. Those are still fixed with a `db:correct`
    correction; this row only stops new ones.
  - **Gated on PICK-1**, whose picker this extends. **Owes** a plan, the engineering panel, and a UX
    panel (suggestions on a phone, mid-set, must not cost a tap when the name is right).

## AI-1 — NL logging ([plan](./plans/ai-1-nl-logging.md))

⏸ **PARKED 2026-10-06 — off P0, pending `PICK-1` usage data.** _(the maintainer.)_ 49 live entries
carry **zero** ad-hoc movements, so the case this row exists for has not been observed once;
[PICK-1](#pick-1) is next instead, and it is the only thing that can produce the evidence, because
while the only path to an ad-hoc movement is a free-text box, "ad-hoc never happens" and "nobody will
type it" are the same measurement. **The plan and its panel findings stay on file** — eleven
blocking findings across three lenses (correctness, scope, security), recorded in the plan's
§ "Parked 2026-10-06" ([plan](./plans/ai-1-nl-logging.md)) — because the re-grounding work remains
valid and the findings are the reason parking beat fixing.

NL logging via Anthropic structured outputs → human-confirm chip → write, with a 15-case golden eval

- CI accuracy assertion; two separate gates (accuracy is scalar, the never-emits-a-load invariant is
  binary — plan **S4**). The confirm-chip flow **never auto-writes a load.**
- **No longer "pull forward."** It needed "the entry schema + a write path (both present after v1)" —
  both are present, neither is settled. **[ADR 0004](./decisions/0004-typed-measurements.md) replaces
  the measurement columns AI-1 extracts into**, so AI-1 sequences **behind GAP-3**: legacy CSV samples
  → GAP-3 plan + panels → GAP-3 → V1-13 → AI-1. Rationale + the two rejected alternatives: plan **S5**.

## v1.5 — offline (the local-first / distributed-systems phase, isolated)

> **Auth moved out of v1.5** (2026-09-30): Clerk login is pulled forward to [AUTH-1](#auth-1) in
> [Beta 0](./milestones/beta-1.md). The Clerk step below is kept for history.

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

## OSS-1 — open-source readiness (gate before the repo is made public)

> ### ⛔ BLOCKER, 2026-09-30 — the audit below is STALE and one finding is disqualifying
>
> **The audit was performed 2026-08-11, ~45 merges ago.** It predates DUALS-1, the legacy CSV
> samples, the YDP seed, and the kids' first real logged sessions. Do not treat it as current.
>
> **What it missed, because it did not exist yet:** `apps/web/lib/duals/events/` carried a roster of
> **986 named minors who are not Ray's** — first **and** last name, weight and actual weight, across
> Elementary 4th, Elementary 6th, Girls K-12, Middle School and High School — captured from a
> bracketing site with no consent chain. Categorically different from this audit's findings, which
> concern Ray's own family.
>
> **The files are removed** (2026-09-30), and every route is gated again — the `/duals` public-path
> exemption went with them.
>
> ⚠️ **DELETION FROM `HEAD` IS NOT ENOUGH.** The roster remains in **7 commits** of history, and
> publishing the repo publishes its history. Going public therefore requires **rewriting history**
> (`git filter-repo` / BFG) to purge the blob, then a force-push and a re-clone by anyone who has a
> copy. That is the gate, not the deletion.
>
> **Before flipping visibility, also:**
>
> 1. **Re-run the full audit** — it has not seen ~45 merges of new commits.
> 2. **Sweep `gitleaks` over the ENTIRE history**, not just PR diffs. It gates changes; it has never
>    swept the past.
> 3. **Confirm `.env.local` was never committed** — it is gitignored now; that is not the same claim.
> 4. **Decide about the kids' own data deliberately.** First names, a real bodyweight time series, a
>    birthdate column, and now real logged sessions. Ray's call, but it is a minor's health data and
>    publishing is irreversible.

The repo is going public as a portfolio artifact. This section records a **full audit of committed
personal data performed 2026-08-11** and the (small) work that audit actually justifies.

### Audit findings — what is and isn't in the repo

> 🔴 **Superseded 2026-10-07 by [privacy/data-inventory.md](./privacy/data-inventory.md) §9, which is
> now the live inventory of committed personal data.** `PRIV-1` re-walked the tree and the picture is
> broader than this audit, which was already flagged stale in its own blocker box above — **and its
> Assessment is now factually wrong.** Two things changed:
>
> - **~50 files, not 29**, in five classes this audit does not separate: names bound to per-child
>   prescribed loads in shipped source, a whole per-minor program table in `docs/programs/`, real log
>   rows quoted verbatim as documentation examples, dated incidents about a named minor in an
>   **applied migration** and a **shipped component**, and names as **exported API symbols** (so a
>   rename is an API change across a workspace boundary, not a string edit).
> - **"No log data" is no longer true.** A correction merged 2026-10-01 — **after** this audit —
>   committed three live `entries.public_id` values with exact weigh-in timestamps for one named
>   minor (`packages/db/scripts/corrections/registry.ts`). No bodyweight _value_, deliberately. But
>   weigh-in dates and clock times for a named child are log data.
>
> **PRIV-1 raised this to P0 and moved the rename from a follow-up to a Beta 0 blocker.** The tables
> below are kept as the historical record of what was believed on 2026-08-11; **do not cite them as
> current.**

Audited across all 221 commits, not just the working tree.

**Present:**

| #   | What                                                                                                                                                                                       | Where                                                                                                                                    | Severity                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Two kids' **given names** — no surnames. ✅ **Removed from the working tree 2026-10-08** (see the names question below); the role names `Athlete One` / `Athlete Two` stand in their place | 123 refs across 29 files: `packages/db/src/seed.ts`, `packages/shared/src/{seed-ids,programming}.ts`, tests, e2e, and ~14 `docs/plans/*` | Low                                  |
| 2   | The kids' **prescribed S&C program** — sets/reps/loads, transcribed verbatim (`BW`, `BW +5-10`, `65`, `60`, `30`, `25`, `20/DB`, `15/DB`; reps like `4, last AMRAP` vs `5, last AMRAP`)    | `packages/shared/src/programming.ts`, `docs/plans/v1-10-*`                                                                               | Low                                  |
| 3   | One **bodyweight fixture value** — `72.5` lb                                                                                                                                               | `apps/web/lib/entries/entry-label.test.ts` (×2, a label assertion)                                                                       | Negligible                           |
| 4   | Ray's own full name                                                                                                                                                                        | `docs/plans/v1-10-two-week-program-source.md` frontmatter (`author:`)                                                                    | None — desirable on a portfolio repo |
| 5   | Ray's own PPL movement templates                                                                                                                                                           | `packages/shared` catalog seed                                                                                                           | None                                 |

**Confirmed absent** (each checked, not assumed):

- ❌ **No birthdates.** `profiles.birthdate` exists as a column but is explicitly _reserved_ — never seeded, never written, no UI.
- ❌ **No real logged training history.** Actual entries live in the Neon database, not the repo. The repo ships schema + catalog seed + fixtures only.
- ❌ **No screenshots.** `.screenshots/` is gitignored — `git ls-files` returns **0** tracked files.
- ❌ **No data dumps.** Zero committed `.csv` / `.sql` / dump files; no deleted-then-recoverable data files anywhere in history.
- ❌ **No contact data.** No emails, phone numbers, addresses, or photos.
- ❌ **No secrets.** The only file ever committed under `.local-secrets/` is its `README.md`, which deliberately documents _which_ files are gitignored without containing any of them. `.env*` was never committed. `gitleaks` runs on every PR (`.github/workflows/ci.yml`).

### Assessment

> ⚠️ **This Assessment is wrong as of 2026-10-07 and is kept only as the record of what was believed.**
> Read [privacy/data-inventory.md](./privacy/data-inventory.md) §9 instead. The specific sentence that
> failed is the one about log data, and it failed because a correction landed _after_ this was
> written — which is the argument for the inventory being a live document with a staleness command
> rather than a dated audit.

**The exposure is two first names plus a youth strength program.** ~~There is no measurement history, no
date of birth, no health record, and no log data.~~ There is **no date of birth** (still true) — but
there _is_ committed log data: weigh-in dates and clock times for a named minor, in
`packages/db/scripts/corrections/registry.ts`, plus per-child prescribed loads bound to names in
shipped source and in `docs/programs/`. Earlier planning notes described this as "minors'
health data"; this audit dismissed that as **inferred from the schema's capability rather than from
what is actually committed**, and on the narrow question of bodyweight _values_ that dismissal still
holds. On the broader question it does not.

The one real (and modest) consideration: the repo will be linked from a resume and LinkedIn under
Ray's real name, so publishing creates a permanent, searchable association of the form _"Ray Baker's
kids are named <these two>, and this is their training program."_ That is a mild disclosure, but
unlike mentioning it at a meet it does not decay. Whether that matters is a judgment call, not a
security finding.

### Tasks

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Required?                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| 1   | ✅ **DONE 2026-10-08** — the names question was decided (option **(c)**, below) and the sweep landed: the two given names are out of the working tree, replaced by the role names `SEED_PROFILE_NAME` / `SEED_PROFILE_2_NAME` (`Athlete One` / `Athlete Two`). `db:verify`, the golden vectors and e2e stayed green, and the A≠B routine contrast survives as `SEED_ATHLETE_TWO_ROUTINE`. Two sites were **scrubbed, not renamed** — see [data-inventory](./privacy/data-inventory.md) §9. | **Done**                  |
| 2   | Change the `72.5` bodyweight fixture to an obviously-synthetic value.                                                                                                                                                                                                                                                                                                                                                                                                                      | Nice-to-have              |
| 3   | **Public-facing `README` rewrite** — the current one is written for Ray. Lead with the architecture, the migration discipline, and the AI-1 eval harness: the parts that carry portfolio signal.                                                                                                                                                                                                                                                                                           | **Yes**                   |
| 4   | **Add a `LICENSE`.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Yes**                   |
| 5   | Confirm no Neon / Vercel / Clerk project identifiers, deploy URLs, or org slugs leak via docs or CI config.                                                                                                                                                                                                                                                                                                                                                                                | **Yes**                   |
| 6   | Ensure the AI-1 15-case golden eval fixture uses synthetic data from the start.                                                                                                                                                                                                                                                                                                                                                                                                            | **Yes** (when AI-1 lands) |

### The names question — RESOLVED 2026-10-08, option (c)

> ⚠️ **"It's binary" was wrong**, and the framing below is kept only as the record of what was believed.
> It assumed the only value of a rename is removing the name from history. The third option the framing
> missed — and the one taken — is to rename in the working tree **for the forward exposure alone**: every
> future commit, screenshot, preview and PR diff is then clean **by construction**, which is what matters
> once another family is invited in (`TEN-1`). It buys nothing against `git log -S`, and the PR said so.

A working-tree-only rename does not reach history: `git log -S` on either removed name still finds it
across 221 commits, and the commit author is in every commit regardless. The original framing:

- **(a) Leave the names.** Justified by the audit — the exposure is genuinely small.
- **(b) Rename _and_ rewrite history** with `git-filter-repo`, then verify against a fresh clone.
- **(c) Rename the working tree only** — ✅ **TAKEN.** Closes the forward exposure, leaves history
  untouched, and does not pretend otherwise. History rewriting stays available and un-chosen.

⚠️ **`git-filter-repo` rewrites every commit SHA.** With branch protection on `main` this means a
force-push and a re-clone. The ~40-PR incremental narrative survives a filter-repo (unlike a squash,
which would destroy it — squashing is _not_ recommended for this repo, since that history is itself
portfolio evidence).

**Recommendation: (a).** The marginal privacy gain does not justify rewriting 221 commits, and the
risk of botching the rewrite is real. Revisit only if the names turn out to matter to Ray.

### ✅ Audit revision — 2026-09-18 — RESOLVED before merge (supersedes findings #2 and #3, and the Assessment)

> **Outcome first: the exposure below never reached `main`.** Option (c) was taken — the samples were
> **synthesised on the PR branch before merge**, so findings #2 and #3 revert to their original
> severities and no history rewrite is needed. The analysis is kept because it is the reasoning that
> produced the fix, and because it records _why_ the audit's own logic had to be re-derived.

The audit above was performed **2026-08-11** and was accurate then. **Landing the legacy CSV samples
([`docs/samples/legacy-csv/`](./samples/legacy-csv/README.md), PR #121) falsifies four of its
load-bearing claims.** The original is kept verbatim above as the dated record; this revision is what
holds.

**What the samples changed:**

| Original claim                                                                             | Now                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| ❌ "No real logged training history… the repo ships schema + catalog seed + fixtures only" | **False.** 44 rows of real logged sessions, two named athletes, June–July 2026              |
| ❌ "No data dumps. Zero committed `.csv` / `.sql` / dump files"                            | **False.** 8 committed CSVs                                                                 |
| #3 "One bodyweight fixture value — `72.5` lb" · **Negligible**                             | **14 real dated weigh-ins** (7 per athlete) with `context` — a _time series_, not a fixture |
| Assessment: "no measurement history… no log data"                                          | **False on both.**                                                                          |

**Re-rated findings:**

| #         | What                                                                                                                                                                                                                                                                          | Severity                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 3 _(rev)_ | **A named minor's bodyweight time series** — 14 dated weigh-ins, plus **both athletes' ages**, stated in `bodyweight/README.md`. ✅ Both scrubbed before merge (values and ages replaced/removed); the ages were restated in THIS row until `OSS-1`'s sweep took them out too | **Medium** _(was Negligible)_ |
| 2 _(rev)_ | The prescribed program, **plus 44 rows of what was actually performed** — loads, failures, `SKIPPED`, coaching notes naming each kid                                                                                                                                          | **Low–Medium** _(was Low)_    |

**The assessment's central argument no longer holds.** It dismissed the "minors' health data" framing
explicitly:

> _"that was **inferred from the schema's capability rather than from what is actually committed**, and
> the audit does not support it."_

That reasoning was sound on 2026-08-11 and is now simply out of date — the data is committed. Whether
a child's bodyweight series is "health data" in a regulatory sense is a separate question; what matters
here is that **the stated grounds for dismissing the concern are gone.**

**What is now jointly disclosed**, which is the thing to weigh: Ray's real full name (desirable, #4) +
two first names + **both ages** + a dated bodyweight series + complete training logs. That is a
materially different object from "two first names," and it is the combination — not any single
field — that makes it so.

### The revised decision — and it is time-sensitive

The original "names question" framed this as binary: leave it, or rewrite 221 commits. **The samples
open a third option that did not exist before, and it is the cheapest of the three.**

- **(c) Synthesise the samples. _(Recommended.)_** Their job is to be **evidence for GAP-3's column
  design** — and that value lives entirely in the **shape vocabulary** (`BW`, `BW+8 (vest)`, `30in`,
  `20s`, `123 (50ft)`, `65/65/65`, `sub-failure`, `SKIPPED`), not in which child weighed what on which
  date. Replace names, dates and values; **keep every distinct shape and its frequency** — frequency
  matters, since ADR 0004's whole worry was "a `distance_unit` for one sled row while missing something
  that appears thirty times." The shape taxonomy is already extracted (this README and PR #121), so the
  synthesis is mechanical and loses nothing.
- **(a) Leave everything.** Still defensible for findings #1/#2 in isolation; much weaker now that ages
  and a weight series are in the set.
- **(b) Rename + `git-filter-repo`.** Unchanged, and now strictly larger — it would have to cover the
  CSVs too.

✅ **Done — (c) was taken, 2026-09-18, before merge.** Athlete names, dates and bodyweight values are
replaced; **all 44 strength rows and 14 weigh-ins are kept**, and a **68-shape taxonomy** across `load`,
`reps`, `sets`, `prescribed` and `session_type` was extracted before the scrub and diffed after —
**byte-identical**, so the GAP-3 evidence is intact. Frequency was preserved as well as presence, which
is what ADR 0004 actually asked for. See
[samples/legacy-csv/README.md](./samples/legacy-csv/README.md).

**Net effect on this audit:** findings #2 and #3 return to **Low** and **Negligible** — not because the
original assessment was re-argued, but because the data it was re-rating is no longer in the repo. The
2026-08-11 assessment's conclusion stands; the samples never became a counter-example to it.

**The names question (#1) is untouched** and its recommendation **(a)** still holds on its own merits.

**Note (a) and (c) are independent.** (c) removes the new exposure without touching the names question;
the original recommendation of (a) for findings #1/#2 can stand on its own merits.

### Sequencing

Land **AI-1 first**, then OSS-1, then flip visibility. AI-1 is the reason the repo is worth
publishing; publishing before it lands ships the artifact without its headline.

**Amended (AI-1 plan S5):** AI-1 still precedes OSS-1, but it is no longer the _next_ thing — it sits
behind GAP-3, which sits behind the four legacy CSV samples. The samples are therefore the gate on
going public, not just on V1-13.

**Amended again (2026-10-06):** moot, both ways. OSS-1 landed and the repo is public, and **AI-1 is
parked** off P0 pending [PICK-1](#pick-1) usage data. Kept for provenance.

## OSS-2 — a public landing screen at `/`

- **OSS-2 — a public landing screen at `/`.** _(Ray, 2026-10-01, after OSS-1 made the repo public.)_
  An unauthenticated visitor — the link on Ray's resume — gets a page that says what mat-plan is and a
  link to the source, instead of a bare password prompt. **The profile picker moves to `/p`.** The gate
  is unchanged and still guards every other route.
  [Plan](./plans/oss-2-public-landing.md) (eight-lens panel; two blocking defects found before any code
  — see its review-response log).

  **Three PRs, in this order:**

  1. ✅ **§A — the public route** (#216): `/` public, picker → `/p`, copy + one link into the README's
     own "what's interesting here", `app/loading.tsx` → `app/p/loading.tsx`, the gate matcher's
     unanchored lookahead fixed, a `pages-are-gated` test, `/` and `/gate` axe-scanned un-gated for the
     first time, and every `'/'`-means-the-app-home literal routed through `APP_HOME_PATH`.
     **Built from mockups, with Ray's copy cuts:** the landing is the mark + name, one lead sentence,
     the origin line and the two stacked CTAs. Ray removed the README hook and the gate-explanation
     line after reviewing the UX-panel mockups; `/gate` loses "Private preview."; the CTA reads "See
     how it's built on GitHub". Deviations from the plan are listed in the PR.
  2. ✅ **OSS-1 follow-up — the seed fixtures no longer carry the household's given names** (2026-10-08).
     Decided by the maintainer 2026-10-01; re-scoped and raised to a Beta 0 blocker by PRIV-1
     (2026-10-07). PRIV-1 said three files; the real surface was **57 files / 309 occurrences**, across
     the five classes §9 inventoried **plus a sixth §9 missed** — real **bodyweight values** quoted as
     contract examples, which is the one class [SECURITY.md](../.github/SECURITY.md) singles out as
     privileged. All now **0** except one, listed below. The fixture identities are role names behind
     `SEED_PROFILE_NAME` / `SEED_PROFILE_2_NAME` in `packages/shared/src/seed-ids.ts`, so the next
     rename is two lines rather than another fifty-file sweep, and `db:verify` pins the literal once so
     a real name cannot come back unnoticed.
     - **The exported symbol took a clean break, not an alias:** the second profile's seeded-routine
       export is now `SEED_ATHLETE_TWO_ROUTINE`. All three consumers are in-workspace and `@mat-plan/db` is
       `private: true`, so there is no downstream to deprecate for — and an alias would have left the
       name in the API surface, which is the thing being removed.
     - **Two sites were scrubbed, not renamed** (a rename only de-labels real training data): the
       per-athlete load/rep columns in `docs/programs/kids-sc-foundation-archived.md` are **deleted**,
       and the CSV contract's example rows now quote the already-scrubbed
       [`docs/samples/legacy-csv/`](./samples/legacy-csv/README.md) corpus verbatim. Reasoning in
       [data-inventory](./privacy/data-inventory.md) §9.
     - ⚠️ **One deliberate residual:** `packages/db/migrations/0012_bodyweight_one_per_day.sql` carries a
       given name in a **comment**. It is an **applied** migration, and the forward-only guard allows only
       **added** files under `packages/db/migrations/` — editing it is the one thing the DB rules forbid
       outright, for a comment. Left, and recorded in §9.
     - ⚠️ **A rename is not a removal:** `git log -S` finds every prior value and the commit author is in
       every commit. What it achieves is the **forward** exposure — every future commit, preview and PR
       screenshot is clean by construction. History rewriting was not in scope and was not done.
     - ⚠️ **Live databases keep the names they were seeded with.** The seed is `onConflictDoNothing` on
       `public_id`, so a rename reaches **fresh databases only**. Production holding the household's own
       names is correct; it is their data. The **OPS-1 preview project** was migrated and seeded
       (runbook step 3, 2026-10-08) from the OPS-1 branch **before** this rename merged, so it still
       carries the old fixture names. It is disposable and takes the rename by being **reset** (delete
       the project's data, then re-run step 3 from `main`), not corrected.
  3. **§B — the hero image.** Deliberately last: 🔴 **`next/image` on a `public/` asset is broken in
     this app today** — measured, 400 for every caller, gated or not, because the optimizer's internal
     fetch re-enters the proxy with no cookie. §B un-gates `public/landing/`, scopes
     `images.localPatterns`, sets `metadataBase`, and narrows `ci.yml`'s inert-file allowlist so an
     image that is now **served content** can no longer auto-skip the smoke.

  ⚠️ **Does NOT include sign-in.** The "Sign in with Google" half of the original ask is
  [AUTH-1](#auth-1), which is several PRs behind the household-addressing ADR
  ([beta-1](./milestones/beta-1.md) orders it `ADR → TEN-1 → AUTH-1`). The landing fixes the resume link
  on its own; an env flag that merely turns the gate **off** is rejected — with no auth behind it, its
  only reachable state publishes two children's logged health data.

## OBS-1 — observability, after beta launch

- **OBS-1 — observability, and a study of what modern observability actually looks like.**
  _(maintainer, 2026-10-05)_ **A milestone, sequenced AFTER beta launch** — but the design decisions it
  depends on have to be made before, which is the point of filing it now.

  **The study comes first, and it is not tooling shopping.** Four questions it has to answer with
  evidence rather than vendor copy: what is worth measuring on a three-household app; what changes at
  thirty; which of it is _system health_ (vendor's job) versus _product metric_ (ours, from Postgres);
  and what the privacy posture is for an app holding minors' training data, where sending behavioural
  events to a third party is a decision and not a default.

  🔴 **The blocker is already known and it is one thing: the CSP.** `proxy.ts` ships a nonce-based
  policy with `connect-src 'self'`, and `next.config.ts:24` records the consequence —
  _"the front-end SDK isn't shipped (the CSP's `connect-src 'self'` would block its ingest POST
  outright)"_. So **client-side JavaScript errors are invisible in production today**, and
  [ADR 0001](./decisions/0001-observability-and-web-vitals.md) defers Speed Insights to the prod
  cutover for an entangled reason. One decision — a same-origin tunnel route versus widening
  `connect-src` — unblocks client errors, Core Web Vitals RUM, and any analytics. Make it once.

  **What is already wired:** Sentry server-side, with `withServerActionInstrumentation` mandatory on
  every Server Action (AGENTS.md), source maps deliberately disabled so frames are minified
  ([tech-debt](./tech-debt.md)).

  **No event bus.** Kafka and friends solve fan-out to independent consumers with replay, at a
  throughput a database cannot absorb. This app writes a few rows per athlete per day; Postgres is the
  event log, and `entries` already is the event stream. Revisit only if an independent consumer needs
  replay — not before.

- **OBS-2 — synthetic monitoring: live flows, verified against the deployed system.** _(the maintainer,
  2026-10-05.)_ The Playwright smoke proves the code works at merge. It cannot see a bad env var, an
  expired key, a failed migration or a provider outage — only a test running against the deployed
  system can. Two personas at minimum: **first run** (no athletes → add one → default workout → first
  log) and **returning household** (history, streaks, export).

  ⚠️ **The design consequence lands long before this milestone.** A synthetic household lives in
  production and its rows must be excluded from every aggregate — adherence, streaks, export,
  dashboards — or the monitor quietly pollutes the numbers it exists to protect. Retrofitting that is a
  `WHERE` clause added to every query, which is the kind of thing that gets missed in exactly one
  place. **TEN-1 carries the flag as a column** — `households.synthetic`, shipped dark in its chunk
  1a (migration 0014) — so OBS-2 does not pay for a migration.

  ⚠️ **Two corrections from TEN-1's panel, 2026-10-07, that OBS-2 must not re-derive.** (a) The flag
  is **not** a field on TEN-1's `HouseholdScope`, and "honoured at one seam" does not work as written:
  `getHouseholdScope()` resolves _the household of this request_, so a per-request single-tenant scope
  cannot exclude a household from a **cross-household** aggregate — which is what adherence, streaks,
  export and dashboards are. OBS-2 reads the column where it needs it. (b) **A synthetic household
  must not exist in production before AUTH-1:** until then `getHouseholdScope()` resolves THE single
  live household and throws on ≥2, so creating one takes the app down. OBS-2 is therefore strictly
  post-AUTH-1. The seed must also never name the column — on a fresh or restored database it inserts
  the real household's row, so a seeded value would label a real family's data a test fixture.

  The first-run persona writes real rows on every run, so it either targets a non-production
  environment or is self-cleaning by construction. Decide that in the OBS-2 plan, not in the runner.

- **TEST-1 — every major workflow has a smoke test.** _(maintainer, 2026-10-05)_ Audited 2026-10-05: nine
  spec files cover the gate, bodyweight (log, amend, receipt), day navigation, the scaffold submit,
  export, prefetch and a11y. **Four shipped write surfaces have no functional spec at all:**

  | Surface                                | Today                              | Why it matters                                                                              |
  | -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
  | **Routine editor** (`/p/<id>/routine`) | a11y scan only                     | A whole write path — add, remove, reorder, persist — with no end-to-end proof.              |
  | **Life activities** (`life-form.tsx`)  | nothing, anywhere                  | One-tap logging, entirely untested.                                                         |
  | **Supersets**                          | a11y scan only                     | Its own module and schema shape; grouping is the most intricate thing in the form.          |
  | **Check-ins**                          | reached only via `export-full-day` | And `docs/lessons.md` carries an **unresolved** dossier on a silently-lost check-in submit. |

  An a11y scan proves a page renders and is reachable by keyboard. It proves nothing about whether a
  save works. Each gap is one spec on the existing `e2e:local` harness; no new infrastructure.
  **Do this before the authoring milestone**, because Milestone 1 rewrites the routine editor and the
  form, and a rewrite without a regression net is how a shipped behaviour disappears unnoticed.

- **TEST-2 — fixture personas with varying datasets, derived from production SHAPES, never its data.**
  _(maintainer, 2026-10-05)_ **No to a production
  proxy, and the repo already ruled on it:** [beta-1](./milestones/beta-1.md) OPS-1 rejects a Neon
  branch of prod precisely because it _"clones every family's bodyweight into every preview"_. A proxy
  also makes tests non-deterministic — the data moves under them, so a failure is not reproducible.

  **What is actually wanted is the variety, not the data.** Census production for its _shapes_ — mixed
  `kg`/`lb` households, duplicate weigh-ins on a day, partial sessions, long gaps, a year of history,
  an empty household — and encode each as a named, deterministic fixture. GAP-3's shape census
  ([the census](./plans/gap3-typed-measurements.md)) is the precedent: it inventoried twelve real
  `load` shapes and designed against them without copying anyone's numbers.

  The idiom exists: `screenshot-ephemeral.ts`'s named `--state` seeders, and the `--use-live-db`
  opt-in guard that makes touching real data a deliberate act rather than a default. Personas extend
  that, one level up.

- **UI-2 — restyle the UI with a motion component framework (Aceternity UI / Magic UI / similar).**
  ✅ **DECIDED 2026-10-07: take the token path, not the framework path.** _(maintainer.)_ The reskin
  happens in the OKLCH tokens (**UI-3**) and the theme switch is its own row (**UI-4**). No
  `framer-motion`, no copy-paste component library, on the logging path. The **landing page**
  (`app/(landing)/`, OSS-2) is the one surface where the question stays open — if it is revisited there
  it needs its own prototype and panel, and nothing from it leaks into `app/p/`. The rest of this row
  is kept as the reasoning behind that decision, because the costs it records are the reason.
  _(maintainer, 2026-10-07.)_ Requested as a backlog item, not a decision. Both are Tailwind +
  **Framer Motion** component collections distributed copy-paste in the shadcn-registry style, so
  adopting one is not a dependency swap — the components become **our** code, and `framer-motion`
  becomes a runtime we did not have (today `apps/web` carries only `tw-animate-css`, which is CSS, not
  JS).
  **First, split the question, because "restyle" has two very different answers here.**
  [design.md](./design.md) is explicitly token-driven and already answers one of them: _"Components
  never hardcode colors; they use the semantic tokens below. **To reskin, change the tokens, not the
  components.**"_ So:
  - **A reskin** — palette, typography, spacing, radius, density — is a change to the OKLCH tokens in
    `apps/web/app/globals.css` plus the type scale. No new runtime, no new client components, no a11y
    risk, and it is reversible in one file. If what is wanted is "it should feel different", this is
    the cheap path and it should be tried **first**.
  - **New component archetypes** — animated beams, spotlight/aurora backgrounds, marquees, meteors —
    is what these libraries actually sell, and it is a different proposition with real costs below.
    **Where it is plausibly a yes:** the **public landing page** (`app/(landing)/`, OSS-2). That is a
    marketing surface, it is the one screen whose job is to impress rather than to be used between sets,
    and it carries none of the logging app's constraints. A showcase aesthetic belongs there.
    **Where the default answer is no, and why — each of these is a standing rule, not a preference:**
  - **`AGENTS.md` → Design: "adult-first, clean — NOT a kid aesthetic."** These libraries' signature
    components are glow/aurora/meteor effects built for landing pages. On a logging form they read as
    decoration, and decoration is the thing that rule excludes.
  - **RSC-first, minimize `'use client'`** (`AGENTS.md` → Architecture rules). Framer Motion
    components are client components by necessity, so a broad adoption pushes the logging path
    client-side — the opposite direction from the stated architecture.
  - **The CWV budget is first-class**: LCP < 2.5s · INP < 200ms · CLS < 0.1, **p75 mobile**
    ([ADR 0001](./decisions/0001-observability-and-web-vitals.md)). Framer Motion is ~100KB+ gzipped
    before tree-shaking, and INP is the budget animation spends first. ⚠️ **Nothing measures this
    budget today**, so "it still feels fine" would not be evidence.
  - **The actual use context.** Kids log on a **phone, on a gym floor, between sets**. Motion that
    delays a tap is a direct cost there, and `prefers-reduced-motion` has to be honoured throughout.
  - **A11y regression risk.** Animated and absolutely-positioned components routinely break
    focus-visible, ≥44px targets and the 360px layout. `e2e/a11y.spec.ts` gates tap targets and 360px
    overflow on three routes only, so most of the surface has no automated guard — the reviewer is it.
    **Acceptance (what would make this decidable, rather than arguable):** a prototype on **one** real
    screen at all three widths, with a measured before/after bundle delta and an INP figure on a
    mid-range phone, reviewed by a **UX panel before any broad adoption** (`AGENTS.md` → UI PR rules).
    If the token-only reskin satisfies the want, this row closes as "answered more cheaply".
    **Sequencing:** this is a **seam** — it touches every pillar's UI — so per
    [roadmap.md](./roadmap.md) it does not parallelize and must land before, not beside, the pillars
    that consume it. The _decision_ belongs in `docs/decisions/` as an ADR; the _implementation_ is
    cross-pillar. It is **not** a P0: nothing is broken, and PICK-1 and the Beta 0 milestone are ahead
    of it.

- **UI-3 — reskin in the tokens, with real options instead of the default.** 🎨 _(maintainer,
  2026-10-07.)_ The chosen half of **UI-2**. The ask in the maintainer's words: make it _"feel less out
  of the box and cookie cutter."_
  ⚠️ **That is literally accurate, and measurably so: every colour token is `oklch(L 0 0)` — chroma
  exactly zero — in both `:root` and `.dark`.** Even `--primary` is a dark grey
  (`oklch(0.205 0 0)`). This is shadcn's stock neutral theme, unmodified, which is exactly why it reads
  as a template. [design.md](./design.md) describes the zero-chroma base as a deliberate choice
  ("calm and grown-up"), and it was — but "restrained" and "uncustomised" have been the same thing so
  far, and they do not have to be.
  **The levers, all token-level, no new runtime:**
  - **Give the neutrals a hue bias.** A grey with a slight chroma pull toward the accent reads as
    chosen; `chroma 0` reads as a default. This alone is most of the effect.
  - **Commit to a type pairing.** Currently the stack default. A display/body pairing via `next/font`
    (no FOUT, no layout shift) is the single biggest change to how a page _feels_.
  - **Pick a density and radius signature** — spacing scale and `--radius` — so the app looks like one
    product rather than assembled parts.
  - **An accent that carries meaning**, kept separate from semantic good/warn/destructive.
    **Acceptance: more than one option, reviewed side by side.** Produce **three** distinct token sets,
    each applied to the same two real screens (Today and the strength form, the two that matter),
    captured at **mobile / tablet / desktop** and in **both themes** — which is why **UI-4 lands
    first**. A UX panel picks one or sends them all back (`AGENTS.md` → UI PR rules). Not a single
    take-it-or-leave-it proposal, and not a mood board — real screens with real data.
    ✅ **UI-4 built most of the apparatus** ([plan](./plans/ui-4-theme-switch.md)): the switch, plus
    **`/design/tokens`** — gated, `noindex` — rendering **four candidate sets** (a control that
    declares nothing, plus Forge / Tatami / Clinch, each with a hue-biased ramp, a committed accent
    and a radius + density signature) against the app's real components, with **measured** WCAG
    ratios on the page and asserted in the fast test tier. `screenshot:ephemeral --theme light|dark`
    now exists, so the both-themes × three-widths capture is one flag.
    **What this row still owes, stated so it is not lost:** the harness renders the **real**
    `ProgramReference` and the **real** `SetRepsWeightFields`, but not Today and the strength form
    _as pages with seeded data_ — that mechanism (a validated `?tokens=<id>` on `app/p/`, plus
    `--tokens` on the capture script) is UI-3's first step, deliberately not built in UI-4 because it
    would have put candidate CSS on the hottest route in the app.
    **Two acceptance lines added by the UX panel:** (1) before choosing, open the preview on the
    phone the logging actually happens on, in gym light **and** daylight, in both themes, and record
    the device and lighting in the decision — three of the four rationales appeal to a physical
    environment that is unfalsifiable from a desk; (2) **this row's PR deletes `app/design/tokens/`**
    and its entry in `e2e/a11y.spec.ts`'s `ROUTES`. A harness kept past its decision is a CI cost
    paid forever for a choice made once.
    ⚠️ **Three inputs UI-4 measured and could not fix** (fixing them means changing `:root`, i.e.
    changing the live app's look, which UI-4 ruled out): `muted-foreground` on `muted` is **4.34:1**
    in light; the `destructive` button variant is **4.39:1** light and **3.04:1** dark on a card (it
    has zero call sites, which is the only reason CI is green); and hairlines miss SC 1.4.11's 3:1 in
    both themes (**1.26:1** light, **2.69:1** dark). All four candidate sets clear AA on every text
    pair in both themes, and Clinch clears 3:1 on hairlines too. Pinned in
    `app/design/tokens/token-sets.test.ts`, so fixing one tells you to delete its row.
    **Constraints that do not move:** contrast ratios stay AA, `MIN_TAP_TARGET_PX` stays, the 360px
    layout stays, and the kid-ergonomics defaults in [design.md](./design.md) stay. A reskin that breaks
    `e2e/a11y.spec.ts` is not a candidate. **Reversible in one file** — that is the whole appeal of the
    token path, and the reason it beats UI-2's framework path on risk as well as cost.
    **Not a P0.** It is a **seam** (every screen), so it does not parallelize. PICK-1 and Beta 0 are
    ahead of it.

- **UI-4 — a light/dark theme switch, which the tokens are already paid up for.** ✅ **SHIPPED**
  ([plan](./plans/ui-4-theme-switch.md)). 🌓 _(maintainer, 2026-10-07.)_ Requested alongside UI-3, and
  it landed **first**, because reskin options have to be reviewable in both themes.
  ⚠️ **Dark mode is fully defined and completely unreachable today.** `globals.css` carries a
  **33-line `.dark` OKLCH palette**, and: nothing ever sets `.dark` (no `next-themes`, no provider, no
  toggle — zero matches in `app/`, `components/`, `lib/`), and there is **no `prefers-color-scheme`
  fallback either**. So the dark palette has never rendered for anyone. [design.md](./design.md):64
  says this honestly — _"A theme toggle lands in a later PR; the tokens already support both"_ — but
  its opening line claims components _"adapt to light/dark **automatically**"_, which is not true while
  nothing sets the class. **Fixed in this PR**; the row is what makes it true.
  **What it takes:** a provider that sets the class on `<html>`, a toggle, persistence, and
  **`suppressHydrationWarning` plus a pre-paint script so there is no flash of the wrong theme** — the
  one genuinely fiddly part, and the reason this is a row and not a one-liner.
  **Decisions the row owes:** three states or two (system / light / dark — **system should be the
  default**, so a viewer's OS preference is honoured before anyone touches anything); where the toggle
  lives on a phone, where header space is scarce; and whether it is per-device (`localStorage`) or per
  profile (a DB column). ⚠️ **Per-device is the right default** — a theme is a property of the room you
  are in, and the gym is lit differently from the kitchen.
  **Acceptance:** both themes pass `e2e/a11y.spec.ts` (axe AA contrast is checked, so the dark palette
  gets its first real audit), no flash on load, the choice survives a reload, and screenshots at three
  widths in both themes. Small, self-contained, genuinely useful, and it unblocks UI-3's review.
  **What shipped, against that:** three states with **Auto** as the default, per-device
  `localStorage`, the control on the **profile picker only** (the panel priced a root-layout bar at
  ~52px on every screen — Today already spends ~300px above the first logging surface at 390px), and
  **both themes pass the a11y scan on all four routes**: the dark palette's first audit is clean.
  "No flash" is asserted by mechanism, not end state — the nonce on the rendered script must match
  the response's CSP header and the first class mutation must land at `readyState === 'loading'` —
  and a negative control (nonce removed) was run to prove both go red. Three sub-AA pairs in the
  **light** palette were found on the way and are recorded below.

- **UI-1 — the form is the day: the program card becomes the rendered form.** _(maintainer,
  2026-10-06.)_ Today shows a read-only program card listing the day's movements, then a button that
  scaffolds those same movements into the form below — **the same list twice**, and `PROGRAM_SEED` is
  `open()` on 11 of 13 prescriptions, so for most rows the card shows a bare name the form repeats.
  Replace both with the form itself: the day's movements rendered as **collapsible drawers**, the
  prescription as text on each summary line, the form as the single source of truth for what was
  performed.

  **This does NOT need scheduling.** `programDayRows` already returns the day's prescriptions — it is
  what the scaffold button already consumes. What needs schedules is _which_ workout lands on a day,
  not whether the form can render one. (An earlier draft of ADR 0005 conflated the two and deferred
  this; that was wrong.)

  **The mechanism is already shipped**: `strength-form.tsx` collapses scaffolded cards to a one-line
  summary, one open at a time (V1-19, against the ~6,600px of blank inputs a flat scaffold renders at
  360px). This makes that the default instead of hiding it behind a tap, and puts `target_reps` on the
  summary — the V1-23 follow-up, which never carries `load`.

  ⚠️ **One trap, and one stale reason not to worry about it.**
  - `program-reference.tsx` says the card sits outside the form because "the form remounts on
    `key={gen}` after every logged session, so a React-state disclosure inside it would RE-EXPAND on
    every log." **That is now stale** — `strength-section.tsx` keys the form on `strength-${day}`, so it
    remounts on a day change only. Drawer state already survives a save. Fix the docblock in the same PR.
  - The live trap is the other one: a `<details>`-hidden **`required`** input deadlocks the native
    submit with an invisible "not focusable" error. Drawers containing required fields cannot be native
    `<details>`; the shipped collapse keeps inputs mounted, which is why it works.

  **Derive the drawer state from progress** rather than persisting it: saved movements collapse, the
  next one opens. More useful than restoring whatever happened to be open, and nothing to store.

  **Parallelizable** with onboarding once its deck is reviewed, because the data contract is small and
  stable: `(the household's default unit, the day's prescriptions, what is already logged) → the form`.

- **SET-1 — settings: the household's preferred units.** _(maintainer, 2026-10-06.)_ There is no
  settings surface and no household unit preference; `DEFAULT_BODYWEIGHT_UNIT` is an app constant.
  ⚠️ **GAP-3 already decided the shape and it is the part that matters:** the household preference is a
  **default for new rows only** — the resolved unit is stored ON the row, because "a
  household-preference-only design silently reinterprets all history when the preference changes
  (45 lb → 45 kg)". A settings screen writes a default; it never reinterprets anything already logged.

- **OBS-3 — analytics and consent, as one optional milestone.** _(maintainer, 2026-10-06.)_ They are one
  decision, not two: the app's two cookies (`mp_gate`, `tz`) are **strictly necessary**, which needs no
  consent, and a banner only becomes required when tracking cookies appear. **Optional by design** —
  and the cheapest version may be to never need it: the onboarding funnel, entry rate and workout
  completion % are all answerable from `households`, `profiles` and `entries` timestamps, which are
  already stored lawfully to deliver the service. First-party rows, no third party, no banner, and no
  consent dialog sitting in the middle of the funnel being measured. Exhaust that before reaching for a
  library. See [OBS-1](#obs-1) for the system-health half, which is a separate concern.

- ✅ **SEC-5 — the production audit is a CI gate.**
  _(maintainer, 2026-10-06.)_ `audit --prod --audit-level high` lived inside `pnpm verify`, and **no CI
  job ran `pnpm verify`** ([tech-debt](./tech-debt.md)), so an advisory reached `main` with CI fully
  green **four times** — and all four were found by accident:

  | Advisory                                                       | Severity            | How it was caught                                                  |
  | -------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
  | GHSA-vcvr-r3jv-pc5j (`next` RCE)                               | critical            | a local `verify` during unrelated work, 2026-09-30 (#182)          |
  | GHSA-68fv-2mgg-jv7q (`source-map-js` DoS)                      | high                | a local `verify` during unrelated **docs** work, 2026-10-06 (#222) |
  | GHSA-hrr3-gc8f-f4qj (`fast-uri`) + a **critical** `proxy-addr` | moderate / critical | a sweep during unrelated work, 2026-10-06 (#227)                   |
  | GHSA-wq5f-xc86-pv6w (`sharp` → librsvg)                        | high                | unrelated **feature** work, 2026-10-06 (#235)                      |

  Four accidents, and each earlier fix patched the advisory rather than the gate.
  ✅ **Implemented:** `pnpm audit:check` (`.github/scripts/check-audit.mjs`) is the single definition,
  run identically by `pnpm verify` and by `ci.yml`'s `quality` job, failing on any `high` or `critical`
  in the `--prod` tree; its 19-case self-test runs before the install so a broken guard fails in
  seconds. The rule is stated once, in [SECURITY.md](../.github/SECURITY.md) → Supply chain.
  **PLAN: [sec-5-verify-in-ci.md](./plans/sec-5-verify-in-ci.md)** — five adversarial lenses cut it
  from ~450 implementation lines to ~120. They found a permanent-green bypass (one line of committed
  config emptied the advisory list while leaving the counts intact), killed the leniency branch the
  first fix had made dead code, and moved two whole sub-features out to their own rows below. What
  survived: **could-not-check is two exit codes**, because only one of them may ever be advisory — a
  registry outage warns on a PR that changes no dependency input, and an unparseable, incoherent or
  disarmed report never does. **No escape hatch** shipped: the answer to an unfixable production
  advisory is fix it, re-classify it as dev if that is honest, or merge red (SEC-5c when that stops
  being enough).

- **SEC-6 — the seed `public_id`s have no entropy, and a shipped comment relies on the opposite.** 🔴
  _(found 2026-10-07 while writing [ADR 0006](./decisions/0006-household-addressing.md); filed as its
  own row rather than folded into AUTH-1, because it is live today and independent of addressing.)_
  `packages/shared/src/seed-ids.ts` defines `019826b4-0000-7000-8000-000000000001` / `…0002` / `…0010`
  and the seed upserts them into **production**, so `…0003` is a guess rather than a search.
  ⚠️ **`apps/web/lib/rate-limit.ts` declines to rate-limit the six mutating Server Actions on exactly
  the premise those ids falsify** — _"real ids are non-enumerable UUIDv7 … and therefore unreachable by
  guess."_ **Scope of the exposure today, stated honestly:** the actions still re-verify the gate and
  the gate itself is rate-limited, so this needs the shared code first; and households created through
  the app get real UUIDv7s from `newId()`, so only the seeded rows are guessable. The defect is the
  **false premise**, because it is load-bearing for a decision that gets revisited the moment the gate
  is retired for sessions (AUTH-1).
  **Fix:** rotate the seeded `public_id`s to real UUIDv7s (a guarded, idempotent `db:correct`
  correction — the ids are referenced by `PROGRAM_SEED`, both screenshot scripts and the e2e
  constants, so this is a sweep, not a column edit), and correct or remove the premise in
  `rate-limit.ts`'s docblock either way. **Acceptance:** no committed constant equals a live
  production `public_id`, and the rate-limit rationale states only what is true.

- **SEC-5b — the daily scheduled audit.** _(maintainer, 2026-10-06; cut out of SEC-5 by its scope
  lens.)_ SEC-5's gate only fires when something is pushed, so an advisory published against a
  dependency nobody touches is caught by nothing in this repo except `dependabot.yml`'s security PRs.
  A `schedule:`d workflow auditing the **full** tree closes that. **Gated on one unanswered question:**
  nobody has confirmed that a failed scheduled run reaches a human — force a failure and watch for the
  notification **before** wiring it, or it is a gate whose output nobody reads. When built:
  **no install step** (measured — `pnpm audit` reads the lockfile, not `node_modules`),
  `persist-credentials: false` (a daily unattended checkout should not sit beside a token),
  `cancel-in-progress: false` (a cancelled run notifies nobody), and the full-tree report must route
  **through the guard** in a report-only mode rather than a bare `pnpm audit` — a second bare audit
  re-states the threshold and is subject to every config bypass SEC-5 just closed. Note the full tree
  cannot pass at `high` today ([tech-debt](./tech-debt.md)), so this reports, it does not gate.

- **SEC-5c — the expiring audit allowlist.** _(maintainer, 2026-10-06; cut out of SEC-5 by its scope
  lens.)_ **Build it the first time an unfixable `high` actually lands in the `--prod` tree** — not
  before. SEC-5 shipped without it on purpose: `audit --prod` is clean, so the file would ship empty,
  and in the draft it was 60% of the guard and 17 of its 26 test cases. The reviewed design is
  preserved in the plan's history (#237) and is worth re-reading then — in particular that **V10 is
  load-bearing for V11**: without a check that an entry's severity still matches the advisory's, an
  advisory later re-scored to `critical` is still silently suppressed by a `high` entry. Carried over
  with it: an expiry needs a stated timezone basis (reuse `check-status-touched.mjs`'s local-date
  convention, which this repo already got wrong once), the `90`/`14` day numbers need names, and V8
  should reuse the exported `cleanPath` rather than re-implement it. The precedent that makes this row
  real rather than theoretical: `braces@3.0.3` was a `high` **in the production tree** until
  2026-10-03, and its advisory names a patched version that has never been published.

## Later — ideas captured, not scoped

- **PUB-1 — a public household page, with per-field visibility.** _(captured 2026-10-07, not scoped.)_
  Visit a household at a public, human-meaningful address and see only what it chose to publish —
  a streak, or the movements of a workout without the logged values, or more. Needs its **own
  deliberately-unauthenticated namespace** (`/h/<handle>`), not the private `/p/<profileId>` address;
  [ADR 0006](./decisions/0006-household-addressing.md) records why that is true under either addressing
  option.
  **What it needs settled before any plan**, recorded now so it is not rediscovered late: a public page
  is **indexed and cached by third parties**, which collides with PRIV-1's promise of a _defined
  deletion_ — a retraction cannot reach Google's cache or archive.org. The tiers are not equally
  sensitive: a streak is a behavioural signal about a child, movements-without-values is close to a
  program share, and a full log publishes a minor's training history. Default off, per field, parent
  controlled. A handle is **chosen, never derived from a family name** — a surname would be a
  permanent, guessable public identifier for a household with children, and it cuts against this
  repo's own naming rule. Gets the `privacy-reviewer` lens on every PR. Depends on PRIV-1 and AUTH-1.

- **SHARE-1 — share a program, and copy one into your own household.** _(captured 2026-10-07, not
  scoped.)_ Hand a program to another household, who can copy it and then edit their copy.
  ⚠️ **It makes `TEN-2` a prerequisite rather than an option.** `movements.slug` is globally unique
  (`packages/db/src/schema.ts:422`) while `program_blocks` is household-scoped, so a copied program's
  movement references are **shared rows** — the recipient silently inherits the source household's
  unit and bodyweight flags, which is the `findOrCreateMovementId` defect TEN-2 exists to fix.
  **The product rule to write down first: copy the structure, drop the loads.** The inviolable rule in
  this repo is that the model never authors loads, because a bad load is an injury risk. A copy feature
  puts one household's prescribed loads onto another household's athlete — the same risk with a
  different author. `5×5 Back Squat` is safe to copy; `5×5 @ 135lb` is a coaching decision someone has
  to make for _that_ athlete.

- **SOCIAL-1 — follow an athlete, and compare streaks.** _(captured 2026-10-07, not scoped.)_ Follow
  athletes in other households, get notified of their streaks, and optionally compete on them. The
  cross-household grant and the notification system are **the same mechanism `COACH-1` needs** (below)
  and should be designed once, not twice.
  **What it needs settled before any plan:** a streak becomes **a scoreboard rule people can game** the
  moment it is comparable, which makes [ADR 0007](./decisions/0007-scheduling-model.md)'s nothing-due-day
  rule load-bearing — and that rule has to be settled before the first verdict row is written, because
  retrofitting it rewrites history. Following also creates an **adult-follows-child** path: who may
  follow, whether approval is required, and whether a notification reveals a schedule pattern
  (_"trained at 3pm every weekday"_ is a time-and-place pattern about a minor). Same privacy posture as
  `COACH-1`: the `privacy-reviewer` lens on every PR.

- **COACH-1 — a coach sees athletes across households, by permission.** _(maintainer, 2026-10-06.)_ A
  club coach is granted access to outcomes for athletes in other households, and gets notified of
  streaks and who did or did not train yesterday. The simpler case is the same mechanism with one
  household: the account owner watching their own athletes.

  🔴 **This is the sharpest consent question in the project, and it should not be designed casually.**
  Everything else here keeps minors' health data inside one household. This deliberately moves it
  across a household boundary, to an adult who is not the parent. Before any plan: who consents, how it
  is revoked, what the coach sees (outcomes only, or the underlying weigh-ins), whether the athlete is
  told, and what happens to the grant when the athlete leaves the club. It depends on TEN-1 (a scope
  seam that can express "not mine, but shared with me") and AUTH-1 (identity to grant it to), and it
  gets the `privacy-reviewer` lens on every PR.

  Notifications are a second system with their own consent and retention questions, and they are the
  first thing in this app that would reach a person who is not holding the phone.

- **DASH-1 — dashboard metrics.** _(maintainer, 2026-10-06.)_ Streaks; week-over-week, month-over-month
  and year-over-year on reps, bodyweight and total load; PRs and PRs-with-streaks; leaderboards within a
  household, or across athletes a coach has been given access to.

  **Everything here is answerable from rows this app already stores** — `entries`, `entry_sets`,
  `entry_set_quantities` — which is the argument [OBS-3](#obs-3) makes for not reaching for an analytics
  vendor. Two dependencies worth stating now rather than discovering later: a **streak** needs to know
  which days were scheduled, so it waits on the scheduling ADR and on the skip/complete facts
  ([ADR 0005](./decisions/0005-programming-model.md) §6); and a **PR** is only comparable across rows
  whose unit is known, which is why GAP-3 stores the resolved unit on the row.

  ⚠️ **Leaderboards between children are a product decision, not a feature.** Ranking siblings by
  bodyweight or load has obvious failure modes in a house with two kids of different ages. Worth
  deciding deliberately whether comparison is opt-in, household-only, and which metrics are ever
  rankable.

## DX — agent & developer tooling ([skills index](../.claude/skills/README.md))

Tooling that makes each PR cheaper and safer to produce. It sits outside the product priority order
above; the skills index holds the smaller items.

- **DX-1 — `@claude review`: the `review-pr` skill, on request, in CI.** A writer comments `@claude
review` on a PR and gets one verified P0/P1/P2 review comment. Subscription auth; never automatic;
  advisory, never a required check. [Plan](./plans/dx-1-claude-review.md) (engineering panel rounds
  1–2: 4 + 1 blocking → redesigned as a read-only model job + a model-free post job; PR review on
  #176 resolved). **Implemented in #185. Dormant by choice (2026-09-30):** Ray reviews from
  Claude Code at the desk (the local `review-pr` skill does the same review with no secret), so
  `CLAUDE_CODE_OAUTH_TOKEN` is deliberately unset. To activate: [runbook](./runbooks.md), then the post-merge
  injection smoke (plan, tests 3–5) is the acceptance gate. #179's `.claude/settings.json` would have
  tripped the plan's blanket settings guard, so #185 pins that file by hash instead (plan, D1).
- ✅ **DX-2 — changelog fragments: no shared insertion point.** Every PR inserts its changelog entry at
  the top of `docs/status.md` → Changelog, so every merge re-conflicts the other open PRs (all seven
  on 2026-09-30). One file per change in `docs/changelog/`. ✅ **Implemented in #190:** `status:check` requires a
  fragment on product branches once `docs/changelog/README.md` is in the branch (so a legacy branch
  meets the rule when it merges `main`), and fails any branch that adds to the frozen status.md or
  skills-README history. [Plan](./plans/dx-2-changelog-fragments.md) (two engineering panel rounds:
  the guard detects DX-2 from the working tree, so a conflicted keep-mergeable merge can't slip through).
- **DX-3 — `screenshot:ephemeral` silently captures a stale build.** It reuses `apps/web/.next`
  whenever a `BUILD_ID` exists; only `--build` forces a rebuild. On #180 that posted a screenshot of
  copy the PR had already changed, and it was caught only by a reviewer reading the image. **Fix:** record
  the commit (plus a dirty-tree flag) the build came from, and rebuild when it differs from `HEAD`.
  Add a `docs/lessons.md` entry. Small; no plan needed.
- **DX-4 — the main-checkout guard blocks harmless variable-named commands.** #179's `PreToolUse` hook
  denies any command whose name comes from a variable or `$(…)` in the main checkout. That's right for
  git, but it also blocked a read-only `gh pr checks` polling loop and a `for w in …; git worktree remove`
  cleanup loop on 2026-09-30. It fails safe, but each false positive teaches agents the escape hatch.
  **Fix:** resolve the name when the loop's values are literal, or allow variable-named commands when no
  git/gh mutation can result. Self-tests for both loops. The guard is ~1,000 lines, so check the file-size
  rule first.
- **DX-5 — nothing enforces the merge gates.** Verified via the API (2026-09-30): classic branch
  protection is **off**, and the only ruleset ("Protect Main") blocks deletion and force-push. So there are
  **no required checks** (a red PR can merge), no "require branches up to date" (a behind PR shows
  `clean`), and a direct push to `main` is possible. Separately, `skills:check`, `guards:test` and
  `status:check` run only in local `pnpm verify`, never in CI. Today the `review-pr` shipit bar is the
  only gate. **Fix:** (a) a repo-admin settings change
  (required checks: `quality`, `gitleaks`, and `e2e` once PR 28's soak ends; require up-to-date; a
  `pull_request` rule on `main`); (b) a CI change to run `skills:check`, `guards:test` and
  `status:check` (DX-2's guard), which needs its own plan and panel. **The audit third of (b) is
  done** — SEC-5 wired `audit:check` into `quality` and carved its own self-test out of `guards:test`
  as a standalone step; **(b) deletes that step** when it wires `guards:test` properly, and could
  reasonably take `check-action-pins.test.sh` with it (offline, fixture-only, ~1s), which SEC-5
  deliberately left alone to keep to one concern.
  (SEC-2's `check-action-pins.mjs` already runs in `quality`; its self-test, in `guards:test`, does not.)
  Then update AGENTS.md's gate list, which #181 corrected to say "by convention", in the same PR.
- **DX-8 — every root `pnpm` script passes when its filter matches nothing.** 🔴 Found 2026-10-06
  while reviewing DX-7 (#244). `pnpm --filter <name> <script>` prints _"No projects matched the
  filters"_ and exits **0**, so a root script whose package is renamed, moved or mistyped reports
  success without running. Measured on the pinned pnpm (`package.json:5`, 11.13.1):
  `pnpm --filter @mat-plan/nope typecheck` → exit 0.
  **Blast radius is every gate that runs through the root scripts**: `lint` (`package.json:15`),
  `typecheck` (`:16`, now two filters after #244), `test` (`:17`), `db:verify` (`:22`) and `build`
  (`:13`). Four of those are `pnpm verify` steps and `ci.yml`'s `quality` gates, so **`pnpm verify`
  would print a green run for a check that executed against nothing** — exactly
  [tech-debt](./tech-debt.md)'s _"a green check that proves nothing, which is strictly worse than no
  check, because it is trusted."_ Nothing in the repo asserts a filter matched.
  ⚠️ **Not hypothetical for long:** #244 widened `typecheck` to a second `--filter` on
  `@mat-plan/db`, so a rename of that package now silently drops the DB half of the typecheck gate
  while the step stays green.
  **Fix (measured, one line):** `failIfNoMatch: true` in `pnpm-workspace.yaml` — a missing filter
  then exits 1 and a real filter still resolves normally. `--fail-if-no-match` is the per-invocation
  form. Prefer the config key so a new root script inherits it instead of having to remember the flag.
  **Acceptance:** a root script whose `--filter` matches no project exits non-zero, proved by a case
  that exercises a deliberately wrong filter — the gate has to be seen red before it is trusted.

- **DX-7 — `packages/db/scripts/**` is typechecked by nothing.** 🔴 Found 2026-09-30 while writing
  V1-24 PR 1c. `pnpm typecheck` is `pnpm --filter web exec tsc --noEmit`, and `apps/web/tsconfig.json`
  is the **only** tsconfig in the repo — its `include` is relative to `apps/web`, so `verify.ts`
  (3,388 lines), `migrate.ts`, `seed.ts` and `corrections/` are never checked. `tsx` strips types
  without checking them, so a type error there surfaces as a runtime failure against a real database.
  An ad-hoc `tsc` over that directory found **3 pre-existing errors** in `verify.ts`
  (`:1882,:1883,:1947` — `weight` missing from a set literal) plus 1c's own tautological `assert`,
  which is how the gap was noticed. **Fix:** a `packages/db/tsconfig.json` and a root `typecheck` that
  runs both projects, then fix what it finds. Small, but it is a gate that does not exist where the
  DB proofs live. ✅ **Implemented in #244:** `packages/db/tsconfig.json` covers `src/**` and
  `scripts/**`, and the root `typecheck` now chains a `typecheck` script in each project — so the
  `pre-push` hook and CI's one `pnpm typecheck` step both widened with it, no workflow edit needed. The
  gate found **12** errors on its first run, not 3: the 3 missing `weight` keys (drifted to
  `:1908,:1909,:1991`) plus **9** `insertBodyweightEntry(db, …)` calls handing a `PgliteDatabase` to a
  parameter typed `Executor` (a node-postgres handle) — every other call in the file already used the
  `asPg` cast declared at `verify.ts:83` for exactly that. Both fixes are shape-only; `db:verify`
  passes unchanged. ⚠️ **Still open, deliberately out of scope:** `packages/shared` and
  `packages/engine` have no tsconfig (checked only transitively, via the app's imports), and **linting
  still stops at `apps/web`** — the other half of the 2026-09-30 baseline's seed #4.

- **DX-6 — recent changelog fragments in the SessionStart briefing.** Agents used to see recent work by
  reading the top of the status.md changelog, which DX-2 froze. The hook
  (`.claude/hooks/session-context.mjs`) prints the "Where we are" pointer and open PRs, not what just
  merged. **Fix:** add the last ~5 lines of
  `git log origin/main --diff-filter=A --format='%cs %s' -- docs/changelog/`, with a hook self-test.
  Small; no plan needed.

## BETA — share with other families ([milestone](./milestones/beta-1.md))

Rows the beta milestone needs that had no home. Order and exit criteria live in the milestone file.

<a id="onb-2"></a>

- **ONB-2 — a default program for new households: The Daily Five.** _(Filed by Ray 2026-09-28; doses
  drafted by a model session, pending confirmation.)_ **Status: model-drafted definition, not yet
  confirmed — Ray (or a qualified coach) signs off each dose before it is seeded; the seed PR cites the
  sign-off.** Full definition, movement table, catalog additions and how-to copy:
  [programs/daily-five-default.md](./programs/daily-five-default.md). _(Beta 0.)_

  ONB-0 establishes that a brand-new household's first screen is **Ray's family's routine**. That is one
  of two shapes: `routine_config` is an ordered list of activity keys; a **program** is
  `program_blocks → prescriptions → prescription_targets`. A stranger needs a neutral default of
  **both**, or their first screen is still Ray's family's day. **ONB-2 is the program half.** It is
  derived from a research pass (youth resistance-training guidance, injury epidemiology,
  distributed-practice literature) rather than from Ray's household — that provenance is the point.

  **Why it seeds clean: prescriptions with NO `prescription_targets`.** Per-athlete loads live in
  targets (`prescriptions` has no load column); a neutral default has none to write because it does not
  know the athlete. `BW` comes from the movement and durations ride in `target_reps` with
  `unit_default: sec`. A fresh household renders from prescriptions alone, via `programDayRows`' LEFT
  JOIN (no target → null load). **The default is per household**: blocks are household-scoped, so an
  athlete added to an existing household gets that household's program, not this one.

  **Shape:** "Daily Five" → slug `daily_five`. Eight prescription rows (~8–10 min): 4-way neck
  isometrics, submaximal pull-ups + dead hang, submaximal push-ups (`push-ups` — the existing slug), a
  squat → deep-hold → Cossack flow, hollow-body hold, side plank. Bodyweight only; every item has a
  stated fallback, logged as the movement actually done (`dead_hang`, `inverted_rows`). The finisher
  (15 penetration steps) is the routine's `shot` check-in, not a prescription. Six movements are
  catalog additions, and `hollow-body_hold`'s shared unit default changes to `sec` (a guarded
  correction or migration, since the seed never updates an existing row).

  **Scheduling — decided: the A/B stopgap** _(Ray, 2026-09-30)_. No `daily` role exists and Today's
  role is global A/B parity, so the same rows are seeded under **both `strength_a` and `strength_b`**.
  No new role, no CHECK migration, **no SCHED-1 dependency** — ONB-2 stays in Beta 0. Accepted
  consequences: CSV `session_type` alternates `strength-a` / `strength-b` by day (no `daily-five`
  value); the program runs every day (under parity there is no program rest day); the real
  per-household daily role is deferred to SCHED-1 (Beta 1), which can migrate these rows later.
  **Constraints:** never add it to `PROGRAM_SEED` under Ray's household (it would replace YDP on both
  roles); the A and B copies drift under a one-sided V1-22 edit; a later single-role block alternates
  with it; programs on other roles never reach Today. **The rows are written at household creation**
  (TEN-1/AUTH-1 or ONB-0's first run), not by `seed.ts`.

  **The load-bearing constraint: no set ever goes to failure.** In Beta 0, ONB-2 is **fixed,
  signed-off doses + the write at household creation + first-run copy that says it**; nothing yet
  enforces it. **Deferred with the engine (post-beta):** the per-movement tap (Too easy / Just right /
  Too hard), the ramp and its ceilings — computed deterministically (`packages/engine`, golden
  vectors), never by an LLM. No max testing anywhere.

  **`sprawl-to-stance` is held back** _(Ray, 2026-09-28)_ — the sixth movement of the full Daily Six
  and the first graduation unlock; the cost (competency coverage 8/8 → 6/8, the only item that raises
  heart rate) is recorded in the program doc.

  **CSV:** strength-log only today, since prescribed push-ups and pull-ups are movement entries; routing
  them to `calisthenics-log` is an open decision (it needs a calisthenics export and a per-program
  rule, because Ray's household already writes `pull-up` to strength-log). Contract:
  [csv-export-contract.md](./csv-export-contract.md).

  **Dependencies:** ONB-0 is **done** and shipped the first-run surface — but ⚠️ **it did NOT ship "a
  neutral routine that includes `shot`"**, which this line used to assume. ONB-0's neutral default is
  `['strength']`; `shot` is reachable only as `checkin:brush_teeth:shot` (whose group label is the very
  string ONB-0 existed to get off a stranger's screen), and the `shots` activity sits outside
  `CHECKIN_FIELDS`' render scope on purpose. **So ONB-2 owns both halves:** the render-scope change that
  gives `shot` a neutral home, and the one-line edit to `NEUTRAL_DEFAULT_KEYS` that admits it. ONB-2
  must also decide whether its prescribed push-ups / pull-ups co-exist with the calisthenics check-in
  counters — **CAT-1 says they must not**, which is why ONB-0 left them out of the default; **V1-27** (every row prescribes `sets`, so with V1-27
  open a partial set blocks submit on every movement); the catalog additions and the hollow-body
  change; the dose sign-off; a UX panel before implementation (the first-run copy). No GAP-3 unit work
  is needed: everything is `BW` or seconds.

  **Open questions for Ray:** audience — tuned for **youth wrestlers ~8–14** with a parent present; if
  mat-plan will serve high-school and open wrestlers, onboarding needs an age gate. **One rule stays
  hard at every tier:** never substitute a loaded wrestler's bridge for the neck isometrics.
  The finisher is stored as the routine's `shot` check-in but reaches **no CSV** until the
  exporter writes check-in rows (the checkins export is header-only today).

- **OPS-1 — previews hold neither production data nor production credentials.**
  [Plan](./plans/ops-1-preview-isolation.md). Every Vercel preview got the prod `DATABASE_URL`
  ([deploy.md](./deploy.md)) — and in fact every _other_ production credential too, including the
  access-gate code. Previews get a seed-only database (never a branch of prod, which would clone every
  family's data), the Preview scope holds no production secret (separate Clerk dev instance, Upstash,
  Sentry DSN), and Vercel's fork-PR protection is verified on. _(Beta 0.)_

  🟡 **Repo half merged; the dashboard half is OUTSTANDING and OPS-1 is not done until it is run.**
  The repo now refuses to boot or migrate against a database that disagrees with its environment
  (`packages/shared/src/db-environment.ts`), ships `pnpm preview:check` to verify the Vercel scopes,
  and migrates a preview estate (`migrate-preview.yml`). Creating the Neon project, splitting the
  Vercel scopes and the Upstash database are dashboard work: **[runbooks.md](./runbooks.md) → OPS-1**,
  nine steps, ordered to run _before_ the merge. Tick this row in that runbook's closeout commit.

  ⚠️ **The row's own wording missed the biggest part, found by the PR's security panel.** Vercel
  injects env values at **build time**, so re-scoping the project does nothing for previews that
  already shipped: **100 publicly-listed preview URLs were live, each holding the production database
  string and the production gate code.** Runbook step 7 purges them and rotates both credentials.
  **Rotation is not retroactive** — a credential that was ever in a build stays in that build.

- **OPS-2 — split the seed: reference data for prod, fixtures for dev/CI.** `migrate.yml` seeds prod on
  every push; the seed writes Ray's family with public fixed UUIDs and re-creates them if deleted, and
  expands ramp targets over every kid in the database. Split into `seedReference` and `seedFixtures`;
  keep `PROGRAM_SEED` reaching prod until V1-22; scope ramp targets by household. _(Beta 0.)_
- **OPS-3 — restore one household from backup, rehearsed.** The runbook's restore section is a TODO.
  Per-household restore (branch → extract → copy) plus a deletion ledger, because a whole-database
  point-in-time restore rolls back other families and un-deletes deleted ones. One drill; delete the
  drill branch. _(Beta 0.)_

  **The deletion ledger is now defined** — `PRIV-1` was its first writer, so it specified it rather
  than naming an artifact that did not exist:
  [runbooks.md](./runbooks.md) → "The deletion ledger" has the location (**outside git and outside the
  restorable database**), the field list, and its own retention. **Inherit that shape; do not invent a
  second.** The invariant `OPS-3` owes it: **a per-household restore replays the ledger before the
  data is served**, or a restore silently resurrects a household that asked to be deleted.

  ⛔ **`OPS-3` is now a precondition of the first real household deletion**, not just an exit
  criterion. Until a per-household extract exists and has been rehearsed once, a mistaken or
  fraudulent deletion is **not practically recoverable** — the restore branch `PRIV-1`'s procedure
  holds is a whole-database copy, so using it would roll back every other family
  ([priv-1 plan](./plans/priv-1-privacy-review.md) → review log S-N1).

  **Two locations, not one, since OPS-1.** The deletion ledger must walk the production Neon project
  **and** `mat-plan-preview`, which holds the seed's fixture profiles plus whatever any preview wrote
  ([service-setup.md](./service-setup.md) → "Where personal data lives"). The preview copy's deletion
  path is cheap and complete — delete the project; it rebuilds from `db:migrate` + `db:seed` in
  minutes — but it has to be _in_ the ledger, or it is the copy a request misses.

- **TEN-1 — household scoping through one DAL seam, proven.** A `cache()`d `getHouseholdScope()`;
  every read and write scopes through it (folds in DAL-2). Before AUTH-1 it resolves to the
  maintainer's household; AUTH-1 swaps its implementation. `db:verify` proves a second household
  cannot read, write, correct or export the first's data, at every entry point, including
  `findOrCreateMovementId`. **Unblocked:** the household-addressing ADR it needed —
  **[ADR 0006](./decisions/0006-household-addressing.md) — is ✅ Accepted (option A, session-only)**
  _(the maintainer, 2026-10-07; #252)_, which was chunk 0 of
  [TEN-1's plan](./plans/ten-1-household-scope.md). The plan's six-lens panel ran 2026-10-07 and its
  review-response log is committed. **Chunk 1a (`households.synthetic`, shipped dark) is in flight;**
  1b (the seam and the gate), 1c (DAL-2's tail) and 1d (guards, the catalog verdict, docs) follow in
  that order. _(Beta 0.)_
- **TEN-2 — custom movements per household.** `movements.slug` is globally unique and
  `findOrCreateMovementId` silently reuses another household's row on a name clash. Expand (nullable
  `household_id` + partial unique indexes, `CONCURRENTLY`) → switch every slug lookup → contract.
  Three PRs. _(Beta 0 if TEN-1 can't prove the catalog stays per household; else Beta 1.)_
- **EVAL-0 — the safety gate ships before the model** ([plan](./plans/eval-0-gate-before-model.md), #220).
  The accuracy + never-emits-a-load gates for AI-1, built and proven BEFORE any extraction runs. ⚠️
  **Row added 2026-10-06:** EVAL-0 had a merged plan and a line in [roadmap.md](./roadmap.md) but **no
  backlog row at all** — the inverse of the AI-1/PRIV-1/DX-1 omission in the same PR, and the reason
  the roadmap's pillar table is now the stated membership test. **AI-1 depends on it**; see
  [ai-1-nl-logging](./plans/ai-1-nl-logging.md) → EVAL-0.

- **PRIV-1 — privacy review, notice, consent, retention, deletion.** ✅ **The documents are written**
  ([plan](./plans/priv-1-privacy-review.md), [docs/privacy/](./privacy/)): a plain-language
  [notice](./privacy/notice.md) listing what is stored and every processor, a retention policy, a
  defined household deletion ([runbooks.md](./runbooks.md)) with the residuals stated, the consent
  requirements `AUTH-1` must wire, and SECURITY.md's threat model rewritten for many households. The
  evidence it is derived from — all 18 tables, the processors, the committed-data inventory — is
  [data-inventory.md](./privacy/data-inventory.md). **Signed off by the accountable role, with a date**
  (amended from "a named reviewer": `AGENTS.md` forbids personal names in docs, so the exit criterion
  was unsatisfiable as written). **Not legal advice.**
  **Two code follow-ons remain — `PRIV-2` is the actual `AUTH-1` gate.** _(Beta 0.)_

  🔴 **PRIV-1's sharpest finding is not in PRIV-1's scope:** committed personal data about minors is
  far broader than `OSS-1`'s audit records — ~50 files, raised to **P0**, and `OSS-1`'s audit
  conclusion is now wrong. See `OSS-1` and [data-inventory.md](./privacy/data-inventory.md) §9.

- **PRIV-2 — serve the notice at `/privacy`, on the app's own domain.** The real `AUTH-1` gate: the
  Clerk and Google consent screens need a reachable privacy-policy URL. A page, one entry in
  `PUBLIC_PATHS` (`apps/web/lib/access-gate.ts` — the single definition), a footer link, one UX
  reviewer. ⚠️ **Not a one-file PR:** there is **no markdown pipeline in the tree**, so it must
  generate the page from [notice.md](./privacy/notice.md) with a drift test, or hand-transcribe it and
  keep two copies of a privacy notice — the recommendation is the former, and it is the maintainer's
  call ([plan](./plans/priv-1-privacy-review.md) → Alternatives). Static or generated only — never a
  file read keyed on a request param. **Its acceptance also carries PRIV-1's four unfilled blanks:**
  the Neon / Sentry / Vercel retention windows and the contact route. _(Beta 0.)_

- **PRIV-3 — the household deletion as a guarded script, with a `db:verify` proof.** Wraps
  [runbooks.md](./runbooks.md)'s procedure so the dry run, the target-host print and the
  one-transaction wrapper come from a runner rather than an operator's care. ⚠️ **Not a drop-in
  correction:** `Correction.run` takes no target and the runner ignores positional args, so it needs a
  `--household <public_id>` flag — **a runner change, which needs its own plan** — and **no household
  id may be committed** (that plus the public `Applied` table would publish a register of who asked to
  be erased). The deletion correction inverts corrections rules 2 and 5, declared in
  [that README](../packages/db/scripts/corrections/README.md). **The `db:verify` proof is the point,
  not the polish:** it is the only thing that catches a 19th per-household table escaping the
  runbook's hand-maintained delete order, and the panel found exactly that class of defect by
  reading. _(Beta 0.)_

  **Retention: decided in principle** _(maintainer, 2026-10-07)_. **Raw training history is kept for as
  long as the household is active.** There is no rolling window and no summarize-then-discard step:
  - Summaries would break the byte-faithful CSV export, the v2 engine's per-set history, and
    [CLONE-1](#clone-1)'s "who ran which version" record.
  - A summary of a child's bodyweight is still a child's health data, so summarizing does not reduce
    the privacy exposure.
  - The volume is trivial (about 51 rows in prod after several weeks).

  The written policy spends its effort on **deletion** instead. Three items:
  1. A **hard delete on request**, per athlete and per household, that includes soft-deleted rows.
     Today nothing is ever hard-deleted, so a "deleted" row is kept forever.
  2. A **purge window** after which soft-deleted rows are hard-deleted. This row's plan sets N.
  3. **What a departed household's data becomes**, including the residual copies in backups and Neon
     branches, which the per-household restore runbook must respect through its deletion ledger.

  Until this ships, `SECURITY.md`'s "defined retention/delete path" is unmet, and this paragraph is the
  record that the gap is known.

## AUDIT-1 — baseline audit fix queue ([report](./audits/2026-09-30-baseline.md))

`review-pr` in audit mode over the whole repo at `78ec41a` (2026-09-30): **2 P0 · 5 P1 · 7 P2**, plus
verdicts on the 10 doc-vs-code seeds. One concern per PR, in this order. Each row says what it owes.

| #   | Branch                           | What                                                                                                                                                                                                  | Owes                                                      |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | `fix/v1-30-loggable-units`       | ✅ **V1-30a**: every offered unit saves and exports; boundary tests, `db:verify`, guide invariant 4b                                                                                                  | plan + engineering panel, one UX reviewer                 |
| 2   | `fix/v1-27-partial-sets`         | ✅ **V1-27**: partial sets on a scaffolded movement can be submitted (#207)                                                                                                                           | its existing plan                                         |
| 3   | `fix/sec-1-gate-prefetch-bypass` | ✅ **SEC-1, raised to P0:** a live bypass on Vercel (2026-09-30). Matcher fixed, gate re-checked in every action and page, e2e pins it ([plan](./plans/sec-1-gate-prefetch-bypass.md))                | expedited; security lens post-implementation              |
| 4   | `chore/sec-2-pin-actions`        | ✅ **SEC-2:** every action in all 5 workflows SHA-pinned; `check-action-pins.mjs` guards it in `verify` + `quality`                                                                                   | [plan](./plans/sec-2-pin-actions.md) (CI) + security lens |
| 5   | `chore/sec-5-audit-in-ci`        | ✅ **SEC-5** (this row's `pnpm audit --prod` in the `quality` job; the duplicate **SEC-5** row above is the same work): `audit:check` gates the `--prod` tree ([plan](./plans/sec-5-verify-in-ci.md)) | **not** a one-liner — a 5-lens panel reshaped it          |
| 6   | `docs/status-headline`           | P1: "Where we are" still headlines removed DUALS-1 routes; it's the first line every session sees                                                                                                     | exempt                                                    |
| 7   | `fix/v1-26-bw-live-region`       | P1: the BW warning's live region mounts with its text; tie it to the chip                                                                                                                             | one UX reviewer                                           |
| 8   | `docs/agents-md-truth`           | seeds 1, 2, 7, 8 and doc P2s; seeds 3 and 9 as tech-debt rows                                                                                                                                         | exempt                                                    |
| 9   | `chore/ci-2-typecheck-packages`  | seed 4: typecheck `packages/db` (incl. `verify.ts`)                                                                                                                                                   | short plan (CI config)                                    |
| 10  | `test/v1-26-test-hardening`      | #171's test leftovers                                                                                                                                                                                 | exempt                                                    |

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

- **SCHED-1 — scheduling as data: multiple programs per athlete.** _(Ray, 2026-09-18.)_
  📐 **Model: [ADR 0007](./decisions/0007-scheduling-model.md)** — recurrence is a weekday SET as rows
  (no RRULE) and `daily` is seven rows; rotation becomes an anchor + an ordered list **on the block**
  (not the assignment — one program must not get N phases, or co-training siblings desynchronize) and
  stays calendar-indexed; dueness is derived and the day's verdict is **recorded and snapshots what it
  judged**, at a boundary derived from `WRITABLE_DAY_RADIUS`. It closes both of this row's open
  questions below. ⚠️ **It authorizes only two tables** — the assignment row and the weekday rows — and
  **does not close this row**: requirement 3's third converging problem, `routine_config`'s schedule, is
  deliberately deferred there. Today an athlete
  has exactly one daily routine and one implicit strength split. Ray's model: **an athlete has several
  programs, each with its own schedule** — a "daily" program (the habit routine), an S&C program on
  Mon/Wed/Fri, conditioning on other days — and the coach decides which of them feed the streak (MOT-1.3).

  **The reason this is worth its own row: three unrelated-looking problems are the same missing
  primitive — a schedule that lives in data.**

  1. **The weekday → `day_role` map is a hardcoded app const.** `DAY_ROLE_BY_WEEKDAY` in
     `apps/web/lib/programming/day-role-schedule.ts` — Ray's Mon/Wed/Fri split, in code. Changing a
     training day is **a deploy, not an edit**, and a second household silently inherits Ray's split
     ([tech-debt](./tech-debt.md)).
  2. **`routine_config` has no schedule at all** — it is implicitly every day, so "this kid does mobility
     only on practice days" is unrepresentable.
  3. **MOT-1's streak needs to know what is DUE today**, or it breaks on a correctly-taken rest day.

  Build the primitive once and all three close. That three independent needs converge on it is the best
  evidence the abstraction is real rather than invented.

  **What already exists to build on** — this is less net-new than it sounds:
  - `program_blocks → prescriptions → prescription_targets` (V1-10), with `day_role` already on the
    prescription. A block **is** a weekly plan; it just can't say which weekday it lands on.
  - `profiles.routine_config` (V1-18) + its shipped coach editor at `/p/[profileId]/routine`.
  - `routineItemSchema`'s `conditional` marker, documented as "an OPAQUE cosmetic marker… **scheduling
    flips it functional later**" (`packages/shared/src/routine.ts:43`) — the down-payment, already made.
  - `localDayIso` / the `tz` cookie (V1-6c). **"Due today" must resolve on the athlete's local calendar
    date**, not UTC — the same correctness V1-6c already bought, and a streak that rolls over at the wrong
    hour is exactly the bug that destroys trust in a streak.

  **The design constraint, and the way to get this wrong: unify the SCHEDULING layer, not the CONTENT
  shape.** `routine_config` is an ordered list of activity keys; `prescriptions` are movement + sets +
  reps + load. They are different shapes because they answer different questions. Collapsing them into
  one "program" table would force a one-tap rice-bucket check-in through prescription machinery it does
  not need — and the JSONB routine was a deliberate, documented exception in the first place. A program
  should be **a thing with a schedule**; what is _inside_ one may stay two shapes.

  **A THIRD shape exists — session-indexed rotation (2026-09-23).** Ray's real daily program
  ([samples](./samples/youth-daily-program/README.md)) runs **every day**, alternating `A → B → A`, with
  the letter derived from **completed-session count, never the calendar** — the spec is explicit that
  `date % 2` silently doubles up box jumps after any missed day, and a sample session proves it. This is
  **not** the rejected quota shape: "is it due today?" is always **yes**; the open question is _which
  variant_, which is a function of history. It therefore needs the **recorded daily verdicts** this row
  already requires. The assigned-days decision below stands for weekday blocks; it simply is not the only
  shape.

  **One schedule shape: assigned days.** _(Ray, 2026-09-19.)_ A schedule says **which days** a program is
  due — `daily`, or `Mon/Wed/Fri`. A **quota** shape (`3×/week`, any days) was considered and **explicitly
  rejected**: the coach selects the days. That keeps "is this due today?" a lookup rather than a
  computation, and it is the single decision that keeps MOT-1's streak arithmetic-free. See MOT-1.4 for
  the tradeoff accepted.

  **On multiple streaks — SETTLED (2026-09-19): there is one.** An intermediate draft proposed
  per-program streaks with configurable periods; Ray dropped it in favour of one daily streak with
  inclusion flags (MOT-1.4). My earlier dilution objection and the counter-argument that these are
  genuinely different commitments are both moot — the simpler model covers every case posed.

  **Changes a stated assumption:** tech-debt names **Clerk / multi-household (v1.5)** as the promotion
  trigger for the hardcoded schedule. MOT-1 now pulls it forward **independently of Clerk** — the streak
  needs scheduling for a single household. The trigger is whichever lands first.

  ### SCHED-1 — three requirements from Ray's real case (2026-09-21)

  Ray's actual programming: **calisthenics daily, year-round, in the streak. Off-season, add S&C on
  assigned days.** Checked against the schema, that case needs three things the model does not have.
  Together they **resolve this row's first open question** and add one requirement that is cheap now and
  a data migration later.

  **1. A program is assigned to an ATHLETE, not just a household — and that assignment row is where
  everything lands.** Today `program_blocks.householdId` has **no `profile_id`**
  (`packages/db/src/schema.ts`); the only per-athlete link is `prescription_targets.profile_id`, which
  carries per-kid **loads and reps on a shared block**. So the model currently says _"both kids do this
  program, at different loads"_ — fine for the shared calisthenics case, but it cannot express _"one
  sibling does S&C, the other doesn't,"_ which is exactly what adding a seasonal program to one athlete requires.

  **This answers the open question: the schedule belongs on a block↔athlete assignment row**, not on
  `program_blocks`. And the same row is the natural home for all three of these — one row saying _this
  athlete does this program, on these days, between these dates, and it counts toward the streak._ That
  convergence is the argument for the assignment row, not just a convenience.

  **2. Programs need a date range — nothing models seasonality.** Grepped: no `active_from`,
  `starts_at`, `season` or `effective` column exists anywhere in the schema. A block has `slug`, `name`,
  `notes`, timestamps — it is active forever until soft-deleted. Ray's year-round calisthenics is an
  **open-ended** assignment; the off-season S&C is a **bounded** one. Nullable `active_from` /
  `active_to` on the assignment covers both. Note soft-delete is **not** a substitute: deleting the block
  destroys the record of what was programmed last November, which requirement 3 depends on.

  **3. The streak's daily result must be RECORDED, not recomputed — decide this before building, not
  after.** If "what counted" is derived live from current config, then **editing a program rewrites
  history.** Add S&C to the streak on 1 November and every prior day is re-judged against a bar that did
  not exist then; drop it in-season and the reverse. For an athlete whose programming legitimately
  changes twice a year, **the streak number would move when the coach edits a program**, retroactively,
  for reasons the kid cannot see. That is the single worst thing a streak can do — constraint 2 is about
  not making a break feel like failure, and an unexplained retroactive break is worse than a break.

  **Fix:** when a day closes, persist its verdict as a fact. History becomes immutable and a program
  change affects only the future — so a kid at 200 days keeps 200 when S&C is added, and the harder bar
  applies from that day forward. This also makes the streak a cheap read instead of a recomputation over
  all history.

  **Open, arising from 3:** **when does a day close?** The lazy form — on the next read, evaluate every
  unevaluated day up to _yesterday_ in the athlete's local zone — avoids a scheduled job and is probably
  right, but it is **tz-sensitive** and must use V1-6c's `localDayIso`. · **What happens to a recorded
  verdict when an entry is logged LATE** (a backdated set, once V1-15 day navigation exists)? Either the
  day reopens and re-scores, or it does not — both are defensible, neither is free, and picking one late
  means a backfill.

  **Still open from before:** does a "program" subsume the daily routine or sit beside it? · **needs a UX
  panel** (it reshapes the coach editor) and an engineering panel (migration + a new subsystem).

<a id="clone-1"></a>

- **CLONE-1 — clone a workout, edit the copy, choose which athletes move to it.** _(Maintainer,
  2026-10-07.)_ The need is to **replace** a workout, not to edit the one in use: copy Strength A, change
  its movements, sets and reps, then move an athlete onto the copy. Editing in place (V1-22 chunk 4)
  is a different need.

  **Decided: per athlete, not household-wide** _(maintainer, 2026-10-07)_. Saving the copy asks which
  athletes move to it; the default is none. Moving one closes their current
  [`program_assignments`](./decisions/0007-scheduling-model.md) row (`active_to`) and opens one on the
  copy (`active_from` = today). Nothing is deleted, so the old program, each entry's snapshotted
  prescription ([ADR 0005](./decisions/0005-programming-model.md) decision 5), and the assignment dates
  together say who ran which version, when. That is most of what versioning would buy, without a version
  subsystem.

  - **Rejected: household-wide replacement.** "The newest block per day role wins" (programming guide,
    invariant 3) would make a copy replace Strength A for **every** athlete at once, including the
    maintainer's own training, with no way to keep one athlete on the old version. It needs no new
    table, which is what made it tempting, but `program_assignments` would supersede it.
  - **Grain:** the clone is a **block** (`program_blocks` + its `prescriptions` + `prescription_targets`),
    because an assignment points at a block. Cloning a single day inside a block is the `workouts` arc,
    which [ADR 0007](./decisions/0007-scheduling-model.md) records but does not authorize.

  **Gated on, in order:**
  1. V1-22 chunks 2 and 3 (the log-time snapshot writer and the backfill). Until both land, switching
     an athlete's program rewrites the `prescribed` column of their past exports.
  2. SCHED-1's `program_assignments`, plus Today reading the athlete's **assignment** instead of
     `programDayRows`' newest block. ADR 0007 decision 4 prices that read change as **byte-affecting**
     for the CSV export, so CLONE-1 is the first row that needs it decided.
  3. The V1-22 editor (chunks 4 and 6), which edits the copy rather than the original.

  **Out of scope:** comparing two versions, and a version history screen. ADR 0005 keeps versioning
  additive "whenever it earns a screen"; whether the copy records a `cloned_from` link is a question for
  this row's plan. **Owes** a plan, the engineering panel with the DB-safety lens (block creation and a
  copy across three tables), and a UX panel (the "who moves to this version?" step). Milestone: not yet
  assigned; Beta 1 ("program editing, schedules") is the natural fit.

<a id="retire-1"></a>

- **RETIRE-1 — archive a program so it stops appearing, without losing its history.** _(Maintainer,
  2026-10-08.)_ [CLONE-1](#clone-1) makes old versions pile up: every replacement leaves the previous
  program behind. Archiving hides a program from the program editor, from the list of programs to clone,
  and from new assignments. It changes nothing about the past: entries, their snapshotted
  prescriptions, and the assignment dates still render and export exactly as before.
  - **Archived is not deleted.** `deleted_at` means "this was removed", and soft-deleted parents drop
    their children out of live reads (the soft-delete-through-live-parents rule). An archived program's
    history must stay readable, so archiving needs its own marker, and the plan decides its shape.
  - **Undo is required:** an archived program can be restored.
  - **Open for the plan:** archiving a program that an athlete is still assigned to. Either it is
    refused, or it closes the open assignments; both are defensible, and the UX panel should weigh
    which one surprises a parent less.
  - **Gated on CLONE-1** (which creates the pile) and SCHED-1's assignments. **Owes** a plan, the
    engineering panel with the DB-safety lens, and a UX panel.

<a id="hist-1"></a>

- **HIST-1 — see what program an athlete was running on any past date.** _(Maintainer, 2026-10-08.)_
  "What was this athlete doing in March, and how did it go?" The data will exist once CLONE-1 ships
  (assignment rows with start and end dates, plus each entry's snapshotted prescription), but no screen
  shows it. Two candidate surfaces, for the UX panel to choose between or combine:
  - **a dashboard widget** (with [V1-16](#v1--online-kids-logger-generalized-model-still-no-offline-no-login)
    / DASH-1): a timeline of the athlete's programs; or
  - **a date selector on the program page:** pick a date and see that day's program as it was then.
  - **Gated on CLONE-1** (no assignment history exists before it). Which surface wins decides the
    roadmap pillar: Insight for the widget, Authoring & Scheduling for the program page. It is filed
    under Insight until then. **Owes** a UX panel and a plan.

- **V1-25 — the logging loop, from four sessions of real use.** _(Ray, 2026-09-29.)_ Four requests
  that arrived together and are **one theme**: the form should know what the athlete already told it —
  about the movement, about the day, and about yesterday. Filed as one row because they share a
  surface and two of them share V1-24's reframe; **split at implementation**, not here.

  ### 1. The scaffold's set count is hardcoded, and belongs to the coach

  `DEFAULT_SCAFFOLD_SETS = 3` (`strength-form-scaffold.ts:92`) — an **app constant**, not a coach
  decision. Ray wants **5** for his kids, and wants to set it **in the editor**. Two layers, and they
  are different rows' worth of work:

  - **The value:** the YDP seeds `sets: null` on every rotating and core movement _deliberately_ (the
    paper sheet shows no targets — "the absence of a target reduced the 'I failed today' effect"), so
    `clampSetCount` falls through to the app default. A per-athlete or per-program default is a
    **prescription** concern, not a form one.
  - **The control:** "set it in the editor" is **V1-22's** surface (program authoring), which does not
    exist yet. An interim is an input on the scaffold button itself — _how many sets?_ — which is
    cheap, needs no schema, and is the thing Ray can use this week.

  ⚠️ Do **not** solve this by changing the constant to 5: it is Ray's number for his kids, not a
  default for a stranger's first session (ONB-0/ONB-2 own that).

  ### 2. ~~Pre-select BW on bodyweight movements, and clear it when a weight is typed~~ ✅ shipped as V1-26 PR-A, DIFFERENTLY

  **Both halves of this were dropped on review, and the plan says why**
  ([v1-26](./plans/v1-26-form-knows-the-movement.md)). The catalog declaration does now reach the form
  — but on the **Unit select**, not as a pre-tapped chip.

  - **Pre-selection re-opens the V1-19 submit wedge.** `isUntouchedScaffold` requires
    `!s.isBodyweight`, so a scaffolded set seeded `isBodyweight: true` is permanently "touched" and
    blocks submit behind a collapsed card whose `required` reps input is unmounted. Doing 5 of 7
    programmed movements would have been unsubmittable. Found independently by both panels.
  - **Auto-clear makes `BW+8 (vest)` unmaintainable** — backspacing a typo in the weight destroys the
    mode — and it is a control changing state off-screen under the keyboard, announcing nothing (the
    checkbox is `sr-only`). Leaving BW on has no data-loss failure; clearing it silently converts a
    weighted push-up to `8 × 10 lb`, which is the 2026-09-28 incident mirrored.

  What shipped instead: the declared unit seeds the select (visible, overridable), and tapping BW on a
  catalog-declared-loaded movement raises a **non-blocking** note.

- **V1-30 — the log form offers units the server rejects.** ✅ **30a** (every offered unit saves and exports; BW/band refused on a time or distance) · 📋 [**plan**](./plans/v1-30-loggable-units.md). 🔴 **P0, reported 2026-09-30** by the
  `review-pr` run on #171: the strength form offers 9 units and the server's schema rejects 7 of them
  (`sec`, `min`, `in`, `cm`, `ft`, `m`, `yd`), since #141. Picking one fails the whole submit.
  Reproduced by #201's red-first commit; filed from #176's review.

- **V1-30b — the form stops inviting the shapes V1-30a refuses.** 🟡 Filed 2026-10-01 from the V1-30
  UX lens. 📋 [**plan**](./plans/v1-30b-form-stops-inviting.md) — **✅ COMPLETE — 30b-i (#234) + 30b-ii** (the form offers only what the server keeps: chips mass-only, Measuring clears the load modes in one update, per-dimension field word, one precision for every unit); **30b-ii** moved the stored-value ceiling to a PER-UNIT bound in the session refine (a real `3219 m` run and a `2400 sec` hold are accepted; the same number in the wrong unit is not) and spelled the five length codes in history with correct singulars. Per-dimension blank copy was already done by V1-27. Filed from ([plan § V1-30b](./plans/v1-30-loggable-units.md#v1-30b-filed-not-in-this-pr-the-form-stops-inviting-the-bad-shapes)).
  Hide BW / band on a time or distance movement and clear them when Measuring changes; label the field
  `time` / `distance` instead of `weight` (placeholder and aria-label); per-dimension blank copy
  ("Enter the time."); a hint when Measuring differs from the catalog's dimension; `step="0.5"` blocks
  `6.25 ft`; the shared 2000 cap now refuses a real 2-mile run in metres (3219) or a 40-minute hold in
  `sec` as "too high" (per-dimension caps, copy "check the unit"); history shows raw codes (`20 m`)
  where the picker says "Metres". A UI PR: a UX reviewer plus screenshots.

- **V1-33 — time and distance sets can't be edited.** 🟡 Filed 2026-10-01 (V1-30 UX lens). The edit
  guard is mass-only (form and SQL, invariant 3), so a `300 sec` typo needs a hand-written correction.
  Since V1-30 these sets are savable, so the population is real. Sequence after V1-30b.

- **V1-34 — jumps and holds open as Weight / Pounds.** 🟡 Filed 2026-10-01 (V1-30 UX lens). Box Jump,
  Broad Jump and Hollow-Body Hold have `unitDefault: null` (`catalog-movements.ts`), so the scaffold
  seeds `lb`, and the quickest path ("tap BW, type 30") saves a mass. Needs a correction or migration,
  because the seed is `ON CONFLICT DO NOTHING`.

- **V1-37 — a timed card asks for reps it doesn't have.** 🟡 Filed 2026-10-03 (V1-30b UX panel). A time
  card keeps the `reps × time` layout and requires reps ≥ 1, so on a plank a kid's natural move — type
  `30` into the first field — lands in reps and gets "Enter the time.", and a slip saves `30 × 1 sec`,
  which can't be edited (V1-33). Decide the timed-set shape (reps optional, defaulting to 1 on submit, or
  a single duration field); don't prefill a value the athlete didn't confirm. Sequence with V1-33/V1-34.

- **EXP-1 — one unexportable unit 500s the whole export.** 🟡 Filed 2026-10-01 (V1-30 architecture
  lens, pre-existing). `export/route.ts` has no try/catch around the builders, so any tripwire unit
  (none is offered: V1-30 made every strength unit export, and CSV-1 converts a kg bodyweight rather than
  throwing — but a new unit code could still trip one) fails every row. Do NOT fix it by skipping the bad
  row: gaps are normal in these files, so a dropped row reads as a day off — silent loss. Per-row failure or a
  typed error page.

- **V1-36 — the set-edit guard is looser than the UI says.** 🟡 Filed 2026-10-02 by the V1-24 3a fact
  sheet. Strength-logging invariant 3 says `isEditableSet` and `updateStrengthSetById`'s guard are
  identical, but the client requires exactly one quantity (`set-display.ts`), and the SQL guard only
  requires a live primary mass quantity. A crafted POST can edit a set the UI shows as locked (it
  updates the primary only). A server fix plus a `db:verify` proof.

- **E2E-3 — `export-full-day`'s determinism check can race another spec's strength write.** 🟡 Filed
  2026-10-02 (V1-24 3a correctness lens). Its comment says no other spec submits the strength form;
  `scaffold-submit` has since V1-19, on the same profile and month. Compare only the probe's rows.

- **V1-31 — the strength form's dropdowns may snap back after a rejected save.** 🟡 **Suspected, not
  yet reproduced** (found 2026-09-30 while fixing #180). React 19 resets a `<form action>` after the
  action returns, **including on an error**, and its native `form.reset()` puts a controlled `<select>`
  back to its first option: React keeps a controlled input's reset target in step with state but not a
  select's `defaultSelected`. #180 hit exactly this on the bodyweight Unit (kg silently became lb) and
  fixed it with a layout-effect resync (`bodyweight-form.tsx`, see `docs/features/write-path.md`).
  `strength-form.tsx`'s Measuring and Unit selects sit inside a form action the same way. Its saved data
  comes from state, so a submit is probably right, but after a rejected save the VISIBLE select may show
  the wrong unit. **First step: a probe** (reject a strength save with a non-default unit, read the
  select); fix only if it reproduces, with an e2e.

- **V1-32 — several weigh-ins a day, one per time-of-day slot.** 🟢 **Feature, deferred** (Ray,
  2026-09-30). Weigh on waking and before bed, and see the **overnight change** (bedtime on day D →
  morning on D+1). Each weigh-in carries a **slot** (`context`: `morning · pre-practice ·
post-practice · bedtime · other`), and the natural key is **one per (profile, day, slot)**: a
  double-tap still can't make two `morning` rows, but morning and bedtime coexist. **Slots, not free
  timestamps**, because a bare timestamp brings back the duplicate row V1-24 exists to stop. The saved
  time still shows on the receipt. **All profiles** (Ray's call, B). The legacy CSV already has this
  column (`docs/samples/legacy-csv/bodyweight/README.md`: `morning / pre-practice / post-practice /
random`), so this also ends the export's always-empty `context` (`packages/shared/src/csv/bodyweight.ts`).
  - **Schema prerequisite rides in V1-24 1d, not here** (the
    [1d amendment](./plans/v1-24-form-is-the-day.md#amendment-2026-09-30-the-index-is-slot-ready-v1-32)):
    the `context` column and the `(profile, day, context)` index land there, with every weigh-in
    `morning`, so this row needs **no index swap** later. What remains here is the slot picker,
    a receipt listing several weigh-ins, the overnight delta, and the form accepting slots other than
    `morning`.
  - **Owes:** a plan + **full UX panel** (the weigh-in form changes on a phone, on the gym floor).
  - **For the panel:** the legacy README's youth-safety rule says bodyweight is for _"tracking growth
    and relative strength, NOT weight management… never cut weight"_. Ray chose all profiles knowingly.
    The panel decides how an overnight delta reads on a kid's profile, and `morning` stays the weight
    that relative strength uses.
  - **After** V1-24 1d/1e and the AUDIT-1 P0s.

- **CSV-1 — a `kg` bodyweight exports as a bare number under `weight_lb`.** ✅ **Fixed — kg is CONVERTED (Ray, 2026-10-02).** The export read carries the unit; `buildBodyweight` writes an `lb` weigh-in as logged and a `kg` one as kg × `LB_PER_KG` (exact) rounded half-up to one decimal (the form's `step`), appending `logged <value> kg` to its notes so the number the athlete logged stays in the row. Any other unit still throws (a tripwire). Chosen over refusing — a kg tap is ordinary, unrepairable in the app, and would have 500'd the profile's whole export history — and over widening the contract (the header is legacy bytes). 🔴 **P0, found
  2026-09-30** by V1-24 PR 1b's correctness lens (#187), **outside that diff**. `bodyweight-form.tsx`
  has offered `kg` since V1-3 (#35). But `packages/db/src/queries/export-month.ts` has **never selected
  `unit`**, and `buildBodyweight` writes `formatNumeric(r.weight)` into a column headed `weight_lb`.
  So a kg weigh-in exports as `84.5`, and the Claude workflow reads that as **pounds**: a silent 2.2×
  error in a trend a coach reads. It doesn't throw, which is what makes it bad. `csv/value.ts` refuses
  exactly this for strength loads (_"a converted number is one the athlete never logged"_), and the
  bodyweight path has no equivalent. **Fix:** ~~(1) check prod for existing kg rows~~ — **answered
  2026-09-30 by V1-24 PR 1c's read: there are none.** All 10 live bodyweight rows are `lb`
  (`2026-07-29` → `2026-09-30`), so no correction is owed and this is now a **pure app PR**; (2) select
  `unit` in `bodyweightMonthRows`
  and ~~refuse a non-`lb` weight in `buildBodyweight`, so the export fails loudly~~ (superseded by (3): kg is
  converted; only an unknown unit still throws). ⚠️ **Not**
  `assertExportableUnit`: since V1-30 it RETURNS `'kg'` (strength loads spell it `85kg`), so calling it
  here would write `84.5kg` under a `weight_lb` header. CSV-1 needs its own lb-only guard for that
  column. (3) Convert, or widen the contract — **decided 2026-10-02: convert, keeping the original in
  notes** (above).
- **DAL-1 — `listEntriesForDay` does not exclude a soft-deleted profile.** ✅ **Fixed** (it now scopes by
  `isLiveProfile`, pinned by `lib/dal/entries.test.ts`; review found `weeklyAdherenceRows` had copied
  the same join, so it was fixed too, with a `db:verify` proof). 🔴 **P0, found 2026-09-30**
  alongside CSV-1 (#187). Its WHERE omits `isNull(profiles.deletedAt)`, one of two ownership sites
  that skipped it (the other was `weeklyAdherenceRows`). It's inert today because no profile is soft-deleted, but it breaks the
  ownership invariant the moment one is. **Fix:** add the predicate, plus a DAL test that a
  soft-deleted profile's entries don't come back. `writers/ownership.ts` (V1-24 PR 1b) is the natural
  place to make it unskippable.
- **DAL-2 — the live-profile ownership predicate is still hand-written at nine sites** (DAL-1 moved the two sites that lacked the soft-delete half — `listEntriesForDay`, `weeklyAdherenceRows` — onto the helper). V1-24 PR 1b
  extracts it to `packages/db/src/writers/ownership.ts` and converts the strength writer; the rest are
  untouched. A security predicate is the last thing that should drift between call sites (DAL-1 is
  what drift looks like). **Fix:** a `refactor/` sweep onto the shared helper, with `db:verify`'s
  cross-profile proofs as the check. No behaviour change.
- **SEC-3 — a failed DB call can send a kid's bodyweight to Sentry.** ✅ **Fixed 2026-10-01** (`fix/sec-3-sentry-db-params`):
  the scrubber cuts `params:` off every message and drops `params` keys at any depth. 🔴 Found 2026-09-30 by #192's
  security lens. drizzle-orm's `DrizzleQueryError` message embeds the query's params
  (`Failed query: … params: …`), `withServerActionInstrumentation` captures the thrown error, and
  `scrubSentryEvent` strips cookies, headers and form data but not `exception.values[].value`. So any
  timeout or dropped connection inside a bodyweight write ships the value to a third party
  (SECURITY.md → Logging). **Fix:** cut each exception value at `\nparams:` (and drop `params` keys
  from `extra`/`contexts`) in `scrubSentryEvent`, with a test built on a real `DrizzleQueryError`.
- **SEC-4 — `safeInternalPath` accepts only same-origin paths.** ✅ Found 2026-09-30 by #193's security
  lens. The shared redirect helper (the gate page and the gate Server Action) checked only for a single
  leading slash, but the URL parser rewrites `\` to `/` and drops tab/CR/LF, so some single-slash
  paths resolve to another origin. It now rejects backslashes and control characters (raw or
  percent-encoded) and requires the path to resolve to the same origin. Fixed before AUTH-1 or an
  invite flow reuses the helper.

- **V1-27 — doing SOME of a movement's sets blocks the submit.** ✅ **Fixed (#207)** — trailing empty sets are no longer required or sent, and a line above **Log strength** says what will be logged. 📋 [**plan**](./plans/v1-27-partial-sets.md) (approved by Ray 2026-10-01, trailing-set trade-off accepted). 🔴 **P0, found 2026-09-30** by
  `e2e/scaffold-submit.spec.ts` while building V1-26 PR-A. `DEFAULT_SCAFFOLD_SETS` is 3 and `reps` is
  unconditionally `required`, while `isUntouchedScaffold` drops a whole **movement** and has no
  per-**set** equivalent. So a kid who does **2 of 3 prescribed sets** cannot submit at all — the
  browser refuses with "Please fill out this field" on a row they deliberately left blank — until they
  discover the per-row "Remove" button. That is the most likely way to do a prescribed movement on a
  gym floor, and the failure is the same "form appears dead" shape the guide already documents twice.

  **Why no test caught it:** the unit tests submit through `payload()`, which never runs native
  constraint validation, and no e2e had ever submitted a scaffolded form. The V1-26 spec now does, and
  it fills every row precisely so it does not depend on this bug either way.

  **Planned fix:** untouched sets **after the last touched set** of a movement are not `required` and
  are not submitted, and a line above **Log strength** states what the tap will log. A gap (an untouched
  set before a touched one) still blocks, with a message naming the way out. No server validation or
  wire change: the server already rejects a blank set. Related to V1-25 §1 (the athlete should be able
  to choose the set count up front) but strictly worse, because that one is friction and this one is a
  wall.

- **V1-35 — an error names "Pull-up" when the day has two Pull-ups.** 🟢 Filed 2026-10-01 (V1-27's
  panel). Strength-session errors were numbered by payload index ("Movement 3"), which drifts when an
  untouched card is dropped before the faulty one; #201 replaces the number with the movement's name.
  A name is ambiguous when the same movement appears twice in a day (legitimate — two blocks of
  pull-ups). Fix when it bites: carry the card's on-screen position for the label, bounded so it can
  never reject a valid session, read only on the error path, and never stored.

  ### 3. A logged form should look complete, not empty

  📋 [**plan**](./plans/v1-24-form-is-the-day.md) — planned jointly with **V1-24**, per the note below.

  > _"Once we've clicked Log Strength maybe we should change the treatment to make it appear complete.
  > Same for Log Weight or check-ins — keep the value and just make it appear complete."_

  This is **V1-24's reframe reaching every form**, and the two rows should be planned together: V1-24
  is _the form holds today's values so you can edit them_; this is _and it looks like you're done_.
  Today the three forms disagree — check-ins render **checked + inert**, bodyweight and strength
  render **empty**, and the day's truth is in a read-only list underneath.

  **Ray asked for a design pass on this specifically** ("lets do some UX/design revisions on this to
  get the best UI for it"), so it gets the full UX panel rather than a chosen treatment. The real
  question is not styling: it is **what "complete" means when the value is still editable** — a
  checkmark that implies finality on a field you can still change is a lie, and an inert field you
  cannot correct is V1-24's bug in a nicer costume.

  ### 4. A calendar by the date, with a dot on days that have activity

  Reachable **from the date line** on Today; days with any logged activity carry an indicator, days
  without carry none — so a month tells you the streak story at a glance.

  Mostly **already specified**: this is the brainstorm's **v2 month calendar**
  ([day-navigation](./plans/day-navigation-and-dashboard-brainstorm.md)), whose read is one bounded
  query — `SELECT DISTINCT activity_date … WHERE profile_id = ? AND activity_date >= :monthStart AND
< :nextMonth`, index-covered by `idx_entries_profile_date`, ≤31 rows. It is **V1-15's v2**, and
  V1-15 (prev/next paging + the dated route) is planned but unbuilt — the calendar needs somewhere to
  navigate **to**.

  ⚠️ **Sequenced after V1-15**, and it composes with **MOT-1**: the dots and the streak are the same
  fact rendered two ways, so they should share one read rather than each growing their own.

- **~~V1-28 — paging to another day left the last day's form behind.~~** ✅ **Fixed 2026-09-30**,
  reported from real use. V1-15 made day navigation a client-side RSC transition, and
  `StrengthFormBody` was keyed on `gen` — a SUBMIT counter — so the subtree never remounted on a day
  change and every uncontrolled field kept its first-mount DOM value.

  **The damage was the day-role select.** Paging from a Strength B day back to a Strength A day left
  it reading "Strength B" under a header reading "Strength A". Its own docblock says the stored
  value's whole worth is PROVENANCE — _"a non-null day_role must mean a human asserted it"_ — and it
  is the column V1-13's CSV reads as `session_type`. So the bug did not merely look wrong: it wrote a
  day role the athlete never chose, into the column the export trusts most.

  Fixed by keying on the day as well (`${day}:${gen}`), which also clears typed-but-unsubmitted
  movement cards on a day change — the intended trade, since carrying them silently lets Day B's
  movements be submitted onto Day A. Covered by `e2e/day-nav-form-state.spec.ts`; the check-in form
  was already safe (its checked state is controlled, with a comment saying exactly why).

- **V1-24 — the form IS the day's state: edit what you already logged.**
  **PR 1a ✅** (the receipt, read-only — removes the second-submit path through the UI; concurrent
  mounts can still duplicate until 1d) · **PR 1b ✅** (the amend — a logged weight is correctable, on
  every day including closed ones) · **PR 1c ✅ applied 2026-10-01** (the duplicate-row
  correction: the prod read is committed in the plan — one group, one athlete, 2026-09-30, keeper named by
  Ray) · **PR 1d ✅ #210** (migration 0012, the bodyweight-scoped unique index, slot-ready for V1-32 —
  it keys on `(profile, day, coalesce(context, 'morning'))`; `context` already existed and nothing
  writes it, so NULL and `morning` must be one slot) · **PR 1e #214** (the create path's arbiter is
  target-less `ON CONFLICT DO NOTHING` in `insertBodyweightEntry` — replay → same id, another device →
  typed "already logged"; the `context` stamp and CHECK moved to V1-32). Then **3a** (strength, ahead
  of 2 by Ray's call 2026-10-02; split into **3a-i** ✅ the per-set amend → **3a-ii** ✅ the section
  receipt → **3a-iii** the fill skips logged movements, a dependency of 3a-ii; 📋
  [plan](./plans/v1-24-3a-strength-receipt.md)), 2 (check-ins), 3b (demote the list, plus session-less
  strength entries and the `Strength` heading rename).
  - ⚠️ **1d is gated on 1c being `--apply`'d, not merely merged**, and on the duplicate query being
    re-run just before 1d merges. `migrate.yml` runs on every push to main with no gate, so a 1d that
    lands before the data is clean fails the index build and then **re-fails on every later push**,
    taking `db:seed` with it. Procedure in [runbooks.md](./runbooks.md).
  - **Follow-up (from #180's round-2 review, not yet done):** the receipt's three states the e2e
    CANNOT reach today — a **closed day with a weight**, a **closed empty day** (`No weight
logged.`) and **duplicates** — have unit coverage (`bodyweight-section.test.tsx`) and screenshots,
    but **no axe or 360px-overflow e2e**. The e2e seeds its profiles today, so `resolveViewedDay`
    floors every `?d=` into the writable window; covering them needs a backdated-profile fixture (the
    screenshot script's `seedClosedDays` is the precedent). Fold into 1b, which adds a control to
    every one of these states and must audit them anyway.
  - **Follow-up (from V1-27's panel, 2026-10-01): add a set to a logged strength entry.** Once V1-27
    drops trailing blank rows, a set done but not entered (or entered after an early **Log** tap) has
    no in-app recovery: logging it again creates a second entry for the movement on that day, and only
    a `db:correct` correction can merge them. 1b amends values; 3a/3b are a receipt and a list move.
    Belongs with the strength half of the amend.

  📋 [**plan**](./plans/v1-24-form-is-the-day.md) (with V1-25 §3 — the two rows are planned together,
  as this row says they must be). _(Ray, 2026-09-28, from logging a real session.)_ He logged an athlete's KB swings as **`20 × BW`** when it was **10 reps × 20 lb**
  — and then **could not fix it**, for either of two independent reasons. First data-correctness bug
  found by real use, and the data is still wrong on the day it happened.

  ### P0 — a bodyweight set is STRUCTURALLY uneditable

  `isEditableSet` (`apps/web/app/p/[profileId]/set-display.ts`) opens with `!set.isBodyweight`, and
  `updateStrengthSetById`'s WHERE mirrors it. **No path through the UI or the API can correct a BW
  set**, and there is **no delete action anywhere in the app** — so a mis-tapped BW is permanent.

  GAP-3 PR 4a's plan flagged exactly this class — _"a set with reps and no load renders `5 × ?` and
  `isEditableSet` then refuses to fix it — permanently unrecoverable, because there is no delete
  action in this app"_ — and the guard was restated rather than relaxed, on the reasoning that nothing
  could write the shape. **The YDP seed can, and did.**

  ### P0 — the form ignores the movement's own declaration

  `KB Swings` is seeded `isBodyweight: false, unitDefault: 'lb'` — the YDP spec marks bell weight
  **required**, not optional. `strength-form.tsx` reads **neither field** (zero references to either),
  so BW was offered on a movement that cannot be done at bodyweight. The catalog already knew; the form
  never asked.

  ### Ray's shape: keep the values in the form, drop the read-only list

  > _"Why not just keep them in the form if they exist so they can edit? Same thing for rice bucket and
  > bodyweight, keep the values populated there for that day, no need to render the results below."_

  A reframe, not a tweak. Today the form is **write-only** and the log below is **read-only**, so the
  day's state is rendered twice in two vocabularies — and the _editable_ copy is the one that does not
  show what happened. Ray's version has one surface: **the form holds today's values, and correcting
  them is editing in place.**

  It also answers a scrolling problem V1-23 has been chipping at: one logged session renders **29
  read-only lines** (`25 × BW` five times, `5 × BW` five times, …) between the athlete and the rest of
  the page.

  **What it costs, and none of it is optional:**

  1. **"Submit again to correct" fights the idempotency guarantee.** `writeStrengthSession` is per-row
     `ON CONFLICT DO NOTHING` on `client_id` — a replay is deliberately a NO-OP, which is what makes
     v1.5's offline sync safe. The resolution is almost certainly **edit as a distinct intent**, not
     re-submit-as-upsert.
  2. **Deletion becomes reachable, and the app has no delete.** Correcting 5 sets → 3 means removing
     two. Soft-delete exists in the schema; nothing uses it.
  3. **The check-in "inert once logged" rule is deliberate** — `checkin-form.tsx` renders a logged
     habit checked + inert on purpose. Rice bucket becoming re-tickable is a decision about what a
     check-in MEANS, not a rendering change.
  4. **V1-13's CSV export reads the other model.** "The form is the state" makes the DTO the form's
     shape; the exporter reads the logged-entry shape.

  ⚠️ **UI change of this size ⇒ UX panel BEFORE implementation** (AGENTS.md). **Split it**: the two P0
  bugs are fixable independently of the reframe, and there is wrong data on the board now.

- **SCHED-2 — practice + privates as a logged shape, not free text.** _(Ray, 2026-09-24.)_ The athletes'
  real week, which nothing in the app currently represents: a **private 3:00–4:30PM M–F**, **wrestling
  practice 5:00–6:30PM**, and an **extra private Tue + Thu 7:00–8:00AM**.

  **Ray's call for now: they do not need to be logged — put them in `notes`.** This row is the later
  version: a shape and a slot so mat time is structured data rather than prose.

  Why it matters beyond tidiness: the [YDP spec](./samples/youth-daily-program/README.md) §8 says _"mat
  time is real training load — if practice is logged, the composer should be able to drop the rotating
  movement and keep only the core plus every-day block."_ A structured practice entry is what would let
  the session composer respond to load; a note cannot. `wrestling_practice` already exists as a one-tap
  life activity (V1-7) recording `practice_minutes`, so the real gap is the **private** — a distinct kind,
  with a coach and a time window — and the link from either to the day's programming.

  **Consequence worth recording now, because it affects shipped code:** logging happens **after 6:30PM**,
  with a pre-7AM window on Tue/Thu. That is the window V1-6c's local-day boundary has to be right for, and
  it is the constraint any streak cutoff has to respect.

- **IMP-1 — import the paper-era CSVs.** _(Ray, 2026-09-24.)_ Nothing reads the legacy
  `data/<type>/<athlete>/<YYYY-MM>.csv` files into the DB, so the app holds none of that history — which
  is why V1-13's "byte-faithful round-trip against the legacy corpus" **cannot be run at all** and why
  the exported directory does not need to be human-readable.

  **Sequenced AFTER the exporter, deliberately** (Ray): the exporter fixes the format, and the importer
  is then written against it.

  **The concrete job** (Ray, 2026-09-24): take the old **named** directories — one per child, named for them —
  and import their rows against the matching **`public_id`**. That is the one place a human name ever
  meets the data model, and it happens once, under review, rather than on every export. Two things fall out. First, **the old named directories become the
  importer's test fixture** — real authored rows, every shape the census found, already scrubbed and
  committed at [docs/samples/legacy-csv](./samples/legacy-csv/README.md). Second, it is what makes the
  `public_id` export directory legible in hindsight: the importer maps a named directory onto the right profile,
  so a human name is never a path.

  ⚠️ **Four of the twelve `load` shapes are not currently importable** — `BW+8 (vest)` and
  `123 (50ft)` need GAP-3 PR 4b's worn-load slots, and `BW (unassisted)` / `30 (2x 15 DB)` are
  qualitative prose with no destination until V1-9a's notes. An importer that silently drops them would
  be worse than none; it must refuse or park them.

- **IMP-2 — re-export the imported corpus and diff it byte-for-byte.** _(Ray, 2026-09-24 — "the
  exporter, after the importer".)_ This is the proof V1-13 **cannot** give on its own, and the reason is
  worth stating precisely: its plan admits the byte-faithful round-trip _"cannot be run at all"_ today,
  because there is no importer and the app holds none of the legacy data. There is nothing to re-export.

  **IMP-1 changes that.** Once the eight real files are in the database, running the exporter over them
  and diffing against the originals is a true end-to-end check of the format — against rows a human
  authored, not fixtures we wrote from our own reading of the contract. That closes the gap V1-13's own
  risk table names: _"the exporter is provable only against fixtures we wrote… both the fixtures and the
  formatter encode the same understanding, so a misreading passes both."_

  **The diff will not be clean on the first run, and that is the point.** Known non-matches to expect,
  each already documented: four `load` shapes are not importable yet (`BW+8 (vest)` and `123 (50ft)`
  need GAP-3 PR 4b; `BW (unassisted)` and `30 (2x 15 DB)` need V1-9a notes), `bodyweight.context` can
  never be written by the app, and a typed `92.0` trims to `92`. Each mismatch is either a known gap or
  a real exporter bug — and telling those two apart is the whole exercise.

  Stronger than V1-14b, which round-trips a day the app itself authored: this round-trips **history the
  app did not write**, which is the only way to catch a shared misreading.

<a id="hh-1"></a>

- **HH-1 — the household is a PATH SEGMENT, and it comes before the athletes.** _(Ray, 2026-09-28.)_

  ✅ **Superseded in part by [ADR 0006](./decisions/0006-household-addressing.md)** — **Accepted:
  option A (session-only)** _(the maintainer, 2026-10-07; #252)_. **This row's URL clause is
  superseded and nothing else is:** the club question and the matcher / two-ids-ownership warnings
  below survive and still apply. `/p/<profileId>` stays the address, the household comes from the
  session through TEN-1's single seam, and a wrong household is a 404. **TEN-1 is unblocked and in
  flight.**

  Today every route is `/p/<profileId>` with **no household segment at all**, even though the data
  model has been multi-tenant since V1-1a (`households` + `profiles.household_id`). Ray's shape:

  ```
  mat-plan.dev/                       → sign up / log in          (not a raw picker)
  mat-plan.dev/<household-id>         → who's logging today?
  mat-plan.dev/<household-id>/edit-athletes
  mat-plan.dev/<household-id>/p/<profileId>
  ```

  **Decided: the household id lives in the PATH, not only in the session.** Clerk still authenticates
  and authorizes — but the household is _addressable_, so a URL identifies whose data it is rather than
  depending on who happens to be logged in. That is what makes a link shareable between two parents,
  and what stops "log in as the wrong account, see the wrong kids" from being a silent failure.

  ### ⚠️ "A household may even be a club for all we know"

  Ray's aside, and it is the most consequential thing on this row. If the tenant can be **Mat
  Assassins** rather than _the Baker family_, then several things already shipped are sized for the
  wrong population:

  - **`households` is misnamed** for that case. Renaming a table is expand→contract, and it gets more
    expensive with every row that references it — cheapest to decide _now_, before an authoring UI
    writes to it.
  - **A club has coaches as well as athletes.** `profiles.kind` is `kid | adult` — a membership _role_
    (coach / parent / athlete) is a different axis, and PROF-1 is about to author into it.
  - **GAP-3 already assumed this.** The typed-measurement design was chosen over cheaper fixed columns
    explicitly because _"the population is a club, not two kids"_. The data model made the club bet;
    the URLs and the vocabulary have not.

  **This row does not have to settle the club question** — it has to avoid foreclosing it.

  ### What it touches, which is the real cost

  Not "add a segment". Every one of these has bitten this repo already:

  1. **Every route, link and `revalidatePath`.** `actions.ts` revalidates `'/p/' + id`; a household
     segment changes every one, and a missed one shows the athlete stale data after a write.
  2. **The gate matcher.** `proxy.ts` matches on path shape, and this repo has had **two** incidents of
     route reachability drifting from the matcher — `/duals` bouncing every visitor to `/gate` (#153),
     and the `/api` exclusion that would have shipped the CSV export completely ungated
     ([tech-debt](./tech-debt.md)). A third path shape is a third chance. **Assert the public/gated set
     directly**, rather than per-route.
  3. **Ownership.** Today `getProfileByPublicId` is the BOLA seam. With a household in the path there
     are **two** ids, and the new hole is a valid profile under the _wrong_ household — which looks
     authorized if only the profile id is checked. Boundary test: wrong-household → 404.
  4. **ONB-0's empty state.** ⚠️ This sub-bullet was stale in two ways and is corrected here: the empty
     state moved to **`/p`** at OSS-2 (`/` is the public landing), and **ADR 0006 was accepted
     session-only** (2026-10-07), so there is no `/<household-id>` segment for first-run to move to.
     What remains true is the agreement: ONB-0 shipped "a brand-new household sees the explained empty
     state, and `routine_config = NULL` means the neutral default" — so TEN-1 must leave a created
     profile's `routine_config` NULL rather than writing a starter routine (see
     [programming](./features/programming.md) invariant 5).
  5. **NOT the CSV export directory.** That is `public_id` on a _data_ path, not a URL, and is
     unaffected — stated because it looks adjacent.

  **Sequencing: HH-1 → PROF-1 → MOT-1's picker badge.** The path shape is the thing everything else
  authors into. HH-1 can land the routing _before_ Clerk — the household id in the path is useful with
  the access gate alone, and it decouples the URL decision from v1.5's auth work.
  ⏳ **This sequencing holds only under the path option.** If
  [ADR 0006](./decisions/0006-household-addressing.md) is signed as session-only there is no new path
  shape to author into, so PROF-1 and MOT-1 are gated by **TEN-1**, not by this row.

- **AUTH-1 — OAuth login (Google / Facebook).** _(Ray, 2026-09-30, P0 — new.)_ **Narrowed the same day for
  [Beta 0](./milestones/beta-1.md): Google only, via Clerk, sign-up invitation-only; Ray's existing
  household is claimed by a guarded correction before the gate goes; a `household_members` table;
  every entry point rejects a caller with no session. Facebook waits for a tester to ask.** Replaces the shared
  access code with per-person identity.

  **Why it became P0 the day the repo went public:** the access gate is a single shared password, and
  it is now the only thing between the internet and two children's logged health data. The public repo
  does not weaken it — the secret lives in env, not in the code — but a shared credential has **no
  per-person revocation**: one leak means rotating for everyone, and there is no way to give a coach
  access without giving them the family's. That is a security rationale, where before auth was a
  convenience one.

  **Scope:** Google and Facebook providers, a household per account, and the access-gate stopgap
  retired. v1.5 planned **Clerk**, which does both providers out of the box and already has a
  `pin_hash` column reserved — so this is likely "pull Clerk forward", not a new decision.

  ⚠️ **Revisit [HH-1](#hh-1) first — now owned by
  [ADR 0006](./decisions/0006-household-addressing.md)** (proposed 2026-10-07, unsigned). It
  recommends session-only, and it corrects the two costs this row used to assert: a `/p/<profileId>`
  link **is** shareable between two parents of one household once membership authorizes, and a
  wrong-account deep link still 404s. Read the ADR rather than this paragraph; it must be settled
  before either is built or they will disagree about what a URL means.

  ⚠️ **It is one story with PROF-1 and ONB-2, not three rows.** OAuth with no athlete editor means you
  log in and still cannot add yourself; an editor with no auth means anyone can add a child to your
  household. Ship the slice, not the layer.

- **PROF-1 — profile create / edit.** _(Ray, 2026-09-24 — after the MVP.)_ There is **no
  profile-editing surface at all** today: profiles exist only because the seed writes them, names cannot
  be changed, and a new athlete cannot be added without a deploy. That is the same shape as V1-22's
  finding for programs — config that requires editing TypeScript.

  Scope: create an athlete, rename one, set `kind`. **The first profile-mutating endpoints**, so it
  needs both panels and the full boundary-test set.

  **The affordance — Ray, 2026-09-28, from using it:** an **"Add athlete" tile at the BOTTOM of the
  picker**, styled like the athlete tiles but with a **dashed border and a `+`**. Two things that
  buys, neither of which a header button does:

  - **It is where you are already looking.** The picker is a vertical list and the answer to "how do I
    add myself?" is the next item in it, not a control above the question.
  - **Dashed-vs-solid is the whole affordance.** It reads as _a slot that could hold an athlete_
    rather than a button that does something, which is what makes it self-explanatory to a parent who
    has never seen the app — an ONB-0 concern reaching the picker.

  `kind` is `kid | adult`, so **Ray adding himself is this row**, not a separate one.

  ⚠️ **Sequenced AFTER [HH-1](#hh-1)**, and that is not a preference. The maintainer's framing is
  `mat-plan.dev/<household-id>/edit-athletes` — a path that does not exist yet. Building the editor
  first means building it at `/edit-athletes` and moving every route, link and `revalidatePath` when
  the household segment lands. Decide the URL shape, then author into it.

  ⏳ **That dependency dissolves if [ADR 0006](./decisions/0006-household-addressing.md) is signed as
  session-only** (proposed 2026-10-07): there is no household segment to author into, so PROF-1 is
  gated only by **TEN-1**. Under the path option the warning above stands as written.

  **Pulled forward** from "after the MVP" (2026-09-28): Ray is using the app and cannot add himself,
  which makes this the first real onboarding gap rather than a nicety.

  **The shipped version is full athlete CRUD** _(maintainer, 2026-10-08)_. ONB-0's empty-state link
  to GitHub ("How athletes get added") is interim, and PROF-1 removes it (ONB-0 plan, finding E23). No
  household outside the maintainer's reaches that screen first, because Beta 0 ships PROF-1's create
  alongside ONB-0.
  - **Create, read and edit live on `/p`.** That means the dashed "+ Add athlete" tile above, plus
    rename and `kind`.
  - **Delete does not have to live on `/p`.** The maintainer's first idea: an **Edit** toggle on `/p`
    reveals a delete control on each athlete tile, and the parent **types the athlete's name to
    confirm**. A settings surface (SET-1) may be the more deliberate home. The UX panel
    explores both; neither is decided.
  - **Whatever the surface, delete is PRIV-1's hard delete**, not a new soft-delete button: the
    athlete's rows go, soft-deleted ones included, and the deletion is recorded in the ledger. That
    makes it irreversible, so the confirm step should offer **archive** (Beta 1), the reversible
    alternative, before it offers delete. It sits behind Beta 1's step-up, which this row adds to that
    list.

- **YDP — run the youth daily program (the second real program).** _(Ray, 2026-09-23.)_ Everything the
  app needs before [Ray's daily A/B program](./samples/youth-daily-program/README.md) — the one his kids
  actually run, every day, on paper — can be logged in mat-plan. Grouped because they share one goal and
  one piece of evidence, and because a scattered finding gets re-derived rather than built.

  **They must co-exist with the weekday S&C block, not replace it** — Ray runs both at once, adding the
  block on top of the daily program in the off-season. So every item below is **additive**: an existing
  weekday program keeps working byte-identically.

  - **YDP-1 — session-indexed rotation. ⏸️ DEFERRED by Ray (2026-09-24); calendar alternation ships
    first.** _(Also SCHED-1's third schedule shape.)_ The spec is emphatic that the letter must come from
    **completed-session count, never the calendar**, and gives the failure mode: `date % 2` doubles up box
    jumps after a missed day. **Ray has accepted that failure mode deliberately** — _"I don't mind if they
    miss a day and end up doing the same thing twice, that's on them. The way this works is by streak and
    consistency, stacking days. For now we can just align A with a day, B, next day etc."_
    So v1 alternates on the **calendar**, which the existing `DAY_ROLE_BY_WEEKDAY` shape already supports
    and which needs no new schema. Recorded rather than silently inherited, because the consequence is
    invisible when it happens — a doubled-up box-jump day looks like a normal day.
    True session-indexing still needs `schedule_kind` on SCHED-1's assignment row and the **recorded daily
    verdicts** SCHED-1 requires, since "completed sessions" is a question about history. **Blocked on
    SCHED-1** whenever it is picked up.
  - **YDP-2 — multi-slot loads + duration. ✅ RESOLVED into GAP-3 (2026-09-24).** Two reversals worth
    keeping visible. It was first filed as needing new columns; GAP-3 §7.2 then claimed it needed **no
    migration** because the metric model already fit; that claim was **retracted by GAP-3's panel** —
    a metric-modelled Stance in Motion is **unprescribable** (`prescriptions.movementId` is a NOT NULL
    FK → `movements`), yet the YDP seed gives it a progression rule.

    **Decision (Ray): Stance in Motion is a MOVEMENT, and the worn loads get a typed child table**
    `entry_set_loads(entry_set_id, slot, value_num, unit)` — parent is the SET, because a vest comes off
    after set 1. Chosen over a cheaper single `weight_num` + `load_slot` column despite all four sample
    sessions using at most one slot at a time, because: the population is a **club** (Mat Assassins), not
    two kids, so a four-session family sample never described it; slots vary within a session; and the
    data-loss window is open only until logging starts. See
    [GAP-3 §7.2a](./plans/gap3-typed-measurements.md). Original framing:

    **YDP-2 (original) — multi-slot loads + duration on one activity.** Stance in Motion carries
    `duration_minutes` with **independent** `vest_lbs` / `ankle_lbs` / `wrist_lbs`, any combination
    including none. Today a set has ONE `weight_num`, and `entry_sets.seconds` has no writer outside the
    strength path. **ADR 0004's mapping table does not anticipate three simultaneous load slots** — it
    handles one weight plus at most one other dimension (`123 (50ft)`). This is the same class of
    surprise the legacy CSVs produced with per-set slash lists, and it is **daily** work, not an edge
    case. **GAP-3 must see this before its columns are fixed.**

  - **YDP-3 — ~~read `movements.is_bodyweight`~~ → FOLDED INTO GAP-3 (2026-09-23).** Investigated before
    implementing; **the row rested on two claims that are false**, so it is corrected here rather than
    built.

    1. **`findOrCreateMovementId`'s `isBodyweight: false` is not a bug.** The insert is
       `ON CONFLICT DO NOTHING` on `slug` (`apps/web/lib/dal/catalog.ts:76-88`), so the 7 seeded
       bodyweight movements keep their correct `true`. The hardcode only applies to a genuinely NEW
       movement typed as free text, where the app has no way to know — `false` is the safe default, not
       an oversight.
    2. **"These movements have no meaningful weight field" is wrong for this very program.** Push-ups,
       pull-ups, leg raises and inverted rows are all
       `"weight": { "applies": true, "required": false, "source": "vest" }` in
       [seed.json](./samples/youth-daily-program/seed.json) — bodyweight movements that **can** be
       weighted. So auto-filling `BW` would **silently mis-log a vest session**, which is the V1-10
       confirm-gate failure in a new costume. Today's design — field required, `BW` one tap via
       `LoadChips` — is correct and should not change.

    **Where the column's value actually lands:** [ADR 0004](./decisions/0004-typed-measurements.md)
    already assigns it a consumer — its mapping table has `BW → movements.is_bodyweight (already)` and
    `BW+8 (vest) → is_bodyweight + weight_num`, the shape it flags as **not representable today** and
    exactly what this program needs. So `is_bodyweight` becomes load-bearing **as part of GAP-3**, not
    before it. Tracked there; no separate row.

  - **YDP-4 — the extras: box height, ladder rounds, fixed-set checkboxes.** Box height is a **length**
    dimension, which `UNIT_CODES` does not have at all (GAP-3/ADR 0004 §6). Ladder rounds fits the
    existing `ladder` metric's `value_num`. **Hip thrusts and leg raises are ordinary REP MOVEMENTS**
    (Ray, 2026-09-24) — the paper sheet's three completion checkboxes are a paper affordance, not a data
    shape. That collapses two of this row's three open questions: both are `movement + entry_sets`, the
    model the app already has, and neither needs a bespoke column or a boolean triple. `per_side` remains
    unmodelled (it lives in prescribed text today).
  - **YDP-5 — youth guardrails as engine limits.** _No forced eccentrics · no max-effort grip work · no
    loaded jumping_, with an anatomical rationale (an unfused apophysis is not a mature tendon
    attachment). The repo's **first domain-specific safety constraints**. They belong to `packages/engine`
    (v2): **AI-1 S1** already permits a load derived by _a readable rule_, and these are what such a rule
    must respect. Recorded now so they are inherited rather than rediscovered — and per the spec they are
    **hard limits, not defaults.**

- **MOT — motivation & retention (the behavior-change layer).** _(Ray, 2026-09-16.)_ The product spec's
  **top risk** is that nobody logs: the premise is behavior change and the app is **entirely schema** —
  today the only motivational surface in the whole product is the calisthenics `<progress>` bar
  (V1-6b-2). These three rows are that risk's answer, grouped because they share machinery (a
  "did this athlete log today" query, a per-profile schedule, a rotation-with-memory) and because
  scattered singles don't get built. See [product-spec.md §12](./product-spec.md).

  - **MOT-1 — streaks.** Consecutive days logged, per athlete, surfaced as a **badge in BOTH places**
    (Ray, 2026-09-28): beside the name on the **picker tile**, and on the athlete's **Today** screen.

    That is two different jobs, not one feature rendered twice. On the picker the streak is a
    **pre-commitment cue** — you see it _before_ choosing, and the kid with 12 days is looking at what
    they stand to keep. On Today it is a **reward**, after the work. The same number, read at opposite
    ends of the decision, which is why "surfaced on their Today screen" (the original wording) was the
    smaller half.

    Picker placement has a cost the Today placement does not: the picker currently runs ONE query
    (`listProfiles`), and a per-athlete streak must not turn that into N. Fold it into the same read —
    the streak is a fold over `entries.activity_date`, which `idx_entries_profile_date` already covers.
    **Two design constraints that are not optional**, both arising from what this app is:
    1. **A streak must not break on a programmed rest day.** The schedule already knows a rest day is a
       rest day (V1-10 `day_role`); a streak that punishes a kid for correctly resting is worse than no
       streak, and directly contradicts the program.
    2. **A broken streak must not read as failure.** The known failure mode for streak mechanics is that
       loss triggers abandonment — the exact outcome this exists to prevent. **Ray's shape (2026-09-16):
       the current counter returns to `0`, with LONGEST STREAK shown beside it** — so the achievement is
       never destroyed, only the run is. That solves it cleanly: a kid who hit 100 still has 100 on
       screen, and the thing they lost is recoverable rather than erased.
    3. **The PROGRAMMER decides what counts toward the streak** — configuration, not a rule the app
       imposes. _(Ray, 2026-09-17, superseding an earlier draft of this row that hard-split "daily habits
       count, S&C doesn't.")_ That split was wrong on its own evidence: the world-champion kid's 90+ day
       run included **stance-in-motion in a weighted vest, several rounds daily** — loaded work, done every
       day. "Daily habits are unloaded, S&C is loaded" does not survive contact with a real athlete, and
       the app should not encode a taxonomy the sport doesn't have. The coach picks the inclusion set; if
       they want the weekly S&C in it, it counts.

       **This extends V1-18 rather than adding a mechanism.** `routineItemSchema` is already
       `{ key, conditional? }`, and `routineConfigSchema` is deliberately an **object rather than a bare
       array** so additions are "additive with no shape bump" (`packages/shared/src/routine.ts:44-54`) —
       exactly what a per-item `streak: true` flag is. The authoring surface exists too: the V1-18 coach
       editor at `/p/[profileId]/routine` is already a per-kid activity checklist, so streak inclusion is
       one more column on a screen that ships today.

    4. **ONE daily streak, and every program has ASSIGNED DAYS.** _(Ray, 2026-09-19 — two decisions that
       together settle a design which had started to sprawl.)_

       **(a) One streak, not many.** An intermediate draft went toward per-program streaks with
       configurable periods — a daily streak, a weekly S&C streak, a weekly sprint streak. **Dropped.**
       There is one streak, its period is **a day**, and a program that is not daily is simply **included
       or not** by the coach (constraint 3). That deletes streak _periods_, the weekly _unit_, and
       _competing counters_ — and still covers every case posed, including "wrap it all into one program,"
       which now falls out for free. One number is also the only shape a kid actually tracks.

       **(b) No `n`-times-per-week programming.** The coach selects **the days** a program is due —
       Monday, Wednesday, Friday — never "three times a week." This is a statement about how programs are
       **authored**, not just about streaks, and it removes a whole shape from the model.

       **Together these make the streak arithmetic-free.** A day counts when everything **due** that day is
       done; "due" is a lookup against assigned days, not a computation. Rest days are handled by
       construction — nothing assigned, nothing due, nothing missed.

       **A field-tested completion rule (2026-09-23).** Ray's paper program already answers what the UX
       panel was left to decide: **core block + every-day block counts as complete; the rotating movement
       is optional**, "so a missing box does not punish a kid who did the work"
       ([samples](./samples/youth-daily-program/README.md)). Adopt as the default rather than re-deriving
       it — it comes from a program two kids have actually run, and it matches the forgiving shape
       constraint 2 already requires.

       Note `conditional` already exists on a
       routine item as "an OPAQUE cosmetic marker… scheduling flips it functional later"
       (`routine.ts:43`), which is exactly this lookup.

       **The tradeoff, considered and accepted.** A quota model (`3×/week`, any days) was worked through
       and rejected. It would have been more forgiving — an athlete who moved Wednesday's session to
       Thursday would keep their streak — but it costs a dueness rule with real arithmetic, a "due because
       you are out of runway" state the UI has to explain, and a partial-first-week question. With assigned
       days, **a session done on the wrong day does not save the streak**: Wednesday breaks it, and
       Thursday's work counts toward nothing. That is the accepted cost, and it is also how a written
       program actually reads — the kid was asked to lift Wednesday.

       **Watch this against constraint 2.** Fixed days make a break easier to hit, so the forgiveness has
       to come from the _response_ rather than the rule: the counter returns to `0`, **longest streak stays
       on screen**. If real use shows breaks landing on kids who did the work on a shifted day, the cheap
       mitigation is a coach-marked **excused day** — not a return to quotas. Flagged for the UX panel to
       watch, not to build.

       Needs a **UX panel**: this is a motivational surface aimed at a child, and getting it wrong costs
       retention rather than correctness.

  > **Product reframe this surfaced (Ray, 2026-09-16) — worth more than the feature.** The roadmap has
  > treated **strength programming** as the core and habits as the supporting cast. Ray's actual primary
  > use is the inverse: **daily-habit consistency is the product**, and S&C is programmed on top of it on
  > certain days depending on practice load. The evidence he cites is a world-champion kid at his club
  > running 90+ day streaks — on daily basics **plus weighted-vest stance work**, so the loop is "something
  > every day," not "unloaded work only." If that is the core loop, then the **daily routine + streak** is
  > the retention engine and the strength form is the _secondary_ surface — which reorders a good deal of
  > the backlog, and partly answers the premise-drift finding in
  > [product-spec.md §9](./product-spec.md).
  >
  > **Weaker than it first looked, deliberately noted.** Once the coach can fold S&C into the streak
  > (MOT-1.3), "habits are the core, S&C is the overlay" stops being a clean architectural split and
  > becomes one configuration among several. The reframe may be about **emphasis and sequencing** rather
  > than a change of product. **Not acted on; flagged for Ray to confirm before it moves anything.**
  - **MOT-2 — reminders / notifications.** Push reminders to log entries and finish blocks (e.g. "log
    your weigh-in", "conditioning is due today"). Primary surface is **iPad / iPhone / tablet**
    (installed-PWA **web push** works on iOS 16.4+; a thin native shell only if web push proves too
    limited), occasionally Mac. Per-profile schedules + quiet hours; **opt-in per kid**. Builds on the
    v1.5 PWA + auth foundation. Note the ordering trap: a reminder to log is only useful once logging is
    fast — shipping it ahead of the strength-entry fix (V1-19/V1-21) nags a kid toward a slow form.
  - **MOT-3 — daily motivational quote.** A rotating quote for the day, surfaced for the `brain_rep`
    activity and/or on Today. **Source (Ray): wrestling Hall of Famers, NCAA champions** — real,
    attributed quotes from the sport, not generic gym-poster filler; the attribution is most of the
    value for a wrestler. Needs: a seeded quote list (a catalog table, consistent with the
    reference-table pattern — **not** LLM-generated, same authorship principle as loads), a rotation
    that doesn't repeat until exhausted, and per-profile "already seen" tracking. Verify quotes are
    genuinely attributable before seeding — a misattributed quote to a HOFer is embarrassing in exactly
    the community this targets.

- **ONB-0 — first run was broken. ✅ DONE 2026-10-07** ([plan](./plans/onb-0-first-run.md) ·
  [UX panel](./plans/onb-0-first-run-ux-panel.md)). Pulled forward out of Beta 0 step 4 on 2026-10-07:
  it had been bundled behind `AUTH-1`, which bought no safety — first run was **broken today**, a P0,
  blocking nothing. Work that is already broken and blocks nothing is pure throughput
  ([milestone](./milestones/beta-1.md), [parallel-work](./parallel-work.md)).

  **What was wrong.** A new profile has `routine_config = null`, which `resolveRoutine` mapped to
  `buildDefaultRoutine` over the **whole** seeded catalog — so a stranger's first screen was **the
  maintainer's household's routine**, in its shorthand: Rice bucket · Brain rep · Splits · **Brush
  teeth** (a wrestling drill block with stance/ladder/bridge sub-metrics, which a new coach reads as
  dental hygiene). The UX panel counted the real burden: **~17 controls, none explained.** And before
  that, the picker said, to a human: **"No profiles found. Seed the database to get started."**
  ⚠️ That string was cited here for months as `apps/web/app/page.tsx:25`; **OSS-2 moved the app behind
  the public landing**, so it was `apps/web/app/p/page.tsx:37`. Citation corrected in the same PR.

  **What shipped**, to [ONB-1's R2](./plans/onb-1-self-serve-onboarding-prd.md) (an explained empty
  state + a control + a neutral default; **not** a questionnaire):
  - The picker's empty state explains what the app is, what happens next, and that adding an athlete
    isn't in the app yet — and the page **subhead branches** too, because "Pick a profile to start
    logging." is an imperative with no object when the list is empty.
  - The neutral default is **`['strength']`** — with the pinned weigh-in, exactly the UX panel's own A2
    candidate ("weigh-in + strength only, everything else opt-in via the editor"). Membership stays the
    full catalog, so an existing household's authored items still render; only the fallback narrowed.
  - `routine_config = NULL` **is** the neutral default and is never written. Seeded profile 1 was NULL,
    so it got an explicit full-catalog config, and a guarded correction
    (`null-routine-to-full-2026-10-07`, scoped to the seeded household) did the same for the live row.

  **What it deliberately left, and to whom:**
  - **PROF-1** removes the "isn't in the app yet" line, the GitHub link and the README's
    `## Adding an athlete` section when its dashed `+` tile lands. R2's "route to the editor" half is
    unsatisfiable until then: at zero profiles there is no `profileId`.
  - **ONB-2** owns `shot`. It is reachable today only as `checkin:brush_teeth:shot` — whose group label
    is the offending string — and the `shots` activity is outside `CHECKIN_FIELDS`' render scope, so
    giving it a neutral home is a render-scope change, plus the matching one-line edit to
    `NEUTRAL_DEFAULT_KEYS`.
  - **CAT-1** — the calisthenics counters are out of the default, consistent with its trap (2) ("the
    default needs the criterion too"); its named exclusion const beside `CALISTHENICS_METRIC_KEYS` is
    still CAT-1's to write.
  - **OPS-2** — `migrate.yml` seeds prod on every push and the seed inserts two named fixture profiles,
    so a stranger who forks and deploys by the documented route still lands on a picker holding _the
    maintainer's_ two kids, not this empty state. OPS-2 is what makes the empty state the normal first
    screen.
  - **`life:wrestling_practice`** rejoins the default once its one tap states what it writes
    (`DEFAULT_PRACTICE_MINUTES = 90`, the maintainer's club's number) or takes a duration.

- **UNIT-1 — ABSORBED into GAP-3 (2026-08-26).** The finding stands and is unchanged: verified against the tree,
  `entry_sets.weight_num` is `numeric` with **no unit column** (`packages/db/src/schema.ts:191`),
  `prescription_targets.load` is verbatim text with no unit (`:544`), and `movements.unit_default` exists and FKs to
  `units.code` (`:255`) but **nothing in the app reads it**. Only weigh-ins carry `lb | kg`, so **a kg household is
  unrepresentable across the whole strength path today**. It is no longer its own row because units and typed
  measurements are the same migration — see **GAP-3** and [ADR 0004 §6](./decisions/0004-typed-measurements.md).
- **ONB-1 — self-serve onboarding: bring-your-own-program** — **scope clarified 2026-09-18:** "import"
  here means a **program** (prescriptions, targets, the plan going forward). **Importing a family's
  historical logged data is NOT a goal** — a new household enters their program and starts logging;
  they already know the loads their child uses. Consequence: the legacy CSVs' N-sets-in-one-cell shapes
  (`65/65/65`, `4/3/4/2`) never need a split-on-import path. See
  [samples/legacy-csv/README.md](./samples/legacy-csv/README.md).
  ([PRD](./plans/onb-1-self-serve-onboarding-prd.md)) — _(Ray, 2026-08-11; UX panel 2026-08-12; Ray's
  decisions 2026-08-20)_ **PRD ONLY — not a plan, not scoped.** Onboarding a new family today costs a code
  change + a deploy: `seed.ts` is the only writer of profiles, and the strength program is a TypeScript
  const with no authoring UI. The data model is already multi-tenant (`households` +
  `profiles.household_id`), so the gap is **authoring surfaces + auth**, not the schema.
  **Shape, after Ray's 2026-08-20 answers closed the decision-shaping questions:** **no questionnaire** —
  first run is an explained empty state plus V1-18's **already-shipped** routine editor (→ ONB-0). Import
  serves only the **structured** plan shape; parent-written daily goals ("100 push-ups a day") are
  **`ramp_targets` on the shipped calisthenics metrics — typed, no AI, no new tables** (and must never
  render as `1 × 100`, which would break the accumulation model). The two shapes **arrive layered in one
  document**, so the extractor **splits** rather than classifies, and **refuses free-form prose** outright
  (`"a couple sets"` has no ground truth to proofread — that was the one real break in the
  "transcription, not authorship" claim). Loads are **never model-written**: the extracted text shows as
  static source beside an empty field and the coach **taps to fill it**, one load at a time, **at the
  moment of use** on the existing V1-10 card — **no bulk confirm screen** (theatre at 20+ rows on a
  phone) and **no "fill all", ever**. Provenance is marked for the **first workout after import** only,
  then clears. Verification is **loads-only**. Equipment is **cut permanently** (the app will never
  suggest movements, so nothing would ever read it). **Suggested loads are an explicit goal** — from past
  logged performance via a published progressive-overload scheme, in **`packages/engine`**
  (deterministic, golden-vector tested, auditable), **never an LLM**. **Two blocking prerequisites:**
  `movements` must be **household-scoped** before any multi-tenant writing — `slug` is globally `UNIQUE`,
  so the second household to type "RDL" gets a **hard write failure** — and **UNIT-1**. **v2+ territory.**
- **Brain-reps content — FOLDED INTO MOT-3** (2026-09-16). The daily-quote idea now lives in the **MOT**
  group above, with a source named (wrestling HOF / NCAA champions) and the rotation + "already seen"
  requirements written down. Kept as a pointer so the original idea's thread isn't lost.

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

- DB-in-CI → Docker Postgres (CI tests) + Neon branch-per-PR (previews). ⚠️ **The previews half was
  SUPERSEDED by [OPS-1](./plans/ops-1-preview-isolation.md) (2026-10-07) and was never built.** A
  branch of production is a copy-on-write clone, so it would put every family's data in every preview;
  previews use a separate, seed-only Neon project. Kept here as provenance, annotated rather than
  rewritten.
- PIN → deferred; `pin_hash` column only.
- Habits CSV → app-only until the v3 API.
- Auth provider → Clerk (COPPA stays deferred; kids have no accounts).
