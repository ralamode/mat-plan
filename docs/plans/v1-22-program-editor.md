# V1-22 — the program editor: author programming without a deploy

> Backlog: [plan.md](../plan.md) row **V1-22** _(new)_. Branch: `feat/v1-22-program-editor`.
> **PLAN ONLY — not yet panelled.** Supersedes the authoring half of **V1-20**.
> Evidence: [youth-daily-program](../samples/youth-daily-program/README.md) (a second real program, and
> the harder one). Depends on **SCHED-1**; informs **ONB-1**.

## Goal

**Changing a single load today means editing TypeScript and deploying.** Verified: `PROGRAM_SEED`
(`packages/shared/src/programming.ts:162`) → `packages/db/src/seed.ts` is the **only** writer of
`prescriptions` and `prescription_targets` — there is no write path anywhere in `apps/web`. The V1-18
editor at `/p/[profileId]/routine` edits the _daily routine_ (which activities, in what order); it does
not touch the strength program at all.

This PR gives the coach a screen to author a program — its movements, sets, target reps, and per-athlete
loads — and to assign it to one athlete or several. It is the missing half of the product: the app can
_log_ against a program and _display_ one, but a human cannot _write_ one.

## Acceptance

- A coach can create a block, add/reorder/remove prescriptions within a `day_role`, and set
  `sets` / `target_reps` — no deploy.
- Per-athlete **loads and reps overrides** are editable on the same screen, with a visible per-athlete
  column, because that is the only thing that differs between Ray's two kids today.
- A block can be **assigned to one athlete or to several**, which is the "group or individual" ask.
- Editing is **BOLA-scoped**: a coach can only reach blocks in their own household, re-verified in the
  DAL on every read and write.
- The **LLM authors nothing** here. This screen is where a human types a load; that is its whole point.
- Existing seeded programs keep working unchanged — the editor writes the same tables the seed does.

## The decision this plan exists to force

**Two scopes, and they are not the same PR.**

|                            | Scope                                                                                                     | Size                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **A — edit what exists**   | CRUD over `prescriptions` + `prescription_targets` within the shipped schema. No migration.               | ~1 PR                         |
| **B — author any program** | A: plus an assignment model, a third schedule shape, and the measurement shapes GAP-3 is still designing. | A migration + SCHED-1 + GAP-3 |

**Recommended: A first, deliberately.** It removes the deploy-to-change-a-load problem — the actual pain
— using tables that already exist, and it is testable today. B is not blocked by taste but by two
unbuilt dependencies, and building the editor twice is cheaper than building it once and wrong.

