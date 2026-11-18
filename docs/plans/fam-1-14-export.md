# FAM-1 14 — The export carries what the day page logs

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step 14. Branch: `feat/fam-1-14-export`. Lane E. **Rev 2**: reshaped by a five-lens panel (§
> Review-response log). It now goes to the maintainer for approval. No implementation code is
> committed before that approval.

## Goal

What a person logs in the app reaches their export, in a file a spreadsheet opens.

Today two things fall out (both are in the code, `apps/web/lib/dal/export.ts`):

1. **Program rows.**
   - A ✓ on the day page writes one entry per set (11b). The export writes each entry as its own
     `strength-log` row with `sets=1`, and it never writes the workout's name.
   - A **Count logged in `count`** makes the **whole export throw**: `assertExportableUnit`
     (`packages/shared/src/csv/value.ts:62`) refuses the unit.
   - So once 12c puts the program on the day page, one Count ✓ breaks that athlete's export.
2. **Check-ins.**
   - The check-ins file is always header-only (`buildCheckins([])`, `export.ts:198`).
   - Practice, habits, calisthenics and the old check-in rows are stored as entries. None of them
     reach the export.

**Split:** **14a** fixes the program rows; **14b** writes the check-ins file. One plan, two PRs.

**12c waits on 14a only**, and 14a waits on Q1. 12c is what makes program rows loggable, so 14a
closes the gap 12c opens. The check-ins gap predates FAM-1 (3b-page, #418) and does not block 12c.
This **replaces two earlier orderings** in the FAM-1 plan:

- `:1036`, "14 gates 15, not 12c".
- `:958`, "14 gates 12b". 12b merged dark as #528 and writes no row a person can reach.

14a updates both lines (§ Docs).

**Roadmap alignment (2026-11-17):** advances `FAM-1` lane E. Gated by 11b (#470, merged). 14a gates
12c. Checked against the private roadmap: nothing to add here, since the export's direction is
public, in ADR 0009. `ID-1`: its six items are answered in the log; nothing new is keyed on the
household.

## Acceptance

From §5 row 14 (`fam-1-family-program.md:575`), verbatim:

> a comma in a workout name round-trips; template rows of each type

Done when:

- **14a**
  - **One row per exercise.** The `strength-log` file has one row per **program item in a session**,
    not one per set. A ✓ on sets 1–3 of a bench reads `…,bench-press,3,8,25,…`, as a strength-form
    row of the same sets would.
  - **Purged prescriptions stay apart.** Two purged prescriptions of different movements export as
    two rows.
  - **A new `workout_name` column**, last, carries the session's frozen `workout_name`.
    - It is never an id and never the live name: a workout renamed after the ✓ exports the old name.
    - It is empty for a row logged outside a program, and for a session that belongs to another
      athlete.
  - **No tracking type throws.** Every type, in every unit it takes, exports a row whose bytes are
    pinned: Check, Count, Reps, Weight × reps, Duration, Time per set and Distance.
  - **Bare numbers in `load` mean pounds.** No bare number in `load` is anything but pounds.
  - **Standard quoting.** The file is quoted the RFC 4180 way throughout. A workout name or note
    with a comma or a double quote parses back exactly in a standard reader.
  - **The privacy notice and inventory say what the export now holds**, including that a workout
    name goes out as typed.
- **14b**
  - The check-ins file carries one row per live check-in entry, in the shape Q2 settles.
  - Every live entry of a month lands in **exactly one** file.

## 14a — program rows in the strength log

Size estimate: about 300 lines of code and tests, plus the docs. That is under the 400 target, so
14a is one PR.

### File by file

- **EDIT `packages/db/src/queries/day/program-rows.ts`** — two helpers, written once (reuse).
  - `programItemKey(row: { prescriptionId: number | null; movementId: number | null }): string`
    returns `p:<prescriptionId>`, or `m:<movementId>` once the prescription is purged. The day
    resolver's R4 uses it (`day-plan.ts:618`), and so does the export.
  - `byFirstLogged(bySet: boolean)` is the comparator `firstOf` already uses: the lowest set where
    `bySet`, then `created_at`, then id. Today it is written inline twice (`day-plan.ts:522`,
    `:638`), and it replaces both.
  - Neither changes what the day page shows. The 12a proofs stay green as they are, which is the
    check.
- **EDIT `packages/db/src/queries/export-month.ts`.**
  - **The select** gains `prescriptionId`, `prescriptionSet`, `workoutName` (`sessions.workout_name`)
    and `createdAt` (`entries.created_at`).
  - **The sessions join's ON** gains `sessions.profile_id = entries.profile_id` (runbook pre-flight
    (i), `day-writers.md` invariant 13). The athlete's own entry is still exported. A foreign
    session's columns come back NULL, so it never lends its name or its `session_type`. This is ON
    and not WHERE, unlike the resolver: the resolver drops a row it cannot place, and the export
    must keep the athlete's row.
  - **NEW `foldStrengthMonth(rows): FoldedStrengthRow[]`, moved here from `export.ts`.** It is pure,
    so `db:verify` can run the whole chain. The export's own `FoldedStrengthRow` type moves with it.
    - **The key** is `e:<entryId>` for a row outside a program. For a program row it is
      `s:<sessionId>:` plus `programItemKey(row)`. "Program row" is `prescriptionSet !== null`; the
      select carries it as `isProgramRow: sql<boolean>` built from `programRow()`, so the rule is
      written once.
    - **Sets** go in `prescription_set` order, using `byFirstLogged(true)`. The query's
      `created_at` order is not the set order.
    - **`prescribed`, `notes` and `status`** come from the first row by `byFirstLogged(true)`: R4's
      rule, the lowest set first.
    - The day page heads a _live_ item whose rows all show with its earliest-logged row (`:603`).
      The two differ only when a later set was ticked first and the prescription was edited in
      between. The export follows the lowest set because a file row stands for the whole item, as a
      removed item does. This is stated in `csv-export-contract.md`.
    - **R7** (a one-row type) holds without code: a Check, Count or Duration has one slot, and
      `uq_entries_session_prescription_set` allows one live entry per slot.
- **EDIT `apps/web/lib/dal/export.ts`.** It calls `foldStrengthMonth`. The `prescribed` fallback
  (`resolvePrescribed`) stays here, unchanged.
- **EDIT `packages/shared/src/csv/aggregate.ts`** — where a Count's number goes (Q1).
  - In a set with no reps, a **primary quantity whose unit measures a count** becomes that set's
    `reps`. The test is `dimensionOf(unit) === UNIT_DIMENSION.count`, the helper `value.ts:80`
    already exports. That quantity is then left out of `load`.
  - A set that carries **both** reps and a count quantity **throws**: the export never picks one.
  - `CSV_UNIT_SUFFIX.count` **stays `null`**, so `assertExportableUnit` still refuses a `count` that
    reaches `load` (`value.ts`, `units.test.ts:98` unchanged).
  - The result is `…,plank-taps,1,25,,…`.
- **EDIT `packages/shared/src/csv/row.ts`** — one quoting rule.
  - Any field that holds a `,` or a `"` is wrapped in `"…"`, with each inner `"` doubled (RFC 4180;
    ADR 0009 §3(c), "preferred").
  - `QUOTABLE` is deleted, along with the non-quotable comma throw and its docblock. A comma in a
    movement or a load cannot shift a column any more, because it is quoted.
  - The line-break throw stays: a line break in any field still refuses.
  - The docblock now states the one rule and says why the legacy raw inch marks went (ADR 0009 §4).
- **EDIT `packages/shared/src/csv/strength-log.ts`.**
  - `STRENGTH_LOG_HEADER` gains **`workout_name`** as the last column, and `StrengthLogRow` gains
    `workoutName: string | null`.
  - It is named `workout_name`, not `workout`, because every program row's `session_type` already
    reads `workout`.
  - It is last so the first eight columns, and the fixtures that pin them, are untouched; a file
    diff then shows only the new column.
- **EDIT `packages/shared/src/csv/columns.ts`** (only if 14b needs it): `csvToken()`, the `_`→`-`
  that `csvMovement` and `csvSessionType` both write today.
- **Tests (vitest).**
  - **NEW `packages/shared/src/csv/strength-log-types.test.ts`**, next to the code it covers.
    - It is **derived**: for each tracking type in `TRACKING_TYPES`, and each unit that type takes,
      it builds the set through `fillRowValues` and `entryUnitFor`, as the row writer stores it.
    - It pins the row's bytes, including today's Distance `(40yd)` and Time per set's empty `reps`.
      Each is written into `csv-export-contract.md`.
    - A new tracking type or unit with no pinned shape fails the test.
  - **EDIT `packages/shared/src/csv/row.test.ts`** (new, or the nearest): `"Heavy, ""A"""`, a note
    with a bare `"`, and a note that opens a `"`. These are exact-byte assertions, which is what
    RFC 4180 specifies. No test-side reader is written.
  - **NEW `packages/db/src/queries/export-fold.test.ts`** covers `foldStrengthMonth`:
    - three sets of one prescription make one row;
    - one movement twice in a workout makes two rows;
    - two purged prescriptions of different movements make two rows, each with its own slug;
    - when set 2 is ticked before set 1, with different loads and snapshots, the loads come out in
      set order and the row carries set 1's `prescribed`;
    - a legacy strength entry is unchanged.
  - **Changed on purpose:**
    - `apps/web/lib/csv/strength-log.test.ts:237-243` pins a `count` refusal with reps set. It moves
      to `bool` and `timing`.
    - `strength-log.test.ts:333` (inch marks) now expects the quoted bytes.
    - Every fixture row gains a trailing `,`, and the file-shape header test (`:364`) changes.
  - **Repaired:** `apps/web/lib/dal/export-prescribed.test.ts`'s `prescribedCellOf` splits on `,`.
    It moves to an exported test helper next to `row.ts` that reads one RFC 4180 line, the only
    reader in the tests. `flatRow` gains defaults for the new columns.
- **`db:verify`** (`packages/db/scripts/verify/day.ts`, after the 11c proofs, using the existing
  `fixture()`). One proof, `14a: the strength log carries the program`:
  - it ticks every `f.p.*` type through `logRow`, plus a second set of the reps item;
  - it renames the workout through `saveWorkout`;
  - it plants a set in another athlete's session (the (i) detector world) and a hidden set
    (`plantHiddenSet`);
  - it reads `strengthMonthRows`, folds it, builds the file, and asserts the file's bytes.

  **Mutations 364–366** (lane E's block, given by the board):
  - 364: the select reads the live `workouts.name`, so the rename shows.
  - 365: the sessions join drops `profile_id`, so the foreign session lends its name.
  - 366: `programItemKey` drops the movement fallback. The proof's purged pair (two prescriptions
    purged in place) folds into one row.

- **Docs.**
  - **`docs/csv-export-contract.md`:**
    - the one quoting rule (the "write raw" paragraph goes);
    - `workout_name`;
    - the fold and its lowest-set rule;
    - the Count rule;
    - each tracking type's row.
  - **`packages/shared/src/text.ts:11-23`:** the "a quote carries no special meaning" comment points
    at `row.ts` instead of restating the rule.
  - **`docs/privacy/notice.md`:**
    - the export paragraph: the strength log carries program rows and the workout's name;
    - `:236`, "your athletes' names are not in the files", becomes precise. Files are named by id
      and the name field is never written; anything typed into a workout name or a note goes out as
      typed;
    - `:65`: the free-text sentence gains the workout name and drops "How it felt", which the
      export never wrote;
    - `:57-58`: "Nothing writes to them today" is stale since 11b;
    - the "does not yet include" list gains the household's programs (only the frozen name on a
      logged row goes out).
  - **`docs/privacy/data-inventory.md`:**
    - a dated "re-read for FAM-1 step 14" entry;
    - `:243`, "the frozen workout name", is now exported;
    - `:448`'s claim that `feel` is exported is corrected against the code
      _(the board, 2026-11-17: fix the wrong one)_;
    - §6, `:629-641`: `workout_name` is now in "what it contains";
    - `:646-651`: step 14's two decisions, as "Decided": the export names a program only through
      `sessions.workout_name` on a logged row; `program_assignments`, `workouts.description`, item
      notes and targets are not exported.
  - **`docs/plans/fam-1-family-program.md`:**
    - row 14 splits into 14a and 14b and links this plan;
    - `:958` and `:1036` are reworded to the new gate;
    - the 12c row (`:612`) and the lane table (`:735`) gain the 14a dependency;
    - row 14's "spellings for `mi`, `count`, `bool`; `entryUnitFor`'s (C10)" is answered: `mi`
      already has its spelling (step 3), `bool` stays refused because a Check stores no quantity,
      and the file reads the units as stored on the quantities, which `entryUnitFor` chose at log
      time.
  - **`docs/plan.md`:** IMP-2 now diffs the first eight columns.
  - **`docs/features/write-path.md`:**
    - the export seam;
    - the session-ownership ON;
    - the stale `export.ts → prescribedFor` cite at `:797`, which also appears at
      `apps/web/lib/dal/scoped.test.ts:67`.
  - **`docs/features/day-writers.md`** (it owns `verify/day.ts` and `queries/day/`): the two helpers,
    the proof, and mutations 364–366.
  - The changelog fragment.
  - `export.ts`'s docblock "a MISSING file and an EMPTY file are different inputs to the workflow" is
    refreshed (ADR 0009).

