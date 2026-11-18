# FAM-1 6d-ii: an athlete's program order

Lane P's step **6d-ii**, the second half of row 6d ([fam-1-family-program.md](./fam-1-family-program.md)
§5, Lane P; split under the overnight delegation, D16, 2026-11-18). One writer,
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
   `placeAssignments(tx, profileId, ordered)` in `assign.ts`, which `putOn`'s compaction and reopen
   also call.
   - **Every** open, live row of the athlete moves into the band, not only the listed ones (`putOn`'s
     set). `dayAssignments` drops a hidden program's rows, so an open row on a hidden block could
     otherwise still hold a place and collide on the order index.
   - The listed programs' open or upcoming rows get `idx` 0..n-1 in their relative order in the
     list. Any unlisted open row (a hidden program's) follows, in `(idx, id)` order.
   - **A row closing today is left untouched** (same `ctid`), per Amendment 5: its row no longer
     moves, and #601's rank shows it after the ones that stay, wherever the list put it.
5. **Unchanged writes nothing:** when every placed row's `idx` already equals its position, nothing
   is written, proved by `ctid`.

## Files

- N `packages/db/src/writers/program/reorder-programs.ts`: `reorderPrograms`.
- E `packages/db/src/writers/program/assign.ts`: `placeAssignments`, taken out of `putOn`.
- E `packages/db/src/writers/program/index.ts`, `packages/db/src/index.ts`'s comment, and guide
  invariant 6: "the writers behind `ProgramActions` and `DayActions.reorderPrograms`".
- E `packages/db/scripts/verify/program.ts`: `verifyReorderPrograms`.
- E `packages/db/src/writers/program/owed.test.ts`: the last 6d line closes by pointing at
  `verify/schema.ts`'s FAM-1 5 proof ("two open assignments at one place are refused"), which
  already proves the index, plus 6d-ii's own swap proof.
- E `docs/features/program-writers.md`: map row 6d-ii, a files row, an invariant, invariant 12's
  sentence.
- E `docs/privacy/data-inventory.md`: `program_assignments.idx` gains a writer.
- N changelog fragment.

## Tests (`db:verify`, in households of the proof's own)

- A reorder of two open programs is stored, and `currentPrograms` answers it. The swap reverses two
  open rows, so a writer without the band hits `uq_program_assignments_profile_idx`.
- `[C (closing today), A, B]`: A and B are stored 0 and 1, C's row keeps its `ctid`, and the read
  still ends with C.
- An open row on a hidden program does not collide, and keeps a place after the listed ones.
- `invalid`: a non-uuid; a repeat (the schema); one left out; one added; another athlete's program.
- `not_found`: an archived, removed, unknown or other-household athlete. Each writes nothing
  (`ctid`).
- An unchanged order writes nothing (`ctid`).
- `putOn` still compacts and reopens through `placeAssignments` (6c-i's proofs, unchanged).

Mutation patches from lane P's 520–539 block (532 onward): one per refusal, the band, the closing-row
rule, the hidden-row rule and the unchanged rule.

## Known gaps, not this PR's

- **The day fake's `reorderPrograms` accepts an archived athlete** (`fakes.ts`: `mine` checks the id
  only), while the writer answers `not_found`. `DayPlan` carries no archived field (invariant 24), so
  the fake cannot match. It is raised with the contract owner.
- `programOrderSchema` has no `.max`, and the number of programs is uncapped (invariant 30): the
  band's "far past any real place" holds for any realistic list.

## Review-response log

The panel runs on this plan before any implementation is committed.
