---
feature: Program writers and reads (FAM-1 lane P)
owns:
  - packages/db/src/writers/program/
  - packages/db/src/queries/program/
  - packages/db/scripts/verify/program.ts
---

# Program writers and reads

**Read this before adding or changing how a program, a workout, a week or an assignment is written
or read.** This is **lane P** of the [FAM-1 plan](../plans/fam-1-family-program.md) (§5, "Lane P").

## What this is

A parent builds a program: named workouts of items, a week of slots, and who is on it. These are
the writers that store it and the reads the builder's screens load. They start when the plan's
migration 4b is applied.

🚧 **Written at step 0b, before the lane's first step.** It names the lane's directories and the
rules it starts under. Each step below adds its files, its diagram and its invariants here.

## The map

| Step | Adds                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 6a   | `writers/program/{create-program,rename-program,save-workout,shift-band}.ts`; `queries/program/{workout,movement-options}.ts`       |
| 6b   | `writers/program/save-week.ts`; `queries/program/week.ts`                                                                           |
| 6c   | `writers/program/assign.ts` (put on); `queries/program/{program-view,program-list}.ts`; fills in `writers/program/seed-fixtures.ts` |
| 6d   | take off and reorder, in `assign.ts`                                                                                                |

## Files

| File                                               | What it is for                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/program/seed-fixtures.ts` | `seedProgramFixtures`: seeds the fixture family's programs with the real writers. Writes nothing until step 6c.           |
| `packages/db/src/writers/program/owed.test.ts`     | The lane's `it.todo` list: the tests steps 6a to 6d still owe the contract. Delete a line in the PR that writes its test. |
| `packages/db/src/queries/program/index.ts`         | A placeholder so the directory exists. The first real module may replace it.                                              |
| `packages/db/scripts/verify/program.ts`            | The lane's `db:verify` proofs. Its header lists what each step owes and how to compare a read with a fixture.             |

## Invariants

1. 🔴 **The lane's files go in these three paths and nowhere else.** It never edits `seed.ts`,
   `writers/ownership.ts` or `schema.ts` (plan §5): those are lane A's. A column the plan missed is
   a **column request** to lane A, added expand-only in its next migration (plan §6).
2. 🔴 **A read deep-equals the contract's fixture.** Seed the state the fixture describes, run the
   query, and compare through `scripts/verify/normalize-fixture.ts`: `workout` with `heavy-a-draft`
   (6a), `program-view` with `family-program` (6c). The shapes and fixtures are
   [the contract's](./program-contract.md); a shape that is wrong or short is a contract change,
   not an edit here.
3. **Every proof goes in `verify/program.ts`**, never in `verify.ts` or another lane's module.
4. **Start on open, merge on applied** (plan §6). A step may be written on top of an open PR it is
   gated on; it merges only when that gate has merged and, for a migration, been observed applied.
5. **[write-path.md](./write-path.md)'s invariants still apply to these files**, though the guide
   gate no longer sends a PR there: ownership proven by `public_id` inside the transaction (2), the
   writer shared with `db:verify` (3), idempotency by a client id, a database UNIQUE and
   `ON CONFLICT` (5), and a create that is replay-first with a named conflict target (12).

## Changing it

Start from the step's row in the plan (§5) and the decisions it cites (D19 for matching a saved
workout to its rows). Re-run `pnpm db:verify` and `pnpm db:mutations`.
