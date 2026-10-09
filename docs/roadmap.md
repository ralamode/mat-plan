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

| Pillar                      | Owns                                                                                                                                               | Ids                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Onboarding & Access**     | `app/(landing)/`, the gate, sign-in, empty states                                                                                                  | `ONB-*` `AUTH-1` `OSS-*` `SEC-1` `SEC-6` `PRIV-1`                                                    |
| **Profiles & Tenancy**      | `lib/dal/profiles.ts`, household scoping, `app/p/` shell                                                                                           | `PROF-1` `TEN-*` `DAL-*`                                                                             |
| **Logging & Measurement**   | [strength-logging](./features/strength-logging.md) + [write-path](./features/write-path.md) guides                                                 | `V1-19` `V1-24` `V1-26..30` `GAP-*` `SET-1` `UI-1` `DUALS-*` **`PICK-1`** `PICK-2` `AI-1` _(parked)_ |
| **Authoring & Scheduling**  | [programming](./features/programming.md) guide, `prescriptions`, `routine_config`                                                                  | `V1-18` `V1-20` `V1-22` `SCHED-*` `CLONE-1` `RETIRE-1` `CAT-*` `SHARE-1`                             |
| **Insight** (read & export) | `V1-16` charts, aggregation kernel, `lib/dal/export.ts`, the CSV contract                                                                          | `V1-16` `CSV-1` `MOT-*` `DASH-1` `HIST-1` `COACH-1` `PUB-1` `SOCIAL-1`                               |
| **Platform**                | `.github/workflows/`, `.claude/`, hooks, deps, the migrations runner                                                                               | `OPS-*` `DX-*` `SEC-2..5c` `TEST-*` `EVAL-0` _(incl. `DX-1`)_                                        |
| **Product & Spec**          | `docs/decisions/`, `docs/specs/`, `docs/milestones/`, `AGENTS.md`, the design system (`docs/design.md` + the tokens in `apps/web/app/globals.css`) | `UI-2..4` _(the design system; the rest are ADRs and specs, not backlog rows)_                       |

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
| **ADR 0006** — household addressing | Product & Spec         | **✅ Accepted 2026-10-07 (#252): option A, session-only**, superseding [HH-1](./plan.md#hh-1)'s path clause and nothing else. It was **TEN-1's chunk 0**, so Beta 0's critical path (`TEN-1` → `AUTH-1`) is unparked; chunks `1a` and `1b` are landed and its four named obligations are discharged (the picker proved on two households, `force-dynamic` + the cache rule pinned, the miss-path event, the refusal copy promoted to `lib/constants.ts`).                                                                                                                 |
| **AI-1** — NL logging               | Logging & Measurement  | ⏸ **Parked 2026-10-06, pending [`PICK-1`](./plan.md#pick-1) usage data** — prod carries zero ad-hoc entries, so the case it exists for has not been observed once. Not in flight; listed once more so the move is visible, then it leaves this table. _(V1-30b completed and left this table: #234 + #236.)_                                                                                                                                                                                                                                                              |
| **OPS-1** — preview isolation       | Platform               | 🟡 **Repo half merged; dashboard half outstanding.** The guard, `pnpm preview:check` and `migrate-preview.yml` have landed; the Neon preview project, the Vercel scope split, the second Upstash DB and — the part the row's own wording missed — **purging ~100 live preview deployments that still hold the production credentials, then rotating them** are the maintainer's, in nine ordered steps: [runbooks.md](./runbooks.md) → OPS-1 ([plan](./plans/ops-1-preview-isolation.md)). It is **Beta 0 step 1** and it blocks inviting a second family, not a session. |

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

| Pillar                 | Next                                                                                          | Gated on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding & Access    | **`PRIV-2`** — serve the notice at `/privacy`; then `OSS-2` §B                                | Nothing. **`PRIV-1` is done** (2026-10-07) — notice, retention policy, deletion procedure and the rewritten threat model are in [docs/privacy/](./privacy/). `AUTH-1` now waits on **`TEN-1` and `PRIV-2`**: its Clerk/Google consent screens need a privacy-policy URL on the app's own domain, and a `docs/` file is not one. ⚠️ `PRIV-2` is **not** a one-file PR — no markdown pipeline exists, so it generates the page from `notice.md` with a drift test rather than keeping two copies of a privacy notice ([plan](./plans/priv-1-privacy-review.md)). ✅ `OSS-1`'s rename is **done** (2026-10-08) — PRIV-1 re-scoped it from 3 files to ~50 and raised it to a Beta 0 blocker; the real surface was 57 files / 309 occurrences and is now 1 (a comment in an applied migration, which the forward-only guard forbids editing). Forward exposure only — history was not rewritten ([§9](./privacy/data-inventory.md)). **`ONB-0` is done** (2026-10-07) — first run no longer inherits the maintainer's household's routine, and `PROF-1` now owns the "add an athlete" control the empty state only explains.                                                                                                                                                                                                                                                           |
| Profiles & Tenancy     | `TEN-1`                                                                                       | **Nothing — it is running, and the gate is CLOSED.** [ADR 0006](./decisions/0006-household-addressing.md) (its chunk 0) is Accepted, `1a` (the dark `households.synthetic` column) and **`1b` (the scope seam) are landed**: `getHouseholdScope()` exists, `isLiveProfile` requires a `HouseholdScope`, and `db:verify` proves two households cannot read or write each other through the picker, both scoped reads and all three amends. **`1c`** converts the remaining five predicate sites; **`1d`** adds the structural guard, the corrections and the `findOrCreateMovementId` → `TEN-2` verdict. It is a **seam change**, so it lands before the pillars that consume it, not beside them. Unblocks `AUTH-1` — which still owns _authorization_: `TEN-1` buys consistent scoping, not a principal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Logging & Measurement  | **[`PICK-1`](./plan.md#pick-1)** — the movement picker                                        | Nothing. `V1-30b` is **complete** (#234 + #236), so this lane is free. It is **not a P0** — the hazard is latent, not live — and it is the pillar's next item because the only way to name an unprescribed movement is a free-text box that mints a catalog row on a near-miss. It needs a plan + panel of its own before code. **`AI-1` is parked behind it** (2026-10-06): prod's 49 entries carry zero ad-hoc movements, and only the picker makes that case cheap enough to measure. `V1-26` / `V1-33` follow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Authoring & Scheduling | Chunk 1                                                                                       | Nothing. `SCHED-1` waits on the scheduling ADR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Insight                | `V1-16`                                                                                       | Nothing. `DASH-1` / `COACH-1` are later ideas (#221).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Platform               | **`OPS-1`'s runbook**, then `DX-5(b)`                                                         | OPS-1's repo half is merged and its **dashboard half needs the maintainer, not a session** ([runbooks.md](./runbooks.md) → OPS-1) — it is Beta 0 step 1 and gates inviting a family. Then nothing: `SEC-5` ✅ shipped the audit third of `DX-5(b)`, leaving `skills:check`, `guards:test` and `status:check`, which need their own plan and panel. `SEC-5b` (the daily full-tree audit) is gated on confirming a failed scheduled run reaches a human; `SEC-5c` (the allowlist) is built on first need.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Product & Spec         | **A SCHED-1 plan**, on [ADR 0007](./decisions/0007-scheduling-model.md), then `UI-4` → `UI-3` | Nothing. The scheduling ADR is written and panelled: recurrence is a weekday set as rows (no RRULE), rotation becomes an anchor + ordered list **on the block** and stays calendar-indexed, dueness is derived and the day's verdict is recorded **and snapshots what it judged**. ⚠️ **It authorizes two tables, not five** — the assignment row and the weekday rows; rotation slots and the `workouts` arc have recorded shapes and no authorizing row. `SCHED-1` starts on those two; **`MOT-1` ships WITH the verdict table**, not behind a derived-only era; **V1-22 A4 splits** (a new day has an interim needing no schema — eight unused `DAY_ROLES` codes — while a new block waits on the one-block→N-assignments read, which is byte-affecting for the CSV). ⚠️ **`CAT-2` was never gated on this** — its own row gates it on the movement-list review, and this table said otherwise. **`UI-4`** (the light/dark switch) lands **before `UI-3`** (the reskin), because reskin options must be reviewable in both themes — and dark mode is defined but unreachable today (a 33-line `.dark` palette, nothing sets the class, no `prefers-color-scheme` fallback). Both are **seams**, so neither parallelizes. Neither is a P0. **[ADR 0006](./decisions/0006-household-addressing.md) is written and proposed** (2026-10-07) — it needs a signature, not a session. |

⚠️ **This table is the membership test, and it has already failed once.** `AI-1`, `PRIV-1` and `DX-1`
sat in `plan.md` for weeks while belonging to **no** pillar — so this file claimed to be the
cross-program view and silently was not. A backlog row in no pillar is invisible here, which is the
one failure it cannot afford. Adding a row to `plan.md` means putting its id in a pillar above, or
saying in the row why it has none.

## Seams — where two pillars must agree

Pillars are disjoint **file globs**, which is what makes them parallel-safe. These are the places two
of them nonetheless touch one contract, so a change on either side is a change to both. **Each seam
has one owner**; the other pillar consumes it and does not redefine it.

| Seam                                           | Pillars                        | Owner                                                        |
| ---------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| The log form's submit schema + `ScaffoldRow`   | Logging ∩ Authoring            | **Logging** — Authoring chunk 2 adds a prescription id to it |
| `lib/dal/` household scoping                   | Tenancy ∩ Authoring ∩ Profiles | **Tenancy** (`TEN-1`'s single scope seam)                    |
| `packages/shared/src/units.ts` dimension words | Logging ∩ Measurement          | **Logging** (`v1-30b`'s `QUANTITY_FIELD_WORD`)               |
| `ROUTINE_CATALOG` — membership, default, offer | Authoring ∩ Insight            | **Authoring** (`CAT-1`); adherence counts consume it         |
| The byte-faithful CSV contract                 | Authoring ∩ Insight            | **Insight** (`docs/csv-export-contract.md` + golden files)   |
| The design tokens + the `.dark` class          | **every** pillar with a screen | **Product & Spec** (`UI-3` reskin, `UI-4` the switch)        |

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
- 🟡 **OPS-1's dashboard half is outstanding**, so a Vercel preview still reaches production data and
  credentials until [runbooks.md](./runbooks.md) → OPS-1 is executed. This is the one standing debt
  that is a _live_ exposure rather than a latent one.
- **`e2e` is not a required check** and branch protection is off, so "CI green" is held by review, not
  by GitHub.

## Recently landed

The full list is [status.md](./status.md)'s changelog. The last few, for orientation:

| PR         | Pillar              | What                                                      |
| ---------- | ------------------- | --------------------------------------------------------- |
| #227       | Platform            | 11 of 13 audit findings cleared, nine without an override |
| #226       | Product & Spec      | The Authoring spec, reversed by its own panel             |
| #225, #223 | Platform            | The `write-spec` skill, then its derivation traps         |
| #224, #218 | Product & Spec      | ADR 0005 — workouts become data                           |
| #216       | Onboarding & Access | A public landing page at `/`                              |
