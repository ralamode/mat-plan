# LEGACY-1 — retire the legacy strength write path, and the old forms' other unused exports

> Backlog row: [plan.md](../plan.md) → `LEGACY-1` (maintainer, 2026-11-19; FAM-1 decision D51).
> Tech-debt row: [tech-debt.md](../tech-debt.md) → "Older days have no in-app fix, and the old forms
> left callerless code in the packages". This plan takes the **callerless-code half only**; the
> older-day half stays open. Assigned to the Tech Debt lane by the board (the maintainer's pick,
> 2026-11-20).

_Roadmap alignment (2026-11-20): checked against the private roadmap; nothing to add here. Closes
`TEN-2b-1` (overtaken) and `V1-36`; re-scopes `TEN-2b-2`; gates nothing._

**Status: v2, APPROVED by the maintainer (2026-11-20).** After the panel (correctness, db-safety,
scope; log below). Line numbers are hints at `ca7ab590`; the **banner text** is the key.

## Goal

FAM-1 12f deleted the old log forms and their actions, and left the code below them in place on
purpose. Nothing in the app reaches it now. This plan deletes it after proving it dead, and **keeps
every proof of a property that live code or live schema still has**.

## Out of scope, on purpose

- **`apps/web/lib/entries/entry-label.ts` stays.** It is the only app code that words an old entry,
  kept by recorded decision **D21**. The tech-debt entry's list was wrong to include it; this work
  corrects the entry (board, 2026-11-20).
- **`findOrCreateMovement` stays.** It is a one-line wrapper over the live `findOrCreateTypedMovement`,
  not legacy code, and renaming its ~19 proof references collides with open draft #770. A later
  mechanical rename can take it.
- No schema change and **no migration**. The `sessions`, `supersets` and `entry_sets` tables stay
  live: `writers/day/log-row.ts` writes them. What becomes write-dead is listed under "Left in the
  schema".
- The older-day recovery half of the tech-debt entry.

## What is dead

Checked by a reference sweep on main (definition, every reference, barrels, dynamic `import()`,
`packages/evals`, seed, corrections, scripts, e2e). **The sweep runs to a fixpoint:** an export that
only a deleted export used is deleted too.

- **The app DAL:** `logStrengthSession`, `editStrengthSet` (`apps/web/lib/dal/entries.ts`).
- **The writer:** `writeStrengthSession`, `updateStrengthSetById` and their private helpers
  (`packages/db/src/writers/strength-session.ts`).
- **The resolver:** `resolveSessionMovements`, `resolveMovementByPublicId`,
  `MovementNotAvailableError`, `MOVEMENT_NOT_AVAILABLE`, `ResolvedSessionMovement`
  (`writers/movement-catalog.ts`).
- **The prescription snapshot:** `prescribedSnapshotsFor` and its test
  (`writers/prescribed-snapshot.ts`). The live day writer freezes its own snapshot, proved at
  `verify/day.ts` "9: the frozen prescription" (mutation 129).
- **The adherence query:** `weeklyAdherenceRows` and `WeeklyAdherenceRow`
  (`queries/weekly-adherence.ts`, the whole file).
- **The legacy session schemas:** `logStrengthSessionSchema`, `sessionMovementSchema`,
  `SessionMovementInput`, `supersetInputSchema`, `MAX_SESSION_MOVEMENTS`, `MAX_SESSION_SUPERSETS`,
  `modeNotApplicable*`; then `editStrengthSetSchema`, `numberTooHighMessage`, and **`strengthSetSchema`**
  (finding C8 below).
- **Smaller exports:** `readsHouseholdProgram`, `STRENGTH_DAY_ROLES`, `loggableUnitsOf`, the keyed
  `ACTIVITY_INPUT_SHAPE` map.
- **Fixpoint orphans:** `LOGGABLE_DIMENSION_NOUNS`, `loggableUnitSchema`, `isLoggableUnit`,
  `MOVEMENT_STATUSES` / `movementStatusSchema` / `MovementStatus`, `BLANK_SET_MESSAGE`, and verify's
  `REPLAY_REFUSED`. Each is re-checked when its last user goes.

