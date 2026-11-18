# FAM-1 6d: Take off, and an athlete's program order

Lane P's step 6d, the plan's row 6d ([fam-1-family-program.md](./fam-1-family-program.md) §5,
Lane P). Two writers in `packages/db/src/writers/program/assign.ts`, beside 6c-i's `putOn`.
Nothing in the app calls them until steps 15 (Take off) and 15c (program order).

Roadmap alignment (2026-11-18): advances FAM-1 lane P; gates 15 and 15c; touches no `ID-1` item
(an athlete's own assignments, inside their household).

## One decision held for the maintainer (H6)

**Where a NEW assignment goes in the athlete's order.** This is `putOn`'s rule, not 6d's, but 6d
changes `assign.ts` and its reorder must agree with it, so it rides here.

- **(a) The Programs-list place** (ADR 0007 A2 §7, the plan's 15c row): the new program is placed
  among the athlete's open programs by the household's program order (the order the programs were
  made, `program_blocks.id`, as `readProgramList` lists them).
- **(b) Last** (#588 as built): the new program goes after every program the athlete has.

The one place it shows: an athlete who reordered their programs (15c) and is then put on a new one.
Under (a) it can land between programs they moved; under (b) it never disturbs their order.

**Either way the change is one function in `assign.ts`** (`placeOf(open, block)`): (a) inserts at
the first open row whose block id is greater, (b) appends. Both go through the band, and the proof
differs in one expected order. This plan is written so the pick is that function and one line of the
proof.

## Take off: `takeOff(exec, scope, input, today)`

The contract: `takeOffSchema` and its docblock (`program-shapes.ts`), ADR 0007 Amendment 4, contract
invariants 21 and 31. It answers `{ ok: true, lastDay }`, or a refusal.

1. **Parse** `takeOffSchema`; else `invalid`. `today` must be an ISO day (a caller's bug otherwise).
2. **Lock**, in `putOn`'s order: the program's block `FOR NO KEY UPDATE` (`liveTemplateBlockIn`),
   then the athlete's `profiles` row `FOR NO KEY UPDATE` (live, **not archived**, `inHousehold`).
   A miss of either is `not_found`, including an archived athlete (invariant 31: their assignment is
   not ended).
3. **The athlete's current row of this program** (`assignmentCurrentAsOf(today)`): none is
   `not_found`. A row whose last day is already today answers `{ ok: true, lastDay: today }` and
   writes nothing (a replay).
4. **Which answer:**
   - **not started** (`active_from > today`): the start is removed (soft delete), `lastDay: null`;
   - **started today, nothing logged under it**: removed too, `lastDay: null`. "Logged" is a live
     entry of this athlete on `today` in a live session whose workout is one of THIS block's
     workouts (live or removed). An entry ticked and un-ticked is hidden, so it does not count;
   - **otherwise**: `active_to = today`, `lastDay: today`.
5. **Never hides the weekday rows** (invariant 19: a reopen trusts them live), and never touches
   the order of the athlete's other programs: a closed row leaves the order index, and the band
   closes the gap at the next `putOn` or reorder.

## Program order: `reorderPrograms(exec, scope, input, today)`

The contract: `programOrderSchema` and `DayActions.reorderPrograms` (`actions.ts`): the full order,
a permutation of the athlete's `DayPlan.currentPrograms`.

1. **Parse**; else `invalid`. **Lock** the athlete's `profiles` row (live, not archived, in the
   household), else `not_found`. No block lock: it writes no program's rows. Lock order stays
   acyclic: `putOn` and `takeOff` take a block, then the profile; this takes the profile alone.
2. **The athlete's current programs**, through lane E's `dayAssignments` and `currentPrograms`
   (the day page's rule, with #601's `(rank, idx, id)` order). The list must be exactly a
   permutation of them; anything else is `invalid` (a program they are not on, one left out).
3. **Write through the band**: every current row the order places gets `idx` = its position;
   open rows move through `shiftIntoBand` (the order index is unique on open rows). A row closing
   today keeps its place in the list it was given, but #601's rank still shows it after the ones
   that stay; the writer stores what it was given.
4. An order already as stored writes nothing.

## Files

- E `packages/db/src/writers/program/assign.ts`: `takeOff`, `reorderPrograms`, and `putOn`'s
  `placeOf` (H6).
- E `packages/db/src/writers/program/index.ts`: export both.
- E `packages/db/scripts/verify/program.ts`: `verifyTakeOff`, `verifyReorder`; and the 6c-i/6c-ii
  proofs that stood in for Take off with `active_to = today` now call `takeOff`.
- E `packages/db/src/writers/program/owed.test.ts`: the two 6d lines go.
- E `docs/features/program-writers.md`: map row 6d, files row, an invariant for each writer.
- E `docs/privacy/data-inventory.md`: `program_assignments`' writers (Take off closes or removes a
  row; reorder rewrites `idx`), dated entry.
- N changelog fragment.

## Tests (`db:verify`, in households of the proof's own)

- **Take off:**
  - logged days keep their rows (a past stretch with entries, taken off: the entries and sessions are
    untouched);
  - a start dated today with nothing logged is removed and answers `lastDay: null`;
  - with one live row logged it ends today and answers today;
  - a row ticked and un-ticked does not keep the start;
  - a start still to come is removed;
  - a replay answers the same and writes nothing;
  - refusals write nothing: another household's athlete or program, an archived or removed athlete,
    a legacy, removed or unknown program, someone not on it;
  - Put on after a real Take off today reopens the row and is due today (invariant 19's owed proof).
- **Program order:**
  - a reorder writes the order, and the day read (`currentPrograms`) answers it;
  - a non-permutation (missing, extra, another athlete's program) is `invalid`;
  - an archived athlete is `not_found`;
  - two open rows at one `idx` are refused by the index (the owed line);
  - the unchanged order writes nothing.
- **H6:** an athlete on P (made first) and R (made third), reordered to R, P, then put on Q (made
  second). (a) places Q before the first open program made after it, R: **Q, R, P**. (b) appends:
  **R, P, Q**. The proof asserts the picked one, and a patch swaps `placeOf` to the other.

Mutation patches from lane P's 520–539 block, one per refusal, branch and lock-order rule.

## Review-response log

The panel runs on this plan before any implementation is committed (plans/README.md). Its findings
and verdicts go here.
