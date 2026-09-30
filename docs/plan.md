# mat-plan — Phased Plan & PR Backlog

Each phase is small, shippable, and dogfoods CI + Playwright. **v0 and v1 are broken into
individually-reviewable PRs** (reviewed PR-by-PR to learn the codebase). Architecture + standards are
in [spec.md](./spec.md); agent/PR/CI rules in [../AGENTS.md](../AGENTS.md); per-PR checklist in
[definition-of-done.md](./definition-of-done.md). Each PR is one branch → one PR → squash-merge; reference the id (e.g. `V0-1`).

## ⭐ Current priority order (Ray, 2026-09-30 — the repo is now PUBLIC)

Making the repo public reframed the backlog: **"someone who is not Ray can use this"** stopped being
a v1.5 concern and became the headline. The list below is Ray's, with the sequencing findings that
came out of writing it down.

### P0

| #   | What                                                                                                                          | Row(s)                    | State                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Anything blocking**                                                                                                         | **V1-14b**                | The MVP finish line: log a day → export → diff. Unblocked; has real logged data now.                                               |
| 2   | **Open bugs**                                                                                                                 | **V1-24 / V1-26 / V1-30** | Planned + panelled. A bodyweight set is uncorrectable and the form ignores the catalog — the pair that caused the 09/28 data loss. |
| 3   | **Logged forms look complete**                                                                                                | **V1-25 §3**              | UX pass done; planned jointly with V1-24 ([plan](./plans/v1-24-form-is-the-day.md)). PR 1a (the bodyweight receipt) is next.       |
| 4   | **Athlete editor** — add/remove from the dashboard, new athletes start on [The Daily Five](../programs/daily-five-default.md) | **PROF-1 + ONB-2**        | ONB-2's default program is drafted (branch `docs/onb-2-daily-five`).                                                               |
| 5   | **Edit programs, and choose which days they run**                                                                             | **V1-22 + SCHED-1**       | The authoring half of onboarding.                                                                                                  |
| 6   | **OAuth login (Google / Facebook)**                                                                                           | **new — AUTH-1**          | Replaces the shared access code.                                                                                                   |
| 7   | **Streaks on the athlete card**                                                                                               | **MOT-1** (picker half)   |                                                                                                                                    |

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
| Shareable link between two parents     | ✅                       | ❌ — each sees their own     |
| Wrong-account-wrong-kids fails         | loudly                   | **silently**                 |
| Touches every route + `revalidatePath` | ✅                       | ❌                           |
| Works before auth lands                | ✅                       | ❌                           |