**Stays live:**

- **In the trimmed shared file:** `MAX_SETS_PER_MOVEMENT`, `numericSetSchema`,
  `NUMBER_TOO_HIGH_MESSAGE`, `movementNameSchema` and its tests. So
  `packages/shared/src/strength-session.ts` is trimmed, not deleted.
- **Elsewhere:** `PROGRAM_READ_KIND`, `ACTIVITY_INPUT_SHAPES` (the array), `findOrCreateTypedMovement`,
  `insertEntrySetRows`, `readLiveSets`, `movementIsAvailableTo`, `isLiveProfile`, `ownedEntryIds`.

## Amendment (2026-11-21, PR B)

| Superseded passage                                                                                      | Replaced by                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Mutation patches" → "Re-aim … **36** → the surviving `movementIsAvailableTo` assertion" (done in PR B) | **36 is re-aimed in C2**, in the change that deletes the PICK-1 PR 2 block. Its live targets (`saveWorkout`, `row-steps.ts`, `newItem`, the day-plan read) are proved in the lane modules, which run after `verify.ts`'s body, so while the PICK-1 block exists its `(a)` assertion is always the first to fail. PR B leaves 36 unchanged |

## The proofs, by section

🔴 **Rule:** a section is deleted only when everything it proves belongs to dead code. A section
holding a live proof is cut **inside**, by assertion, and every surviving assertion message stays
verbatim, because mutation `.expect` files match on it.