**What A cannot do, stated plainly so it is not discovered later:** it cannot author the daily A/B
program in [`samples/youth-daily-program`](../samples/youth-daily-program/README.md). That program needs
session-indexed rotation (SCHED-1's missing third shape), three simultaneous load slots on Stance in
Motion (GAP-3), and a box-height field (no length dimension exists). **A coach could author Ray's
weekday block with A; they could not author the program his kids actually run daily.** That asymmetry is
the argument for B, and the reason this plan names it rather than quietly shipping A as "the program
editor".

## Shape

### Route

`/p/[profileId]/program` is **wrong** — a block is a household object assigned to athletes, not a
property of one. Use **`/programs`** (list) and **`/programs/[blockPublicId]`** (edit), household-scoped,
with the assignment expressed on the block. This is also what makes "group or individual" natural rather
than bolted on: the screen's subject is the program, and athletes are a field on it.

Entry points: a link from each athlete's Today page and from the profile picker — closing the **V1-20**
complaint that the routine editor is URL-only, for this screen from the start.

### The editing surface

A block is a short list per `day_role`. Each row is a prescription:

```
Strength B                                              [ + Add movement ]
 ⋮⋮  1. Med-Ball Slam        sets [4]  reps [5]        Athlete A [15-20 lb ball]  Athlete B [        ]
 ⋮⋮  2. Trap-Bar Deadlift    sets [4]  reps [3 (top triple…)]  Athlete A [~145-150]  Athlete B [        ]
```

- `target_reps` and `load` are **TEXT** and stay so — they carry `AMRAP`, `8-10`, `top triple` losslessly,
  which is the coach's safety cue. This screen is the one place that text is _authored_, so it must not
  be narrowed here. (`parseLoad`'s `PRESCRIPTION_SHAPE` guard keeps those shapes out of the _log_ path;
  that separation is deliberate and stays.)
- Reorder is `idx`, the existing slot key. Note `(block_id, day_role, idx)` is a live-row UNIQUE index,
  so a reorder is a **renumber**, not a swap — see Risks.
- Per-athlete cells write `prescription_targets`; blank means "no target for this kid", which already
  renders as no suggestion rather than the sibling's.

### Assignment

Blocked on SCHED-1's assignment row. Until it lands, a block is household-wide and per-athlete
_targets_ are the only per-athlete thing — which is exactly today's model, so **scope A ships with no
assignment UI** and the "group vs individual" distinction is expressed only through which athletes have
targets. Say this in the UI rather than implying more.

## File-by-file — scope A

| Path                                                       | Change | What                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/program.ts`                       | NEW    | The write core — upsert/reorder/delete a prescription, upsert a target. Single-sourced here so `db:verify` and the DAL run the identical path (the `writeStrengthSession` precedent). |
| `packages/db/src/queries/program-blocks.ts`                | NEW    | List blocks + load one for editing, household-scoped.                                                                                                                                 |
| `packages/shared/src/programming.ts`                       | EDIT   | Zod schemas for the edit payloads, reusing the existing seed-row shapes.                                                                                                              |
| `apps/web/lib/dal/programming.ts`                          | EDIT   | `listProgramBlocks`, `getProgramBlockForEdit`, and the mutating wrappers — auth → ownership → DTO.                                                                                    |
| `apps/web/app/programs/page.tsx`                           | NEW    | Block list (RSC).                                                                                                                                                                     |
| `apps/web/app/programs/[blockPublicId]/page.tsx`           | NEW    | Editor shell (RSC).                                                                                                                                                                   |
| `apps/web/app/programs/[blockPublicId]/program-editor.tsx` | NEW    | The client editor.                                                                                                                                                                    |
| `apps/web/app/programs/actions.ts`                         | NEW    | Server Actions — thin: re-auth, re-authorize, zod, DAL, revalidate.                                                                                                                   |
| `packages/db/scripts/verify.ts`                            | EDIT   | Proofs: BOLA, reorder integrity, idempotent upsert.                                                                                                                                   |
| `apps/web/app/p/[profileId]/page.tsx`                      | EDIT   | Link to the editor (the V1-20 discoverability fix).                                                                                                                                   |

## Test plan

- **Boundary tests are mandatory** (AGENTS.md): unauth → reject · wrong-household block → forbid · bad
  body → zod-reject. These are the first _mutating_ endpoints that write config rather than a kid's own
  log, so a wrong-owner write here edits someone's training.
- **`db:verify`**: a reorder preserves every prescription and leaves `idx` contiguous; a re-run of the
  same edit is idempotent; a second household cannot read or write block rows.
- **Unit**: the reorder/renumber pure function, against the UNIQUE-index constraint.
- **Component**: editing a load writes only that athlete's target; blank clears rather than inheriting.
- **E2E + tri-viewport screenshots** — it is a new screen, so the UX panel is required and the captures
  ship with the implementation PR.

## Risks / rollback

| Risk                                                                                                                                                                       | Mitigation                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reorder collides with `uq_prescriptions_block_day_role_idx`.** Renumbering 1↔2 in place violates the UNIQUE index mid-statement.                                         | Renumber in one statement with a deferred check, or write to a temporary offset band then back. Pin with a `db:verify` proof — this is the single most likely implementation bug. |
| **Editing a block rewrites history's meaning.** A logged session references prescriptions that may since have changed, so "did we follow the program" silently re-answers. | The same class of problem SCHED-1 flagged for streaks, with the same fix: what was _performed_ is already recorded independently. Do **not** add retroactive derivation on top.   |
| A coach edits the wrong athlete's load.                                                                                                                                    | Per-athlete columns are labelled and adjacent; no bulk-fill (ONB-1 R8's _no "fill all", ever_ applies here too).                                                                  |
| Scope A ships and reads as "the program editor" while Ray's daily program still needs code.                                                                                | Named in Acceptance and in the UI; the backlog row carries the B follow-on.                                                                                                       |

**Rollback:** app + one new writer module; no migration in scope A. Revert restores seed-only authoring.

## Out-of-scope / deferred

- **Assignment to athletes** — needs SCHED-1's assignment row (scope B).
- **Session-indexed rotation**, **three-slot loads**, **box height** — SCHED-1 / GAP-3 (scope B).
- **Creating movements** from this screen — `movements.slug` is globally UNIQUE, so multi-tenant
  authoring hard-fails on the second household adding "RDL" (ONB-1's blocking prerequisite).
- **Program import** — ONB-1.
- **Suggesting loads.** Never here. A human types every one.

## Open questions

1. **Scope A or B?** The plan recommends A; it is Ray's call, and B's dependencies make it a multi-PR arc.
2. Does the editor create blocks, or only edit seeded ones, in A?
3. Where does the daily A/B program get authored in the meantime — hardcoded seed, as today?
4. Does editing a `day_role`'s movements need an audit trail, given risk 2?

## Review-response log (adversarial panel)

_Not yet run. Required before implementation: the engineering panel (≥3 lenses, plus a DB-safety
reviewer if scope B's migration is taken) and the UX panel — this is a new screen._