### Alternatives rejected

- **Aggregate in SQL** (`GROUP BY session, prescription`). The fold exists, and it keys sets by row
  for the slash-lists. A second aggregation path would drift from it.
- **One row per set, as today.** That reads as three one-set exercises where the athlete did one
  three-set exercise, and the step 14 row asks for one row per item.
- **Quote only `workout_name`** (rev 1). A note that opens a `"` would throw a standard reader off
  for the rest of the line, workout cell included. That is three quoting regimes where one is less
  code, and only one legacy byte test changes.
- **`count` as `25ct` in `load`.** It would add an invented token. `reps` already means "how many".
- **Fold in the DAL, tested by vitest only** (rev 1). The fold is the top risk, and `server-only`
  keeps `db:verify` away from it.

### Risks

- **A wrong number in `load`** is the injury risk this exporter is built around.
  - The Count rule keeps `CSV_UNIT_SUFFIX.count = null`, so the refusal still guards `load`.
  - The derived test pins every type's bytes.
  - Mutation 366 guards the one fold mistake that would put one movement's loads in another's row.
- **Byte changes.** These are the intended ones: a trailing `,` on every row, `workout_name` in the
  header, and quoted fields where a value holds `,` or `"`. The fixtures show nothing else moved.
- **A foreign session.** Before this, the export read `session_type` from a session it never checked.
  That dates from V1-13b, and the ON fixes it too. It is stated in the changelog.

