# FAM-1 6d-iii: where a put-on program goes in an athlete's order

Lane P's step **6d-iii**: row 6d-iii in [fam-1-family-program.md](./fam-1-family-program.md) §5, and
D41. One writer changes: `putOn`, in `packages/db/src/writers/program/assign.ts`. Today it puts every
program it adds or reopens **last** in the athlete's order. D41 makes it follow ADR 0007 A2 §7 and
the maintainer's reopen call.

- **Decided** (the maintainer, 2026-11-18):
  - D41: a newly added program takes its place by the household's Programs-list order ("Keep household order (ADR)");
  - D41: a Put on that undoes a same-day Take off keeps the place the program had ("Its previous place");
  - this plan's open question: **when another Put on has moved things since, the reopen takes the smaller of its old place and the number of the athlete's other programs** ("B: reopen at old number"). No ADR change. The rare case where that is not where it was is accepted: the athlete fixes it with the reorder.
- **Gates:** #633 (6d-ii). Its `placeAssignments`, the one writer of an athlete's order, is what this builds on. Step 15c waits for 6d-iii; step 15 does not (row 6d-iii). Until 6d-iii ships, a Put on from the app puts a new program last.
- Roadmap alignment (2026-11-18): advances FAM-1 lane P (D41); gates 15c; touches no `ID-1` item.

**Terms.** An athlete's order is the `idx` of their **open** assignment rows (`active_to IS NULL`),
unique per athlete (`uq_program_assignments_profile_idx`). **The band:** to reorder without two rows
meeting on that index, every row that moves is first shifted by 1,000,000 (`SHIFT_BAND`), then given
its final place. A row with a last day (Take off) is not open, so it holds no place and is never
moved; the day page reads it after the programs that stay (ADR 0007 Amendment 5).

## What it does

### A newly added program

The preview fake's rule (`apps/web/app/design/program/fakes.ts`, `putOn`): it goes **before the first
of the athlete's programs that comes later in the household's Programs list**, or last when none does.

- **"Later in the list"** compares positions in the household's live Programs list (`readProgramList`'s order: live template blocks, `programBlocks.id` ascending). A program not in that list (a hidden program, whose open row the order still holds) is never "later", as the fake's `findIndex` of -1 is never greater. So a new program is never put before a hidden one.
- **The athlete's own order of the others is kept.** "Later" is read in THEIR order, as the fake does: with [C, A] (reordered) and list order A, B, C, Put on B gives [B, C, A], before C, the first one they keep that is later than B.
- **Only open rows count.** The fake's list of kept programs also holds a program ending today; the writer's order does not (Amendment 5 reads those after the ones that stay). So against what the athlete sees, the two agree.
- **The write:** the new row is inserted at a parking place far past any real one and the band (`PARK_IDX`, a named const in `shift-band.ts`). Then `placeAssignments(tx, profileId, order)` writes every place in one pass, through the band.
- **A start Take off removed** (a start dated today with nothing logged is soft-deleted, 6d-i) is a new row when put back on, so it goes by this rule, not "its previous place".
- The weekday rows, the start day and the skip of an athlete already on it are unchanged from 6c-i.

### A reopen (a Put on the day of a Take off)

**Its place is `min(old idx, n)`**, where `n` is the number of the athlete's open rows. It goes before
whichever open row now holds that place, or last.

- **Exact in the usual case**: a mistaken Take off undone straight away, or with only later-in-the-list programs added in between. Take off leaves the closed row's `idx` as it was, and a later Put on's compaction shifts the rows after the gap down, so the old number is still the right slot.
- **Not exact, accepted** (the maintainer, 2026-11-18): when a program EARLIER in the list is put on in between (A0 B1 C2; take off B; put on D, first in the list: D0 A1 C2; reopen B at 1: D, B, A, C), or after a same-day reorder. The athlete fixes it with the reorder.
- **The write**, in this order, so nothing meets the index:
  1. the reopened row's `active_to` is cleared and its `idx` set to `PARK_IDX`, in one update;
  2. then `placeAssignments` with the full order.
- It reopens the same row it does today (`active_to >= today`, `current` in `putOn`): one predicate for "the row to reopen".

### `placeAssignments`

Its signature stays `(tx, profileId, first)`. **Its return value goes**: `putOn` no longer inserts or
reopens at "the next free place", so nothing needs the count. Its docblock says so.

### The preview fake

