---
feature: Day writers and reads (FAM-1 lane E)
owns:
  - packages/db/src/writers/day/
  - packages/db/src/queries/day/
  - packages/db/scripts/verify/day.ts
---

# Day writers and reads

**Read this before adding or changing how a program row is logged, changed or read back for a
day.** This is **lane E** of the [FAM-1 plan](../plans/fam-1-family-program.md) (§5, "Lane E").

## What this is

An athlete ticks a row of a workout and it is logged: one writer for every tracking type, a second
that changes a logged row's numbers, and the resolver that turns an athlete and a day into the
`DayPlan` the day page shows. The lane starts when the plan's migration 4a-ii is applied.

🚧 **Written at step 0b, before the lane's first step.** It names the lane's directories and the
rules it starts under. Each step below adds its files, its diagram and its invariants here.

## The map

| Step | Adds                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------- |
| 11a  | `writers/session-rows.ts`, extracted from the strength writer. A seam: it owes [write-path.md](./write-path.md). |
| 11b  | `writers/day/log-row.ts`, the one row writer. It also edits `writers/hide.ts`, a seam shared with lane S.        |
| 12a  | `queries/day/{day-plan,previous}.ts`: the day resolver and PREVIOUS.                                             |
| 11c  | `writers/day/amend-row.ts`: Change.                                                                              |
| 14   | The export. Seams: `apps/web/lib/dal/export.ts`, `queries/export-month.ts`, `packages/shared/src/csv/`.          |

## Files

| File                                   | What it is for                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/day/index.ts` | A placeholder so the directory exists. The first real module may replace it.                                  |
| `packages/db/src/queries/day/index.ts` | The same, for the reads.                                                                                      |
| `packages/db/scripts/verify/day.ts`    | The lane's `db:verify` proofs. Its header lists what each step owes and how to compare a read with a fixture. |

## Invariants

1. 🔴 **New files go in these three paths. Anything else the lane touches is a seam** with a merge
   order in the plan's §6 table: `session-rows.ts`, `hide.ts` and the export files owe
   [write-path.md](./write-path.md) or [delete-and-restore.md](./delete-and-restore.md), one PR in
   review at a time with lane S. The lane never edits `schema.ts`; a missing column is a **column
   request** to lane A.
2. 🔴 **The resolver deep-equals every `DayPlan` fixture.** Step 12a seeds the state each fixture
   describes, with hand-written timestamps, and compares through
   `scripts/verify/normalize-fixture.ts`. The shapes and fixtures are
   [the contract's](./program-contract.md); a shape that is wrong or short is a contract change,
   not an edit here.
3. 🔴 **The prescribed text a row is frozen against comes from one renderer**,
   `@mat-plan/shared/program/prescribed-text`. The day page, the row's snapshot and the export all
   call it.
4. **Every refusal is a typed `RowResult`, never a throw**, and the reasons are the contract's
   `ROW_REFUSALS`. The preview route's fake answers the same reasons by the same rules
   (`apps/web/app/design/program/fakes.ts`), so a difference between the two is a bug in one.
5. **Every proof goes in `verify/day.ts`**, never in `verify.ts` or another lane's module.
6. **Start on open, merge on applied** (plan §6).
7. **[write-path.md](./write-path.md)'s invariants still apply to these files**, though the guide
   gate no longer sends a PR there: ownership proven by `public_id` inside the transaction (2), the
   writer shared with `db:verify` (3), and idempotency by a client id, a database UNIQUE and
   `ON CONFLICT` (5).

## Changing it

Start from the step's row in the plan (§5) and the decisions it cites (D3 and D20 for how a row is
stored, D7 for a logged day, D13 for an empty ✓, D18 for a replay after Clear day). Re-run
`pnpm db:verify` and `pnpm db:mutations`.