**They are not exclusive** — the path can be the address and the session the authorization, which is
the combination HH-1 actually described. But **#6 should not be built assuming session-scoping**
without revisiting HH-1, or the two will disagree about what a URL means.

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
| V1-13                                                                                                    | **CSV export** re-aggregating to the live legacy schema — **[contract](./csv-export-contract.md)** (authoritative; supersedes spec.md where they differ). Four files at `data/<type>/<athlete>/<YYYY-MM>.csv`, one per kid per month, no athlete column. **Not RFC-4180**: zero quoted fields exist, one real row carries bare `"` inch marks and another an unescaped comma — join raw, never use a CSV library. One row per MOVEMENT (aggregate the per-set rows; collapse a uniform slash-list to a scalar). `prescribed` is the plan and is NEVER reconciled with the actuals. Bodyweight must export as TEXT (`71` vs `71.0` must survive) — a data-model consequence. CI asserts the golden diff **plus** that `sets` equals any slash-list's element count, which the diff alone cannot catch. **PLANNED 2026-09-24** — [v1-13-csv-export.md](./plans/v1-13-csv-export.md), two panels before implementation (engineering + a dedicated contract-fidelity lens that read the real sample bytes). **Nine blocking findings; two would have silently corrupted the workflow.** (a) The app emits `front_squat` where legacy is `front-squat`, so **every movement forks into two series** and the workflow's grouping returns nothing. (b) A `kg` load exports as a bare number the workflow reads as lb — a **2.2x error in the column that drives load progression**; the exporter now REFUSES rather than converts. Also: `SKIPPED` comes from `entries.status` not `entry_sets.status`; `sub-failure` is a 12th shape that was missed; **38% of seeded prescriptions contain a comma** and would split the row; `numeric` returns a string so every load reads `70.000`. Re-scoped to one file at a time — **13a = strength-log end-to-end**, 13b = bodyweight/checkins + zip. **Resolved by Ray:** the `<athlete>` directory is **`profiles.public_id`** — no slug, no migration. A readable directory was only ever needed to keep app exports contiguous with the paper-era tree, and Ray retired that requirement (_"the past data does not matter that much at this point"_), so the stable id the schema already has wins on every remaining axis. Legibility comes back via the importer (**IMP-1**), which maps the old named directories onto the right profile — and Ray's point that **the old named data is the importer's test fixture**. `profiles.slug` cancelled (#145 closed). Bodyweight trims trailing zeros. `calisthenics-log` cut → **V1-13a-fu**.                                                                                             | Output diffs clean vs the committed golden files, and slash-list arity matches `sets`                                                       | Data transform + golden-file test                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| V1-13a-fu                                                                                                | **`calisthenics-log` CSV — the one schema the app DEFINES rather than matches.** Cut from V1-13 by Ray (2026-09-24) as a fast follow, because defining it is its own decision with three unanswered questions, each a silently-wrong column: ~~the program prescribes `leg_raises`, which has no column~~ — **resolved 2026-09-24 (Ray): leg raises are an ordinary REP MOVEMENT**, so they belong in `strength-log` beside the other per-set movements, not in this file's daily-scalar shape. Two questions remain: the program tracks `reps_per_set` across up to 10 sets while the CSV column is a **single daily scalar** (sum? max? undefined); and **`vsit_skill_step` (1-5) has no representation in the data model at all**. Also collides with the contract's `0`-vs-empty rule — the program's `"empty_set_means": "not_performed"` is exactly the ambiguity [csv-export-contract.md](./csv-export-contract.md) L49-50 forbids. Header is fixed by the contract; the mapping is not. Nothing exists on disk, so the app also creates the directory + a README mirroring the other two.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A calisthenics day exports a row the Claude workflow can read                                                                               | Export schema definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| V1-14a                                                                                                   | **Hardening** ([plan](./plans/v1-14a-hardening.md)) — rate-limit the ACCESS GATE (the app's only unauthenticated password oracle) keyed by the Vercel-set client IP, fail-open; Sentry error reporting via `withServerActionInstrumentation` **with a unit-tested PII scrubber** (the documented wiring would ship the `mp_gate` cookie, a kid's bodyweight, and the plaintext access code to a third party); Dependabot cooldown. Mutation rate limits deferred to Clerk/v1.5 — `profileId` is caller-supplied, so a limit keyed on it would constrain only the household. Every var OPTIONAL: absent ⇒ no-op, which is what local dev and CI run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Gate blocks past the limit with a typed envelope; a thrown error reports to Sentry with no cookie/PII; CI unchanged without credentials     | Operational hardening                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ~~V1-14b~~ ✅                                                                                            | **Full-day E2E + CSV diff** — log a full day through the real UI, download the real export, open it with the system `unzip`, assert the bytes. `apps/web/e2e/export-full-day.spec.ts`. **Deliberately NOT a committed golden file:** a golden is a fixture _we_ wrote, which is exactly the insufficiency V1-13's risk table names, and it would pin a date the test cannot control. The expected bytes are derived from the day the app itself declares (`input[name="day"]`) and the values typed into the form. Proven by mutation: breaking `csvMovement` and `collapse` each fail it, while every pre-existing test — including `export-csv.spec.ts` — stays green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | E2E green in CI                                                                                                                             | Full-flow E2E                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| V1-15                                                                                                    | Day navigation — view previous days (prev/next paging + tappable date; history **read-only** to dodge the V1-6c ±1 write bound). Turns the Today route's day into a URL param and **reuses `listEntriesForDay` + the current view** (factor the Today `<main>` body into a shared day-view). RSC-per-day, **no speculative prefetch** ("don't hammer the API"). Then a "this-week" 7-dot strip; then a month calendar (one bounded `DISTINCT activity_date` query). Forward/programmed days deferred until the ramp schedule is seeded + V1-10. ([brainstorm](./plans/day-navigation-and-dashboard-brainstorm.md)) **NEW EVIDENCE 2026-09-24:** a dated route has a second consumer — the TEST SUITE (the scaffold a11y check self-skipped 4 days in 7; #141 works around it with a timezone shift). GAP-3 also made `listEntriesForDay` two seeks, so re-verify the "no new queries" claim. See the [brainstorm](./plans/day-navigation-and-dashboard-brainstorm.md) → "New evidence". **PLANNED 2026-09-24** — [v1-15-day-navigation.md](./plans/v1-15-day-navigation.md), two panels before implementation. Two findings reshaped it: (1) blanket read-only history was **stricter than the server** — `declared-day.ts` already accepts yesterday (`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | diff                                                                                                                                        | <= 1`) and `editStrengthSetAction`has no day bound at all, so it would have regressed V1-9 on every past day for no safety gain; the writable window now mirrors the server. (2) The **week strip moves into v1** — two chevrons cost 9 taps to reach last Tuesday at 4-7 queries each; the strip is pure date arithmetic (zero new queries) and makes it 2. Also cut: the promised`PROGRAMMED_TZ` deletion, which contradicts read-only history and would turn the scaffold a11y test red. | Page back to Tuesday, see that day's log; reload stable | Day as route param; read-mostly nav |
| V1-16                                                                                                    | Progress dashboard — range view (week/month/3mo/year) with restrained Recharts. A series is just **`foldAggregation` per time-bucket** (pure kernel reuse, coarser `GROUP BY`). v1 tiles: bodyweight trend (line, parent-gated), calisthenics volume + movement picker (bars), stretch max-progression (line — the home V1-8a was waiting for). One range fetch per tab; clamp date span; per-profile `revalidateTag`. Ramp-adherence + strength/est-1RM tiles land as their upstream data does. ([brainstorm](./plans/day-navigation-and-dashboard-brainstorm.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pick "month" → see bodyweight trend + a movement's load over time                                                                           | Aggregation-over-buckets; motivating viz                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| V1-17                                                                                                    | _(Ray, post-V1-8)_ Logged-entries list in **performed order (oldest-first)** ([plan](./plans/v1-17-performed-order.md)) — flipped `listEntriesForDay` to `asc(created_at), asc(id)` so the day reads top-down in the order the kids did things (wake → bodyweight → rice bucket). Pure read change, no migration; oldest-first default (a toggle is a fast-follow). `COALESCE(event_at, …)` was cut by the panel as gold-plating.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Log reads top-down in performed order                                                                                                       | Read ordering by activity time                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| V1-18                                                                                                    | _(Ray, post-V1-8)_ **Per-kid routine builder** ([brief](./plans/v1-18-routine-builder-brief.md) · [eng plan](./plans/v1-18-eng-plan.md)) — REFRAMED from "reorder the 4 sections" into a **per-kid ordered checklist of the activities that kid actually does** (weigh-in pinned first, then their sequence — rice bucket, brush teeth, strength if programmed, finishers…). Per-kid _selection_ AND _order_ — the front half of **V1-10 (programming)**; day-conditional strength defers to V1-10. Hybrid picked via a 4-phase design→eng investigation. **PR 1a** (`db/v1-18-routine-config`, #63) = the migration + shared `routineConfigSchema` + seed, ships dark; **PR 1b** (#64) = render-from-config; **PR 2** (`feat/v1-18-routine-config-ui`, #65) = the coach editor (checklist + ▲▼ + Save), which **folds in PR 3** (unchecking a check-in key IS the per-kid allowlist); copy-from-kid deferred to a later slice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Kid A's Today shows their routine in their order; Kid B's differs; weigh-in first                                                           | Per-kid routine / programming (V1-10 overlap)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| V1-19                                                                                                    | _(Ray)_ **"Start today's program" — one tap builds the log form.** The V1-10 card shows the day's movements; the athlete then hand-types every movement name and adds a set row per set (see the card+form screenshot). This adds a button that POPULATES the strength form from the program: one movement card per prescription, `sets`-count of blank set rows, superset grouping pre-applied where prescribed — **movement names and set STRUCTURE only. Loads and reps stay BLANK.** That boundary is the whole design: the V1-10 panel rejected pre-filling loads because a PRESCRIBED value would log as a PERFORMED one with no human typing it, and ~90% of Ray's authored loads are text (`BW`, `band`, `~75-85`) a numeric field cannot hold. Neither objection touches names or set counts — which is also exactly the cheaper alternative the V1-11 panel proposed when it recommended deferring copy-to-sibling. Reuses the existing `getProgramDay` read; no new query, no migration. Needs a decision on re-tap after a partial log (replace / append / disabled). **PLAN: [v1-19-start-todays-program.md](./plans/v1-19-start-todays-program.md) (2026-09-21) — panels revised this row twice. (1) **Superset pre-grouping is CUT**: `prescriptions` has no superset column, so a prescribed pairing is not expressible; supersets are a PERFORMED concept only. (2) **Structure only — reps prefill is CUT too**, reversing the 2026-09-16 revision below: the V1-10 panel's reason (2) was the CONFIRM-GATE (a blank `required` field IS the human confirmation), which applies to reps identically, and its reason (3) rejected parsing `target_reps` outright. Re-tap replaces with Undo; scaffolded cards render COLLAPSED (7 movements = ~6,600px of blank inputs otherwise). **Superseded 2026-09-16 revision follows:** **Revised 2026-09-16** by [logging-speed-brainstorm.md](./plans/logging-speed-brainstorm.md): reps and loads do NOT share a risk profile — a wrong load is an injury, a wrong rep is a data bug — and `prescription.reps` is free text (`programming.ts:100`), so of Ray's 7-movement Strength B day only **2 of 7** rep prescriptions are clean integers (4 of 7 after GAP-3). Revision: **loads stay blank with a tap-to-fill chip** (S1-legal — the origin is the parent's readable rule, not a model), **clean-integer reps prefill**, and **discovered reps (`AMRAP`, `to failure`, `8-10`) stay blank and get MARKED** as the set that matters. The no-authored-loads boundary is enforced more precisely, not relaxed. | Tap "Start today's program" → the form is pre-built with the day's movements and blank set rows; typing only the numbers logs the session   | Program → form scaffolding (no authored values)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| V1-20                                                                                                    | _(Ray)_ **Coach editor: discoverable + cross-athlete.** `/p/[profileId]/routine` (V1-18 PR 2) is **URL-only today** — nothing links to it. Add a visible entry point per athlete, and — the actual ask — a way to edit **both athletes together**, since the programming order is usually changed for both at once. Two shapes to weigh: a shared editor writing N profiles in one submit, vs. per-kid editors plus "apply to \<sibling\>" (the copy-from-kid affordance V1-18 PR 2 deferred). Note the URL-only entry is currently the ONLY thing limiting who can edit a routine — it is not a security control, but making it discoverable removes that friction, so it should land with or after Clerk, or knowingly accept the gap ([tech-debt](./tech-debt.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | A link reaches the editor for each athlete; one edit can apply the same order to both                                                       | Coach authoring surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| V1-21                                                                                                    | _(Ray)_ **Interaction-design review of the entry UI, then comps to choose from.** NOT an implementation PR — a design deliverable. Phase 1: a detailed human interaction-design critique of the logging flow as it stands (the card→form gap, set-row entry on a phone mid-set, superset grouping, one-handed reach, glanceability between sets, error recovery). Phase 2: rounds of wireframes/comps at **mobile / tablet / desktop** for Ray to review and pick the patterns to build. ~~Explicitly upstream of V1-19~~ — **amended 2026-09-21 (V1-19 plan, D10): V1-19 now lands FIRST.** V1-19 is app-only, no migration, revert-able in one commit; V1-21 is a design deliverable needing rounds of comps and Ray's review, a far larger commitment at ~4h/wk — and no athlete has used the app yet, with the dogfood test blocked on exactly the interaction V1-19 fixes. V1-19's collapsed-card work is also EVIDENCE for V1-21 (does disclosure solve the length problem?) rather than waste. V1-21 still asks whether the form-with-set-rows model is the right shape at all. Output: a committed design doc + comps; implementation PRs follow from Ray's choices.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Ray reviews comps at 3 widths and picks the interaction model to implement                                                                  | Design investigation (decide before building)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| V1-22                                                                                                    | **Program editor — author programming without a deploy** ([plan](./plans/v1-22-program-editor.md)) — _(Ray, 2026-09-23.)_ `PROGRAM_SEED` → `seed.ts` is the **only** writer of `prescriptions`/`prescription_targets`; there is no write path in `apps/web` at all, so **changing one load means editing TypeScript and deploying**. V1-18's editor covers the daily ROUTINE, not the program. Adds `/programs` + `/programs/[block]`: edit a block's movements, sets, target reps, and per-athlete loads, and assign it to one athlete or several. ~~Supersedes V1-20's authoring half~~ — **corrected by the panel: V1-20 is about the ROUTINE editor, which V1-22 does not touch.** V1-22 claims only the program surface and links itself from Today; V1-20 remains cross-athlete _routine_ editing. **Panelled 2026-09-23** (3 lenses incl. DB-safety + the required UX panel) — route corrected to `/p/[profileId]/program` (every BOLA guarantee derives from a profile public id), block _creation_ hard-disabled in A (it would silently hijack every athlete's Today card via `id DESC LIMIT 1`), and A split A1–A4 at ~1,200–1,600 lines. Two scopes: **A** = CRUD on the shipped tables, no migration; **B** = A plus assignment + a third schedule shape + GAP-3 measurement shapes — needed before the [youth daily A/B program](./samples/youth-daily-program/README.md) can be authored at all. Needs BOTH panels (new screen + first config-mutating endpoints). **Scope widened 2026-09-24:** GAP-3's child table makes a movement's **load-slot set** (`vest`/`ankle`/`wrist`) something a coach must declare — slots are **movement-declared, never added per-set by the athlete**, which is what keeps the child table invisible on a 360px log row. That authoring surface lands here ([GAP-3 §7.2c](./plans/gap3-typed-measurements.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A coach changes a kid's programmed load without a deploy                                                                                    | Authoring surface / config CRUD                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
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

## AI-1 — NL logging ([plan](./plans/ai-1-nl-logging.md))

NL logging via Anthropic structured outputs → human-confirm chip → write, with a 15-case golden eval

- CI accuracy assertion; two separate gates (accuracy is scalar, the never-emits-a-load invariant is
  binary — plan **S4**). The confirm-chip flow **never auto-writes a load.**
- **No longer "pull forward."** It needed "the entry schema + a write path (both present after v1)" —
  both are present, neither is settled. **[ADR 0004](./decisions/0004-typed-measurements.md) replaces
  the measurement columns AI-1 extracts into**, so AI-1 sequences **behind GAP-3**: legacy CSV samples
  → GAP-3 plan + panels → GAP-3 → V1-13 → AI-1. Rationale + the two rejected alternatives: plan **S5**.

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

Audited across all 221 commits, not just the working tree.

**Present:**

| #   | What                                                                                                                                                                                    | Where                                                                                                                                    | Severity                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Two kids' **first names** (`Liam`, `Scarlett`) — no surnames                                                                                                                            | 123 refs across 29 files: `packages/db/src/seed.ts`, `packages/shared/src/{seed-ids,programming}.ts`, tests, e2e, and ~14 `docs/plans/*` | Low                                  |
| 2   | The kids' **prescribed S&C program** — sets/reps/loads, transcribed verbatim (`BW`, `BW +5-10`, `65`, `60`, `30`, `25`, `20/DB`, `15/DB`; reps like `4, last AMRAP` vs `5, last AMRAP`) | `packages/shared/src/programming.ts`, `docs/plans/v1-10-*`                                                                               | Low                                  |
| 3   | One **bodyweight fixture value** — `72.5` lb                                                                                                                                            | `apps/web/lib/entries/entry-label.test.ts` (×2, a label assertion)                                                                       | Negligible                           |
| 4   | Ray's own full name                                                                                                                                                                     | `docs/plans/v1-10-two-week-program-source.md` frontmatter (`author:`)                                                                    | None — desirable on a portfolio repo |
| 5   | Ray's own PPL movement templates                                                                                                                                                        | `packages/shared` catalog seed                                                                                                           | None                                 |

**Confirmed absent** (each checked, not assumed):

- ❌ **No birthdates.** `profiles.birthdate` exists as a column but is explicitly _reserved_ — never seeded, never written, no UI.
- ❌ **No real logged training history.** Actual entries live in the Neon database, not the repo. The repo ships schema + catalog seed + fixtures only.
- ❌ **No screenshots.** `.screenshots/` is gitignored — `git ls-files` returns **0** tracked files.
- ❌ **No data dumps.** Zero committed `.csv` / `.sql` / dump files; no deleted-then-recoverable data files anywhere in history.
- ❌ **No contact data.** No emails, phone numbers, addresses, or photos.
- ❌ **No secrets.** The only file ever committed under `.local-secrets/` is its `README.md`, which deliberately documents _which_ files are gitignored without containing any of them. `.env*` was never committed. `gitleaks` runs on every PR (`.github/workflows/ci.yml`).

### Assessment

**The exposure is two first names plus a youth strength program.** There is no measurement history, no
date of birth, no health record, and no log data. Earlier planning notes described this as "minors'
health data" — that was **inferred from the schema's capability rather than from what is actually
committed**, and the audit does not support it.

The one real (and modest) consideration: the repo will be linked from a resume and LinkedIn under
Ray's real name, so publishing creates a permanent, searchable association of the form _"Ray Baker's
kids are named Liam and Scarlett, and this is their training program."_ That is a mild disclosure, but
unlike mentioning it at a meet it does not decay. Whether that matters is a judgment call, not a
security finding.

### Tasks

| #   | Task                                                                                                                                                                                                                                                                                                                                         | Required?                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | **Decide the names question** (see below). If renaming: swap `Liam`/`Scarlett` for neutral fixture names across seeds, tests, and plans. `db:verify` proofs, golden vectors, and e2e must stay green — same schema, same row counts, same edge cases (the A≠B routine contrast in `SEED_SCARLETT_ROUTINE` is load-bearing and must survive). | Judgment call             |
| 2   | Change the `72.5` bodyweight fixture to an obviously-synthetic value.                                                                                                                                                                                                                                                                        | Nice-to-have              |
| 3   | **Public-facing `README` rewrite** — the current one is written for Ray. Lead with the architecture, the migration discipline, and the AI-1 eval harness: the parts that carry portfolio signal.                                                                                                                                             | **Yes**                   |
| 4   | **Add a `LICENSE`.**                                                                                                                                                                                                                                                                                                                         | **Yes**                   |
| 5   | Confirm no Neon / Vercel / Clerk project identifiers, deploy URLs, or org slugs leak via docs or CI config.                                                                                                                                                                                                                                  | **Yes**                   |
| 6   | Ensure the AI-1 15-case golden eval fixture uses synthetic data from the start.                                                                                                                                                                                                                                                              | **Yes** (when AI-1 lands) |

### The names question — it's binary

A working-tree-only rename is **security theater**: `git log -S Liam` still finds it across 221
commits. So there are exactly two coherent options:

- **(a) Leave the names.** Justified by the audit — the exposure is genuinely small.
- **(b) Rename _and_ rewrite history** with `git-filter-repo`, then verify against a fresh clone.

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

| #         | What                                                                                                                                        | Severity                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 3 _(rev)_ | **A named minor's bodyweight time series** — 14 dated weigh-ins, plus **both athletes' ages (10 and 12)**, stated in `bodyweight/README.md` | **Medium** _(was Negligible)_ |
| 2 _(rev)_ | The prescribed program, **plus 44 rows of what was actually performed** — loads, failures, `SKIPPED`, coaching notes naming each kid        | **Low–Medium** _(was Low)_    |

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

## DX — agent & developer tooling ([skills index](../.claude/skills/README.md))

Tooling that makes each PR cheaper and safer to produce. It sits outside the product priority order
above; the skills index holds the smaller items.

- **DX-1 — `@claude review`: the `review-pr` skill, on request, in CI.** A writer comments `@claude
review` on a PR and gets one verified P0/P1/P2 review comment. Subscription auth; never automatic;
  advisory, never a required check. [Plan](./plans/dx-1-claude-review.md) (engineering panel rounds
  1–2: 4 + 1 blocking → redesigned as a read-only model job + a model-free post job; PR review on
  #176 resolved). **Note:** `main` now carries `.claude/settings.json` (#179: two hooks, both no-op under CI,
  no permissions/MCP/env keys). The DX-1 implementation PR must replace prefetch step 8's blanket
  fail-closed with a narrower check: reject `permissions`, `mcpServers`, `enableAllProjectMcpServers`,
  `env`, and any hook command not in an explicit allowlist, and require allowlisted hooks to be
  CI-no-op. Its panel re-reviews that.

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

- **SCHED-1 — scheduling as data: multiple programs per athlete.** _(Ray, 2026-09-18.)_ Today an athlete
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
  program, at different loads"_ — fine for the shared calisthenics case, but it cannot express _"Liam
  does S&C, Scarlett doesn't,"_ which is exactly what adding a seasonal program to one athlete requires.

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

- **V1-30 — the log form offers units the server rejects.** 🔴 **P0, reported 2026-09-30** by the
  `review-pr` run on #171: the strength form offers 9 units and the server's schema rejects 7 of them
  (`sec`, `min`, `in`, `cm`, `ft`, `m`, `yd`), since #141. Picking one fails the whole submit. Not yet
  reproduced outside that review; the fix PR starts by writing the failing test. Filed from #176's
  review so it isn't carried only by a changelog line.

- **V1-27 — doing SOME of a movement's sets blocks the submit.** 🔴 **P0, found 2026-09-30** by
  `e2e/scaffold-submit.spec.ts` while building V1-26 PR-A. `DEFAULT_SCAFFOLD_SETS` is 3 and `reps` is
  unconditionally `required`, while `isUntouchedScaffold` drops a whole **movement** and has no
  per-**set** equivalent. So a kid who does **2 of 3 prescribed sets** cannot submit at all — the
  browser refuses with "Please fill out this field" on a row they deliberately left blank — until they
  discover the per-row "Remove" button. That is the most likely way to do a prescribed movement on a
  gym floor, and the failure is the same "form appears dead" shape the guide already documents twice.

  **Why no test caught it:** the unit tests submit through `payload()`, which never runs native
  constraint validation, and no e2e had ever submitted a scaffolded form. The V1-26 spec now does, and
  it fills every row precisely so it does not depend on this bug either way.

  **Likely fix, to be planned:** an untouched scaffolded SET is dropped at submit the way an untouched
  scaffolded movement already is — which means `required` can no longer carry the "don't submit
  nothing" job alone, and `strengthSetSchema`'s superRefine has to. Related to V1-25 §1 (the athlete
  should be able to choose the set count up front) but strictly worse, because that one is friction
  and this one is a wall.

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
  **PR 1a ✅ merged** (the bodyweight receipt, read-only — removes the second-submit path through
  the UI; concurrent mounts can still duplicate until 1d). **Next: 1b** (amend), then 1c (the duplicate correction), 1d (the scoped unique index),
  2 (check-ins), 3a/3b (strength).
  - **Follow-up (from #180's round-2 review, not yet done):** the receipt's three states the e2e
    CANNOT reach today — a **closed day with a weight**, a **closed empty day** (`No weight
logged.`) and **duplicates** — have unit coverage (`bodyweight-section.test.tsx`) and screenshots,
    but **no axe or 360px-overflow e2e**. The e2e seeds its profiles today, so `resolveViewedDay`
    floors every `?d=` into the writable window; covering them needs a backdated-profile fixture (the
    screenshot script's `seedClosedDays` is the precedent). Fold into 1b, which adds a control to
    every one of these states and must audit them anyway.

  📋 [**plan**](./plans/v1-24-form-is-the-day.md) (with V1-25 §3 — the two rows are planned together,
  as this row says they must be). _(Ray, 2026-09-28, from logging a real session.)_ He logged Liam's KB swings as **`20 × BW`** when it was **10 reps × 20 lb**
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

  **The concrete job** (Ray, 2026-09-24): take the old **named** directories — `liam/`, `scarlett/` —
  and import their rows against the matching **`public_id`**. That is the one place a human name ever
  meets the data model, and it happens once, under review, rather than on every export. Two things fall out. First, **the old named directories become the
  importer's test fixture** — real authored rows, every shape the census found, already scrubbed and
  committed at [docs/samples/legacy-csv](./samples/legacy-csv/README.md). Second, it is what makes the
  `public_id` export directory legible in hindsight: the importer maps `liam/` onto the right profile,
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
  4. **ONB-0's empty state** currently lives at `/`, which becomes the sign-in page. First-run moves
     to `/<household-id>` and the two rows have to agree about what a brand-new household sees.
  5. **NOT the CSV export directory.** That is `public_id` on a _data_ path, not a URL, and is
     unaffected — stated because it looks adjacent.

  **Sequencing: HH-1 → PROF-1 → MOT-1's picker badge.** The path shape is the thing everything else
  authors into. HH-1 can land the routing _before_ Clerk — the household id in the path is useful with
  the access gate alone, and it decouples the URL decision from v1.5's auth work.

- **AUTH-1 — OAuth login (Google / Facebook).** _(Ray, 2026-09-30, P0 — new.)_ Replaces the shared
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

  ⚠️ **Revisit [HH-1](#hh-1) first.** HH-1 put the household in the PATH, decided before OAuth was a
  priority. Session-scoping is what OAuth makes possible and it is cheaper — but it loses the
  shareable link between two parents, and makes "logged in as the wrong account, seeing the wrong
  kids" fail **silently** instead of loudly. The combination HH-1 actually described — path as the
  address, session as the authorization — is probably right, but it must be settled before either is
  built or they will disagree about what a URL means.

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

  ⚠️ **Sequenced AFTER [HH-1](#hh-1)**, and that is not a preference. Ray's own framing is
  `mat-plan.dev/<household-id>/edit-athletes` — a path that does not exist yet. Building the editor
  first means building it at `/edit-athletes` and moving every route, link and `revalidatePath` when
  the household segment lands. Decide the URL shape, then author into it.

  **Pulled forward** from "after the MVP" (2026-09-28): Ray is using the app and cannot add himself,
  which makes this the first real onboarding gap rather than a nicety.

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

- **ONB-0 — first run is broken TODAY (P0, independent of everything below)** — a brand-new household has
  `routine_config = null`, which `resolveRoutine` maps to `buildDefaultRoutine` over the seeded catalog,
  so **a stranger's first screen is Ray's family's routine** in Ray's family's shorthand — Rice bucket ·
  Brain rep · Splits · **Brush teeth** (a wrestling drill block with stance/ladder/bridge sub-metrics,
  which a new coach reads as dental hygiene). And before that, `apps/web/app/page.tsx:25` says, to a
  human: **"No profiles found. Seed the database to get started."** Spec is
  [ONB-1's R2](./plans/onb-1-self-serve-onboarding-prd.md): an **explained empty state** (what this app
  is, what happens next) plus a control that routes to — or inlines — the movement/workout editor, and a
  **neutral** default routine. **Not** a questionnaire. Cheapest item in the onboarding story, blocks any
  stranger using the app, and depends on nothing else. UI change ⇒ **needs a UX panel before
  implementation** (AGENTS.md).
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

- DB-in-CI → Docker Postgres (CI tests) + Neon branch-per-PR (previews).
- PIN → deferred; `pin_hash` column only.
- Habits CSV → app-only until the v3 API.
- Auth provider → Clerk (COPPA stays deferred; kids have no accounts).