In the not-exact case above, the fake puts the reopen where it was, since it holds a program ending
today in the athlete's list, and the writer does not. The roadmap thread is told; **the difference is
accepted** (the maintainer's call names the case). Aligning the fake is optional, and is the
contract owner's.

## Files

- E `packages/db/src/writers/program/assign.ts`: `putOn`'s placement of a new row and of a reopen; `placeAssignments`' return value; the docblocks ("last in the order" goes).
- E `packages/db/src/writers/program/shift-band.ts`: `PARK_IDX`, named with `SHIFT_BAND`.
- E `packages/db/src/writers/program/take-off.ts`: its docblock's "the next put on closes the gap" stays true; checked, not changed.
- E `packages/db/src/writers/program/seed-fixtures.ts`: its comment that the seed's put-on order is the world's order. The fixture athletes' programs are put on in list order, so the seeded orders do not change.
- E `packages/db/scripts/verify/program.ts`. Proofs that assume "put on = last", each rebuilt with `reorderPrograms` where an order is not list order, with the setup order asserted before the step under test:
  - 6c-i's "last in the order" and "the order closed up, the reopened program last" cases;
  - 6d-ii's closing case (n2, `[C, A, B]` set up by put-ons) and its hidden-row case (n3, `[A, H, B]`, which would no longer put H in the middle);
  - 6c-ii's "on it from tomorrow" world (`a3` on `[p3, p2]`, against the list order).
- E mutation patches:
  - 407 (`put-on-leaves-the-gap`): re-scoped to a gap that still closes, a row that ended before today;
  - 410 (`seed-fixtures-reverses-the-order`): the order is now the writer's rule, not the seed's loop, so it is retired with its reason in the README, or replaced by a seed patch the list rule catches;
  - 406, 412, 417 re-cut; each still red;
  - new ones from lane P's **576–589**.
- E `docs/features/program-writers.md`: invariants 11 and 19 (19: "each put on … takes the last place" becomes the list rule and the reopen rule); the `assign.ts` files row.
- E `docs/privacy/data-inventory.md`: the dated entry.
- N changelog fragment.

No migration, no contract change, no ADR change.

## Tests (`db:verify`)

Each order that is not list order is built with `reorderPrograms`, and asserted before the step.

- **A new program in its list place:** A, C on (list A, B, C); Put on B → A, B, C.
- **A first one** (earlier than every kept one) goes first; **a last one** goes last.
- **Against a reordered athlete:** [C, A] + B → [B, C, A]. A mutation for the plausible wrong rule, "after the last earlier one" (which gives [C, A, B]), is red here.
- **A hidden program's open row:** [H, A, C] with H hidden, Put on B → [H, A, B, C]; H is never moved past.
- **No swap:** on a reordered athlete, a Put on never changes the relative order of two others.
- **A reopen, nothing moved:** A0 B1 C2; take off B; put on B → A, B, C.
- **A reopen after a later Put on:** take off B; put on D (last in the list); put on B → A, B, C, D.
- **A reopen after an earlier Put on (the accepted case):** take off B; put on D (first in the list); put on B → D, B, A, C. Pinned, so a change to the rule is seen.
- **A reopen with nothing after it:** take off C (the last); put on C → C last.
- **A removed start put back** (started today, nothing logged): placed by the list rule.
- **The gap closes once the day ends:** A0, B ended yesterday at 1, C2; Put on D → A0, C1, D2.
- **Replays:** an already-on athlete is skipped and writes nothing (`ctid`).
- **No row left parked or in the band:** after every Put on in the proofs, every live row of the athlete has `idx < SHIFT_BAND`.

## Known limits

- The accepted reopen case above, and a reopen after a same-day reorder: the old number among reordered rows.
- Open rows' places are dense after every Put on and reorder (a closed row holds none), as today.

## Review-response log

The panel (correctness, db-safety, architecture/scope; opus) on aa5d3ee8, which proposed a held place
for a program ending today. All three found it under-scoped; the maintainer chose the simpler reopen
(B) on 2026-11-18, which removes most findings.

| Lens                                          | Finding                                                                              | Verdict                   | What changed                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| architecture P0, db-safety P1, correctness P1 | a reopen after a same-day reorder collides, or its place depends on row ids          | **resolved by B**         | the held place is gone; the reopen is parked, then placed through `placeAssignments`, in that order                                   |
| architecture P1, db-safety P1, correctness P1 | the held place rewrites signed ADR 0007 text                                         | **resolved by B**         | no ADR change                                                                                                                         |
| architecture P1, db-safety P2, correctness    | `placeAssignments`' return value stops being true                                    | **agreed**                | the return value goes                                                                                                                 |
| architecture P1, correctness P1               | docs that become false (invariant 19, `take-off.ts`, `schema.ts`, lane E's comments) | **agreed, narrowed by B** | invariant 19 and `seed-fixtures.ts` in Files; `take-off.ts` and `schema.ts` stay true under B; lane E's comments are not touched by B |
| architecture P1, db-safety P1                 | mutation 410 survives; 407, 412 and 571 lose their red                               | **agreed**                | 407 re-scoped, 410 retired or replaced, 412 re-cut; 571 stays red on the reorder's swap (unaffected)                                  |
| correctness P1, architecture P2               | how a program outside the list ranks                                                 | **agreed**                | position in the live list; outside it, never later; a test                                                                            |
| correctness P1                                | existing proofs assume "last" (6c-i, 6d-ii's n2 and n3, 6c-ii's a3)                  | **agreed**                | each listed, rebuilt with `reorderPrograms`, setup asserted                                                                           |
| correctness P1                                | nothing tests that the gap closes once the day ends                                  | **agreed**                | a test, and 407 points at it                                                                                                          |
| correctness P1                                | the order tests could pass with the wrong rule                                       | **agreed**                | built on a reordered athlete; a wrong-rule mutation; the removed-start case                                                           |
| correctness P2, db-safety P2                  | one predicate for the reopen's row                                                   | **agreed**                | `putOn`'s `current`, as today                                                                                                         |
| db-safety P2                                  | a row left parked or in the band goes unnoticed; the parking place inline            | **agreed**                | a proof (`idx < SHIFT_BAND`) and `PARK_IDX` as a const                                                                                |
| correctness P2                                | the rejected alternative was misdescribed; the fake already holds the place          | **agreed**                | the fake's difference stated, accepted by the maintainer                                                                              |
| architecture P2, correctness                  | the mutation block is 576–589 (570–575 are #633's)                                   | **fixed**                 | stated                                                                                                                                |
| architecture P2                               | terms undefined; "(the row)"; why #633 gates it                                      | **fixed**                 | a Terms paragraph; the row named; the gate explained                                                                                  |
| architecture P2                               | step 15 ships Put on before 6d-iii                                                   | **noted**                 | stated under Gates; the window is the row's (15 does not wait)                                                                        |
| db-safety P2                                  | invariant 12 should name the profile lock for any `idx` write                        | **already done**          | #633 states it                                                                                                                        |
| db-safety (also found)                        | closed rows' `updated_at` would move                                                 | **resolved by B**         | B never writes a closed row                                                                                                           |
