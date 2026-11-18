# FAM-1 6d-i: Take off

Lane P's step **6d-i**, the first half of row 6d ([fam-1-family-program.md](./fam-1-family-program.md)
§5, Lane P), split under the maintainer's overnight delegation (D16, 2026-11-18). One writer,
`takeOff`, in `packages/db/src/writers/program/take-off.ts`. Nothing in the app calls it until
step 15, which waits for it.

- **Gates:** 6c-i (#588, merged). Nothing open.
- **Not here:** 6d-ii (`reorderPrograms`, gated on #601) and the new-assignment placement (its own
  PR after the maintainer's call; ADR 0007 A2 §7 vs `putOn`'s append).
- Roadmap alignment (2026-11-18): advances FAM-1 lane P; gates step 15; touches no `ID-1` item (an
  athlete's own assignment, inside their household).

## How Take off answers

```mermaid
flowchart TD
  P[parse takeOffSchema] -->|fails| I[invalid]
  P --> B["lockAthletes: the block FOR NO KEY UPDATE (live template of the household), then the athlete's profile (live, not archived)"]
  B -->|a miss| N[not_found]
  B --> C{"a current row of this program? (assignmentCurrentAsOf(today))"}
  C -->|none| R{"a hidden row of this program with active_from >= today?"}
  R -->|yes: removed before| RN["ok, lastDay: null (replay, D15)"]
  R -->|no| N
  C -->|last day already today| RT["ok, lastDay: today (replay)"]
  C --> S{"started? (active_from <= today)"}
  S -->|not started| DEL["remove the start (soft delete), lastDay: null"]
  S -->|started today| L{"a live program row of this athlete today in a workout of this block?"}
  L -->|no| DEL
  L -->|yes| END
  S -->|started before today| END["active_to = today, lastDay: today"]
```

The contract: `takeOffSchema` and `ProgramActions.takeOff` (`packages/shared/src/program/`), ADR 0007
Amendment 4, contract invariants 21 and 31, and D15.

1. **Parse** `takeOffSchema`; otherwise `invalid`. `today` is an ISO day the caller passes (a
   caller's bug otherwise, thrown).
2. **Lock** through one helper, `lockAthletes(tx, scope, profilePublicIds)` in `assign.ts`, that
   `putOn` also uses (the profile lock in id order, live, **not archived**, `inHousehold`). The
   block first, as every program writer does (lane guide invariant 12). An archived athlete is
   `not_found`, and their assignment is not ended (invariant 31).
3. **The current row** of this athlete and program: `assignmentCurrentAsOf(today)`, the shared
   predicate, never re-typed.
   - **None**: if a hidden row of this (profile, program) has `active_from >= today`, a Take off
     already removed it: `{ ok: true, lastDay: null }`, writing nothing (D15). Otherwise
     `not_found`: never on it, a start removed in the past, or another household's.
   - **Its last day is already today**: `{ ok: true, lastDay: today }`, writing nothing.
4. **Which answer:**
   - **Not started** (`active_from > today`): the start is removed (soft delete), `lastDay: null`.
   - **Started today, nothing logged under it**: removed too, `lastDay: null`. "Logged" is lane E's
     `programRowOf(profileId, today)` (a live program entry of this athlete today) on a live session
     whose workout is one of this block's workouts, live or removed. An entry ticked and un-ticked
     is hidden, so it does not count.
   - **Otherwise**: `active_to = today`, `lastDay: today`.
5. **Never hides the weekday rows** (lane guide invariant 19: a reopen trusts them live), and never
   moves the athlete's other programs. A closed row leaves the order index, and the band closes the
   gap at the next `putOn`.

**An accepted limit, written on the function and in the guide (beside invariant 16):** "nothing
logged" is read without a lock against the row writers, and two paths leave a logged row today under
a start Take off removed:

- **a race:** `logRow` checks the assignment with a plain read (`isOnProgramThatDay`), so a ✓
  passing that check before Take off commits writes its entry after the removal;
- **no race needed:** `retickRow` and lane S's Restore all bring a hidden entry back with no
  assignment check (C24). A tick, an un-tick, a Take off (`lastDay: null`), then a re-tick does it
  every time.

Both leave contract change C24's state: a logged workout on a day no live assignment covers, which
the day page shows as a workout that left the week (lane E's proof, `verify/day-plan.ts`). The
export reads entries, so it is unaffected. Closing it would need lane E's writers to lock the
assignment, and re-tick and Restore all would still get through, so it is accepted. A proof pins the
re-tick sequence. ⚠️ "Logged" follows the session's `workout_id`: a workout purged under ADR 0008
has it set to NULL, so its rows stop counting.

## Files

- N `packages/db/src/writers/program/take-off.ts`: `takeOff`.
- E `packages/db/src/writers/program/assign.ts`: `lockAthletes`, taken out of `putOn` so both
  writers share it.
- E `packages/db/src/writers/program/index.ts`: export `takeOff`.
- E `packages/db/scripts/verify/program.ts`: `verifyTakeOff`. The 6c-i and 6c-ii proofs that stood
  in for Take off with `active_to = today` call `takeOff`.
- E `packages/db/src/writers/program/owed.test.ts`: the 6d take-off line goes.
- E `docs/features/program-writers.md`: map rows 6d-i and 6d-ii, a files row, an invariant with the
  flowchart, and invariant 12's "6d's take off and reorder must take the same two" made true for
  take off (reorder's lock is 6d-ii's).
- E `docs/privacy/data-inventory.md`: `program_assignments`' writers (Take off closes or removes a
  row), and a dated entry.
- N changelog fragment.

## Tests (`db:verify`, in households of the proof's own)

- Logged days keep their rows: a stretch with entries from earlier days, taken off; its entries and
  sessions are untouched.
- A start dated today with nothing logged is removed and answers `lastDay: null`.
- With one live row logged today it ends today and answers today.
- A row ticked and un-ticked today does not keep the start.
- A start still to come is removed.
- A replay after an end answers `lastDay: today`; a replay after a removal answers `lastDay: null`
  (D15). Both write nothing (`ctid` snapshot).
- `not_found`, writing nothing: never on it; a start removed in the past; an archived or removed
  athlete; another household's athlete or program; a legacy, removed or unknown program.
- A row logged under ANOTHER program today does not keep this start.
- Put on after a real Take off today reopens the row, and the athlete is due today
  (`assignmentDueOn`): invariant 19's owed proof.
- The accepted limit: tick, un-tick, Take off (`lastDay: null`), re-tick leaves a live entry on a
  day with no live assignment, and the day read shows it as a workout that left the week.
- "Writes nothing" is checked by `ctid` (`assignmentRows`), since `updated_at` cannot see a rewrite
  inside one transaction.

Mutation patches from lane P's 520–539 block (521 onward): one per refusal, branch and predicate.
**No patch for the lock order**: PGlite has one connection and row locks do not show in `pg_locks`,
so a lock-order patch would stay green. The order is recorded in the guide as reviewed, not proven
(invariant 12).

## Review-response log

The panel (correctness, db-safety, architecture/scope) ran on the combined 6d plan before the split.

| Lens                | Finding                                                                        | Verdict               | What changed                                                               |
| ------------------- | ------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------- |
| architecture P1     | H6 should not ride in 6d; "last" departs from A2 §7 and the fake               | **agreed**            | its own PR, after the maintainer's call; reframed for the morning question |
| architecture P1     | a repeated Take off of a removed start answered `not_found`                    | **decided (D15)**     | `lastDay: null`, writing nothing                                           |
| architecture P1     | the reorder relied on open #601                                                | **moved**             | 6d-ii, gated on #601                                                       |
| architecture P1     | the profile lock would be copied                                               | **agreed**            | `lockAthletes`, shared with `putOn`                                        |
| architecture P2     | split take off from reorder                                                    | **decided (D16)**     | this plan is 6d-i                                                          |
| architecture P2     | an unstated race; no diagram; invariant 12's sentence                          | **agreed**            | the race on the function; a flowchart; invariant 12                        |
| architecture P2     | the "logged" predicate re-typed                                                | **agreed**            | built on lane E's `programRowOf`                                           |
| architecture (also) | C24 not named                                                                  | **agreed**            | the race paragraph cites it                                                |
| db-safety P1        | re-tick and Restore all reach a logged row under a removed start, with no race | **accepted, written** | the limit stated, with a proof of the re-tick sequence                     |
| db-safety P2        | the removal replay                                                             | **decided (D15)**     | `lastDay: null`                                                            |
| db-safety P2        | lock-order patches cannot fail on PGlite                                       | **agreed**            | none; the guide says reviewed, not proven                                  |
| db-safety P2        | reorder numbers a different set of rows than putOn                             | **moved**             | 6d-ii's plan                                                               |
| db-safety P2        | invariant 12 contradicts reorder's lock; #601 not a gate                       | **moved**             | 6d-ii's plan                                                               |
| db-safety NIT       | "writes nothing" needs `ctid`                                                  | **agreed**            | `assignmentRows`                                                           |
| db-safety NIT       | reuse `programRowOf`; the purge edge                                           | **agreed**            | both, in step 4 and the limit                                              |