## 14b — the check-ins file (shape only)

Its file-by-file comes after Q2. This panel did not review a 14b format, only these constraints on
it:

- **Which entries are check-ins.** Live entries with `movement_id IS NULL` whose activity is not
  `weigh_in`.
  - Bodyweight stays in its own file, with its own handling (`.github/SECURITY.md:134`).
  - A `db:verify` proof asserts that every live entry of a fixture month lands in exactly one file.
- **Each row says what it measures.** The row is keyed by activity and metric:
  `date,activity,metric,value,unit,notes`, with `metric` set where `metric_key` is set
  (`pushups`, `practice-minutes`). Calisthenics records four metrics under one activity, and the old
  check-in activity records seven.
  - Tokens come from `ACTIVITY_TYPE_KEYS` and `METRIC_KEYS` through `csvToken()`.
- **The stored unit is always written**, as a unit code (`min`, `count`, `bool`, `timing`). A clock
  time and a `done` are then never ambiguous.
- **The old check-in rows are included.** Their seven metrics are the legacy header's own columns
  (`ACTIVITY_METRIC_MAP`), and they are held today with no way out.
- **Free text** (`value_text`, `notes`) goes into the inventory's §3 and §6 in the same PR.
- **Tests.** `apps/web/e2e/export-full-day.spec.ts:161` asserts the file is header-only, so 14b
  changes that assertion and runs `e2e:local`. The stale `checkinMonthRows` mock
  (`export-prescribed.test.ts:20`) becomes the real query or is deleted.

