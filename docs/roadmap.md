# Roadmap — the whole program, by pillar

**What this is:** the one forward-looking, cross-program view — what is in flight, what is next, and
what each thing waits on. It is a **pointer document**: every item is an id you look up in
[plan.md](./plan.md). Nothing here restates a row's scope or acceptance, because the second copy is
the one that goes stale.

**What this is not.** [plan.md](./plan.md) is the backlog (~80 rows, the full scope and acceptance of
each). [status.md](./status.md) is "where we are" plus the merged changelog — it looks **backwards**.
[milestones/](./milestones/) sequences one milestone's phases. This file is the only one that answers
"what is the state of the whole thing right now", which is the question a new session asks first.

**Updated in the same PR as the work** — the same rule as the changelog fragment and `status.md`
(AGENTS.md → "Status rides with the work"). Moving an item between columns is one line; if a PR
doesn't move one, say so in the description.

## The pillars

A pillar is **a set of owned file globs**, not a theme. That is deliberate: the question a session
actually needs answered is _"can this run in parallel with what is already in flight"_, and that is a
**file** question. Two items in different pillars whose globs overlap are **not** parallel-safe —
this milestone's chunk 2 and `v1-30b` both touch `strength-form.tsx`, and any theme-based grouping
would have called them independent.

Where a glob is already owned by a [feature guide](./features/), the guide's `owns:` frontmatter is
the authority and `pnpm guides:check` enforces it. The pillar does not re-declare it; it points.

| Pillar                      | Owns                                                                                                                                               | Ids                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Onboarding & Access**     | `app/(landing)/`, the gate, sign-in, empty states                                                                                                  | `ONB-*` `AUTH-1` `OSS-*` `SEC-1` `SEC-6` `PRIV-1`                                                                        |
| **Profiles & Tenancy**      | `lib/dal/profiles.ts`, household scoping, `app/p/` shell                                                                                           | `PROF-1` `TEN-*` `DAL-*`                                                                                                 |
| **Logging & Measurement**   | [strength-logging](./features/strength-logging.md) + [write-path](./features/write-path.md) guides                                                 | `V1-19` `V1-24` `V1-26..30` `GAP-*` `SET-1` `UI-1` `DUALS-*` **`PICK-1`** `PICK-2` `AI-1` _(parked)_ `VOICE-1` _(later)_ |
| **Authoring & Scheduling**  | [programming](./features/programming.md) guide, `prescriptions`, `routine_config`                                                                  | `V1-18` `V1-20` `V1-22` `SCHED-*` `CLONE-1` `RETIRE-1` `CAT-*` `SHARE-1` `LADDER-1` _(later)_                            |
| **Insight** (read & export) | `V1-16` charts, aggregation kernel, `lib/dal/export.ts`, the CSV contract                                                                          | `V1-16` `CSV-1` `MOT-*` `DASH-1` `HIST-1` `COACH-1` `PUB-1` `SOCIAL-1` `MCP-1` `SENTINEL-1` `ASK-1` _(later)_            |
| **Platform**                | `.github/workflows/`, `.claude/`, hooks, deps, the migrations runner                                                                               | `OPS-*` `DX-*` `SEC-2..5c` `TEST-*` `EVAL-0` `SYNTH-1` _(later)_ _(incl. `DX-1`)_                                        |
| **Product & Spec**          | `docs/decisions/`, `docs/specs/`, `docs/milestones/`, `AGENTS.md`, the design system (`docs/design.md` + the tokens in `apps/web/app/globals.css`) | `UI-2..4` _(the design system; the rest are ADRs and specs, not backlog rows)_                                           |

Two deliberate departures from the obvious cut, both argued rather than assumed:

- **There is no "Tech Leads" pillar.** Coordination is a role, and a pillar that owns no files cannot
  be assigned, cannot be checked, and becomes the place work goes to be forgotten. The function is
  real and it already has artifacts — ADRs, specs, milestone docs, `AGENTS.md`, and the review panels
  in [`.claude/agents/`](../.claude/agents/) — so it is **Product & Spec**, which owns files.
