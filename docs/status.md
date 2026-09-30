# mat-plan — Status

Living progress tracker toward the **MVP = end of v1** (kids log a full day online + CSV export keeps
the Claude workflow alive). Updated as each PR merges. Roadmap detail in [plan.md](./plan.md).

**Last updated:** 2026-09-30

## Where we are right now

🆕 **DUALS-1 — the first parent-facing surface** (2026-09-25). `/duals/[event]/[team]` renders a
tournament day sheet — pool, round order, mat, and the weight-by-weight matchup per round — for the
2026 Tyrant Columbus Day Duals, in time for the Assassins squads wrestling that weekend. Static
JSON, no DB and no migration. The day-sheet routes are **public** — no access code — because they
render only static tournament data, never household data ([plan](./plans/duals-1-public-day-sheet.md)
D1/D3/D4); the logger itself stays gated. **Corrected 2026-09-25:** the first capture mis-paired an
8-slot bracket and turned two of Wrestling Chix's duals into byes — the schema now asserts the
round-robin invariant (`duals == poolTeamCount - 1`) so a lost dual fails the build instead of
rendering as a plausible bye. Notable because it is the **first
thing in this repo aimed at someone other than the three of us**, and the first test of whether the
day sheet is the artifact parents actually forward.

🏁 **The MVP finish line was crossed on 2026-09-24.** **CSV export ships** — **#149** (the pure
strength-log formatter, proven against golden vectors transcribed from the contract's own real bytes)
and **#150** (delivery: reads, a hand-rolled STORED zip, and a download an e2e actually performs). The
export route is **`/p/[profileId]/export`, deliberately NOT under `/api`** — the access-gate matcher
excludes `/api`, so a handler there would have left every athlete's whole training history
downloadable by anyone with the URL. That exclusion is now recorded in
[tech-debt](./tech-debt.md) as a live hazard for the `/api/sync` design.

