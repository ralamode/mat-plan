# FAM-1 11c — Change a logged row, and a ✓ that brings an un-ticked row back

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step
> 11c, decisions D20 and D35. Branch: `feat/fam-1-11c-amend-row`. Lane E
> ([day-writers.md](../features/day-writers.md)). **Rev 1, a draft for the panel.**

## Goal

Two writer changes for the day page, both on program rows:

1. **Change** (`amendRow`): an athlete corrects a logged row's numbers, in place, on today or
   yesterday.
2. **A slot holds at most one entry** (D35): a ✓ on a set whose entry the athlete un-ticked, or that
   Clear day hid, brings that entry back with the new numbers. It does not add a second entry.

This PR is the writers and their `db:verify` proofs. The Server Action for Change is 12b's, and the
page is 12c/12d's.

**Roadmap alignment (2026-11-17):** advances `FAM-1` lane E. It is gated by 11b (#470, merged) and
lane S's B2-0 (#514, merged; `0030` applied), which adds `entries.hide_reason` and `UNHIDE`. It
gates 12b's Change action and 12d. `ID-1`: nothing new is keyed on `(household, profile)`, and
ownership goes through the existing helpers. Checked against the private roadmap; nothing to add here.

## Acceptance

From the plan's §5 row 11c (`fam-1-family-program.md:567`), in short:

> `amend-row.ts`: Change a logged row's numbers in place, by entry, validated against the item's
> type, on today and yesterday only (D20). And D35, in `log-row.ts`: a ✓ under a new `clientId` on a
> slot whose latest entry is the athlete's own hidden one un-hides it and writes this ✓'s numbers,
> in one transaction. With several hidden entries on a slot, the most recently hidden one is
> revived. The revive clears `hide_reason` in the same UPDATE that clears `deleted_at`. This
> rewrites one of 11b's proofs.

Done when:

- `amendRow` exists in `packages/db/src/writers/day/amend-row.ts` and returns a `RowResult`. It never
  throws for an expected case.
- `logRow` revives as D35 and the contract (`day-shapes.ts:287-308`) say.
- The two 11c lines in `writers/day/owed.test.ts` (`:33-36`) are real proofs in `verify/day.ts`, and
  are deleted from the owed list.
- Every rule below names the mutation that turns its proof red (lane E's 341–359). A rule with no
  patch is listed as unproven, with the reason.
- The preview fake (`apps/web/app/design/program/fakes.ts:296-313`) and the writer give the same
  answer for the same input, apart from what is listed under Fake parity.
- After every proof, lane A's pre-flight (f) and (g) detectors read zero rows.

## Decisions

### Change (`amendRow`)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Refusal order is the fake's** (`fakes.ts:296-313`): `bad_value` (the parse) → `not_found` (not this athlete's, not a program row, or hidden) → `closed_day` → `not_scheduled` → `program_changed` → `bad_value` (`fillRowValues(item, values, null)` and `fitsItsType`). `retry` comes from `rowTransaction`, as in 11b.                                                                                                                                 |
| A2  | **The entry is found by public id inside the scope.** `isLiveProfile(profilePublicId, scope)` gives the profile. The entry must match `programRowOf(profileId, entry.activity_date)` and be live; a hidden entry is `not_found`, as in the fake. Its workout and block are reached through `athleteTemplateBlockIn`, the 11b anchor, so another household's entry is `not_found` (ADR 0006).                                                               |
| A3  | **The window is the entry's own day** (the contract has no `day`): `rowDayOpen(entry.activity_date, today, profile.archivedAt)`. An archived athlete's row is `closed_day`.                                                                                                                                                                                                                                                                                |
| A4  | **Schedule and program.** `not_scheduled` when `isScheduledOn` fails for the entry's workout on its day. `program_changed` when the prescription, its workout or its block is hidden. This is 11b's check, read from the entry, not from the request.                                                                                                                                                                                                      |
| A5  | **The values.** The item's tracking type comes from the movement. `fillRowValues(item, values, null)` fills nothing, so a blank is `bad_value` and the stored number is kept (contract `day-shapes.ts:347-358`).                                                                                                                                                                                                                                           |
| A6  | **The write is in place**, through a new shared helper, `writeRowValues(tx, entryId, values)` in `writers/day/row-values.ts`. It UPDATEs the one live `entry_sets` row's `reps`, and each live `entry_set_quantities` row's `value_num` by `(entry_set_id, slot)`. A type's shape is fixed, so a row that was logged has every quantity row it needs. The helper asserts each UPDATE touched exactly one row, and throws if not (a defect, not a refusal). |
| A7  | **Lock:** `SELECT … FOR UPDATE OF entries` on the entry before any read of its values, the same lock `hideRows` takes. An amend racing an un-tick then serialises: whichever is second sees the other's result (a hidden entry is `not_found`).                                                                                                                                                                                                            |
| A8  | **No `clientId`; replay is by state.** The same amend twice writes the same numbers and answers the same. The answer is `{ ok, entryPublicId, values: readRowValues(...) }`.                                                                                                                                                                                                                                                                               |
| A9  | **The text is not re-frozen.** `prescribed_snapshot` keeps the text the row was logged against. Change fixes a number, not what was prescribed.                                                                                                                                                                                                                                                                                                            |

### The revive (D35, in `logRow`)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Where in the flow:** after steps 1–10 pass and before the insert (step 11). So a refused ✓ (`closed_day`, `not_scheduled`, `program_changed`, `bad_value`) leaves a hidden entry hidden and untouched, as the contract requires.                                                                                                                                                                                                                                                                                                                                                                 |
| R2  | **The slot is locked first:** `SELECT` the athlete's entries on `(session for that day and workout, prescription, set)`, live or hidden, `FOR UPDATE OF entries ORDER BY id`. If a live one is there, the answer is `slot_taken`. If the session does not exist yet, there is nothing to revive, so the insert path runs as today.                                                                                                                                                                                                                                                                 |
| R3  | **Which entry:** the most recently hidden one, by `deleted_at DESC, id DESC`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| R4  | **The revive** is one UPDATE on that entry: `.set({ ...UNHIDE, clientId: write.clientId, prescribedSnapshot, unit, movementName, supersetId, supersetOrder })`. These are the values a new ✓ would write now, so "the entry is then what a new ✓ would have made, but for its id" holds, and the text is frozen again. Then `writeRowValues` writes this ✓'s numbers, filled from the prescription as for any ✓. `UNHIDE` clears `hide_reason` in the same UPDATE, so a revive after Clear day passes `entries_hide_reason_hidden_check`, and the entry leaves the "Day cleared · n hidden" count. |
| R5  | **A replay is unchanged.** `classifyRowHolder` runs first (step 3), so the entry's CURRENT `clientId` still answers as before: as the first call did while live, `own_hidden` while hidden. A replaced `clientId` is a new ✓: `slot_taken` while the set is logged, and a revive after it is un-ticked again (the accepted limit, D35).                                                                                                                                                                                                                                                            |
| R6  | **Two racing ✓ on one hidden slot:** the second waits on R2's lock, sees the first's revived entry live, and answers `slot_taken`. A ✓ racing an un-tick of a different entry on the slot cannot happen, since a slot has at most one live entry.                                                                                                                                                                                                                                                                                                                                                  |
| R7  | **Re-tick needs no change.** `restoreHidden` already answers `ok` for an item that is live again (`hide.ts:265`), so a re-tick of a revived entry answers with the entry as it is now, which is what `rowRetickSchema` says. 11b's proof 10 (`verify/day.ts:1364-1377`, "slot_taken") is rewritten to this answer. Proof 3b (`:641-656`) is re-checked against R5.                                                                                                                                                                                                                                 |
| R8  | **Where the UPDATE lives (Q1).** `hide.ts` is documented as the only module that writes `entries.deleted_at` (`src/index.ts:44`, `write-path.md:110`, `delete-and-restore.md:29`). Recommended: an exported `reviveEntry(tx, { entryId, clientId, frozen })` in `hide.ts`, so that claim stays true and `no-bare-unhide.test.ts` sees one more `UNHIDE` user. That is a seam edit in lane S's file, which owes its guide.                                                                                                                                                                          |

## File by file

| Path                                                                 | Change       | What                                                         |
| -------------------------------------------------------------------- | ------------ | ------------------------------------------------------------ |
| `packages/db/src/writers/day/amend-row.ts`                           | N            | `amendRow(db, { scope, today, input })`, A1–A9.              |
| `packages/db/src/writers/day/row-values.ts`                          | N            | `writeRowValues`, A6, shared by amend and revive.            |
| `packages/db/src/writers/day/log-row.ts`                             | E            | R1–R6. The revive branch and its slot lock.                  |
| `packages/db/src/writers/day/index.ts`                               | E            | Export `amendRow`.                                           |
| `packages/db/src/writers/hide.ts`                                    | E (seam, Q1) | `reviveEntry`, R8.                                           |
| `packages/db/scripts/verify/day.ts`                                  | E            | The proofs below; proof 10 rewritten; the header's 11c line. |
| `packages/db/src/writers/day/owed.test.ts`                           | E            | The two 11c lines deleted.                                   |
| `packages/db/scripts/mutations/341-*` onward                         | N            | One patch per rule, with README rows.                        |
| `docs/features/day-writers.md`                                       | E            | Files, invariants, the map's 11c row.                        |
| `docs/features/write-path.md`, `docs/features/delete-and-restore.md` | E            | The revive as an un-hide path (if Q1 is yes).                |
| `docs/changelog/…`                                                   | N            | Fragment.                                                    |

Not touched: lane A's `schema.ts`. Its `entry_set_quantities` docblock says quantities are "written
only when the parent entry was freshly created" (~`:596-598`), which an amend and a revive now
contradict. Q2 asks lane A to reword it.

## Test plan (`db:verify`, `verify/day.ts`)

**Change:**

- One amend for each of the seven tracking types: the numbers change in place. The entry's id,
  `client_id`, `prescribed_snapshot` and `created_at` are unchanged. `readRowValues` answers the new
  numbers. (Owed line: "amend a row of each tracking type".)
- A non-number is refused by the parse, and a blank field is `bad_value` with the old number kept.
  A day before yesterday is `closed_day`. (Owed line.)
- Another household's entry, a weigh-in's entry and a hidden entry are each `not_found`, with
  nothing written.
- An archived athlete's row is `closed_day`.
- A row whose prescription, workout or block is hidden is `program_changed`.
- A row whose workout has left the week is `not_scheduled`.
- The same amend twice: the same answer, and the same rows.

**Revive:**

- **After an un-tick:** a ✓ under a new `clientId` answers the SAME `entryPublicId`. It is live with
  the new numbers and the new `client_id`, and there is exactly one entry on the slot.
- **After Clear day:** the same, and `hide_reason` is NULL. The day's cleared count drops by one.
- **Several hidden entries on the slot** (planted, as 11b could leave them): the most recently
  hidden one is revived, and the others stay hidden.
- **A refused ✓** (`closed_day`, `bad_value`, `program_changed`): the hidden entry is unchanged, and
  so are its `deleted_at`, `hide_reason` and numbers.
- **Text frozen again:** edit the prescription after the first ✓, un-tick, then ✓. The revived
  entry's `prescribed_snapshot` is the new text.
- **Replays:** the revived entry's old `clientId` while live → `slot_taken`; its new `clientId` →
  the same answer; a hidden entry's own `clientId` → `own_hidden`, with no revive.
- **Re-tick of a revived entry** answers `ok` with its current values (proof 10, rewritten).
- **The race:** two concurrent ✓ on one hidden slot → one revive and one `slot_taken`, and still one
  entry on the slot.

**Mutations (341 onward):**

- the revive branch removed, so a second entry is inserted;
- `UNHIDE` swapped for `{ deletedAt: null }`, which the CHECK must refuse (and which the no-bare-unhide
  test also catches);
- the most recent hidden entry picked by oldest instead;
- the revive placed before the refusal checks;
- `clientId` not replaced;
- the snapshot not re-frozen;
- amend without the window;
- amend without the household anchor;
- amend accepting a hidden entry;
- amend filling a blank from the prescription.

## Fake parity

The fake revives nothing (it is in-memory and keeps no hidden entries on a slot). No change is
needed there unless the panel finds a case where the page would see a difference.

## Risks

- **A revive writes the values in two tables after an UPDATE on a third.** Everything is in one
  transaction, and `writeRowValues` asserts each row count, so a partial write throws and rolls
  back.
- **Lock order.** The revive locks entries `ORDER BY id`, as `hideRows` does. Restore locks by
  public id; a cycle needs one restore of two rows a revive holds, and a revive locks one slot.
- **The accepted D35 limit:** a replaced `clientId` replayed after a second un-tick revives with old
  numbers. It is recorded in ADR 0008 Amendment 2, and not changed here.

## Out of scope

The Change action and its page (12b, 12d). Bodyweight and practice: their re-entry stays a new row
(D35, program rows only). Keeping replaced client ids (v1.5).

## Open questions

- **Q1 (lane S, the `hide.ts` owner):** put the revive's UPDATE in `hide.ts` as `reviveEntry`?
  Recommended: yes.
- **Q2 (lane A):** reword `schema.ts`'s `entry_set_quantities` docblock ("written only when the
  parent entry was freshly created"), which an amend and a revive contradict.

## Review-response log

_(empty: the panel has not run.)_
