# FAM-1 11c — Change a logged row, and a ✓ that brings an un-ticked row back

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step
> 11c, decisions D20 and D35. Branch: `feat/fam-1-11c-amend-row`. Lane E
> ([day-writers.md](../features/day-writers.md)). **Rev 3, approved** by the maintainer (2026-11-17, relayed by the board), after a six-lens
> panel and a re-review (§ Review-response log). **Split** _(maintainer, 2026-11-17, relayed by the board)_: 11c-i is Change, 11c-ii is the revive, under this one plan.

## Goal

Two writer changes for the day page, both on program rows:

1. **Change** (`amendRow`): an athlete corrects a logged row's numbers in place, on today or
   yesterday.
2. **A slot holds at most one entry** (D35): a ✓ on a set whose entry the athlete un-ticked, or that
   Clear day hid, brings that entry back with the new numbers. It does not add a second entry.

This PR holds the writers and their `db:verify` proofs. The Server Action for Change belongs to 12b,
and the page to 12c and 12d.

**Roadmap alignment (2026-11-17):** advances `FAM-1` lane E.

- **Gated by** 11b (#470) and lane S's B2-0 (#514; `0030` applied), both merged.
- **Gates** 12b's Change action and 12d.
- **`ID-1`:** nothing new is keyed on `(household, profile)`, and the amend is a new consumer of
  `programBlockOfProfile`, which compares against the athlete's **current** household. So under
  `ID-1`'s "take your history", a moved athlete could no longer Change or revive rows logged against
  the old household's programs. `ID-1` inherits that trade-off; it is recorded here, not decided.
  A household member corrects a row with the same authority as logging and hiding (ADR 0008
  Decision 4; revisited after `AUTH-1`).
- Checked against the private roadmap; nothing to add here.

## Acceptance

From the plan's §5 row 11c (`fam-1-family-program.md:567`), in short:

> `amend-row.ts`: Change a logged row's numbers in place, by entry, validated against the item's
> type, on today and yesterday only (D20). And D35, in `log-row.ts`: a ✓ under a new `clientId` on a
> slot whose latest entry is the athlete's own hidden one un-hides it and writes this ✓'s numbers, in
> one transaction. With several hidden entries on a slot, the most recently hidden one is revived.
> The revive clears `hide_reason` in the same UPDATE that clears `deleted_at`. This rewrites one of
> 11b's proofs.

Its test column, each line mapped below:

- another athlete's hidden entry is never revived;
- un-tick and ✓ five times leaves one entry with the last numbers;
- an empty ✓ revives with the prescription's numbers;
- a refused ✓ (including `not_scheduled`) leaves the hidden entry untouched;
- the limit is pinned;
- the first ✓'s `clientId` answers `slot_taken`.

Done when:

- **`amendRow` exists** in `writers/day/amend-row.ts` and returns a `RowResult`. It never throws for
  an expected case.
- **`logRow` revives** as D35 and the contract (`day-shapes.ts:287-308`) say.
- **The two 11c lines** in `writers/day/owed.test.ts` (`:33-36`) are real proofs, and are deleted
  from the owed list.
- **Every rule names the patch that turns its proof red** (§ Mutations). A rule with no patch is
  listed as unproven, with the reason.
- **The writers and the preview fake answer alike**, apart from § Fake parity.
- **Inherited from 11b's harness:** after every proof, lane A's pre-flight (f) and (g) detectors read
  zero rows. 11c adds the (i) detector (an entry in a session of another profile) to that sweep.

## Decisions

### Shared steps (both writers)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | **One module for the steps `logRow` and `amendRow` share:** `writers/day/row-steps.ts`. It holds `RowRefused`, `refuse`, `rowTransaction` (the `retry` answer), `storedValues`, `fitsItsType`, and `rowItem(tx, scope, { workoutId, prescriptionId })`. That last returns `{ prescription, quantities, movement, trackingType, terms }`: 11b's steps 5, 6 and the `prescriptionTerms` half of 10, lifted out of `log-row.ts` unchanged. `openRowDay` is split into `openProfile` (`isLiveProfile`) and the window check, because Change learns its day from the entry. `log-row.ts` imports all of these. No behaviour change for `logRow`: 11b's proofs and mutations still pass, and patches that no longer apply are regenerated. |
| S2  | **The frozen columns are one function:** `rowFrozenColumns(...)` returns `Pick<typeof schema.entries.$inferInsert, 'unit' \| 'movementName' \| 'supersetId' \| 'supersetOrder' \| 'prescribedSnapshot'>`. The insert spreads it, and so does the revive. `movementId` and `activityTypeId` are never re-frozen, because a prescription's movement cannot change (`save-workout.ts:195` refuses a swap; a swap is a new card).                                                                                                                                                                                                                                                                                                        |
| S3  | **Every in-place write bumps `updated_at`** on the rows it touches (`entries`, `entry_sets`, `entry_set_quantities`), as `strength-session.ts:486,518`, `practice.ts:36` and `bodyweight.ts:86` do (the LWW convention). Both writers are added to the tech-debt entry "Set-edit LWW uses server-`now()`…", so v1.5 sync finds every in-place writer.                                                                                                                                                                                                                                                                                                                                                                                |
| S4  | **The writers do not parse.** The 12b action does (`log-row.ts:272`, as for 11b), so "a non-number is refused" is the contract's schema test (`shapes.test.ts`), named in the owed line's place. The writer's own proof is the blank (`bad_value`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Change (`amendRow`)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Refusal order is the fake's** (`fakes.ts:296-313`), after the parse: `not_found` → `closed_day` → `not_scheduled` → `program_changed` → `bad_value`. `retry` comes from `rowTransaction`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A2  | **One scoped, locked read finds the entry.** `openProfile` gives the profile id. Then a single `SELECT … FOR UPDATE OF entries` with: `entries.public_id = $id`, `entries.profile_id = $profile`, `programRow()` (a program row; the profile-only conjunct, no day), and the session is the athlete's own (`sessions.profile_id = entries.profile_id`, runbook pre-flight (i)). It returns `deleted_at`, `activity_date`, `session.workout_id`, `prescription_id`, `prescription_set` and the stored quantity units. No row, or a hidden row, is `not_found`. Every later check reads this locked row, so an un-tick cannot slip in between the check and the write.                                                                                                                                                                                                                                                                                                                                                                                 |
| A3  | **The window is the entry's own day:** `rowDayOpen(entry.activity_date, today, profile.archivedAt)`. An archived athlete's row is `closed_day`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A4  | **Schedule, then program,** in the fake's order. `not_scheduled` when `isScheduledOn` fails for the entry's workout on its day. Then the workout is reached through `rowWorkout` (`athleteTemplateBlockIn`, the 11b anchor), and the prescription through `rowItem`, pinned to that workout (`prescriptions.workout_id = workout.id`, as `logRow` step 5). A hidden workout, block or prescription is `program_changed`. `movementIsAvailableTo` is part of `rowItem`, so a movement no longer available is `not_found`, as in `logRow`. **A purged row** (`sessions.workout_id` or `entries.prescription_id` set to NULL by `ON DELETE SET NULL`, while `programRow()` still matches it): no workout is `not_scheduled`, as `untickRow` (`log-row.ts:526-531`) and the fake's order give; no prescription is `program_changed`, as the fake's `!found.item.prescriptionPublicId` (`fakes.ts:306`). **`isOnProgramThatDay` is not checked:** the fake does not check it, and a logged row stays correctable after its athlete comes off the program. |
| A5  | **The values** are checked against the row as it was LOGGED, not as the prescription reads now. The type comes from the movement. Each typed quantity's unit must equal the stored quantity's unit, else `bad_value`. Then `fillRowValues(item, values, null)` (no target, so nothing is filled) and `fitsItsType`. A blank is `bad_value`, and the stored number is kept. A Check has no numbers: an amend of a Check answers `ok` and changes nothing but `updated_at`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A6  | **The write:** `updateEntrySetRows(tx, entryId, input)` in `writers/session-rows.ts`, beside `insertEntrySetRows`, sharing its conventions (`EntrySetRowInput`; `reps` never invented; `String(q.value)`). It runs `UPDATE entry_sets SET updated_at = now() [, reps] WHERE entry_id = $e AND deleted_at IS NULL RETURNING id`, asserting one row. Then each quantity by `(that set id, slot)`, live, setting `value_num` and `updated_at`, asserting one row each. Then `entries.updated_at`. Child order is `entry_sets` then `entry_set_quantities`, as `updateStrengthSetById`, so the two paths cannot form a lock cycle. That function is not reused: it is addressed by a set's public id, guarded to mass, done and non-bodyweight, and asserts no row count.                                                                                                                                                                                                                                                                                |
| A7  | **The text is not re-frozen.** `prescribed_snapshot` keeps what the row was logged against. Change fixes a number, not what was prescribed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A8  | **No `clientId`; replay is by state.** The same amend twice writes the same numbers and answers alike, through `storedValues`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### The revive (D35, in `logRow`)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Where:** inside step 11, after the session and superset upserts (so `supersetId` is the CURRENT group's row, even if the group was added or renamed since the first ✓), and in place of the entry insert. Every refusal (steps 1–10) comes first and throws `RowRefused`, so a refused ✓ never reaches it.                                                                                                                                                                                                                    |
| R2  | **Lock the slot, scoped to the athlete:** `SELECT id, deleted_at, … FROM entries WHERE programRowOf(profileId, write.day) AND programRowSlot(sessionId, prescription.id, write.set) ORDER BY id FOR UPDATE OF entries`. The athlete's own rows only: a sibling's, or another household's, entry planted in this session is never seen (runbook state (i)).                                                                                                                                                                      |
| R3  | **Decide in JS, from the locked rows.** If any is live, there is no revive: fall through to 11b's insert, so the row arbiter and the classifier answer as they do today (`log-row.ts:436-476`: a retry of this `clientId` answers `ok`, anything else `slot_taken`). If none is hidden, insert as today. Otherwise revive the most recently hidden: `deleted_at` DESC, then `id` DESC, sorted after the lock (Postgres sorts a locking query before it locks, so an `ORDER BY deleted_at` there would sort on pre-lock values). |
| R4  | **The revive, in a savepoint** (the `restoreHidden` pattern, `hide.ts:308-331`):                                                                                                                                                                                                                                                                                                                                                                                                                                                |

1. `UPDATE entries SET ...UNHIDE, clientId = write.clientId, ...rowFrozenColumns(...), updatedAt = now() WHERE id = $id AND deleted_at IS NOT NULL AND <profile conjunct> RETURNING id`. The profile conjunct here repeats R2's: defence in depth, with no patch of its own (R2's is the one 342 proves).
2. If 0 rows, someone restored it first (lane S's constraint 2): fall through to the insert.
3. On `23505`: on `uq_entries_client_id`, roll back the savepoint and re-run `classifyRowHolder` → `answerHolder` (this `clientId` landed elsewhere meanwhile; a foreign holder is `not_found`); on the row arbiter, fall through to the insert.
4. **The values:** the entry's live `entry_sets` row is soft-deleted (with `updated_at`), and `insertEntrySetRows` writes this ✓'s numbers (filled from the prescription, as for any ✓) as a new set with quantity rows carrying the current unit and dimension. So the revived entry is literally what a new ✓ would write, a unit change included (lb → kg), and `readRowValues` already ignores a hidden set (mutation 172).
   `UNHIDE` clears `hide_reason` in the same UPDATE, so a revive after Clear day passes `entries_hide_reason_hidden_check`, and the entry leaves the "Day cleared · n hidden" count. |
   | R5 | **Replays.** `classifyRowHolder` (step 3) runs first, so the entry's CURRENT `clientId` answers as before: as the first call did while live, `own_hidden` while hidden (never revives). A replaced `clientId` is a new ✓: `slot_taken` while the set is logged; after a second un-tick it revives with that old attempt's numbers (D35's accepted limit, pinned by a proof). |
   | R6 | **Races:** two ✓ with DIFFERENT `clientId`s on one hidden slot, so the second waits on R2's lock, sees a live entry, and falls through to the insert: `slot_taken` from the arbiter. The SAME `clientId` fired twice: the second falls through, its insert hits `uq_entries_client_id`, and the classifier answers `ok` with the same `entryPublicId`. |
   | R7 | **Re-tick needs no change:** `restoreHidden` answers `ok` for an item that is live again (`hide.ts:479`), so re-ticking a revived entry answers with it as it is now (`rowRetickSchema`). |
   | R8 | **The UPDATE stays module-private in `log-row.ts`** (not `hide.ts`). This follows the 11c row ("in `log-row.ts`"), D35, ADR 0008 Amendment 2 ("only by the row writer's revive") and `hide.ts:70`. `hide.ts` is `export *`'d from the package (`src/index.ts:46`), so a `reviveEntry` there would be a public un-hide by internal id. The "only module that writes `entries.deleted_at`" claim is reworded everywhere it appears: `hide.ts` is the only module that HIDES, and the one other write is `log-row.ts`'s revive, which only clears it, through `UNHIDE`. The claim exists to keep the reader audit finite, and an un-hide adds no tombstone. This changes the answer lane S gave to Q1; lane S was told why. `ownedOnDay` is imported from lane S's `queries/clear-events.ts` once it lands, not copied. |

### Proofs 11b's rewrite touches

| 11b proof                                                  | Today        | Under 11c                                                        | Its mutation                                                                                                                                                                                           |
| ---------------------------------------------------------- | ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10, "a re-tick after a new ✓ took the set is `slot_taken`" | `slot_taken` | `ok`, the revived entry (R7)                                     | **122 keeps a proof:** a planted leg on the same set, a live L and a hidden H (a state 11b could leave). Re-tick H → `slot_taken` through `RESTORE_SLOT_INDEXES`. 122's `.expect` is re-pointed to it. |
| 3b, "replaying c1 after c2"                                | `own_hidden` | `slot_taken` (c2 revived c1's entry and replaced its `clientId`) | **125 moves to proof 3** (the Clear-day replay), which still reddens under it. The header note at `day.ts:74-77` ("3b runs before 3") is fixed, and so are both README rows.                           |

## File by file

| Path                                                                 | Change                  | What                                                                                                       |
| -------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/day/row-steps.ts`                           | N                       | S1, S2.                                                                                                    |
| `packages/db/src/writers/day/amend-row.ts`                           | N                       | `amendRow(db, { scope, today, input })`, A1–A8.                                                            |
| `packages/db/src/writers/day/log-row.ts`                             | E                       | Imports S1/S2; R1–R8.                                                                                      |
| `packages/db/src/writers/day/index.ts`                               | E                       | Export `amendRow` by name.                                                                                 |
| `packages/db/src/writers/session-rows.ts`                            | E (seam)                | `updateEntrySetRows`, A6. Owes `strength-logging.md` and `write-path.md`.                                  |
| `packages/db/src/writers/hide.ts`                                    | E (seam, comments only) | `:23` and `:68-72` reworded (R8).                                                                          |
| `packages/db/src/writers/no-bare-unhide.test.ts`                     | E                       | `:9-11` names the revive's place.                                                                          |
| `packages/db/src/index.ts`                                           | E                       | `:44`'s claim reworded.                                                                                    |
| `packages/db/scripts/verify/day.ts`                                  | E                       | The proofs below; 10 and 3b rewritten; the (i) detector in the sweep; the header.                          |
| `packages/db/src/writers/day/owed.test.ts`                           | E                       | The two 11c lines deleted.                                                                                 |
| `packages/db/scripts/mutations/341-*`–`356-*`                        | N                       | § Mutations; 122 and 125 re-pointed; patches S1's move breaks are regenerated.                             |
| `docs/features/day-writers.md`                                       | E                       | Files (`row-steps.ts`, `amend-row.ts`), invariant 8's check order with the revive step, the map's 11c row. |
| `docs/features/write-path.md`, `docs/features/delete-and-restore.md` | E                       | The claim reworded; invariant 1's table gains `log-row.ts`'s revive; 1b names it.                          |
| `docs/features/strength-logging.md`                                  | E                       | `session-rows.ts`'s new function.                                                                          |
| `docs/tech-debt.md`                                                  | E                       | S3's LWW entry.                                                                                            |
| `docs/changelog/…`                                                   | N                       | Fragment.                                                                                                  |

**Seams:** `write-path.md` is edited after #528 (12b) merges, and `day-writers.md`, the mutations
README and `src/index.ts` after #527. The board is asked to add 11c to the FAM-1 plan's §6 rows for
`write-path.md` and `delete-and-restore.md`. Lane A's `schema.ts` is not touched: lane A rewords the
`entry_set_quantities` docblock in its 0031 PR (Q2, answered).

## Test plan (`db:verify`, `verify/day.ts`)

**Change:**

- One amend for each of the seven types: the numbers change in place. The entry's id, `client_id`,
  `prescribed_snapshot` and `created_at` are unchanged, and `updated_at` advances. A Check answers
  `ok` and changes no number. (Owed line 1.)
- A blank field is `bad_value`, and the old number is kept. A day before yesterday is `closed_day`.
  (Owed line 2; a non-number is the schema's, S4.)
- The prescription's unit edited lb → kg after the log: an amend typed in kg is `bad_value`, and an
  amend in lb writes lb.
- **Ownership:** each case is `not_found` with nothing written, and each has its own mutation.
  - A sibling's entry under this athlete's id.
  - Another household's entry under this household's scope.
  - A weigh-in's entry.
  - A hidden entry.
  - A planted (i) entry: this athlete's entry in a SIBLING's session, on a workout of this household
    scheduled that day (so only the session-profile conjunct refuses it).
  - A planted (f′) state: the athlete's own entry on a foreign workout.
- An archived athlete's row is `closed_day`.
- A hidden prescription, a hidden workout and a hidden block are each `program_changed`.
- A workout that left the week is `not_scheduled`.
- A purged row: with no workout it is `not_scheduled`; with no prescription, `program_changed`.
- The same amend twice gives the same answer and the same rows.
- A planted hidden set on the entry, carrying a LIVE quantity in the same slot (as proof 10 plants): the amend writes the LIVE set's quantity (the A6 key).

**Revive:**

- **After an un-tick:** a ✓ under a new `clientId` answers the SAME `entryPublicId`. The entry is
  live, with the new numbers and the new `client_id`, and the slot holds one live entry.
- **After Clear day:** the same, with `hide_reason` NULL and the cleared count down by one.
- **An empty ✓** (no values) revives with the prescription's numbers.
- **Five rounds:** un-tick and ✓ five times leaves one entry, with the last numbers.
- **Several hidden entries:** planted with explicit `deleted_at`, the newest on the LOWER id. The
  newest is revived, and the others stay hidden.
- **Another athlete's hidden entry is never revived:** this athlete's own hidden entry on the slot,
  OLDER, beside a sibling's and another household's hidden entries planted NEWER in this athlete's
  session. This athlete's ✓ revives their own entry, leaves both planted entries untouched, and the
  slot holds one live entry.
- **The row arbiter arm:** this athlete's hidden entry, and a sibling's LIVE entry planted on the same
  slot in this athlete's session (state (i)). R2 sees only the hidden one and revives it. The UPDATE
  hits `uq_entries_session_prescription_set`, the savepoint absorbs the `23505`, and the fall-through
  insert answers `slot_taken`.
- **A refused ✓** (`closed_day`, `not_scheduled`, `program_changed`, `bad_value`): the hidden
  entry's `deleted_at`, `hide_reason`, `client_id` and numbers are unchanged.
- **Frozen again:** after the first ✓ and the un-tick, the prescription's text, its unit (lb → kg)
  and its superset group are each edited. Each revive carries the new text, the new unit (on the
  entry and on the quantity row, and in the answer) and the current group's superset row.
- **Replays:**
  - the revived entry's old `clientId` while live → `slot_taken`;
  - its new `clientId` → the same answer;
  - a hidden entry's own `clientId` → `own_hidden`, with no revive.
- **The limit, pinned:** the replaced `clientId`, replayed after a second un-tick, revives with its
  old numbers (D35, ADR 0008 Amendment 2).
- **Re-tick:** re-ticking a revived entry answers `ok` with its current values (proof 10, rewritten).
  **Planted states and the sweep.** Each proof that plants a state a detector reads (the (i) entries,
  the sibling's live and hidden entries, the (f′) workout) deletes its plants before the end-of-proof
  sweep, as (f′) does today (`verify/day.ts:1191-1192`).

**Order:** 11c's proofs run after `verifyRowWriter`'s 11b proofs, so the regenerated 11b patches whose
code moves to `row-steps.ts` (112, 114, 124, 127) still redden their own 11b assertion first, as
12a-i's proofs are arranged (`verify/day.ts:79-82`).

**Unproven on PGlite, and why.** PGlite has one connection (`harness.ts:22-26`), so nothing
concurrent runs. These are left without a `db:verify` proof:

- the R2 lock and the A2 lock;
- R6's two races;
- R4's 0-row arm (unreachable while R2's lock is held) and its `uq_entries_client_id` arm.

The PR records a **two-connection probe on embedded Postgres** (the 3b-0 precedent, `hide.ts:336-339`)
for:

- two ✓ with different `clientId`s;
- the same `clientId` twice;
- an amend racing an un-tick;
- a revive racing `restoreHidden`.

## Mutations (lane E's block 341–359, board 2026-11-17; 11c-i takes 348–356, 11c-ii 341–347 and 357)

| #   | Rule  | The patch                                                                                           | Its proof                                                                                                                                      |
| --- | ----- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 341 | R3    | the revive branch removed (a second entry is inserted)                                              | after an un-tick, one entry on the slot                                                                                                        |
| 342 | R2    | at R2's call site (not the shared helper, which is 173's), the slot lock drops the profile conjunct | another athlete's hidden entry is never revived: the newest pick is a planted entry, the UPDATE matches 0 rows, and a second entry is inserted |
| 343 | R3    | the pick by `id` only                                                                               | several hidden entries                                                                                                                         |
| 344 | R4    | `clientId` not replaced                                                                             | replays: the new `clientId`                                                                                                                    |
| 345 | S2/R4 | the revive does not re-freeze (keeps the old columns)                                               | frozen again: text                                                                                                                             |
| 346 | R4.4  | the revive updates `value_num` in place instead of re-inserting                                     | frozen again: the unit                                                                                                                         |
| 347 | R1    | the revive uses the hidden entry's `superset_id`                                                    | frozen again: the group                                                                                                                        |
| 348 | A3    | amend without the window                                                                            | the day before yesterday                                                                                                                       |
| 349 | A2    | amend accepts a hidden entry                                                                        | the hidden entry                                                                                                                               |
| 350 | A2    | amend drops `entries.profile_id`                                                                    | the sibling's entry                                                                                                                            |
| 351 | A2    | amend drops the session-profile conjunct                                                            | the planted (i) entry                                                                                                                          |
| 352 | A4    | amend drops `athleteTemplateBlockIn` (the 4d pattern)                                               | the planted (f′) state                                                                                                                         |
| 353 | A5    | amend checks the unit against the prescription, not the stored row                                  | the unit edited lb → kg                                                                                                                        |
| 354 | A4    | amend skips `isScheduledOn`                                                                         | the workout that left the week                                                                                                                 |
| 355 | A4    | amend skips the liveness checks                                                                     | the hidden prescription                                                                                                                        |
| 356 | A6    | `updateEntrySetRows` keys quantities on any set of the entry                                        | the planted hidden set (its live quantity makes the UPDATE match two rows)                                                                     |
| 357 | R4    | the revive's savepoint and its `23505` catch removed                                                | the row arbiter arm                                                                                                                            |

`UNHIDE` swapped for `{ deletedAt: null }` gets no patch: it is lane S's rule (155), and the
after-Clear-day proof fails it with `23514`. Existing patches 119 and 178 keep their proofs, because
R3 falls through to the insert.

## Fake parity

The fake already revives (`fakes.ts:218-235`: the same `entryPublicId`, the replaced attempts
dropped, the text frozen again), so R4, R5 and R7 match it. Its `amendRow` order (`fakes.ts:296-313`)
is A1's. The remaining differences:

- **Several hidden entries on a slot:** the fake keeps at most one per slot, so R3's pick has no
  counterpart there.
- **The unit an amend is checked against:** the fake checks the prescription's current unit
  (`found.item.unit`, `fakes.ts:308`); the writer checks the stored row's (A5). Q4 asks the contract
  owner to align the fake.
- **The existing differences** listed in day-writers.md (archive, household, stored rounding).

## Risks

- **Several statements on three tables.** They all run in one transaction, and each in-place UPDATE
  asserts its row count, so a partial write throws and rolls back.
- **Lock order.**
  - A revive locks one slot's entries `ORDER BY id`, as `hideRows` and `clearDay` do.
  - `restoreHidden` locks by public id. A slot's entries were created in separate transactions,
    ordered in time, so their UUIDv7 public-id order matches their id order. `restoreClear` holds at
    most one row per slot per token. So no cycle forms.
  - The amend locks one entry, then its set, then its quantities, the same order as
    `updateStrengthSetById`.
- **D35's accepted limit** is pinned by a proof and not changed (ADR 0008 Amendment 2).

## Out of scope

- The Change action and its page (12b, 12d).
- Bodyweight and practice, whose re-entry stays a new row (D35).
- Keeping replaced client ids (v1.5).
- **Pre-existing, filed in `docs/tech-debt.md` (lane E's, the board 2026-11-17; fixed in its own PR after 11c-i):** `updateStrengthSetById` (`strength-session.ts:450-530`)
  edits any live set of the profile on any day, so a crafted fix-a-set request can change a
  Weight×reps program row outside D20's window.

## Open questions

- **Q1 (lane S): answered yes, then reversed by the panel (R8).** The UPDATE stays in `log-row.ts`.
  Lane S was told why, and asked whether the reworded claim works for them.
- **Q2 (lane A): answered.** Lane A rewords the docblock in 0031.
- **Q3, decided: split** _(maintainer, 2026-11-17, relayed by the board)_. **11c-i** is Change
  (S1–S4, A1–A8, `updateEntrySetRows`, the two owed lines, mutations 348–356); it lands S1 first and
  gates 12b's Change action. **11c-ii** is the revive (R1–R8, the 10 and 3b rewrites, the claim
  rewording, mutations 341–347 and 357). This plan merges on its own (#533); 11c-i and 11c-ii are each their own PR.
- **Q4 (contract owner):** align the fake's `amendRow` to check the stored unit (A5)?

## Review-response log

### Engineering panel, round 1 (rev 1; correctness, db-safety, security, architecture, scope, reuse; Opus 5.5)

> Run on Opus 5.5 while Fable is capped. Panel cost: correctness 156k · 6m51s, db-safety 139k · 6m02s,
> security 123k · 5m35s, architecture 138k · 4m42s, scope 73k · 2m53s, reuse 92k · 3m02s.

| #   | Lens                                           | Critique (short)                                                                                                    | Verdict      | Resolution                                                                      |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| 1   | correctness, architecture, security, db-safety | R2's own `slot_taken` breaks a same-`clientId` retry, and leaves 119 and 178 without a proof                        | **accepted** | R3: a live entry falls through to the insert; R6 split by `clientId`            |
| 2   | correctness, reuse, db-safety, security        | A revive and an amend store a number under a stale unit                                                             | **accepted** | R4.4 re-inserts the set; A5 checks the stored unit; proofs and 346, 353         |
| 3   | security, scope                                | The revive's slot read is not tied to the athlete; "another athlete's hidden entry" is unproven                     | **accepted** | R2's `programRowOf`; a planted sibling and foreign entry; 342; the (i) detector |
| 4   | correctness, db-safety, scope                  | The 10 and 3b rewrites strand 122 and 125                                                                           | **accepted** | § Proofs 11b's rewrite touches                                                  |
| 5   | correctness, db-safety, architecture           | The race tests cannot run on PGlite                                                                                 | **accepted** | Listed as unproven; a two-connection probe in the PR                            |
| 6   | reuse                                          | `amendRow` would copy `logRow`'s private steps, and the copy already drops two                                      | **accepted** | S1, `row-steps.ts`; A4 names each step                                          |
| 7   | scope                                          | Five of the row's proofs are missing                                                                                | **accepted** | All five added, mapped under Acceptance                                         |
| 8   | architecture, security                         | `reviveEntry` in `hide.ts` would be a public un-hide by internal id                                                 | **accepted** | R8: module-private in `log-row.ts`; the claim reworded                          |
| 9   | db-safety, security                            | The amend's hidden check and its lock must be the same read                                                         | **accepted** | A2                                                                              |
| 10  | db-safety, correctness                         | The revive's `supersetId` must be the current group's                                                               | **accepted** | R1 puts the revive after the superset upsert; 347                               |
| 11  | correctness, architecture                      | `writeRowValues` fails for the five no-reps types, skips `updated_at`, and must key on the live set                 | **accepted** | A6, S3; 356                                                                     |
| 12  | db-safety, correctness                         | "Most recently hidden" cannot fail with one `now()`                                                                 | **accepted** | Explicit `deleted_at`, newest on the lower id; 343                              |
| 13  | security                                       | Each ownership conjunct needs its own proof and mutation                                                            | **accepted** | 350–352                                                                         |
| 14  | reuse                                          | The frozen columns are a second hand-written copy                                                                   | **accepted** | S2                                                                              |
| 15  | reuse                                          | `writeRowValues` belongs beside `insertEntrySetRows`                                                                | **accepted** | A6 in `session-rows.ts`                                                         |
| 16  | correctness, scope                             | The Fake parity section was false                                                                                   | **accepted** | Rewritten                                                                       |
| 17  | architecture                                   | Seams: `write-path.md` with #528, `day-writers.md` with #527; guide edits are unconditional                         | **accepted** | § File by file, Seams                                                           |
| 18  | scope                                          | Split into two PRs                                                                                                  | **open: Q3** | Recommended yes, the board decides                                              |
| 19  | correctness                                    | Three listed mutations could not fail as described                                                                  | **accepted** | Replaced with patches that each name a proof                                    |
| 20  | scope                                          | Cut the `UNHIDE` swap patch                                                                                         | **accepted** | No patch; the after-Clear-day proof fails it                                    |
| 21  | security                                       | `ID-1`: the amend uses the current household                                                                        | **accepted** | The alignment line says so                                                      |
| —   | NITs                                           | Lock-order reasoning; the revive's position; `restoreHidden`'s line; `programRowOf` on its own column; Q2's wording | **accepted** | All in rev 2                                                                    |
| —   | db-safety                                      | Out of the diff: `updateStrengthSetById` bypasses D20's window for program rows                                     | **filed**    | Out of scope, sent to the board                                                 |

### Re-review of rev 2 (correctness, security; Opus 5.5, medium)

> correctness 114k · 4m26s, security 64k · 1m48s. Every rev 1 BLOCKING finding is closed.

| #   | Lens                  | Critique (short)                                                               | Verdict      | Resolution                                                                                                                 |
| --- | --------------------- | ------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | correctness, security | 342 cannot fail: R4.1's own profile conjunct turns the bad pick into an insert | **accepted** | The athlete's own older hidden entry beside newer planted ones; 342 at R2's call site; R4.1's conjunct is defence in depth |
| 2.2 | security              | 351 survives if the (i) session is another household's                         | **accepted** | The plant is a sibling's session on a scheduled workout of this household                                                  |
| 2.3 | correctness, security | Planted states trip the end-of-proof sweep                                     | **accepted** | Each such proof deletes its plants before the sweep                                                                        |
| 2.4 | correctness           | R4's row-arbiter arm can be staged on PGlite                                   | **accepted** | A proof, and mutation 357                                                                                                  |
| 2.5 | correctness           | S1's move can break 11b patches' `.expect` if 11c proofs run first             | **accepted** | 11c's proofs run after 11b's                                                                                               |
| 2.6 | correctness           | Change has no answer for a purged row                                          | **accepted** | A4 names both answers; a proof                                                                                             |
| 2.7 | correctness           | 356 needs the hidden set to carry a live quantity                              | **accepted** | Written into the test line                                                                                                 |