| Section (banner)                                                                   | Verdict                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V1-6b-2 `weeklyAdherenceRows` parity                                               | delete; mutation 02 re-aimed first (below)                                                                                                                                                                                                             |
| The legacy writer's session / superset / load / day_role round-trips               | delete the writer round-trips only. **Keep** `assertCheckCoversConst('sessions_day_role_check', …)` and the bad-literal reject, which are the only proofs of that CHECK                                                                                |
| V1-13b, V1-30 (the export reads strength rows)                                     | **keep; re-fixture** with the legacy-row builder: they are the only proof that the export still reads rows production already holds (skipped movements, multi-set entries, `day_role` sessions). Messages verbatim                                     |
| GAP-3 composite-FK proof (reads the labeled-movement rows)                         | keep; re-fixture its rows                                                                                                                                                                                                                              |
| P1-1b, V1-9 edit, V1-24 dead-profile edit                                          | delete (the `updateStrengthSetById` guard)                                                                                                                                                                                                             |
| V1-22 chunk 2 writer half                                                          | delete, and retire 34. **Keep the export read side** ("the EXPORT query returns NULL as NULL", mutation 35), re-fixtured: a NULL-snapshot row and a `''` row from the builder                                                                          |
| TEN-1 1b read matrix                                                               | **keep; re-fixture**; drop the `weeklyAdherenceRows` row and the dead write rows. Positive controls (`> 0` rows) stay                                                                                                                                  |
| TEN-1 1c (the legacy writer's household checks)                                    | delete. The live equivalents are `verify/day.ts` 6c (mutations 112, 114) and the nothing-written check                                                                                                                                                 |
| TEN-1 1d **`db:correct` registry**                                                 | **keep untouched** (mutation 05). It is a correction proof, not the writer's                                                                                                                                                                           |
| "TEN-2b WRITE — CLOSED" (`seedProgram` refuses a foreign movement, writes nothing) | **keep**: `seedProgram` runs on every push                                                                                                                                                                                                             |
| TEN-2b-1 ordering, fixture (e)                                                     | delete                                                                                                                                                                                                                                                 |
| PICK-1 PR 2 (`resolveSessionMovements`, the writer's TOCTOU seam)                  | delete, and retire 37 and 38. **Re-aim 36** first (below)                                                                                                                                                                                              |
| V1-9b B0                                                                           | **keep steps 4b, 5 and 6**: the five `client_id` indexes carry no `WHERE`, the slot arbiters stay partial, and the hidden weigh-in replay through live `insertBodyweightEntry`. Delete steps 1–4, the strength case. **Re-aim 39** to the 4b assertion |
| TD replay-owner                                                                    | delete; retire 440–443                                                                                                                                                                                                                                 |
| V1-9b B1-1b and the hide/restore audit                                             | keep; re-fixture (mutation 41's message verbatim); drop the `weeklyAdherenceRows` reader case                                                                                                                                                          |
| `verify/day.ts` TD fix-a-set                                                       | delete; retire 449, 450                                                                                                                                                                                                                                |
| `verify/schema.ts` FAM-1 5b                                                        | drop the `prescribedSnapshotsFor` half; **keep the `programDayRows` assertion** (mutation 55). The file is lane A's: lane A reviews                                                                                                                    |
| Loose ends                                                                         | `verify.ts` `bwOwner = ssArgs.profilePublicId`; `TEN2B_RESOLVER_IDS` naming the deleted `refusedMovementId`; household B's second profile inserted by a deleted block. Each is re-sourced where the block that made it is deleted                      |

**The legacy-row builder, the one re-fixturing path.** A verify-local `legacyStrengthFixture()`:

- **Session and entry rows:** direct inserts of `sessions`, `supersets` and `entries`, with the
  deleted writer's exact column list, frozen and documented as "rows written before LEGACY-1".
- **Sets and quantities:** through the live `insertEntrySetRows`, as `verify/day-plan.ts` already
  does.
- **No old built-in movement.** After #775's PR 1 a fixtures database holds none
  (`legacyMovements` leaves the seed). So the builder, and every section moved onto it, names no
  old built-in by slug or seed id: only test-library rows or items the household made.
- **Required shapes:** a NULL snapshot, a `''` snapshot, a skipped movement with zero sets, a
  multi-set entry, a `day_role` session, and a session with no workout.

🔴 **`logRow` is never a fixture in `verify.ts`'s body.** It can write none of those shapes, and a
fixture call there would make every `log-row.ts` mutation fail on the wrong assertion.

## Mutation patches

⚠️ Superseded 2026-11-21 (the re-aim of 36) — see § Amendment.

| Action                                                                                                                         | Patches                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Retire** (target deleted): `.patch` and `.expect` removed; the README row becomes `_NN — retired (LEGACY-1)_`, row 56's form | 34, 37, 38, 440, 441, 442, 443, 449, 450                                                                                                                                                                                                                                                             |
| **Re-aim** (target live, `.expect` in a deleted block): a new `.expect` and README row, proved with `--only`                   | **02** → a positive `A_SCOPE` read placed beside `A_SCOPE`'s definition, a stable home; **36** → the surviving `movementIsAvailableTo` assertion (it then shares one with 114 or 134; the README says so); **39** → B0 step 4b (with the comment there about "not independently isolable" rewritten) |
| **Kept with its section**: no change; listed so the PR shows it stays RED                                                      | 05, 35, 41, 04, 06, 42, 129                                                                                                                                                                                                                                                                          |
| **Re-cut** (context quotes deleted code; +/- lines byte-identical; `--only` RED)                                               | **03** (only its `writeStrengthSession` hunk goes; its README prose "the other six" is updated), **12** (`readsHouseholdProgram` in context), **11** and **55** if `program-day.ts`'s comment naming `prescribedSnapshotsFor` is rewritten                                                           |

The runner fails a patch whose **first** failure is not its `.expect` (`mutations.mjs`), so
"still RED" is not enough: each re-aimed and re-cut patch is run with `--only` locally, and CI's
shards run them all.

## The rows this settles

- **`TEN-2b-1` closes as overtaken.** It moves find-or-create inside `writeStrengthSession`'s
  transaction, which is deleted.
  - **The ordering assertion** (`entries.test.ts`: the catalog INSERT commits before `begin`) is
    **retired deliberately**, in the PR that deletes `logStrengthSession`, with this record. Its row
    said it "must be changed deliberately, never deleted", and it guarded the legacy creator alone.
  - **The live creator has no such race.** `newItem` creates in one transaction, and every refusal
    returns before the insert, so it never leaves a created-then-refused row.
- **`TEN-2b-2` is re-scoped, not only re-sequenced.** Its predicate, "a custom movement nothing
  references → hard DELETE", now matches the items `newItem` commits **on purpose** before any
  workout uses them. The picker lists them, and the item cap counts them. Its row is reworded to
  say so, and that it needs a boundary before it is built. The boundary is the maintainer's decision
  (**Needs a decision** below).
- **`V1-36` closes with the path.** Its gap is in `updateStrengthSetById`'s edit guard, which is
  deleted, and the client check it cites (`set-display.ts`) no longer exists.
- **The evals' write-path invariant** (`packages/evals/src/cases/invariants.ts`) parses
  `strengthSetSchema`, which no reachable write has parsed since FAM-1 12f. This is pre-existing,
  found by the panel. It is **re-pointed at the live day schemas** (`rowValuesSchema` /
  `rowWriteSchema`) in the PR that removes the schema's last consumer, so the "LLM never authors
  loads" gate tests the path that writes.

## Left in the schema, on purpose (for the record; a later contract step)

After this plan nothing writes or reads:

- `ramp_targets`, beyond erasure and verify;
- `sessions.day_role` and `feel`;
- `supersets.label` and `note`;
- the NULL arm of `entries.prescribed_snapshot`;
- inserts into `uq_entries_superset_order`.

`sessions.client_id` and `supersets.client_id` are server-minted now, so their indexes no longer
arbitrate a replay. Production rows still hold all of these, and the export still reads them. One
new tech-debt entry records it; dropping any of them is a separate expand→contract change.

## Docs that ride with it (each with its PR)

- **Feature guides:**
  - `strength-logging.md`: `owns:` loses the deleted files; the legacy writer, DAL and invariants go;
    `units.ts` is covered.
  - `write-path.md`: `weekly-adherence.ts` leaves `owns:`; the legacy-path passages go.
  - `programming.md`: its claim that `readsHouseholdProgram` enforces the read is false; the code
    enforces it inline with `PROGRAM_READ_KIND`.
  - `delete-and-restore.md`: the `weeklyAdherence` reader row.
  - `day-writers.md`, `movement-picker.md`: references to the deleted guard and resolver.
- **Contract file:** `program-contract.md` cites `resolveSessionMovements`. Lanes never edit it, so
  the sentence goes to the Roadmap Thread.
- **Other docs:**
  - `docs/architecture.md`: the legacy session-write diagram is **removed**, not replaced.
  - `.github/SECURITY.md`: the find-or-create paragraph.
  - `docs/privacy/data-inventory.md`: "the callerless `logStrengthSession`".
  - Comments that go stale: `apps/web/lib/constants.ts`'s `editStrengthSetAction`, `new-item.ts`'s
    "the strength logger's own find-or-create", `csv/value.ts`'s chain-test cite, and
    `queries/weekly-adherence.ts`'s callers.
- **Rows:**
  - `tech-debt.md`: the entry narrows to the older-day half; `entry-label.ts` is kept by D21; the
    stale line cites are **deleted**, not corrected.
  - `plan.md`: `LEGACY-1` links this plan (PR 0), then closes (last PR).

## Order and split

**Parallel work (gate 1):**

- **#770** (CAT-3 A2-ii) edits `verify.ts`, `verify/schema.ts`, `mutations/README.md` and
  `write-path.md`.
- **#710** edits `mutations/README.md`; **#791** edits `write-path.md`.
- **#775's PR 1** ("F1-i", the post-fresh-start plan, not open yet) re-cuts `verify.ts`'s TEN-1 1d,
  TEN-2a, TEN-2b and TEN-2c, renames `PROGRAM_SEED` to `LEGACY_PROGRAM_FIXTURE`, and is read by
  `verify/schema.ts`'s FAM-1 5b. Neither plan waits on the other: **whichever lands second re-reads
  its sections by assertion message and re-derives its patch list from the `.expect` files**
  (agreed with the Roadmap Thread, 2026-11-21).
- **PRs B and C wait for #770** to merge (it moves `verify.ts`), and re-read the sections by banner
  afterwards. PR A touches none of those files. `roadmap.md`'s In flight records the order (PR 0).

| PR     | Scope (one concern)                                                                                                                                                                                                    | Guides and rows in it                                                                                                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0**  | this plan and its log; the `LEGACY-1` row links it; roadmap In flight                                                                                                                                                  | `plan.md`, `roadmap.md`                                                                                                                                                                                                             |
| **A**  | exports nothing imports: `readsHouseholdProgram`, `STRENGTH_DAY_ROLES`, `loggableUnitsOf`, `ACTIVITY_INPUT_SHAPE` and their fixpoint orphans; mutation 12 re-cut. **Typecheck is the proof.**                          | `programming.md`, `strength-logging.md` (`units.ts`)                                                                                                                                                                                |
| **B**  | **re-fixture and re-aim, writer still present:** `legacyStrengthFixture()`; the kept sections moved onto it; 02, 36 and 39 re-aimed. Every proof green before anything is deleted. **After #770**                      | `write-path.md` if it cites a moved proof                                                                                                                                                                                           |
| **C1** | **app half:** `logStrengthSession` and `editStrengthSet` and their tests, the `WRITES` rows, the ordering assertion retired with its record                                                                            | `write-path.md`; `TEN-2b-1` closed, `TEN-2b-2` re-scoped                                                                                                                                                                            |
| **C2** | **packages half, pure deletion:** the writer, resolver, `prescribedSnapshotsFor`, `weeklyAdherenceRows`, the legacy schemas and `strengthSetSchema`, the dead sections; mutations retired and re-cut; evals re-pointed | `strength-logging.md`, `write-path.md`, `delete-and-restore.md`, `day-writers.md`, `movement-picker.md`, `architecture.md`, `SECURITY.md`, `data-inventory.md`; `V1-36` and `LEGACY-1` closed; the schema-leftovers tech-debt entry |

Each PR has its own branch and worktree, a changelog fragment, and full CI (e2e, `quality`, the
`mutations` shards). Each PR's description links its section here. Each PR gets a heads-up to the
board; lane A reviews the `verify/schema.ts` hunk in C2.

## Decided (maintainer, 2026-11-20)

1. **`TEN-2b-2`'s boundary is deferred to its own plan** (option (c), recommended). This plan only
   rewords the row so it can no longer be built on the old predicate.
2. **v2 is approved.** PR A may start now; PRs B and C wait for #770.

## Review-response log

Panel (2026-11-20): correctness (Fable), db-safety (Fable), scope (Fable). All three: **v1 not
ready.** Every finding below was checked against the code before it was accepted.

| #   | Lens                          | Finding                                                                                                                                                                                                                                   | Response                                                                                                                                                                                                   |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | all three                     | P0: the v1 proof table's line spans were call-site ranges, and swallowed live proofs: the `day_role` CHECK, B0's `client_id` index shapes and weigh-in replay, the `db:correct` registry, `seedProgram`'s refusal, the export's NULL read | **Fixed:** the table is keyed by banner and cut inside sections; each named proof is kept                                                                                                                  |
| 2   | all three                     | P0: kept patches 02, 05, 35, 36, 39 had their `.expect` inside deleted spans                                                                                                                                                              | **Fixed:** re-aim 02/36/39; 05/35 kept with their sections. The keep list was re-derived from the `.expect` map (514 lines; 13 in the v1 spans)                                                            |
| 3   | scope, db-safety, correctness | P0/P1: v1's PR 2 (weeklyAdherence) was red alone: more callers, mutation 02, the delete-and-restore guide                                                                                                                                 | **Fixed:** folded into C2; 02 re-aimed in B first                                                                                                                                                          |
| 4   | db-safety, correctness        | P1: v1's PR 3 broke the `packages/db` typecheck (`SessionMovementInput`)                                                                                                                                                                  | **Fixed:** the shared schemas move to C2                                                                                                                                                                   |
| 5   | db-safety, correctness        | P1: re-fixturing through `logRow` cannot write the legacy shapes and would turn the proofs into program-row proofs; hand-typed rows assert what they typed                                                                                | **Fixed:** one frozen legacy-row builder, with sets through the live `insertEntrySetRows`; `logRow` is never a fixture                                                                                     |
| 6   | correctness                   | P1: `TEN-2b-2`'s predicate now matches items `newItem` makes on purpose                                                                                                                                                                   | **Accepted:** re-scoped; boundary to the maintainer                                                                                                                                                        |
| 7   | correctness, scope            | P1: the `TEN-2b-1` record must ride with the assertion's deletion                                                                                                                                                                         | **Fixed:** C1                                                                                                                                                                                              |
| 8   | correctness                   | P1: `strengthSetSchema` is "live" only through an eval that tests no write path since 12f                                                                                                                                                 | **Accepted:** deleted with the legacy schemas; the eval is re-pointed at the live day schemas in C2                                                                                                        |
| 9   | scope                         | P1: split by risk (dead exports / re-fixture / delete), not by package; make 4a/4b unconditional                                                                                                                                          | **Accepted:** A, B, C1, C2. B (re-fixture) always precedes deletion                                                                                                                                        |
| 10  | scope                         | P1: cut `findOrCreateMovement` (not legacy; 19 refs; collides with #770)                                                                                                                                                                  | **Accepted:** out of scope                                                                                                                                                                                 |
| 11  | scope                         | P1: the V1-22 freeze is answerable now                                                                                                                                                                                                    | **Fixed:** delete the writer half; the live proof is `verify/day.ts` "9" (mutation 129). The export read side is kept                                                                                      |
| 12  | scope                         | P1: the parallel-work rubric was not run                                                                                                                                                                                                  | **Fixed:** B and C wait for #770; the order goes in roadmap In flight                                                                                                                                      |
| 13  | scope                         | P1: guides and rows were assigned to the wrong PRs                                                                                                                                                                                        | **Fixed:** a guides-and-rows column per PR                                                                                                                                                                 |
| 14  | scope                         | P1: V1-13b/V1-30 may duplicate `verify/day.ts`'s export proofs                                                                                                                                                                            | **Pushed back:** those prove the export over rows the live writer writes. These are the only proof over legacy-shaped rows (skipped, multi-set, `day_role`) that production still holds. Kept, re-fixtured |
| 15  | db-safety                     | P2: record what becomes write-dead in the schema                                                                                                                                                                                          | **Accepted:** "Left in the schema", plus a tech-debt entry in C2                                                                                                                                           |
| 16  | db-safety                     | P2: TEN-1 1c's equivalent was mis-cited                                                                                                                                                                                                   | **Fixed:** `verify/day.ts` 6c and the nothing-written check                                                                                                                                                |
| 17  | correctness, db-safety        | P2: missed callers (`verify/schema.ts` 5b, loose fixtures, `MOVEMENT_NOT_AVAILABLE`, the fixpoint orphans, 11/55 context)                                                                                                                 | **Fixed:** listed                                                                                                                                                                                          |
| 18  | scope                         | P2: ceremony (an owner-review column, five per-PR description duties, redrawing `architecture.md`, correcting stale cites)                                                                                                                | **Accepted:** cut. PRs link the plan; the diagram is removed; cites are deleted                                                                                                                            |
| 19  | scope                         | P2: one branch for five PRs breaks `status:check`                                                                                                                                                                                         | **Fixed:** a branch and worktree per PR                                                                                                                                                                    |
