# FAM-1 6d-iii: where a put-on program goes in an athlete's order

Lane P's step **6d-iii** ([fam-1-family-program.md](./fam-1-family-program.md) §5, Lane P; D41). One
writer changes: `putOn`, in `packages/db/src/writers/program/assign.ts`. Today it puts every program it
adds or reopens **last**; D41 makes it follow ADR 0007 A2 §7 and the maintainer's reopen call.

- **Decided** (D41, the maintainer, 2026-11-18):
  - a newly added program takes its place by the household's Programs-list order ("Keep household order (ADR)");
  - a Put on that undoes a same-day Take off keeps the place the program had ("Its previous place").
- **Left to this plan** (D41): what happens when another Put on has taken that place since. Proposed below (§ "The reopen"), for the panel and the maintainer.
- **Gates:** #633 (6d-ii), which makes `placeAssignments` the one band writer this builds on. Step 15c waits for 6d-iii; step 15 does not (the row).
- Roadmap alignment (2026-11-18): advances FAM-1 lane P (D41); gates 15c; touches no `ID-1` item.

## What it does

The contract's rule is the preview fake's (`apps/web/app/design/program/fakes.ts`, `putOn`), which
already follows the ADR. The household's Programs list is in the order the programs were made
(`readProgramList`, `programBlocks.id` ascending).

### A newly added program

It goes **before the first of the athlete's programs that comes later in the Programs list**, or last
when none does. That is the fake's `keeps.findIndex((kept) => rank(kept) > rank(view.name))`.

- The athlete's own order of the others is kept, so an unrelated Put on never swaps two programs (the row's acceptance).
- When the athlete has reordered, "later in the list" is read against THEIR order, as the fake does: it lands before the first later one they keep, wherever that sits.
- **The write:** the new row is inserted at a parking place far past any real one (`2 × SHIFT_BAND`, so it meets neither a placed row nor the band). Then `placeAssignments(tx, profileId, desiredOrder)` writes every place in one pass, through the band.
- The weekday rows, the start day and the skip of an athlete already on it are unchanged from 6c-i.

### The reopen (a Put on the day of a Take off)

**The proposal: a program ending today keeps holding its place until it is reopened or the day
ends.**

- Today, Take off leaves the closed row's `idx` where it was. The next Put on's compaction then closes the gap, and a later reopen can no longer tell where it was.
- With this change, when `putOn` computes places it orders the athlete's open rows **and their rows ending today** together, by `(idx, id)`, inserts any new program by the rule above, and numbers the whole sequence 0, 1, 2…
- It writes the open rows' places (through `placeAssignments`), and **also the rows ending today**. A closed row is outside `uq_program_assignments_profile_idx`, so writing it never collides.
- A reopen clears `active_to` and keeps that row's `idx`, which is still its place.

What that gives:

| Case                                               | Result                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Take off B, then straight back on                  | B where it was (nothing moved).                                             |
| Take off B; Put on D (later in the list); reopen B | A, B, C, D: B where it was.                                                 |
| Take off B; Put on D (FIRST in the list); reopen B | D, A, B, C: B still after A. Without the held place it would land before A. |
| Take off B; the athlete reorders [C, A]; reopen B  | B at its held number, among the reordered ones (see "Known limits").        |

**The alternative, rejected:** keep today's compaction and reopen at `min(old idx, open count)`.
That is exact only when nothing moved. In the third row above it puts B before A, which is the
"another Put on took its place" case D41 asks about. Its advantage is that a closed row is never
written; with the proposal, `putOn` writes a closed row's `idx` (only its place, never its days).

The read is unaffected. `currentPrograms` orders `(rank, idx, id)`, so a program ending today reads
after the ones that stay, whatever its number. Gaps in the open rows' numbers (a held place) are
allowed: the index is unique, not dense.

## Files

- E `packages/db/src/writers/program/assign.ts`:
  - `putOn`'s placement (a new program's place, the held place, the reopen);
  - `placeAssignments` gains an optional set of rows ending today to number with the open ones; the reorder (6d-ii) never passes it, so a reorder still never writes a closed row;
  - the docblocks.
- E `packages/db/scripts/verify/program.ts`: `verifyPutOn`'s "last in the order" cases become the household-order ones, and new cases cover the table above.
- E mutation patches whose context moves (406, 407, 412 and 417 at least), re-cut and each still red; new ones from lane P's 570–589 block.
- E `docs/features/program-writers.md`: invariant 11 (the held place) and the files rows; data-inventory (a closed row's `idx` gains a writer).
- E `packages/db/src/writers/program/seed-fixtures.ts`, only if the seeded orders change (the fixture athletes' programs are put on in list order, so they should not).
- N changelog fragment.

## Tests (`db:verify`)

- **A new program in its list place:** A, C on (list order A, B, C); Put on B → A, B, C; A and C keep their order.
- **First and last:** a program earlier than every kept one goes first; a later one goes last.
- **Against a reordered athlete:** they keep [C, A] (reordered); Put on B → [B, C, A]. The fake puts B before the first kept program later in the list, and C (list place 3) is later than B (2).
- **No swap:** a Put on of one program never changes the relative order of two others.
- **The reopen:** each row of the table above, plus a reopen with a start to come.
- **Replays:** an already-on athlete is skipped and writes nothing (`ctid`).
- `putOn`'s other 6c-i proofs stand (refusals, weekdays, the start day).

## Known limits

- **After a same-day reorder**, a held place is a number among reordered rows: the reopen lands there, which may not be where the athlete would put it. The reorder dialog (15c) lists a program ending today separately, so the athlete sees it.
- **The day ending:** a row that ended yesterday no longer holds a place; the next placement closes the gap, as today.

## Open question (for the panel, then the maintainer via the board)

Accept the held place (recommended), or the simpler `min(old idx, count)` reopen? The held place
writes a closed row's `idx` from `putOn`.

## Review-response log

_The panel has not run yet._
