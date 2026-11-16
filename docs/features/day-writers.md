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

🚧 **Steps 11a and 11b are in** (the row writer, with its un-tick and re-tick); 12a, 11c and 14 add
their files, diagrams and invariants here. The row writer's sequence diagram is
[architecture.md §2i](../architecture.md); its plan is
[fam-1-11b-row-writer.md](../plans/fam-1-11b-row-writer.md).

## The map

| Step | Adds                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11a  | `writers/session-rows.ts`, extracted from the strength writer. A seam: it owes [write-path.md](./write-path.md) and [strength-logging.md](./strength-logging.md). |
| 11b  | `writers/day/log-row.ts`, `queries/day/{scheduled,stored-row-values}.ts`. Seams: `hide.ts` (lane S), `ownership.ts`, `session-rows.ts`, `unique-violation.ts`.    |
| 12a  | `queries/day/{day-plan,previous}.ts`: the day resolver and PREVIOUS.                                                                                              |
| 11c  | `writers/day/amend-row.ts`: Change.                                                                                                                               |
| 14   | The export. Seams: `apps/web/lib/dal/export.ts`, `queries/export-month.ts`, `packages/shared/src/csv/`.                                                           |

## Files

| File                                               | What it is for                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/day/index.ts`             | The directory's exports: `logRow`, `untickRow`, `retickRow`, re-exported from the package index for step 12b's actions.                                                                                                                                                                                                                                                                                                                        |
| `packages/db/src/writers/day/log-row.ts`           | **The row writer** (11b): the three writers, `classifyRowHolder`, `rowWorkout`, `RowRefused`, and the conjuncts `programRowOf`, `workoutSessionSlot`, `workoutSupersetSlot`, `programRowSlot`.                                                                                                                                                                                                                                                 |
| `packages/db/src/queries/day/scheduled.ts`         | `scheduledOn(blockId, workoutId, day)`: a live week slot on the day's weekday (`localWeekday`), as a conjunct; `isScheduledOn(exec, …)` asks it as a boolean (the ✓ and the un-tick). One rule for the writer, 12a's `scheduled` and 11c. `isOnProgramThatDay(exec, profileId, blockId, day)`: step 8, "the athlete is on this program on this day", on step 5's `assignmentOnDay` (on the program, not due on the weekday; see its docblock). |
| `packages/db/src/queries/day/stored-row-values.ts` | `readRowValues`: a logged row's live set and its live quantities, as `RowValues`. Throws on two live sets (D3). A second copy of the DAL's read (`docs/tech-debt.md`).                                                                                                                                                                                                                                                                         |
| `packages/db/src/writers/day/owed.test.ts`         | The lane's `it.todo` list: the tests steps 11b, 12a, 11c and 14 still owe the contract. Delete a line in the PR that writes its test.                                                                                                                                                                                                                                                                                                          |
| `packages/db/src/queries/day/index.ts`             | The directory's exports. Not re-exported from the package index yet; 12a decides.                                                                                                                                                                                                                                                                                                                                                              |
| `packages/db/scripts/verify/day.ts`                | The lane's `db:verify` proofs. Its header lists what each step owes and how to compare a read with a fixture.                                                                                                                                                                                                                                                                                                                                  |

## Invariants

1. 🔴 **New files go in these three paths. Anything else the lane touches is a seam** with a merge
   order in the plan's §6 table: `session-rows.ts`, `hide.ts` and the export files owe
   [write-path.md](./write-path.md) or [delete-and-restore.md](./delete-and-restore.md)
   (`session-rows.ts` also owes [strength-logging.md](./strength-logging.md)), one PR in
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

8. 🔴 **The row writer's check order is the contract**: profile (archived → `closed_day`) → window
   (`inWritableWindow`, D32) → replay → workout → prescription → movement → scheduled → on the
   program that day → set → values → writes. Every step has a proof in `verify/day.ts`, and every one but two has a
   mutation that turns it red (`scripts/mutations/README.md`, 110–119, 121–129 and 170–186; 120 is unused). The two:
   the quantity's derived `dimension` in
   `insertEntrySetRows` has no patch of its own, because hard-coding it reddens `verify.ts`'s GAP-3
   hold proof first; and the replay pin's `prescription_set IS NOT NULL` (3d) is implied by
   `prescription_set = write.set`. Reorder nothing without moving its proof.
9. 🔴 **The replay answers first, and it is pinned.** `classifyRowHolder` finds the entry holding the
   `clientId`, live or hidden (unguarded, so a hidden holder answers `own_hidden`, D18), and it is
   this write only if it is `programRowOf(profile, day)` for this set, prescription and workout.
   Anything else answers `not_found`, never `ok` with another row's values (3c–3h). A replay after a
   purge answers `not_found`: the purge cleared `prescription_id`.
10. **`programRowOf(profileId, day)` is "a program row of this athlete on this day"**
    (`prescription_set IS NOT NULL`): the one conjunct for the pin, un-tick and re-tick, so a weigh-in
    is never reached through a row action (10a, 10b).
11. 🔴 **A refusal reached after the first insert leaves by `RowRefused`**, thrown inside the
    transaction and caught at its edge (`hide.ts`'s `ItemRefused` pattern), so a session or superset
    the call created is rolled back. Every refusal uses it. Proved on one connection by 8a: a ✓
    whose fresh superset insert is followed by the row arbiter's `slot_taken` leaves no superset
    (mutation 178 returns the refusal instead of throwing it). Only a concurrent double-fire, which
    reaches the insert's classification from a race, needs a second connection.
12. **Ownership.** Every public id resolves inside the scope; the workout lookup also ties the block
    to the profile's own household (`programBlockOfProfile`, runbook pre-flight (f), proof 4d,
    mutation 111), so it holds whatever a scope widens to. A foreign id, hidden or not, answers
    `not_found`. ⚠️ **`not_found` is uniform for public ids, not for `clientId`**: a `clientId` held
    by another household's row also answers `not_found`, which tells a caller the id is in use.
    Guessing one needs the 74 random bits of a UUIDv7, so that is accepted, and said here rather than
    claimed away.

## Fake parity

The preview's fake (`apps/web/app/design/program/fakes.ts`) and the writer answer the same input the
same way, except:

- The fake has no household or archive, so `not_found` for a foreign id and `closed_day` for an
  archived athlete are the writer's alone. The fake answers `program_changed` for an unknown
  workout; the writer, `not_found` (it cannot tell unknown from foreign).
- A replay after the window has closed answers `closed_day` in both. A replay after a purge answers
  `not_found` in the writer only (the fake has no purge).
- **A mismatched workout and prescription** answers `program_changed` in the fake (the item is not
  in that workout) and `not_found` in the writer (plan M2).
- The writer answers the values **as stored**: `numeric(8,3)` rounds a quantity to three decimals,
  so 40.12345 answers 40.123, where the fake answers what was typed.
- The writer's "on the program that day" check (step 8) reads `program_assignments` through
  `assignmentOnDay`; the fake reads it from the fixture. 12a must use the same predicate.
- ⚠️ **The item's unit is one rule**, `itemUnit` (`@mat-plan/shared`, C13): the type's fixed unit
  first, else the slot's prescribed unit. 12a's `DayItem.unit` must call it for a live prescription
  (a removed one takes the unit its entry was stored in), or a row's placeholder and its ✓ disagree.

## Changing it

Start from the step's row in the plan (§5) and the decisions it cites (D3 and D20 for how a row is
stored, D7 for a logged day, D13 for an empty ✓, D18 for a replay after Clear day). Re-run
`pnpm db:verify` and `pnpm db:mutations`.