- **Measurement sits with Logging, not with Dashboarding.** Capture (`GAP-3`'s typed quantities,
  `set-fields.tsx`) and read (`V1-16`'s charts) share no files and almost never move together.
  Grouping them would put the one glob the whole app writes through next to the one nothing writes to.

## In flight

| Item                                | Pillar                 | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1-22 Authoring** — chunks 1–6    | Authoring & Scheduling | Spec #226 · **chunk 1 shipped** (#232, `0013` verified live in prod) · chunk 2 **planned** (#239) and unblocked — #236 cleared its `strength-form.tsx` collision. Chunk 2 is next.                                                                                                                                                                                                                                                                                                                                                                                        |
| **ADR 0006** — household addressing | Product & Spec         | **✅ Accepted 2026-10-07 (#252): option A, session-only**, superseding [HH-1](./plan.md#hh-1)'s path clause and nothing else. It was **TEN-1's chunk 0**, so Beta 0's critical path (`TEN-1` → `AUTH-1`) is unparked; all four chunks (`1a`–`1d`) are landed and its four named obligations are discharged (the picker proved on two households, `force-dynamic` + the cache rule pinned, the miss-path event, the refusal copy promoted to `lib/constants.ts`).                                                                                                          |
| **PRIV-2** — serve `/privacy`       | Onboarding & Access    | **Planned 2026-10-13** ([plan](./plans/priv-2-serve-the-notice.md)), on `feat/priv-2-serve-the-notice`. **Sequencing decision:** it ships as **two** PRs, not one — a docs-only `docs(priv-1)` fills the notice's five `⏳` and corrects three factual errors in it, then `feat(priv-2)` serves it and opens **green**. The first draft's blanks-as-a-red-merge-gate would have short-circuited `verify`'s `&&` chain at `test` (fourth of ten), so `audit:check` would never have run on the PR that adds a dependency. ⛔ Owes its engineering + UX panels before code. |
| **AI-1** — NL logging               | Logging & Measurement  | ⏸ **Parked 2026-10-06, pending [`PICK-1`](./plan.md#pick-1) usage data** — prod carries zero ad-hoc entries, so the case it exists for has not been observed once. Not in flight; listed once more so the move is visible, then it leaves this table. _(V1-30b completed and left this table: #234 + #236.)_                                                                                                                                                                                                                                                              |

**Sequencing decision (2026-10-06, [parallel-work](./parallel-work.md) gate 1):** chunk 2 threads a
prescription public id through the log form, and `v1-30b` edits `strength-form.tsx` and
`set-fields.tsx` — same files, same owning guide. `v1-30b` is already planned and panelled and chunk 2
is not, so **`v1-30b` goes first** and chunk 2 rebases onto the form it leaves. Every other gate is
green for this pair, which is why gate 1 is checked first.

## Active milestone — Authoring (beta-1 §3b)

The order and the reason each chunk cannot move live in
**[specs/v1-22-authoring-program-editing.md](./specs/v1-22-authoring-program-editing.md)**. This is
the progress view only.

| #        | Chunk                                                   | State                                                                               |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **1** ✅ | `entries.prescribed_snapshot`, shipped dark             | **Done** — `0013`, mutation-tested. Chunk 2 gated on it being **observed applied**. |
| **2**    | One shared renderer + log-time writer + export fallback | ☐                                                                                   |
| **3**    | The backfill, as a `db:correct` correction              | ☐                                                                                   |
| **4**    | Edit values at `/p/<id>/program` — _the pain goes away_ | ☐                                                                                   |
| **5**    | The day-scoped seed guard                               | ☐                                                                                   |
| **6**    | Add / remove / reorder                                  | ☐ cuttable                                                                          |

## Next per pillar

Each is the item that would start if that pillar got the next session.

| Pillar                 | Next                                                                                                                                          | Gated on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding & Access    | **`PRIV-2`** — serve the notice at `/privacy`; then `OSS-2` §B                                                                                | Nothing. **`PRIV-1` is done** (2026-10-07) — notice, retention policy, deletion procedure and the rewritten threat model are in [docs/privacy/](./privacy/). `AUTH-1` now waits on **`TEN-1` and `PRIV-2`**: its Clerk/Google consent screens need a privacy-policy URL on the app's own domain, and a `docs/` file is not one. ✅ **`PRIV-2` is planned** (2026-10-13): [plan](./plans/priv-2-serve-the-notice.md) — build-time generation with a byte-exact drift test, and **two PRs**: a docs-only `docs(priv-1)` fills the notice's five `⏳` and corrects three factual errors in it (no-public-pages, the 7-day restore promise, the blank sign-off), then `feat(priv-2)` serves it and opens green. ⛔ Needs its engineering + UX panels before implementation — the first draft's six-lens panel found ~20 blocking defects. ✅ `OSS-1`'s rename is **done** (2026-10-08) — PRIV-1 re-scoped it from 3 files to ~50 and raised it to a Beta 0 blocker; the real surface was 57 files / 309 occurrences and is now 1 (a comment in an applied migration, which the forward-only guard forbids editing). Forward exposure only — history was not rewritten ([§9](./privacy/data-inventory.md)). **`ONB-0` is done** (2026-10-07) — first run no longer inherits the maintainer's household's routine, and `PROF-1` now owns the "add an athlete" control the empty state only explains. |
| Profiles & Tenancy     | **[`TEN-2b-1`](./plan.md)** — move find-or-create inside the write transaction; then **`TEN-2b-2`**. `PROF-1` is the pillar's other open row. | **Nothing. `TEN-2` is effectively complete — `TEN-2d` ✅ landed 2026-10-13** ([plan.md](./plan.md)'s TEN-2 row): migration `0018` `VALIDATE`d `movements_global_row_has_pattern`, the arc's only scan of real production rows, and deleted the `23505` fallback. **Four of five rows are done** (`2a` `0015`, `2b` `0016`, `2c` `0017`, `2d` `0018`); the fifth, **`TEN-2c-1`, is a measured no-op** — the production census of 2026-10-13 found 35 `movements` rows, all global, none household-owned, all curated, so the split backfill has nothing to split. It stays open as a **pre-invite conditional** (re-measure, implement only if non-zero), because a dated zero is not an invariant. Remaining pillar work is `TEN-2b-1` → `TEN-2b-2` (garbage collection, not an isolation fix) and `PROF-1`; the backlog sets no order between them. ✅ `TEN-2c` landed 2026-10-12, ✅ `TEN-2b` 2026-10-11, ✅ `TEN-1` DONE 2026-10-08. **Status lives in [plan.md](./plan.md)'s TEN-2 row and [data-inventory.md](./privacy/data-inventory.md) §4** — this cell is a pointer, not a copy.                                                                                                                                                                                                                                                                                                     |
| Logging & Measurement  | **[`PICK-1`](./plan.md#pick-1)** — the movement picker                                                                                        | Nothing. `V1-30b` is **complete** (#234 + #236), so this lane is free. It is **not a P0** — the hazard is latent, not live — and it is the pillar's next item because the only way to name an unprescribed movement is a free-text box that mints a catalog row on a near-miss. It needs a plan + panel of its own before code. **`AI-1` is parked behind it** (2026-10-06): prod's 49 entries carry zero ad-hoc movements, and only the picker makes that case cheap enough to measure. `V1-26` / `V1-33` follow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Authoring & Scheduling | Chunk 1                                                                                                                                       | 🔴 **Not "nothing" — `SCHED-1` is Beta 1 behind a gate.** [Planned](./plans/sched-1-scheduling-model.md) and **panelled** (six lenses), but [beta-1](./milestones/beta-1.md) gates Beta 1 on family #1 having used Beta 0 for two weeks **and** a decision to widen, and **no Beta 0 item consumes it** (`ONB-2` has no SCHED-1 dependency; `MOT-1` is Beta 1 too). So no chunk starts before that gate clears. ADR 0007 also needs signing **and amending** before 1c.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Insight                | `V1-16`                                                                                                                                       | Nothing. `DASH-1` / `COACH-1` are later ideas (#221).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Platform               | `SEC-5b`, then `DX-5(a)` (repo-admin: required checks)                                                                                        | Nothing. `OPS-1` ✅ closed 2026-10-09. `DX-5(b)` ✅ (#283): `skills:check`, `guards:test` and `status:check` run in CI's `quality`; with SEC-5's audit third, (b) is closed. `SEC-5b` (the daily full-tree audit) is gated on confirming a failed scheduled run reaches a human; `SEC-5c` (the allowlist) is built on first need.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Product & Spec         | **`UI-4`** → `UI-3`                                                                                                                           | Nothing. The scheduling ADR is written and panelled: recurrence is a weekday set as rows (no RRULE), rotation becomes an anchor + ordered list **on the block** and stays calendar-indexed, dueness is derived and the day's verdict is recorded **and snapshots what it judged**. ⚠️ **It authorizes two tables, not five** — the assignment row and the weekday rows; rotation slots and the `workouts` arc have recorded shapes and no authorizing row. `SCHED-1` starts on those two; **`MOT-1` ships WITH the verdict table**, not behind a derived-only era; **V1-22 A4 splits** (a new day has an interim needing no schema — eight unused `DAY_ROLES` codes — while a new block waits on the one-block→N-assignments read, which is byte-affecting for the CSV). ⚠️ **`CAT-2` was never gated on this** — its own row gates it on the movement-list review, and this table said otherwise. **`UI-4`** (the light/dark switch) lands **before `UI-3`** (the reskin), because reskin options must be reviewable in both themes — and dark mode is defined but unreachable today (a 33-line `.dark` palette, nothing sets the class, no `prefers-color-scheme` fallback). Both are **seams**, so neither parallelizes. Neither is a P0. **[ADR 0006](./decisions/0006-household-addressing.md) is written and proposed** (2026-10-07) — it needs a signature, not a session.              |

⚠️ **This table is the membership test, and it has already failed once.** `AI-1`, `PRIV-1` and `DX-1`
sat in `plan.md` for weeks while belonging to **no** pillar — so this file claimed to be the
cross-program view and silently was not. A backlog row in no pillar is invisible here, which is the
one failure it cannot afford. Adding a row to `plan.md` means putting its id in a pillar above, or
saying in the row why it has none.

## Seams — where two pillars must agree

Pillars are disjoint **file globs**, which is what makes them parallel-safe. These are the places two
of them nonetheless touch one contract, so a change on either side is a change to both. **Each seam
has one owner**; the other pillar consumes it and does not redefine it.

| Seam                                           | Pillars                        | Owner                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The log form's submit schema + `ScaffoldRow`   | Logging ∩ Authoring            | **Logging** — Authoring chunk 2 adds a prescription id to it                                                                                                                               |
| `lib/dal/` household scoping                   | Tenancy ∩ Authoring ∩ Profiles | **Tenancy** — ✅ written (`TEN-1`'s single scope seam, done 2026-10-08). Consumers call `getHouseholdScope()`; they do not redefine the seam. `AUTH-1` replaces only that function's body. |
| `packages/shared/src/units.ts` dimension words | Logging ∩ Measurement          | **Logging** (`v1-30b`'s `QUANTITY_FIELD_WORD`)                                                                                                                                             |
| `ROUTINE_CATALOG` — membership, default, offer | Authoring ∩ Insight            | **Authoring** (`CAT-1`); adherence counts consume it                                                                                                                                       |
| The byte-faithful CSV contract                 | Authoring ∩ Insight            | **Insight** (`docs/csv-export-contract.md` + golden files)                                                                                                                                 |
| The design tokens + the `.dark` class          | **every** pillar with a screen | **Product & Spec** (`UI-3` reskin, `UI-4` the switch)                                                                                                                                      |

⚠️ **A decision about a seam can sit in a different pillar from the seam.**
[ADR 0006](./decisions/0006-household-addressing.md) is filed under **Product & Spec** (it is a file in
`docs/decisions/`, and pillars are file globs) while being **chunk 0 of a Profiles & Tenancy plan**.
That is correct but not obvious, so it is said here rather than left to be rediscovered: the ADR
blocks `TEN-1`, and `TEN-1` is what writes the seam.

**A seam change does not parallelize.** When the owner changes the contract, the consuming pillar waits
— that is a sequencing decision, recorded in **In flight** with its reason, exactly as the
chunk-2/`v1-30b` collision was. `TEN-1` is the clearest live case: it introduces one household-scope
seam that every pillar's DAL calls change through, so it wants to land **before** the pillars that
consume it, not beside them.

## Standing debts worth seeing here

Not a duplicate of [tech-debt.md](./tech-debt.md) — only the items that change what a session should
do next.

- ✅ **`SEC-5` — the production audit is now a CI gate** (`audit:check` in `quality`). Four advisories
  had reached `main` with CI green, every one found by a local run during unrelated work rather than
  by CI (#182, #222, #227, #235). **Still a debt:** nothing audits the **full** tree automatically —
  that is `SEC-5b` — and there is no suppression mechanism, so an unfixable production `high` reds
  every PR until `SEC-5c` exists.
- **The Neon-branch migration apply is still not wired.** Do not cite it as a safety argument. And
  **re-scope it before building it** — it branches production, which with a second family would clone
  their data into a CI-reachable database; it must branch the `mat-plan-preview` project or an
  anonymized snapshot (OPS-1, [tech-debt](./tech-debt.md)).
- **`e2e` is not a required check** and branch protection is off, so "CI green" is held by review, not
  by GitHub.

## Recently landed

The full list is [status.md](./status.md)'s changelog. The last few, for orientation:

| PR              | Pillar              | What                                                               |
| --------------- | ------------------- | ------------------------------------------------------------------ |
| #283            | Platform            | DX-5(b): the three local-only gates run in CI, each seen red first |
| #261 + closeout | Platform            | OPS-1: previews isolated from production, 440 old previews purged  |
| #227            | Platform            | 11 of 13 audit findings cleared, nine without an override          |
| #226            | Product & Spec      | The Authoring spec, reversed by its own panel                      |
| #225, #223      | Platform            | The `write-spec` skill, then its derivation traps                  |
| #224, #218      | Product & Spec      | ADR 0005 — workouts become data                                    |
| #216            | Onboarding & Access | A public landing page at `/`                                       |