## Out of scope (sent to the board)

- **Who may download bodyweight.** `.github/SECURITY.md:134` says "the household operator". The
  export checks household membership, and the notice says "the adult". That has been true since
  V1-13b and AUTH-1, and 14a/14b do not widen it. This is a decision for the maintainer.
- **Spreadsheet formula injection.** A note or workout name starting with `=`, `+`, `-` or `@` runs
  as a formula in a spreadsheet. `notes` has the same exposure today. This is a question for the
  security lens and the maintainer, not a quiet change to what people typed.
- The readiness colour, "how it felt" and per-athlete targets stay on the notice's "not yet" list.
- The zip export's rate limit and empty-export behaviour stay as tech-debt rows, unchanged.

## Questions for the maintainer

- **Q1, which gates 14a.** Where does a Count logged in `count` go? Proposed: its number goes in
  `reps` and `load` stays empty (`…,plank-taps,1,25,,…`). The alternative is a suffix in `load`
  (`25ct`).
- **Q2, which gates 14b.** The check-ins file's shape. Proposed:
  `date,activity,metric,value,unit,notes`, which replaces the legacy nine columns. The alternative
  keeps the nine-column header and adds columns per check-in.
- **Q3, standard quoting for the whole file.** This changes one legacy byte test: inch marks in a
  note are now quoted. ADR 0009 calls standard quoting "preferred".