📍 **v1 — every backlog row is merged except V1-14b.** Logging surfaces: per-kid routines, weigh-ins,
check-ins, calisthenics + weekly adherence, life activities, strength sessions with supersets,
edit-a-set, skipped/sub-failure, the Today's-program card, and **one-tap scaffolding of the day's
program into the form** (V1-19, #125 — structure only; every reps and weight field arrives blank, and
a unit test fails CI if that changes). **GAP-3 is complete**: migration `0011` landed the typed
measurement model and dropped `weight_num`/`weight_label`/`seconds` (#139), then **#141 deleted
`parseLoad` outright** — ~90 lines of pattern matching and ~300 lines of test whose only job was
reverse-engineering structure the form had thrown away. The six-week chain that gated GAP-3, V1-13,
AI-1 and the open-source release (#121 samples → #126 census → #128 design) is **fully discharged**.

⚠️ **The one thing still unverified: has an athlete used it?** v1's own exit criterion —
_"hand the URL to the kids; observe a real day logged"_ — is the last open question, and it is the one
thing this tracker cannot observe for itself. **#151 seeded the youth daily A/B program specifically so
they could log that evening**, which removes the last excuse (today resolves to a real Day A/Day B and
"Fill in today's movements" scaffolds the real sheet). Whether it happened is Ray's to record here.

✅ **Corrected 2026-09-26 — the claim that stood here was false.** This paragraph asserted for ten days
that _"the last feature merge was #107 on 2026-08-12; everything since has been docs and dependabot."_
By the time it was written that was already wrong, and it stayed wrong through **#125, #133–#141,
#149–#155** — V1-19, five CI gates, the whole GAP-3 arc, CSV export, the YDP seed and DUALS-1. Root
cause: the tables and changelog below were updated per-PR while this section was hand-written from
memory. See
[product-spec.md §11](./product-spec.md) for what "working" would actually have to mean.

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

**Newly added by Ray (post-MVP unless he re-prioritises):** **V1-19** "Start today's program" — one tap
builds the strength form from the V1-10 card (movement names + blank set rows only; loads/reps stay blank,
preserving the V1-10 panel's no-authored-values rule); **V1-20** coach editor made discoverable + editable
for both athletes at once; **V1-21** an interaction-design review of the entry UI followed by mobile/tablet/
desktop comps to choose from — deliberately upstream of V1-19, since it asks whether the
form-with-set-rows model is the right shape at all.

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

**Roadmap change (AI-1 plan, S5)** — the **AI-1 plan is decision-complete** (S1–S5;
[plan](./plans/ai-1-nl-logging.md)) and it moved. AI-1 was "pull forward", on the grounds that it only
needed the entry schema and a write path, "both present after v1". Both are present; **neither is
settled**, because [ADR 0004](./decisions/0004-typed-measurements.md) replaces the measurement columns
AI-1 extracts into. AI-1 now sequences **behind GAP-3**: legacy CSV samples → GAP-3 → V1-13 → AI-1 →
OSS-1 — so the legacy CSV samples gated **going public**, not just V1-13. **That gate is now open:**
the samples merged in #121 and the shape census in #126.

**Merged — V1-19: "Fill in today's movements".** One tap builds the strength form from the day's
program — a card per prescription, in the coach's order, with the right number of set rows — so the
athlete stops retyping names off the card directly above the form. **Structure only: every reps and
weight field arrives blank**, which is the V1-10 panel's confirm-gate boundary (a blank `required`
field IS the human confirmation) and is now pinned by a structural unit test. Scaffolded cards render
**collapsed** with a `done/total` counter, because 7 movements × 4 sets is ~6,600px of blank inputs at
360px otherwise. Plan + both review-response logs:
[v1-19-start-todays-program.md](./plans/v1-19-start-todays-program.md).

## Progress toward MVP (v1)

- **Feature PRs merged:** the data foundation (V1-1a/b/c · V1-2 · V1-3 · V1-4 · V1-5 · V1-6a/6b-1/6c/6b-2 ·
  V1-7), the full strength/superset arc (V1-8-1 · V1-8-2 · V1-8-3a/3b/3c/3d), editing (V1-9), programming
  (V1-10 · V1-17 · V1-18 · V1-19 · YDP seed), a11y-in-CI (V1-12), hardening (V1-14a), the **GAP-1** write-path
  fidelity arc, **GAP-3** typed measurements, and **V1-13 CSV export — the MVP's defining feature**.
- **The v1 backlog is closed.** **V1-14b** (full-day E2E + CSV diff) was the last row, and it is
  merged — the day the app itself logs now round-trips through the real export and back out again. **V1-11 is deferred past the
  MVP** by its panel ([why](./plans/v1-11-copy-movement-to-sibling.md)); **V1-13a-fu** (the
  `calisthenics-log` CSV) was cut from V1-13 by Ray as a deliberate fast-follow, and **V1-15** and
  **V1-22** are planned-and-panelled but unbuilt.
- **The exit criterion is not a PR.** _"Kids log a real full day online; CSV keeps the Claude `/retro`
  workflow alive."_ The CSV half is done and downloadable. The first half needs an athlete, not a commit.

## Phases

| Phase     | Goal                                                                     | Status                                                                                      |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Bootstrap | Repo + planning docs                                                     | ✅ done                                                                                     |
| **v0**    | Thin vertical slice (one feature UI→ServerAction→Drizzle→Neon, CI-gated) | ✅ done                                                                                     |
| **v1**    | Online kids logger (all data types, CSV export) — **MVP**                | 🟡 all rows merged but **V1-14b**; exit needs a real logged day                             |
| DUALS     | Parent-facing tournament day sheets                                      | 🔵 DUALS-1 live (#152–#155); DUALS-2 next                                                   |
| AI-1      | NL logging via structured outputs + eval                                 | 📋 plan decision-complete; **UNBLOCKED** — GAP-3 shipped ([S5](./plans/ai-1-nl-logging.md)) |
| v1.5      | Offline PWA + sync + Clerk auth                                          | ⚪ not started                                                                              |
| v2        | Ray's PPL + progression engine                                           | ⚪ not started                                                                              |
| v3        | AI depth + MCP/REST API                                                  | ⚪ not started                                                                              |

Legend: ⚪ not started · 📋 planned (not started) · 🔵 in review · 🟡 in progress · ✅ done

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

## v1 backlog — completes the MVP

Every row below is merged except **V1-14b**. Rows added after the original 14 are listed in id order,
not merge order.

| PR        | Scope                                                                                                                           | Status |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| V1-1      | generalize schema + forward-migrate (a/b/c/d; a/b/c merged, d deferred)                                                         | ✅     |
| V1-2      | seed catalogs + coverage test ([plan](./plans/v1-2-seed-catalogs.md))                                                           | ✅     |
| V1-3      | profile tiles ([plan](./plans/v1-3-profile-tiles.md))                                                                           | ✅     |
| V1-4      | bodyweight/measurement on generalized model ([plan](./plans/v1-4-weigh-ins.md))                                                 | ✅     |
| V1-5      | checkins/habits dynamic form ([plan](./plans/v1-5-checkins-form.md))                                                            | ✅     |
| V1-6a     | calisthenics inputs + daily totals ([plan](./plans/v1-6a-calisthenics-totals.md))                                               | ✅     |
| V1-6b-1   | ramp_targets table + migration + seed + `db:verify` proof ([plan](./plans/v1-6b-calisthenics-ramp.md))                          | ✅     |
| V1-6c     | timezone / local-calendar-date correctness ([plan](./plans/v1-6c-timezone-local-date.md))                                       | ✅     |
| V1-6b-2   | read DAL + `<progress>` adherence UI ([plan](./plans/v1-6b-2-adherence-ui.md))                                                  | ✅     |
| V1-7      | life activities (wake/practice) ([plan](./plans/v1-7-life-activities.md))                                                       | ✅     |
| V1-8-1    | supersets table + `db:verify` proof ([plan](./plans/v1-8-strength-sessions.md))                                                 | ✅     |
| V1-8-2    | flat strength session write path ([plan](./plans/v1-8-2-session-write-path.md))                                                 | ✅     |
| V1-8-3a   | session read grouping ([plan](./plans/v1-8-3-session-grouping-and-supersets.md))                                                | ✅     |
| V1-8-3b   | session feel ([plan](./plans/v1-8-3-remainder-feel-and-supersets.md))                                                           | ✅     |
| V1-8-3c   | superset write core ([plan](./plans/v1-8-3c-superset-write.md))                                                                 | ✅     |
| V1-8-3d   | superset UI + read bracketing ([plan](./plans/v1-8-3d-superset-ui.md))                                                          | ✅     |
| V1-9      | fix-a-set / edit (LWW) ([plan](./plans/v1-9-edit-set.md))                                                                       | ✅     |
| V1-10     | programming — data model (#66) · real block seeded (#67) · Today's program card ([plan](./plans/v1-10-2-strength-prefill.md))   | ✅     |
| V1-11     | copy-set-to-other-kid — **deferred past the MVP** by its panel                                                                  | ⏸️     |
| V1-12     | a11y + tap-target pass, ENFORCED in CI ([plan](./plans/v1-12-a11y-pass.md))                                                     | ✅     |
| V1-13a    | the strength-log CSV **formatter** — pure, DB-free, golden vectors (#149)                                                       | ✅     |
| V1-13b    | CSV export **delivery** — reads, zip, working download at `/p/[id]/export` (#150)                                               | ✅     |
| V1-13a-fu | `calisthenics-log` CSV — **the one schema the app DEFINES**; cut from V1-13 as a fast-follow, 2 open decisions                  | ⚪     |
| V1-14a    | hardening — gate rate limit + Sentry w/ PII scrubber + Dependabot cooldown (#71) ([plan](./plans/v1-14a-hardening.md))          | ✅     |
| V1-14b    | **full-day E2E + CSV diff** — _the only unmerged v1 row_; unblocked by V1-13 on 2026-09-24                                      | ⚪     |
| V1-15     | day navigation — [plan](./plans/v1-15-day-navigation.md) merged (#142/#143), **unbuilt**                                        | 📋     |
| V1-17     | logged entries in performed order ([plan](./plans/v1-17-performed-order.md))                                                    | ✅     |
| V1-18     | per-kid routine builder ([eng plan](./plans/v1-18-eng-plan.md))                                                                 | ✅     |
| V1-19     | "start today's program" scaffolds the form — **structure only** (#125) ([plan](./plans/v1-19-start-todays-program.md))          | ✅     |
| V1-22     | program editor — [plan](./plans/v1-22-program-editor.md) merged (#127/#129), **unbuilt**                                        | 📋     |
| GAP-1     | close the CSV recording gaps (P0-1/P0-2 · P1-1a/b/c)                                                                            | ✅     |
| GAP-3     | **typed measurements** — CI gates (#133/#135/#138) · `units.dimension` (#137) · migration `0011` (#139) · the typed form (#141) | ✅     |
| YDP       | youth daily A/B program seeded, replacing Kids S&C Foundation (#151)                                                            | ✅     |

> **New entries go in [docs/changelog/](./changelog/README.md)**, one file per change (DX-2). The
> history below is kept as it was, and nothing is added to it.

## Changelog (merged PRs)

- **2026-09-30** — **DX-1 implemented: `@claude review`** ([plan](./plans/dx-1-claude-review.md)).
  A writer's `@claude review` comment runs the `review-pr` skill in CI and posts one verified review,
  or a one-line failure notice, never silence. It is **on request only and advisory**. The model job
  holds only a read-only GitHub token and can edit one file; a separate model-free job scans the
  output and posts it. The PR head is fetched as SHA-pinned data with PR agent config neutralised.
  `review-prefetch.sh` is now the one way both local and CI reviews gather their inputs (26-case
  self-test), and `review-post.sh` has 30. The plan's blanket settings guard would have refused every
  review once #179 added hooks, so it hash-pins `.claude/settings.json` instead (logged as D1).
  **Goes live when `CLAUDE_CODE_OAUTH_TOKEN` is set** (runbook). The post-merge injection smoke is the
  acceptance gate.
- **2026-09-30** — **DX: `shipit` means "keep it mergeable"** (#181, [skill](../.claude/skills/keep-mergeable/SKILL.md)).
  Each merge in the 09-30 batch put the other approved PRs in conflict at the top of this changelog,
  and each was fixed by hand. Now whoever posts `shipit` keeps the PR mergeable until it lands: after
  any merge, merge `main` into each approved PR from a detached worktree, push fast-forward only,
  auto-resolve only changelog/append-style conflicts, and ask on anything else. `review-pr` gains a
  "Shipit" step (the bar for posting it) and `ship-pr` step 8 ends with the sweep. Found while
  reviewing it: **branch protection is off**, so GitHub never reports a PR as behind `main`, and
  AGENTS.md's "require branches up to date is ON" was false (corrected), as were
  "`main` is protected — no direct pushes" and "CI required checks (block merge)": the ruleset blocks
  only deletion and force-push, and no check is required (both corrected; the shipit bar is what
  enforces "CI green"). The sweep checks behind-ness
  with git. The root cause, one shared changelog line, is [DX-2](./plans/dx-2-changelog-fragments.md).
- **2026-09-30** — **V1-24 PR 1a: the weigh-in shows what you logged**
  ([plan](./plans/v1-24-form-is-the-day.md)). Reported from a screenshot of an already-completed day:
  three empty forms above a read-only list of everything that had been done.
  - **"Complete" is a property of the RECORD, not the field**, so the semantic is _saved_, not _done_
    — a **receipt**, not a checkmark. `Bodyweight` is the heading in every state; the receipt reads
    `Saved: 84.5 lb` · `One weigh-in per day.` · `Wrong number? Ask a parent — it can’t be changed in
the app yet.` (the plan's copy verbatim, in `lib/constants.ts`). The last line names the real
    recovery path (`db:correct`) instead of promising "coming next", which 1a cannot keep. 1b's
    amend has no day bound (plan Decision 5) and deletes the line.
  - **It removes the second-submit path; it does not make a duplicate impossible.** `logBodyweight`
    dedupes only on `client_id`, and the form minted a fresh key on every success, so "did I already
    weigh in?" → tap again → a second row. The form now renders only when the day has none, its key
    is stable, and it remounts per day (`key` on the day — a stale tab across midnight replayed the
    old day's key as a silent no-op). **Concurrent mounts can still duplicate until 1d's index**, so
    the receipt lists **every** live row (`2 weights logged: 84.5 lb, 845 lb`) rather than the newest,
    with one line under it instead of the one-per-day and recovery lines: for one value submitted
    twice, `Logged twice — the extra can’t be removed in the app yet; ask a parent.`; for different
    values, `The weights differ — ask a parent which is right; it can’t be fixed in the app yet.`
  - **A plausibility bound** in `logBodyweightSchema` (20–500 lb, 10–230 kg; `That doesn’t look like a
bodyweight — check the decimal point.`). It is what makes a no-amend receipt acceptable: `845` and
    `8.45` used to save permanently. **The form's fields are now controlled**, because React 19
    resets uncontrolled fields when a form action settles, **rejected ones included** (probed): the
    input emptied under the "check the decimal point" message and the unit snapped back to `lb`, so a
    kg user retyping `84.5` saved 84.5 lb. A controlled `<select>` alone still snapped back (React
    syncs an input's `value` attribute for the native reset, never a select's `defaultSelected`),
    so the form re-asserts the unit in a layout effect. `a11y.spec.ts` pins that value and unit
    survive.
  - **A save is announced and focus lands on the receipt** (`saved-announcer.tsx`): the form, its
    live region and the focused button all unmount on success, so a pre-mounted `role="status"`
    announces `Bodyweight saved: 84.5 lb.` on the none→value transition only (never on first load).
    ⚠️ Known, left as is: focus on the receipt makes some screen readers read its text while the
    polite region announces too, so the value may be heard twice. `aria-describedby` would add
    speech, not remove it; the real fix is choosing one channel, which wants a screen-reader pass,
    not a guess — revisit with 1b's focus handling.
  - **The receipt renders on the SERVER, outside the `writable` gate**, so history days show their
    weight too, and a closed empty day says `No weight logged.` instead of a bare heading.
  - **The smoke is disjoint by construction**, not tolerant: no two specs log bodyweight for the same
    `(profile, day)` (warm-up → Scarlett today, smoke → Liam today, export → Liam yesterday, a11y →
    Scarlett yesterday), and `steps.ts:logBodyweight` asserts the value **it** logged.
    `isoDaysAgo` now uses the app's zone — it was UTC, so from 5 PM PT every `?d=yesterday` spec
    (including two on `main`) silently resolved to today.
  - One display renderer for `84.5 lb` (`formatValueUnit`), and the other saved-state strings
    (`· logged today`, `Already logged today`) moved to `lib/constants.ts` so specs share them.
    ⚠️ `formatValueUnit` is deliberately **not** the CSV formatter, whose semantics differ on purpose.
- **2026-09-30** — **DX: rules that failed as prose become checks.** The worktree rule (#174) was
  broken twice within hours: another session switched the main checkout to a feature branch, which
  made a `git pull` try to merge `main` into someone's branch and made project skills vanish
  ("Unknown skill") for sessions launched there. Now a best-effort Claude Code `PreToolUse` hook keeps
  the main checkout to an **allowlist** (read-only git, worktree commands, post-merge `branch -D`,
  `--ff-only` sync on `main`, `checkout main` when clean), reading through subshells, `$(…)`,
  `sh -c`, heredocs into a shell, wrappers and `cd`/`-C`. A `SessionStart` briefing prints the status
  headline, open PRs (fork-PR titles withheld as untrusted input), and stale or off-main worktrees.
  226 guard + 12 briefing self-test cases cover the allowed workflow and the known bypass forms. Both
  hooks no-op under CI, a SECURITY.md invariant the DX-1 job depends on. `pnpm skills:check` fails
  when a skill cites a path or `pnpm` script that doesn't exist. It and the self-tests run in
  `verify`, not yet in CI.
- **2026-09-30** — **Security: Next.js 16.3.5 → 16.3.7** (#182; critical
  [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), RCE in `next/og`, patched
  in ≥16.3.6). Found by the `audit --prod` step of `pnpm verify`, which failed on `main` for every
  branch. CI stayed green and would not have caught it: no workflow runs the audit. AGENTS.md and
  tech-debt.md had both claimed it was a CI gate, and are corrected here.
  16.3.7 rather than the newest 16.3.8: 16.3.8 was an hour old and inside pnpm 11's default
  release-age window, and `pnpm install` would have written exclusions to `pnpm-workspace.yaml` to
  bypass that supply-chain delay. `eslint-config-next` moves in lockstep.
- **2026-09-30** — **Fix: Vercel stops deploying the `screenshots` branch.** Every screenshot upload
  and prune had been posting a failed preview ("Root Directory 'apps/web' does not exist") and a
  failure email since August: #100's skip-CI commit marker never worked, because Vercel doesn't honour
  it. The branch now carries `apps/web/vercel.json` with `git.deploymentEnabled: false`, which
  `publish-screenshots.ts` seeds on a new branch and adds to an existing one. The lessons entry that
  called this fixed is corrected.
- **2026-09-30** — **DX: panel agents** (#178, [.claude/agents/](../.claude/agents/)). The review
  lenses used in every plan panel and `review-pr` run were re-typed as inline prompts each time. They
  are now named agents, **one lens each**, so a panel keeps the ≥3 independent lenses AGENTS.md
  requires: the four standing lenses (correctness, scope, architecture, reuse), a dedicated DB-safety
  reviewer, security, and UX (run once per sub-lens on a new screen), plus a `fact-sheet` researcher.
  One shared reporting contract lives in `review-pr/`, so it isn't copied into each agent. Bash stays
  read-only **by instruction only**: a subagent's `tools` can't narrow Bash, and it inherits the
  session's permission mode. Also restores `review-pr` step 1 (check the diff matches its
  description), which the #173 squash dropped.
- **2026-09-30** — **DX: `pnpm status:check`** (#177). "Status rides with the work" was prose, and #156 is
  what happened to it. A `feat`/`fix`/`db`/`perf`/`refactor`/`revert` branch, read from the branch name or any
  commit subject, now fails the check unless it touches this file. `STATUS_SKIP="<why>"` overrides
  and prints the reason for the PR description. It's local (in `ship-pr`) for now; making it a CI
  gate needs its own plan.
- **2026-09-30** — **DX-1 planned: `@claude review`, reshaped by the panel**
  ([plan](./plans/dx-1-claude-review.md)). On request only, subscription auth. The panel found **four
  blocking flaws in the first draft**. The sharpest, confirmed in the action's source: agent mode
  writes the job's GitHub token into `.git/config` and the model's environment, so an injected fork
  PR could have got a live write token posted in a public comment. A bare `Write` could also have
  hijacked the posting step through `BASH_ENV`. Redesigned as a **read-only model job** plus a
  **model-free post job**, with path-scoped tools, symlinks off, the head SHA pinned, and a
  fail-closed neutralisation of PR-authored agent config. `review-pr` also gained three rules from
  its first real run (on #171): probe instead of re-reading when reviewers disagree, severity by
  today's risk, and "found outside the diff". That run surfaced a **live P0** (7 of 9 offered units
  are rejected by the server), filed as **V1-30** in `docs/plan.md`.
- **2026-09-30** — **Process: every task runs in its own worktree.** AGENTS.md required a worktree
  only for _parallel_ work, so single-task sessions (#170, #173 among them) ran on feature branches in
  the shared main checkout. Other sessions were meanwhile using ad-hoc `/tmp` worktrees, which are
  wiped on reboot and invisible to everyone else. Now every task gets
  `.claude/worktrees/<slug>` (already gitignored) off `origin/main`, the main checkout stays on
  `main`, and worktrees are removed after merge, never someone else's. `start-task` and `ship-pr`
  carry the commands. `pnpm install` in a fresh worktree took 8s.
- **2026-09-30** — **DX: agent skills, batch 2** ([index](../.claude/skills/README.md)). `review-pr`
  is the rubric for an on-demand review (verified P0/P1/P2 findings, each cited to `path:line` and the
  rule it breaks) that runs **only when asked**: locally now, and via an `@claude review` PR comment
  once that workflow ships through its own plan. `db-migration`, `add-server-action`,
  `data-correction` and `debug-ci-failure` each package a high-blast-radius procedure. Writing them
  from fact sheets of the real code, rather than from AGENTS.md alone, surfaced ten places where the
  docs claim more than is wired (root `DESIGN.md`, coverage, CWV measurement, `packages/` typecheck,
  the CONCURRENTLY runner, among others). These are recorded as seeds for the baseline audit, not
  yet triaged.
- **2026-09-30** — **V1-28: paging to another day left the last day's form behind.** Reported from
  real use, on a screenshot of an already-completed day. V1-15 made day navigation a client-side RSC
  transition, and `StrengthFormBody` was keyed on `gen` — a **submit** counter — so the subtree never
  remounted on a day change and every uncontrolled field kept its first-mount DOM value.
  - **It wrote bad data, not just a wrong-looking screen.** Paging from a Strength B day back to a
    Strength A day left the day-role select reading "Strength B" under a header reading "Strength A".
    That select's own docblock says the stored value's whole worth is PROVENANCE — _"a non-null
    day_role must mean a human asserted it"_ — and it is the column V1-13's CSV reads as
    `session_type`. Submitting asserted a day role the athlete never chose.
  - Keyed on the day as well. The check-in form was already immune, and says why in a comment:
    _"Checked state is CONTROLLED. `defaultChecked` is not reconciled after mount."_ The same
    sentence is the whole bug, one file over.
  - **The class, not the instance:** V1-15 changed how the page is entered, and nothing re-examined
    what holds state across that entry. `e2e/day-nav-form-state.spec.ts` now asserts it.
- **2026-09-30** — **V1-26 PR-A: the form knows what the movement is**
  ([plan](./plans/v1-26-form-knows-the-movement.md)). On 2026-09-28 Liam's KB swings were logged
  `20 × BW` when the session was `10 × 20 lb`. The catalog knew — `KB Swings` is seeded
  `isBodyweight: false, unitDefault: 'lb'` — and the form had **zero references to either column**. It
  said nothing at the moment of the mistake and then could not fix it afterwards (the correction ran
  out of band, via `db:correct`). PR-A is the first half: say something.
  - **Carried on the UNIT, not a pre-tapped BW chip**, and that is the whole design. A scaffolded set
    seeded `isBodyweight: true` fails `isUntouchedScaffold`'s `!s.isBodyweight`, so the card is
    permanently "touched", survives `dropUntouchedMovements`, and blocks submit behind a **collapsed**
    card whose `required` reps input is unmounted — the "form appears dead" trap this repo documents
    twice, at a scale of 25 rows. Doing 5 of 7 programmed movements would have been unsubmittable.
    Both panels found it independently, against a plan that had proposed exactly that.
    The unit has none of that problem and is **visible**: the athlete can see what the form assumed.
  - **A warning, never a lockout.** Tapping BW on a catalog-declared-loaded movement raises an inline
    `role="status"` note — once per card, not per set, because three copies of one sentence at 360px
    is noise. The athlete doing bodyweight KB swings is allowed to be right.
  - **`load` still does not cross.** The widening is two columns of the MOVEMENT's declaration —
    what kind of number this is. The coach's prescribed magnitude stays out of `ScaffoldRow` by
    construction, which is how AGENTS.md's one inviolable rule is enforced here.
  - 🔴 **And it found a live P0 nobody knew about — V1-27.** The new e2e is the first test ever to
    submit a scaffolded form in a real browser, and it failed: `DEFAULT_SCAFFOLD_SETS` is 3, `reps` is
    unconditionally `required`, and `isUntouchedScaffold` has no per-SET equivalent — so **doing 2 of
    3 prescribed sets cannot be submitted at all.** The unit tests could never see it; they submit
    through `payload()`, which never runs native constraint validation. Filed, not fixed here.
- **2026-09-30** — **DX: agent skills for the task lifecycle** ([index](../.claude/skills/README.md)).
  The per-PR procedures lived only as prose in AGENTS.md, `docs/plans/README.md`, the DoD and
  lessons.md, so every session re-derived them, and the misses recur: #156 (status drifted from the
  merge log) and #129 (commits dropped by a stale squash). Now `start-task` → `plan-with-panel` →
  `ship-pr` encode the order to apply those rules in, **pointing at the docs rather than copying
  them**, so there is still one source of truth. `hold-the-bar` adds a diff-scoped guard, adapted
  from addyosmani/agent-skills, for the cheapest road to green: new suppressions,
  `.skip`/`.only`, deleted or assertion-thinned tests, stubs and swallowed errors. The index carries
  a prioritised backlog (`db-migration` is next).

- **2026-09-30** — **V1-14b: the full-day round trip, and the gap it closes**
  (`apps/web/e2e/export-full-day.spec.ts`). Every V1-13 proof — the golden vectors, the `db:verify`
  reads, the unit tests — starts from a row shape **we typed**. If the form writes something other
  than what those fixtures assume, all of them stay green and the export is wrong. This is the only
  test whose input is produced by the application rather than by the test.
  - **The real `unzip`, not a reader we wrote.** `buildZip` is hand-rolled; a reader built against
    the same mental model would inherit its mistakes and round-trip a wrong offset cleanly. The
    system `unzip` is an independent implementation of the actual spec, and `-Z1` reads the **central
    directory**, so the two headers must agree. It **fails rather than skips** when absent — a
    self-skipping gate reporting green is the failure mode this repo has now hit four times.
  - **Not a committed golden file**, which is what the backlog row asked for. A golden is a fixture
    we wrote — precisely the insufficiency being fixed — and it would pin a date the test cannot
    control. Expected bytes come from the day the app declares (`input[name="day"]`) and the values
    typed into the form.
  - **Proven by mutation, not by passing.** It went green on the first run, so it was broken on
    purpose twice: dropping `csvMovement`'s normalisation and flattening `collapse`. Each failed it.
    **Every pre-existing test stayed green through both** — including `export-csv.spec.ts`, which
    downloads the same zip. That is the measurement of the gap: the movement-fork bug, which forks
    every movement into two series while both files still look well-formed, would have shipped.
  - **Assertions are containment, deliberately.** `fullyParallel` shares one database and one seeded
    profile, so the bodyweight file legitimately carries sibling specs' rows. The probe movement's
    name is unique to this spec; the path check asserts shape rather than set equality, so a
    month-boundary write cannot flake it; and the determinism comparison is scoped to the two
    entries this spec owns.

- **2026-09-26** — **V1-23 PR 1: a null prescription scaffolds 3 set rows, not 1**
  ([plan](./plans/v1-23-today-focused.md)). `clampSetCount(null)` returned `1`, and `PROGRAM_SEED` —
  the only seeded block — is `open()` on **11 of its 13** prescriptions. So every open movement
  scaffolded ONE set row: a 5-movement Day B cost **~10 "Add set" taps, ~20% of the session**, while
  the `filled/total` counter read `0/1 → 1/1` with two sets still to come, lying on the form's only
  "where am I" signal. `DEFAULT_SCAFFOLD_SETS = 3` is now the default for an unauthored count; an
  explicit `sets` is honoured unchanged and an explicit `< 1` still **floors to 1** (the BUG-2(b)
  zero-row guard is a floor, not a default — two branches, deliberately two numbers).
  - **Structure, not a prescription.** Three blank rows is the same category as the movement name
    V1-19 already places: `ScaffoldRow` still carries no `load`, and the V1-19 blankness test now
    asserts every `reps`/`weight` is empty **across the null-`sets` shape too**, so the wider
    structure cannot become a place to smuggle a value in.
  - Found by the V1-23 panels, which were reviewing four _other_ changes — none of them touched this,
    and together they made the session longer (~53 → ~55 taps). Ray moved it ahead of all four.
- **2026-09-26** — **V1-23 PR 2: the header says which day it is, and the routine editor is reachable**
  ([plan](./plans/v1-23-today-focused.md) → "PR 2 — orient the header"). Two small edits to Today, from
  Ray's first real session on the app. (1) The date line reads **`Today · Fri, Sep 26 · Strength B`** —
  the day ROLE was previously visible only inside the program card, a screenful down. It is **derived
  page metadata** (`resolveDayRole`), labelled through the shared `DAY_ROLE_LABELS`; the athlete's
  **assertion** stays the `dayRole` select in `StrengthForm`, deliberately left where it is — three
  panels killed the plan's own proposal to move it, because what makes the GAP-1 P0-1 provenance
  contract real is the select's **position** (after every movement card, immediately before submit),
  not its visibility. (2) An **`→ Edit {name}'s routine`** link below the logged-entries list — V1-20's
  discoverability half; the editor already removed individual check-in rows, only the link was missing.
  Placed below the log, not in the header: parents scroll to there, kids do not scroll past their own
  work. Also removed the two now-dead `dayRole &&` guards' premise: `resolveDayRole` is **total** since
  the youth daily A/B rotation (no rest days), so there is no unprogrammed day to guard. The
  [tech-debt entry](./tech-debt.md) for the editor was **corrected, not duplicated** — it claimed the
  editor was "reachable by URL only", which this PR makes false — and now records two sharp edges the
  link exposes and that Ray deferred: a kid can `Remove` **`strength` itself** and make the session
  unloggable with nothing on screen explaining why, and `Remove` has no confirm while re-adding
  **appends**, so the authored order is recoverable only via ▲▼.
- **2026-09-26** — **V1-23 PR 3: "Today's program" collapses**
  ([plan](./plans/v1-23-today-focused.md)). On a phone the reference card was a screenful above the
  first input; it is now a native `<details open>`, so the athlete shuts it once they have read it and
  the form is on screen. Native, not React state: `StrengthForm` remounts on `key={gen}` after every
  logged session, so a state-based collapse would have re-expanded on every log — the complaint itself.
  The `<h3 id=…>` lives in the `<summary>` because the wrapping `<section>`'s `aria-labelledby` points
  at it: collapse the heading away and axe's `aria-valid-attr-value` fails the build. `a11y.spec.ts` now
  scans the card in **both** states at 360px and asserts the summary clears 44px.

- **2026-09-25** — **DUALS-1 ships, and the kids get their real program.**
  - **#152 · #153 · #155 — the day sheet.** `/duals/[event]` + `/duals/[event]/[team]`: a team's pool,
    its round-by-round opponent order and mat, each round expanding to the weight-by-weight pairing.
    Reusable by construction — a tournament is a JSON dropped into `lib/duals/events/`, nothing about an
    event is hardcoded in a route. **#153 was a merge accident worth recording:** #152 was merged
    mid-review and squashed only the first two commits, so `main` got the pages but not the `proxy.ts`
    change exempting them — as shipped, `/duals` bounced every visitor to `/gate`, the exact opposite of
    the point. The fix is `isPublicPath()`, **segment-exact** so `/duals/...` opens while `/dualsecret`
    does not, with tests pinning both directions. **#155** added PA West Black GK12; the event is now 63
    teams / 986 wrestlers across 10 day sheets.
  - **#154 — a parse failure that looked like data.** Wrestling Chix showed 3 duals in a 6-team pool:
    the source renders a 6-team pool in an **8-slot bracket**, and a team that has already advanced also
    carries an `"ABC Bye"` LABEL inside its own cell — same text, different thing. Counting those labels
    as slots shifted the positional pairing and handed Wrestling Chix a neighbour's bye **twice**, losing
    two real duals and two opponents from the event entirely. Pool C (7 teams, one bye per round) parsed
    correctly with the same code, which is why it went unnoticed. Re-read keyed on the team id in each
    cell; the schema now **asserts the round-robin invariant** (`duals == poolTeamCount - 1`) so the next
    bad capture fails the build instead of rendering as a plausible bye.
  - **#151 — the youth daily A/B program is seeded**, replacing Kids S&C Foundation, so "Fill in today's
    movements" scaffolds the real sheet instead of six typed names. **Seed-only, no migration:**
    `strength_a`/`strength_b` are REUSED as Day A / Day B, because proper `ydp_a`/`ydp_b` roles need a
    migration altering two `day_role` CHECKs — Ray chose having them log that evening over having the
    right enum, and the reuse is stated in three places because it reads as a mistake later. The old
    program is archived verbatim (generated from `PROGRAM_SEED`, not retyped) at
    `docs/programs/kids-sc-foundation-archived.md`; both cannot be seeded at once, since `programDayRows`
    picks the newest block per day-role and the second would silently hijack the first's card.

- **2026-09-24** — **CSV export — the MVP finish line** ([contract](./csv-export-contract.md) ·
  [plan](./plans/v1-13-csv-export.md)), plus the last GAP-3 PR.
  - **#149 — the formatter.** Pure and DB-free, proven against golden vectors transcribed from the
    contract's **own example rows** (real bytes out of the real files, not cases we invented). Exported as
    the `@mat-plan/shared/csv` **subpath**, deliberately not added to the root barrel — `index.ts` is an
    `export *` that eight `'use client'` components import, and CSV formatting has no business in a client
    bundle. Two panel findings would each have silently corrupted the workflow this feature exists to
    serve: **`load` is RE-SYNTHESISED from typed quantities, not copied** (the contract's eleven verbatim
    shapes predate GAP-3, which deleted the column they were copied from), and **`movement` must be
    KEBAB, from the slug** — `movementSlug()` emits underscores and the workflow groups on this exact
    string, so shipping `front_squat` would fork every movement into a legacy series and a new one while
    every file still looked well-formed.
  - **#150 — delivery.** Reads, a hand-rolled **STORED** zip (~60 lines, no compression, no new
    production dependency; validated against the system `unzip`), and an e2e that actually downloads it —
    because the golden vectors and the `db:verify` proofs each cover half the chain and neither covers the
    seam. **The route is not under `/api`, deliberately:** the access-gate matcher is
    `'/((?!api|_next/static|_next/image|favicon.ico).*)'`, so `/api/export` would have been **completely
    ungated** — every athlete's whole training history downloadable by anyone with the URL. It lives at
    `/p/[profileId]/export`, inside the matcher, and **re-checks the gate itself anyway** because
    middleware is not an authorization boundary; an e2e asserts a cookie-less request never gets a 200.
    The `/api` exclusion is now recorded in [tech-debt](./tech-debt.md) as a live hazard for `/api/sync`.
  - **#141 — GAP-3 PR 4a: the typed log form** ([plan](./plans/gap3-pr4-typed-log-form.md)). Numeric
    keypad, mode toggles, dimension-first units. #139 built the typed model but the form was still sending
    one text string for `parseLoad` to reverse-engineer — **`parseLoad` is now DELETED**, ~90 lines of
    pattern matching and ~300 lines of test whose only job was recovering structure the client had thrown
    away. Hardened by **three panels** (two UX lenses + engineering, per the UI-PR rule); three blocking
    findings, all accepted: `required` + BW made the form silently dead, a BW-only set was silently deleted
    by the untouched-card predicates, and the widened unit select was unrecoverable.
  - **#147 — a latent break on `main` since #139.** `0011_snapshot.json` had `prevId === id`, from merging
    two generated migrations and promoting the second snapshot to the first's filename without repairing
    its parent pointer. drizzle only walks the chain when appending, so `generate` kept reporting "No
    schema changes" and it stayed invisible — it would have surfaced on the **next** migration as a parent
    collision. The `lessons.md` recipe that produced it listed four steps and omitted the fifth; corrected.
  - **#148 — the export directory is `public_id`.** Ray retired the constraint that forced a
    human-readable `<athlete>` segment: _"the past data does not matter that much at this point — and if it
    did, we can work on an importer."_ That was the load-bearing requirement; with it gone `public_id` wins
    on every remaining axis and `profiles.slug` is cancelled. Adds **IMP-1** (the importer, sequenced AFTER
    the exporter so the exporter fixes the format) and **PROF-1** (profile create/edit — there is still no
    way to add a profile without a seed).
  - **#140 — feature guides, enforced by CI.** A guide per large atomic feature (strength logging, the
    write path, programming): the file map, the cross-file invariants, the traps that actually bit someone.
    The guard fails a PR that touches an owned file without touching its guide, **and** a guide claiming a
    file that no longer exists, so a rename cannot silently drop coverage. Enforced rather than
    conventional for the reason #132 documents — _a doc nobody is forced to update is a doc that lies._
  - **Plans merged, unbuilt:** **#142/#143 V1-15 day navigation** — the panels killed three of the draft's
    claims, the sharpest being that blanket read-only history was **stricter than the server**
    (`declared-day.ts` already accepts `|diff| <= 1` and `editStrengthSetAction` has no day bound), and
    recorded that a dated route has a **second consumer — the test suite** (the scaffold a11y check
    self-skipped 4 days in 7). **#144 V1-13** (nine blocking findings) and **#146** — Ray's three YDP
    decisions, including **YDP-1 deferred**: calendar alternation ships despite the spec's session-indexed
    rule, accepted knowingly (_"if they miss a day and end up doing the same thing twice, that's on them"_).

- **2026-09-23** — **Five CI gates that did not exist, and GAP-3's model.**
  - **#132 — the audit.** GAP-3's DB-safety reviewer checked the plan's claim that Squawk hard-fails a
    `DROP COLUMN` and **found no Squawk in CI at all**. Auditing the rest of AGENTS.md's required-checks
    list turned up **five gates claimed for months and never wired**: Squawk, the Neon-branch apply, the
    forward-only guard, CodeQL and `pnpm audit`. Every safety argument in GAP-3's plan cited gates that
    would not have fired. Low impact so far only because every migration to date was additive and
    single-author. Root cause: the rules were written as the intended end state and never re-verified.
  - **#133 forward-only · #135 Squawk · #138 CodeQL** — three of the five, wired before the arc that needed
    them. Two traps decided #133: `meta/_journal.json` is modified on **100%** of DB PRs, so a naive
    `migrations/**` rule fails every DB PR while looking like the guard working (it is excluded and
    verified **append-only** instead — base `.entries` must be an exact prefix of head's, because the
    journal tag maps 1:1 to a filename); and `checkout` has no `fetch-depth` here, so a diff against the
    base would have had nothing to compare and **always silently passed**. #135 found the expected tension
    absent — all 10 migrations already hand-add both timeouts — but needed `assume_in_transaction`, without
    which `prefer-robust-stmts` fires 99 spurious times. **#138 makes CodeQL deliberately NOT a PR check:**
    minutes-long on a ~4h/wk project, and every merged PR is one squashed commit on `main`, so the push
    trigger still sees 100% of merged code. All three live in the **`quality` job, not their own** — a new
    job is not a required check until branch protection is edited, so it would look wired while blocking
    nothing.
  - **#134 `pnpm verify` · #136 `pnpm e2e:local`** — local/CI parity. `verify` runs `format:check` → `lint`
    → `typecheck` → `test` → `db:verify` → `audit --prod` in **~25s** warm (each measured, not assumed;
    `db:verify` runs on PGlite, which is why the DB proofs need no Docker). `--prod` is scoped on purpose:
    the unscoped audit is 5 high + 1 moderate, all in dev/build tooling, and **a gate that is red on
    arrival gets disabled rather than fixed**. #136 closed the last gap — `playwright.config.ts` built the
    app but provisioned no DB, inheriting `.env.local`, i.e. **live Neon** — by migrating + seeding a
    disposable `embedded-postgres` and injecting the connection string, a local gate code and a free port,
    with `assertLocalDbUrl` guarding the target.
  - **#137 GAP-3 PR 2 — `units.dimension` + the five length codes.** `UNIT_CODES` had **no length dimension
    at all**, which is much of why `30in` and `50ft` had nowhere to live but the free-text string the
    census found them in. ADR 0004's four dimensions were incomplete for codes already in use (`bool` and
    `timing` fit none), and they get real dimensions rather than a nullable column — a nullable dimension
    re-opens the hole the column exists to close. `instant` is kept separate from `time`: a clock reading
    and an elapsed duration cannot be added.
  - **#128 — the column design, written after the census.** Three of ADR 0004's assumptions needed
    correcting, each on census evidence: the unit **cannot** be parsed from the string (no row carries
    `lb`) so it is resolved from the movement's dimension and stored on the row; the design must **not**
    key off which column a value appeared in (box-jump height moved between them); and the typed columns
    must stay nullable and **never encode a status** (absence is always `SKIPPED`, never blank). One piece
    of scope vanished: **YDP-2 needs no new columns** — Stance in Motion is a timed activity with measured
    attributes, the `brush_teeth` shape, not a strength movement with sets.
  - **#125 — V1-19: one tap scaffolds the day's program into the form.** A movement card per prescription
    in the coach's order, with the prescribed number of set rows; Ray's real Strength B day was ~60
    interactions and the names and add-set taps are now zero. **STRUCTURE ONLY** — every reps and weight
    field arrives blank, which is the V1-10 panel's holding, not a simplification: a blank `required` field
    **is** the human confirmation, so a prefilled value logs a PRESCRIBED number as a PERFORMED one with no
    affirmative entry. That is a mechanism, not a load-specific rule, so it binds reps too, and **a unit
    test asserts blankness across the whole produced structure** so reintroducing either prefill fails CI
    rather than passing review. Cards render **collapsed** (at 360px, 7 movements × 4 sets is ~6,600px of
    blank inputs, inverting the form's one useful signal — its length grows with work DONE), and collapsed
    rows are **unmounted, not hidden**, since a hidden-but-present `required` input blocks the native
    submit with an invisible error.
  - **#127/#129 — the V1-22 program editor plan.** `PROGRAM_SEED` → `seed.ts` is the **only** writer of
    `prescriptions`; there is no write path in `apps/web` at all, so changing one load means editing
    TypeScript and deploying. (#129 recovered three commits dropped from #127's squash.)

- **2026-09-23** — **GAP-3: typed measurements ship; the free-text load is gone** (migration `0011`,
  [plan](./plans/gap3-pr3-entry-set-quantities.md)). `quantity_slots` + `entry_set_quantities` replace
  `entry_sets.weight_num` / `weight_label` / `seconds`, all three **dropped in the same migration**.
  - **The unit guard is now a constraint, not a convention.** `dimension` is the shared column of two
    composite FKs — `(slot, dimension)` → `quantity_slots` and `(unit, dimension)` → `units`, both
    targeting primary keys — so `lb` in a box-jump height is rejected **by the database**. The panel
    tried to find a defeating spelling and could not.
  - **`primary` is a ROLE, legal at mass, length AND time.** The panel killed a mass-pinned `primary`
    on two movements already in the seeded catalog (`broad_jump` measures a length, `hollow-body_hold`
    a duration). Making the slot PK the `(code, dimension)` pair fixed that **and** a migration-abort
    bug in one move, since drizzle inlines a PK into `CREATE TABLE` but emits a `uniqueIndex` after the
    FK referencing it.
  - **Five PRs became two.** §7.6a's expand→backfill→contract arc existed to protect `weight_num`'s
    live data; prod's `entry_sets` is **empty** (verified: sets 0, labeled 0, numeric_loads 0), so the
    backfill script and the zero-unmigrated-rows gate were deleted outright.
  - Shapes that now round-trip typed: `BW` and `band` → booleans; `30in`/`20s` → a `primary` quantity
    carrying its own unit; `BW+8 (vest)` → a flag **plus** a `vest` row; `123 (50ft)` → **two rows on
    one set**. `isEditableSet` was restated on what a set IS (a single mass) rather than how it was
    spelled — without that, dropping `weight_label` would have made every previously-labeled set
    silently editable.
  - **No markup change**: the form still renders the same fields and chips; only where their values
    land changed. The keypad/multi-slot rewrite is the next PR, with its UX panel.

- **2026-09-22** — **GAP-3 evidence: the shape census** (#126,
  [gap3-typed-measurements.md](./plans/gap3-typed-measurements.md)). Every distinct `load` and
  `prescribed` shape in the four `strength-log` samples, counted — **12 shapes each**, from 22 and 23
  distinct strings over 44 rows / 22 movement-slots. Three findings the column design has to answer
  to: (1) **ADR 0004's "something that appears thirty times" does not exist** — the head is two shapes
  (bare `BW`, per-set slash list) covering 20 of 44 rows, and **seven of the twelve `load` shapes rest
  on one authored cell each**, so this corpus is strong evidence for _which_ shapes exist and weak
  evidence for _how often_; (2) **box-jump height changes columns between the two months** (`load=30in`
  in June, `load=BW, prescribed=4x3 @ 30in` in July — same movement, same author); (3) the **em dash is
  not a measurement shape at all** — 21 of 44 rows carry U+2014 and every one is in `notes`. Also:
  `~`/ranges are prescribed-only (0 rows in `load`), neither column is ever blank (`SKIPPED` is the
  sentinel), weight units are never written while `s`/`in`/`ft` always are, and **30 of 44 `load` rows
  are not a number**. Inventory only — the plan sections are deliberately empty.

- **2026-09-18 → 09-22** — **Planning that unblocked everything above.** **#121** landed the legacy CSV
  samples, clearing the six-week GAP-3/V1-13 blocker (the shapes are verbatim; names, dates and bodyweight
  values scrubbed **before** they reached `main`, so no `git-filter-repo` rewrite was ever needed).
  **#119** measured the real logging cost (~30 interactions for a 3×3 session, 60+ for Ray's 7-movement
  Strength B day) and found that **reps are free text exactly like loads**, so only 2 of 7 rep
  prescriptions on that day are clean integers — `AMRAP`, `to failure` and `8-10` are numbers you DISCOVER
  by doing the set, and prefilling them records a fiction about the one set that mattered. **#122 (SCHED-1)**
  made scheduling data rather than a hardcoded weekday→`day_role` const — three unrelated-looking problems
  turned out to be the same missing primitive, which is the best evidence an abstraction is real rather than
  invented. **#123** settled it: **one streak, period of a day**, with the coach choosing which programs feed
  it — deleting streak periods, weekly units and competing counters, and making the arithmetic trivial.
  **#124** planned V1-19; **#114** ran ONB-0's first-run UX panel before implementation. Plus dependabot
  (#120, #130, #131 — including vitest 5).

- **2026-09-16** — **Docs catch-up + two planning PRs.** **#117** completed the **AI-1 NL-logging plan**
  (S1–S5): the load-provenance invariant, why the confirm chip is UX and not the safety mechanism, what
  the structured output may contain, separate CI gates for accuracy (scalar) and the never-emits-a-load
  invariant (binary), and **S5 — AI-1 sequences behind GAP-3**, an undocumented dependency that had been
  live since ADR 0004. **#118** added **[product-spec.md](./product-spec.md)**, the first human-readable
  product spec, written against a 3-lens panel (Director of Product Development · Sr PM · Staff SWE).
  Two findings: the premise had **drifted** (the docs say the app is for the kid to log their day, but
  nearly everything since July serves the adult — root cause was an over-correction conflating
  _authoring a program_ with _recording a set already performed_), and several **present-tense claims in
  the repo are false** (no offline, no Clerk dependency, no CSV exporter, empty engine — each verified
  against the tree). #118 also added the **MOT** group (streaks · reminders · daily quote), the first
  coherent answer to the spec's top risk: nobody logs.

- **2026-08-12** — **GAP-1 P1-1c — P1-1 COMPLETE**: the UI for both statuses
  ([plan](./plans/gap1-p1-1c-status-ui.md)). A **Skipped** checkbox on the movement card (set rows
  unmount — not CSS-hidden, since `required` inputs left in the tree block the native submit with an
  invisible browser error — and the typed sets survive in state, so unchecking restores them), a per-set
  **Sub-failure** toggle, and status badges in the day's log humanized through a shared
  `ENTRY_STATUS_LABELS` in `packages/shared` (`sub-failure` is the CSV export byte, so the badge and
  V1-13 must emit one string). **Closes BUG-2(b)** — `[].every(...)` is vacuously true, so a skipped
  card with a blank name was silently dropped; fixed at BOTH levels, since a card whose only input is a
  SET status had the same hole. Statuses compare to their DEFAULT, never to `undefined`, so a mis-tap
  that is undone doesn't wedge the form. A skipped movement KEEPS its superset tags (a skipped member is
  still part of the group the athlete programmed), pinned by a schema test. New RTL component test
  asserts the **serialized payload**, not React state — the seam where #98's `dayRole` went missing.
  Screenshot tooling gained an `interact` hook plus a `status-badges` fixture, because the states a
  reviewer needs only exist after a tap or in seeded rows. No migration.

- **2026-08-11** — **GAP-1 P1-1b**: a **SET** can be marked `sub_failure`, keeping its real `reps`
  ([plan](./plans/gap1-p1-1b-subfailure-write.md)). Per-SET, not per-movement: `sub-failure` in the CSV's
  `reps` column is the **uniform collapse of a per-set list**, structurally identical to `5/5/5` → `5`,
  not a granularity signal — so entry-level storage would have thrown away _which_ set failed. `reps`
  stays required (the file loses the number to `notes`; that's a limitation of the FILE, not of the DB —
  byte-faithfulness is a property of the output). New `SET_STATUSES` = `{done, sub_failure}` with a
  `satisfies readonly EntryStatus[]` compile-time subset proof; `skipped` is excluded because the export
  derives `sets` from `COUNT(entry_sets)` and a placeholder set row would over-count. **Closes BUG-2(a)**:
  a sub-failure set is numeric, so it passed every `isEditableSet` guard — a V1-9 edit would have changed
  its reps and left the status behind, exporting as `sub-failure` while claiming reps it never achieved.
  Fixed on BOTH halves (the client predicate and `updateStrengthSetById`'s WHERE), with a `db:verify`
  case on the server half, since a crafted POST bypasses the client entirely. Also plumbs `SetDTO.status`
  (per-set status was unrenderable without it) and records the export collapse rule in V1-13 D7.
  No migration. The badge itself is PR 1c.
- **2026-08-11** — **Speed Insights deferred to production, prod-ONLY when it lands** (Ray) —
  [ADR 0001](./decisions/0001-observability-and-web-vitals.md) §2 amendment. It was phased for "≥ V0-7,
  target V1-12" and never installed; the decision is now explicit rather than drift. The reason it must
  not mount outside prod is concrete: our CSP is `script-src 'self' 'nonce-…' 'strict-dynamic'`, and
  **`'strict-dynamic'` makes browsers ignore `'self'`**, so the injected script is blocked and every
  dev/preview load would log a CSP violation — expected console errors are how real ones get missed. The
  ADR records the gate (via `lib/env.ts`, since AGENTS.md bans bare `process.env` reads outside the DAL),
  the nonce work (this would be the app's first third-party client script — Sentry here is server-side
  only), an open check that it reports the `/p/[profileId]` route PATTERN rather than resolved profile
  UUIDs, and how to verify all of it at cutover.

- **2026-08-11** — **GAP-1 P1-1a**: a movement can be logged as **SKIPPED**, storing
  `entries.status='skipped'` with **ZERO** `entry_sets` ([plan](./plans/gap1-p1-1a-skipped-write.md)).
  Write path only — **no migration, no UI, and no read-path change**: `MovementLine` already renders a
  non-`done` entry status and already guards `sets.length > 0`, so this ships provable by `db:verify` +
  unit tests and the UI PR inherits a working store. New `MOVEMENT_STATUSES` (`{done, skipped}`) is built
  from `ENTRY_STATUS` members and constrains at the **zod boundary**, not the CHECK — widening a CHECK is
  cheap, narrowing one is a migration. `sub_failure` is rejected as a movement status: _a status belongs
  on the entry only if it can be true with zero sets_. The `≥1 set` rule moved into the existing
  session-level `superRefine` (a `.superRefine` on `sessionMovementSchema` would make it `ZodEffects` and
  kill `.extend`/`.shape`), keeping the rendered `Movement N: Add at least one set.` byte-identical. The
  writer **spreads** `status` so an unset status omits the column and takes the DB default, leaving the
  `done` path untouched. Includes an action-boundary test asserting the value reaching the DAL — the
  guard against the silent-drop class that made #98's `dayRole` inert.

- **2026-08-11** — **GAP-1 P1-1 plans** (docs only): the combined P2+P1-1 plan was **reversed by an
  adversarial panel** and is replaced by a 4-PR split. Committed:
  [1a — skipped write path](./plans/gap1-p1-1a-skipped-write.md) (`entries.status='skipped'` with zero
  `entry_sets`) and [1b — sub-failure](./plans/gap1-p1-1b-subfailure-write.md) (`entry_sets.status`, the
  `SetDTO.status` plumbing the original plan omitted, and closing BUG-2(a) — a numeric `sub_failure` set
  currently passes `isEditableSet`, so a V1-9 edit would leave the status stale). PR 1c is the UI.
  The headline decision: **`sub_failure` lives on the SET, not the entry** — `sub-failure` in the CSV's
  `reps` column is the uniform collapse of a per-set list, exactly like `5/5/5` → `5`, not a granularity
  signal. The criterion, reusable: _a status belongs on the entry only if it can be true with zero sets._
  The superseded plan is kept as the historical record the panel reviewed, with a SUPERSEDED banner.

- **2026-08-11** — **GAP-1 P0-1 fix**: `sessions.day_role` was **never written from the app**.
  `logStrengthSessionAction` parsed `dayRole` and then omitted it from the `logStrengthSession({…})`
  call, so the column P0-1 exists to populate stayed NULL for every UI-logged session. Three gates
  missed it independently: `LogStrengthSessionArgs.dayRole` is optional so `tsc` was clean,
  `db:verify` drives the writer directly (bypassing the action), and the happy-path assertion used
  `expect.objectContaining`, which cannot see an ABSENT key. One-line fix plus two regression tests
  that assert the VALUE reaching the DAL (`strength_a` forwarded; `''` normalised to `undefined`),
  verified to fail with the line removed. Recorded in [lessons.md](./lessons.md).

- **2026-08-11** — **GAP-1 P2-2 / P2-3**: reject **CSV-unsafe input at the write boundary**. The CSVs are
  deliberately not RFC-4180 (joined raw, nothing quoted), so a comma in a movement name shifted every
  downstream field and an interior newline in a note split the record. One shared pair of predicates in
  `packages/shared/src/text.ts` (`hasLineBreak`, `hasCommaOrLineBreak`), three consumers: `parseLoad`
  (de-duplicated, behaviour unchanged), the movement **name**, and `freeTextNoteSchema` (newline only —
  the contract quotes a comma-bearing `notes` on export). `"` stays legal everywhere (`30"` is real).
  **A panel reversed the original plan**, which would have sanitised `movementSlug`: that fixes nothing
  (the raw name persists in `movements.name` **and** `entries.movement_name`, and the CSV `movement`
  column is kebab-rendered, not the snake slug) and is a **persisted natural-key change** — the
  derivation is inlined as SQL in applied migration `0002`, so altering it would split a movement's
  history across two rows, uncaught by `db:verify` check 6 (it iterates seed constants, not DB rows).
  The no-change decision is pinned as an executable test. Two latent defects that GAP-1 P1-1 will make
  reachable were filed as **BUG-2**.

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
