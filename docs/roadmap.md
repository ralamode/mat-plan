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

| Pillar                      | Owns                                                                                               | Ids                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Onboarding & Access**     | `app/(landing)/`, the gate, sign-in, empty states                                                  | `ONB-*` `AUTH-1` `OSS-*` `SEC-1`                             |
| **Profiles & Tenancy**      | `lib/dal/profiles.ts`, household scoping, `app/p/` shell                                           | `PROF-1` `TEN-*` `DAL-*`                                     |
| **Logging & Measurement**   | [strength-logging](./features/strength-logging.md) + [write-path](./features/write-path.md) guides | `V1-19` `V1-24` `V1-26..30` `GAP-*` `SET-1` `UI-1` `DUALS-*` |
| **Authoring & Scheduling**  | [programming](./features/programming.md) guide, `prescriptions`, `routine_config`                  | `V1-18` `V1-20` `V1-22` `SCHED-*` `CAT-*`                    |
| **Insight** (read & export) | `V1-16` charts, aggregation kernel, `lib/dal/export.ts`, the CSV contract                          | `V1-16` `CSV-1` `MOT-*` `DASH-1` `COACH-1`                   |
| **Platform**                | `.github/workflows/`, `.claude/`, hooks, deps, the migrations runner                               | `OPS-*` `DX-*` `SEC-2..5` `TEST-*` `EVAL-0`                  |
| **Product & Spec**          | `docs/decisions/`, `docs/specs/`, `docs/milestones/`, `AGENTS.md`                                  | — (ADRs and specs, not backlog rows)                         |

Two deliberate departures from the obvious cut, both argued rather than assumed:

- **There is no "Tech Leads" pillar.** Coordination is a role, and a pillar that owns no files cannot
  be assigned, cannot be checked, and becomes the place work goes to be forgotten. The function is
  real and it already has artifacts — ADRs, specs, milestone docs, `AGENTS.md`, and the review panels
  in [`.claude/agents/`](../.claude/agents/) — so it is **Product & Spec**, which owns files.
- **Measurement sits with Logging, not with Dashboarding.** Capture (`GAP-3`'s typed quantities,
  `set-fields.tsx`) and read (`V1-16`'s charts) share no files and almost never move together.
  Grouping them would put the one glob the whole app writes through next to the one nothing writes to.

## In flight

| Item                                 | Pillar                 | State                                                           |
| ------------------------------------ | ---------------------- | --------------------------------------------------------------- |
| **V1-22 Authoring** — chunks 1–6     | Authoring & Scheduling | **Spec landed** (#226). Chunk 1 next. See the table below.      |
| **V1-30b** — the form stops inviting | Logging & Measurement  | Planned (#215), not started. **Goes before Authoring chunk 2.** |

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

| Pillar                 | Next                     | Gated on                                                                                                                   |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Onboarding & Access    | `OSS-1`, then `OSS-2` §B | Nothing. `AUTH-1` waits on `TEN-1`.                                                                                        |
| Profiles & Tenancy     | `TEN-1`                  | Nothing — but it is a **seam change**, so it lands before the pillars that consume it, not beside them. Unblocks `AUTH-1`. |
| Logging & Measurement  | `V1-30b`                 | Nothing — and it now precedes Authoring chunk 2.                                                                           |
| Authoring & Scheduling | Chunk 1                  | Nothing. `SCHED-1` waits on the scheduling ADR.                                                                            |
| Insight                | `V1-16`                  | Nothing. `DASH-1` / `COACH-1` are later ideas (#221).                                                                      |
| Platform               | `SEC-5`                  | Nothing — and it is the gate that missed three advisories.                                                                 |
| Product & Spec         | The scheduling ADR       | Wanted by `SCHED-1`, `CAT-2` and V1-22 A4.                                                                                 |

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

**A seam change does not parallelize.** When the owner changes the contract, the consuming pillar waits
— that is a sequencing decision, recorded in **In flight** with its reason, exactly as the
chunk-2/`v1-30b` collision was. `TEN-1` is the clearest live case: it introduces one household-scope
seam that every pillar's DAL calls change through, so it wants to land **before** the pillars that
consume it, not beside them.

## Standing debts worth seeing here

Not a duplicate of [tech-debt.md](./tech-debt.md) — only the items that change what a session should
do next.

- **`SEC-5` — no workflow runs `pnpm verify`,** so `audit --prod` is not a gate. Three advisories have
  now been found by a local run during unrelated work rather than by CI (#222, #227).
- **The Neon-branch migration apply is still not wired.** Do not cite it as a safety argument.
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
