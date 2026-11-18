# FAM-1 6d-ii: an athlete's program order

Lane P's step **6d-ii**, the second half of row 6d ([fam-1-family-program.md](./fam-1-family-program.md)
§5, Lane P; split under the overnight delegation, 2026-11-18, as recorded in [6d-i's plan](./fam-1-6d-i-take-off.md)). One writer,
`reorderPrograms`, in `packages/db/src/writers/program/reorder-programs.ts`, behind
`DayActions.reorderPrograms`. Step 15c (lane C) wires it.

- **Gates:** #601 (merged: `currentPrograms` orders `(rank, idx, id)` and returns each program's
  placing row) and **6d-i (#617)**, for the shared `lockAthletes`. The code is written after #617
  merges; this plan can be panelled now.
- Roadmap alignment (2026-11-18): advances FAM-1 lane P; gates 15c; touches no `ID-1` item.

## What it does

The contract: `programOrderSchema` and `DayActions.reorderPrograms` (`packages/shared/src/program/`):
the full order, **a permutation of the athlete's `DayPlan.currentPrograms`**, each program once.
The preview fake (`apps/web/app/design/program/fakes.ts`, `reorderPrograms`) answers in this order,
and so does the writer:

1. **Parse** `programOrderSchema`; otherwise `invalid`. `today` is an ISO day the caller passes.
2. **Lock** the athlete through `lockAthletes(tx, scope, [profilePublicId])` (live, not archived,
   in the household); otherwise `not_found`. **No block lock**: a reorder writes no program's rows,
   and locking several blocks in no fixed order would bring back a deadlock with `putOn`. The lock
   order stays acyclic: `putOn` and `takeOff` take a block, then the profile; this takes the profile
   alone. Lane guide invariant 12 is reworded to say so (reviewed, not proven: PGlite has one
   connection).
3. **The athlete's current programs**, through lane E's `dayAssignments` and `currentPrograms` (the
   day page's own rule). The list must be exactly a permutation of them: one left out, one added, or
   another athlete's program is `invalid`.
4. **Write through ONE band helper** (ADR 0007 A2 §7, "one shifted-band writer"):
   `placeAssignments(tx, profileId, first: blockId[])` in `assign.ts`, in the caller's one
   transaction (`shift-band.ts` requires it).
   - **It reads the athlete's open set itself**, after the profile lock, with exactly the order
     index's predicate (`profile_id = $1 AND active_to IS NULL AND deleted_at IS NULL`, no block
     join). `dayAssignments` drops a hidden program's rows, so a set read there would let an open row
     on a hidden block collide.
   - **Final places are computed over that whole set**: the rows of `first`'s programs take 0..k-1 in
     that order, then every other open row in `(idx, id)` order. **Only rows whose `idx` changes go
     into the band and are written** (putOn's rule today), so a row already in place keeps its `ctid`
     and "unchanged writes nothing" needs no special case.
   - It returns the open count, which `putOn` uses: **a reopen clears `active_to` and sets `idx` to
     that count in ONE update, after the helper runs** (as `assign.ts` does now; mutation
     `put-on-reopens-before-closing-the-gap`), and an insert takes the same next free place. The
     new-assignment placement PR (the maintainer's call on A2 §7) is its next caller and needs only
     `first`.
   - **The rows a reorder places** are each listed program's placing row whose rank is 0 (open or
     upcoming), by `currentPrograms`' own rank, exported from `queries/day/day-plan.ts` rather than
     re-typed. A row with a last day keeps its row untouched (same `ctid`), per Amendment 5.
5. **Unchanged writes nothing**, proved by `ctid`: a second identical call is the replay proof.

## For step 15c (lane C)

- **The route (the board, 2026-11-18):** a program-DAL function in `lib/dal/program/` that lane
  C's day actions call. NOT by widening `DAY_DAL_MAY_IMPORT` (`program-tables-stay-dark.test.ts`)
  or `lib/dal/day/importers.test.ts`: the day DAL keeps its single lane P import.
- **The signature:** `(exec, scope, input: unknown, today): Promise<ProgramResult>`, one
  transaction, throwing on a `today` that is not an ISO day, as its siblings.
- **The words** are `ProgramResult`'s, not `RowResult`'s. **`invalid` also means "the list is
  stale"** (a put on or take off elsewhere, or midnight passing): the dialog should reload, not mark
  a field.
- **Revalidate** the day page, the program page and Home: `athletesOnPrograms` and
  `readProgramsByAthlete` read the same order.

## Files

- N `packages/db/src/writers/program/reorder-programs.ts`: `reorderPrograms`.
- E `packages/db/src/writers/program/assign.ts`: `placeAssignments`, taken out of `putOn` (its
  compaction, reopen and insert); the files row lists `lockProgram`, `lockAthletes` and it.
- `currentPrograms`' rank is exported by lane E, in its C37 change to `day-plan.ts` (the board,
  2026-11-18: one lane in that file); 6d-ii imports it.
- E `packages/db/src/schema.ts`, the `programAssignments` docblock: a **board-granted, comment-only
  guest edit** (lane A is paused; lane E made one in the same docblock in #601). "A reorder writes
  the place onto that row" becomes Amendment 5's rule: a row with a last day is never moved.
- E mutation patches whose context moves with the extraction: 402–409, 412–414, 417, re-cut after
  rebasing on #617, each still red on its own proof; 407 and 412 then break `placeAssignments`.
- E `shift-band.ts`'s and `lockAthletes`' docblocks (the program order is now; the reorder locks the
  profile alone), and invariant 11 (`putOn` and `reorderPrograms` share `placeAssignments`).
- E `packages/db/src/writers/program/index.ts`'s docblock and guide invariant 6 (not
  `packages/db/src/index.ts`, which is outside lane P's paths; its `export *` already publishes it): "the writers behind `ProgramActions` and `DayActions.reorderPrograms`".
- E `packages/db/scripts/verify/program.ts`: `verifyReorderPrograms`.
- E `packages/db/src/writers/program/owed.test.ts`: the last 6d line closes by pointing at
  `verify/schema.ts`'s FAM-1 5 proof ("two open assignments at one place are refused"), which
  already proves the index, plus 6d-ii's own swap proof.
- E `docs/features/program-writers.md`: map row 6d-ii, a files row, an invariant, invariant 12's
  sentence.
- E `docs/privacy/data-inventory.md`: `program_assignments.idx` gains a writer.
- N changelog fragment.

## Tests (`db:verify`, in households of the proof's own)

- **The swap:** A=0, B=1, C=2 reordered to `[B, A, C]`: B=0, A=1, and C keeps its `ctid`. Without
  the band, A's write to 1 hits `uq_program_assignments_profile_idx`.
- **A program with a last day** (take off leaves the order uncompacted): C closed at 0, A=1, B=2;
  `[C, B, A]` stores B=0, A=1; C's `ctid` is unchanged; the read is `[B, A, C]`.
- **A hidden program's open row in the middle:** put on A, then H, then B, hide H (A=0, H=1, B=2);
  `[B, A]` stores B=0, A=1, H=2. Without the full open set, A's write to 1 collides.
- **An upcoming program** (starts tomorrow) is accepted and placed.
- **`invalid`:** a non-uuid; a repeat (the schema); one left out; one added; another athlete's
  program; another household's program; a hidden program they still have an open row on; a program
  left before today; an athlete with no current programs.
- **`not_found`:** an archived, removed, unknown or other-household athlete. Each writes nothing
  (`assignmentRows`' `ctid`).
- **Upper-case ids** are accepted (the parsed draft's ids are read).
- **The replay:** a second identical call answers `ok` and writes nothing (`ctid`).
- **`putOn`** still compacts, reopens and inserts through `placeAssignments` (6c-i's proofs, with the
  re-cut patches red).

Mutation patches from lane P's 520–539 block (535 onward): one per refusal, the band, the closing-row
rule, the hidden-row rule and the unchanged rule.

## Known gaps, not this PR's

- **The day fake keeps a program with a last day where the list put it** (`fakes.ts`
  `reorderPrograms` sets `plan.currentPrograms = ordered`), while the writer and #601's read put it
  last: `[C, A, B]` reads back C, A, B from the fake and A, B, C from the database. It goes to the
  contract owner with C37 (the fake sorts a program ending today last).
- **Lane E's 12a-ii stand-in** replays its `order` change by a direct `idx` update
  (`verify/day-plan.ts`); once this lands, lane E swaps it for `reorderPrograms`.

- **The day fake's `reorderPrograms` accepts an archived athlete** (`fakes.ts`: `mine` checks the id
  only), while the writer answers `not_found`. `DayPlan` carries no archived field (invariant 24), so
  the fake cannot match. It is raised with the contract owner.
- `programOrderSchema` has no `.max`, and the number of programs is uncapped (invariant 30): the
  band's "far past any real place" holds for any realistic list.

## Review-response log

The panel (correctness, db-safety, architecture/scope; opus) on 9da111ff.

| Lens                            | Finding                                                           | Verdict    | What changed                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| db-safety P1, architecture P1   | who reads the band's rows; a caller-side read collides            | **agreed** | the helper reads the open set itself, with the index's predicate                                                                                                |
| architecture P1, correctness P1 | the reopen and insert against the helper                          | **agreed** | reopen and insert after the helper, one update; the new-placement PR named                                                                                      |
| architecture P1, correctness P1 | the putOn patches whose context moves                             | **agreed** | listed, re-cut after #617, each still red                                                                                                                       |
| architecture P1                 | 15c cannot import the writer from the day DAL                     | **agreed** | "For step 15c": the program DAL or a seam turn                                                                                                                  |
| correctness P1                  | the hidden-row test could pass without the rule                   | **agreed** | the hidden row in the middle                                                                                                                                    |
| db-safety P2, correctness P2    | banding every open row rewrites rows in place                     | **agreed** | only changed rows move; a `ctid` check on an unmoved row                                                                                                        |
| correctness P2                  | which rows move, spelled apart from the read's rank               | **agreed** | `currentPrograms`' rank exported and used                                                                                                                       |
| correctness P2                  | the `[C, A, B]` test could be a no-op                             | **agreed** | C closed at 0, A=1, B=2                                                                                                                                         |
| correctness P2                  | missing boundary tests                                            | **agreed** | the seven added                                                                                                                                                 |
| db-safety P2, correctness P2    | the fake disagrees on a program ending today                      | **gap**    | Known gaps, to the contract owner with C37                                                                                                                      |
| db-safety P2                    | the lock rule should be stated, not argued case by case           | **agreed** | invariant 12: every writer of `program_assignments` takes the athlete's `profiles` lock (after the block, if any) before it reads or writes that athlete's rows |
| architecture P2                 | `schema.ts`'s reorder sentence; lane E's stand-in; doc rewordings | **agreed** | Known gaps and Files                                                                                                                                            |
| architecture P2                 | the "D16" citation                                                | **fixed**  | cites 6d-i's plan                                                                                                                                               |
| architecture P2                 | `packages/db/src/index.ts` is outside the lane                    | **fixed**  | dropped                                                                                                                                                         |