## Review-response log

### Engineering panel (round 1, on rev 1, 7e609e34)

> Lenses: correctness, scope, architecture, reuse and privacy, all on **Opus 5.5** (Fable is
> spend-limited until 2026-11-19). Each ran read-only, in parallel.

| #   | Lens                                                                 | Critique (short)                                                                                                                                  | Verdict                    | Resolution                                                                                                                                              |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | correctness, architecture, reuse (BLOCKING); scope, privacy (SHOULD) | The fold key `p:<session>:<prescriptionId>` merges every purged prescription of a session into one row, putting one movement's loads in another's | **accepted**               | `programItemKey` (R4's own fallback) shared by the resolver and the export; fold case; mutation 366                                                     |
| 2   | correctness                                                          | The fold is out of reach of every proof (`server-only`)                                                                                           | **accepted**               | `foldStrengthMonth` moves to `export-month.ts`; the `db:verify` proof asserts the built file's bytes                                                    |
| 3   | architecture                                                         | The new `workout_name` is read from a session never checked to be the athlete's                                                                   | **accepted**               | The sessions join's ON gains `profile_id` (ON, not WHERE, and why); mutation 365                                                                        |
| 4   | correctness, architecture, reuse                                     | The `count` change is planned in the wrong files; the obvious edit would remove the `load` refusal                                                | **accepted**               | It is moved to `aggregate.ts`, keyed on `dimensionOf`; `CSV_UNIT_SUFFIX.count` stays `null`; reps plus a count throws; the two changed tests are listed |
| 5   | architecture, scope                                                  | Quoting only `workout` leaves a note's opening `"` breaking a standard reader; three quoting regimes                                              | **accepted** (Q3)          | One RFC 4180 rule for the file; `QUOTABLE` deleted; one legacy test changes                                                                             |
| 6   | privacy (BLOCKING)                                                   | The inventory names step 14 as the owner of two decisions and notice sentences; several inventory lines go false                                  | **accepted**               | § Docs lists each line, the "Decided" entry and the notice's programs line                                                                              |
| 7   | privacy                                                              | `notice.md:65` falsely says "How it felt" is exported; `:236` overclaims once a workout name ships; `:57` is stale                                | **accepted**               | All three are in § Docs (the `feel` fix as the board asked)                                                                                             |
| 8   | reuse, correctness                                                   | "Lowest set" is a third copy, unstated against the `:603` heading rule, and the query's order is not set order                                    | **accepted**               | `byFirstLogged` is extracted (also removes the duplicate in `day-plan.ts`); the rule and its difference are stated; the set-2-first case is a test      |
| 9   | correctness                                                          | Mutation 2 cannot fail without a rename; mutation 3 has no target; nothing covers a wrong `prescriptionId`                                        | **accepted**               | The proof renames; the mutations are now 364–366 above (the fold key replaces the untargetable one)                                                     |
| 10  | scope                                                                | The proof re-proves filters `verify.ts` already proves                                                                                            | **accepted**, in part      | One proof on the existing `fixture()`; the hidden and foreign plants stay, because they now test the new ON and the fold, not the old filters           |
| 11  | correctness, reuse                                                   | "Every type" is a hand list without bytes                                                                                                         | **accepted**               | A derived type × unit test pins every shape, colocated in `packages/shared`                                                                             |
| 12  | scope, architecture, correctness                                     | The gate contradicts `:958`/`:1036`; row 14's `bool`/C10 asks depart silently; the plan and guides go unlinked                                    | **accepted**               | § Goal names the replaced orderings; § Docs updates row 14, `:958`, `:1036`, 12c, the lane table and `day-writers.md`                                   |
| 13  | scope                                                                | 14a waits on Q1 too; no size estimate                                                                                                             | **accepted**               | "14a waits on Q1" is stated; about 300 lines                                                                                                            |
| 14  | architecture                                                         | `workout` next to `session_type = workout` misleads; "positional reader" is a retired reason                                                      | **accepted**               | `workout_name`, last, for the fixture-diff reason                                                                                                       |
| 15  | reuse                                                                | Two CSV readers in the tests; `prescribedCellOf` breaks on a quoted field                                                                         | **accepted**               | One exported test reader next to `row.ts`; the round trip is exact bytes                                                                                |
| 16  | reuse, architecture                                                  | `prescriptionSet !== null` restates `programRow()`                                                                                                | **accepted**               | It is selected as `isProgramRow` from `programRow()`                                                                                                    |
| 17  | privacy, reuse, architecture                                         | 14b: bodyweight must stay out, the old rows must come in, `activity` cannot tell metrics apart, unit codes, "which entries"                       | **accepted**               | They are the § 14b constraints; Q2 now proposes `activity,metric`                                                                                       |
| 18  | privacy, architecture                                                | Bodyweight audience (`SECURITY.md:134`); spreadsheet formula injection                                                                            | **out of scope**, to board | Neither is widened by 14; both are decisions for the maintainer (§ Out of scope)                                                                        |
| 19  | NITs                                                                 | Distance `(40yd)` and Time per set's empty reps unstated; test colocation; the IMP-2 diff; stale docblocks; "Heavy A" not the fixture's name      | **accepted**               | Pinned by the derived test and the contract doc; tests colocated; IMP-2 and the docblocks listed; the proof names `fixture()`                           |

### `ID-1`'s six keep-open items (privacy lens)

| Item                   | Answer                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · login ↔ profile    | Nothing ties a profile to a login                                                                                                                                                |
| 2 · access path        | Unchanged: `sessionUserOrNull`, the household-scoped `getProfileByPublicId`, `isLiveProfile`                                                                                     |
| 3 · one household each | Nothing assumes it                                                                                                                                                               |
| 4 · keys               | The fold key is session plus program item, not household plus profile. `prescriptionId` and `sessionId` stay on `FoldedStrengthRow`, never a column. The zip path is `public_id` |
| 5 · age                | No age logic                                                                                                                                                                     |
| 6 · roles              | Untouched. The bodyweight audience question goes to the board                                                                                                                    |

The frozen `workout_name` (mutation 364) is also what `ID-1`'s "take your own history" needs: the
exported row does not depend on a household-owned `workouts` row.
