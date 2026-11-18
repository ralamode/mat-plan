# FAM-1 14 — The export carries what the day page logs

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step 14. Branch: `feat/fam-1-14-export`. Lane E. **Rev 3, approved** by the maintainer
> (2026-11-17, relayed by the board), after a five-lens panel and a re-review (§ Review-response
> log). Q1–Q3 are answered below. 14a is built in this PR; 14b follows in its own.

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
  - `byFirstLogged(bySet: boolean)`, typed structurally over
    `{ set: number | null; createdAt: Date; id: number }`, is the comparator `firstOf` already uses: the lowest set where
    `bySet`, then `created_at`, then id. Today it is written inline twice (`day-plan.ts:522`,
    `:638`), and it replaces both.
  - Neither changes what the day page shows. The 12a proofs stay green as they are, which is the
    check.
- **EDIT `packages/db/src/queries/export-month.ts`.**
  - **The select** gains `prescriptionId`, `prescriptionSet`, `workoutName` (`sessions.workout_name`),
    `createdAt` (`entries.created_at`) and `entrySessionId` (`entries.session_id`).
  - **The ORDER BY** reads `entries.session_id` where it read `sessions.id`. They are equal for every
    owned row, so no byte moves; a row of a foreign session (whose `sessions.id` is now NULL) keeps
    its place instead of sorting last.
  - **The sessions join's ON** gains `sessions.profile_id = entries.profile_id` (runbook pre-flight
    (i), `day-writers.md` invariant 13). The athlete's own entry is still exported. A foreign
    session's columns come back NULL, so it never lends its name or its `session_type`. This is ON
    and not WHERE, unlike the resolver: the resolver drops a row it cannot place, and the export
    must keep the athlete's row.
  - **NEW `foldStrengthMonth(rows): FoldedStrengthRow[]`, moved here from `export.ts`.** It is pure,
    so `db:verify` can run the whole chain. The export's own `FoldedStrengthRow` type moves with it.
    - **The key** is `e:<entryId>` for a row outside a program. For a program row it is
      `s:<date>:<entrySessionId>:` plus `programItemKey(row)`, keyed on the entry's own
      `activity_date` and `session_id`, never on the joined `sessions.id`, which the ON makes NULL for
      a foreign session. The date is in the key because nothing in the schema ties an entry's date
      to its session's, or forces a purged program row to keep a session; with it, a key never spans
      two days even on hand-corrected data. The workout name and `session_type` still come only
      through the owned join. "Program row" is `prescriptionSet !== null`; the
      select carries it as `isProgramRow: sql<boolean>` built from `programRow()`, so the rule is
      written once.
    - **Sets** go in `prescription_set` order, using `byFirstLogged(true)` over the entry-level
      records (`set: prescriptionSet`, `id: entryId`), not the flat join rows. The query's `created_at`
      order is not the set order.
    - **A known limit, as on the day page (R4):** two purged prescriptions of the **same** movement
      in one session fold into one row (`sets=6`, interleaved). Nothing is left to tell them apart
      once `prescription_id` is NULL. The movement and the loads stay right. A test pins the bytes,
      and `csv-export-contract.md` states it.
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
  - **NEW `packages/db/src/queries/export-month.test.ts`** covers `foldStrengthMonth`:
    - three sets of one prescription make one row;
    - one movement twice in a workout makes two rows;
    - two purged prescriptions of different movements make two rows, each with its own slug;
    - two purged prescriptions of the same movement make one row (the known limit, pinned);
    - two program rows of one prescription in foreign sessions on different days stay two rows;
    - when set 2 is ticked before set 1, with different loads and snapshots, the loads come out in
      set order and the row carries set 1's `prescribed`;
    - a legacy strength entry is unchanged.
  - **Changed on purpose:**
    - `apps/web/lib/csv/strength-log.test.ts:237-243` pins a `count` refusal with reps set. It moves
      to `bool` and `timing`.
    - `strength-log.test.ts:333` (inch marks) now expects the quoted bytes.
    - `strength-log.test.ts:347-348` ("REFUSES a comma anywhere it cannot quote") now expects a
      quoted movement.
    - Stale comments: `packages/shared/src/movements.ts:150` and `strength-session.ts:66` ("`csvRow`
      throws on a comma"), and `packages/db/scripts/verify.ts:4881` (cites `QUOTABLE`).
    - Every fixture row gains a trailing `,`, and the file-shape header test (`:364`) changes.
  - **Repaired:** `apps/web/lib/dal/export-prescribed.test.ts`'s `prescribedCellOf` splits on `,`.
    It moves to an exported test helper next to `row.ts` that reads one RFC 4180 line, the only
    reader in the tests. `flatRow` gains defaults for the new columns.
- **`db:verify`** (`packages/db/scripts/verify/day.ts`, after the 11c proofs, using the existing
  `fixture()`). One proof, `14a: the strength log carries the program`:
  - it ticks every `f.p.*` type through `logRow`, plus a second set of the reps item;
  - it renames the workout through `saveWorkout`;
  - it plants two sets of one prescription in **one** session of another athlete, with different
    entry dates (the (i) detector world), and a hidden set (`plantHiddenSet`). Each plant is undone after the bytes are
    asserted and before the sweep (the `day.ts:1932` precedent);
  - it purges two prescriptions of different movements in place;
  - it reads `strengthMonthRows`, folds it, builds the file, and asserts the file's bytes. The
    `prescribed` column is filled from `prescribedSnapshot`, which every program row carries. The
    live fallback (`resolvePrescribed`) stays in `apps/web` and is proven there.

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
    - the export paragraph: when an athlete logs a workout, the strength log carries its rows and
      the workout's name. It is worded as what happens on logging, not as current behaviour, because
      14a merges before 12c serves the page;
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
    - `:455-458`: `sessions.workout_name` changes from "coming, not yet reachable" to exported free
      text;
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
  - **`docs/architecture.md`:** the export flowchart (`:440`) gains the fold, and the data-model
    note (`:671`) gains the column. The PR description carries the chart.
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
  code. Two legacy tests change (inch marks; the movement-comma refusal), plus three comments.
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
  - Bodyweight stays in its own file, with its own handling (`.github/SECURITY.md:134`). **One**
    exported bodyweight conjunct (a constant plus a predicate) serves both `bodyweightMonthRows` and
    the check-ins read, in place of today's literal `'weigh_in'` (`export-month.ts:157`).
  - A `db:verify` proof asserts that every live entry of a fixture month lands in exactly one file,
    and that no check-ins row carries the metric `bodyweight`.
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
- **The privacy docs, the other way:** the notice's "does not yet include" list loses check-ins
  (`notice.md:238`), and the inventory's §6 first omission bullet ("written header-only,
  always…") is rewritten.
- **Tests.** `apps/web/e2e/export-full-day.spec.ts:161` asserts the file is header-only, so 14b
  changes that assertion and runs `e2e:local`. The stale `checkinMonthRows` mock
  (`export-prescribed.test.ts:20`) becomes the real query or is deleted.

### 14b — file by file (2026-11-18, after Q2)

Written from the constraints above and Q2's answer (the long format). Size: about 250 lines plus docs.

- **EDIT `packages/db/src/queries/export-month.ts`.**
  - **NEW `bodyweightEntry()`**: the one conjunct for "this entry is a bodyweight reading",
    `activity_types.key = SEED_ACTIVITY_TYPE_KEYS.weighIn` (the constant, in place of the literal
    `'weigh_in'`). `bodyweightMonthRows` uses it.
  - **NEW `checkinMonthRows(db, { profilePublicId, month, scope })`**: every live entry of the month
    with `movement_id IS NULL` and NOT `bodyweightEntry()`, under `isLiveProfile`. It selects date,
    activity key, `metric_key`, `value_num`, `value_text`, unit and notes, ordered by
    `(activity_date, id)`. The day's check-ins have no session order to keep.
- **EDIT `packages/shared/src/csv/checkins.ts`.** `CHECKINS_HEADER` becomes
  `date,activity,metric,value,unit,notes`, and `CheckinsRow` is retyped to match.
  - `activity` and `metric` are written through `csvToken()`. That helper is NEW in `columns.ts`, the
    one `_`→`-` rule, which `csvMovement` and `csvSessionType` then call.
  - `value` is `formatNumeric(value_num)` when there is one, else `value_text`, else empty.
  - `unit` is the stored unit code (`min`, `count`, `bool`, `timing`), never a load spelling.
  - The legacy nine-column docblock goes, and so does `header-only in reality`.
- **EDIT `apps/web/lib/dal/export.ts`.** The check-ins file is built from `checkinMonthRows`, and
  the comment that called it header-only is removed.
- **Tests.**
  - `packages/shared/src/csv/checkins.test.ts` (NEW): the header, one row per kind, a `bool` habit,
    a `timing` Wake, calisthenics' metrics told apart, and a quoted note.
  - `apps/web/lib/dal/export-prescribed.test.ts`: its stale `checkinMonthRows` mock becomes the real
    query's mock, and one case reads the file.
  - `apps/web/e2e/export-full-day.spec.ts:161`: it now asserts the check-ins file's rows, not
    header-only. `e2e:local` runs once.
- **`db:verify`** (`verify/day.ts`, with `verifyExport`). One proof, `14b: every live entry of a month
lands in exactly one file`:
  - it logs a weigh-in, a practice, a calisthenics day (two metrics), an old check-in metric, a
    program row and a hidden check-in;
  - it reads all three month queries;
  - it asserts every live entry's id appears in exactly one of them, that no check-in row carries
    `bodyweight`, and that the hidden one is in none.
- **Mutations 368–370** (lane E's block):
  - the check-ins read drops `movement_id IS NULL`, so strength rows appear twice;
  - it drops NOT `bodyweightEntry()`, so a weigh-in appears twice;
  - it drops `deleted_at`, so a hidden check-in leaks.
- **Docs.**
  - `docs/csv-export-contract.md`: the check-ins section, now the long format.
  - `docs/privacy/notice.md`: the export paragraph names check-ins; the "does not yet include" list
    loses them.
  - `docs/privacy/data-inventory.md`: §6's first omission bullet is rewritten; §3 and §6 gain
    `value_text` and `notes` as exported free text; a dated re-read entry.
  - `write-path.md` and `day-writers.md`; a changelog fragment.

## Out of scope (sent to the board)

- **Who may download bodyweight.** `.github/SECURITY.md:134` says "the household operator". The
  export checks household membership, and the notice says "the adult". That has been true since
  V1-13b and AUTH-1, and 14a/14b do not widen it. This is a decision for the maintainer.
- **Spreadsheet formula injection.** A note or workout name starting with `=`, `+`, `-` or `@` runs
  as a formula in a spreadsheet. `notes` has the same exposure today. This is a question for the
  security lens and the maintainer, not a quiet change to what people typed.
- The readiness colour, "how it felt" and per-athlete targets stay on the notice's "not yet" list.
- The zip export's rate limit and empty-export behaviour stay as tech-debt rows, unchanged.

## Questions for the maintainer — answered _(maintainer, 2026-11-17, relayed by the board)_

- **Q1 (gates 14a): the number goes in `reps` and `load` stays empty**
  (`…,plank-taps,1,25,,…`). The alternative, `25ct` in `load`, was declined.
- **Q2 (gates 14b): the new long format**: `date,activity,metric,value,unit,notes`, one row per
  check-in, with the old rows included.
- **Q3: standard quoting** (RFC 4180) for the whole file.

**Two follow-ups the maintainer decided, each its own small PR after 14a** (lane E, as the export's
owner):

- **Bodyweight download, operator only.** The code is made to match `.github/SECURITY.md:134`, with
  a boundary test that a non-operator member is refused. The privacy lens reviews it, and the
  inventory and notice change in the same PR.
- **Spreadsheet formula injection, fixed.** Any cell starting with `=`, `+`, `-`, `@`, a tab or a
  carriage return is prefixed with `'`, so it opens as text. This applies across the whole export,
  with byte tests.

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

### Re-review (on rev 2, 47062899)

> Correctness, privacy, and architecture with reuse, on **Opus 5.5** at medium effort. All three
> confirm round 1's blockers closed.

| #   | Lens                                 | Critique (short)                                                                                                                        | Verdict      | Resolution                                                                                                 |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| R1  | architecture (BLOCKING); correctness | The new ON makes `sessions.id` NULL for a foreign session, so `s:null:p:…` merges rows across dates; its rows also sort last            | **accepted** | The key and the ORDER BY use `entries.session_id`; the proof plants two foreign sets on different days     |
| R2  | correctness                          | Two purged prescriptions of the same movement still fold into one row                                                                   | **accepted** | Stated as a known limit, as R4 has it; a test pins the bytes                                               |
| R3  | correctness                          | "One legacy test changes" is not accurate                                                                                               | **accepted** | `:347-348` and three comments listed; Q3 reworded                                                          |
| R4  | architecture, correctness            | `byFirstLogged`'s row shape does not fit the export's rows                                                                              | **accepted** | Typed structurally; the fold sorts entry-level records                                                     |
| R5  | architecture, privacy                | 14b: one bodyweight conjunct for both reads; assert no check-ins row carries `bodyweight`                                               | **accepted** | Both are in § 14b                                                                                          |
| R6  | privacy                              | Inventory `:455-458` missing; the notice must not claim program logging before 12c; 14b's notice and inventory lines                    | **accepted** | All three are in § Docs and § 14b                                                                          |
| R8  | architecture (P2)                    | A key on `session_id` alone still merges dates on data the schema allows (a purged row with no session; an entry dated off its session) | **accepted** | The date joins the program key; the proof plants both foreign sets on one session with two dates           |
| R7  | NITs                                 | Test file name; `architecture.md`'s export chart; the plant undone before the sweep; `prescribed` in the proof                          | **accepted** | `export-month.test.ts`; `architecture.md` in § Docs; the `day.ts:1932` precedent; filled from the snapshot |

### Code review (14a, on c927ba90)

> Correctness, reuse and privacy, on **Opus 5.5**. No P0.

| #   | Lens        | Finding (short)                                                                                                                                        | Verdict                    | Resolution                                                                                                                                                                                               |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | correctness | **P1:** mutation 259 no longer applied (its line became `programItemKey(row)`), so the gate failed                                                     | **fixed**                  | 259 regenerated against the new line; same `.expect`                                                                                                                                                     |
| K2  | privacy     | **P1:** the notice and inventory said a program's targets are not exported; `prescribed` carries them                                                  | **fixed**                  | Both say the rendered `prescribed` text of a logged row goes out                                                                                                                                         |
| K3  | reuse       | **P1:** the contract doc hand-copied the pinned rows; write-path invariant 15 restated the contract                                                    | **fixed**                  | One example and a pointer to the test; invariant 15 keeps only what lives between files                                                                                                                  |
| K4  | reuse       | **P1:** the proof re-typed the header; tests typed `'workout'`/`'strength'`                                                                            | **fixed**                  | `STRENGTH_LOG_HEADER`, `SESSION_TYPE`, `SET_STATUS`; the fixture's workout name is one `W1_NAME`                                                                                                         |
| K5  | correctness | Nothing tested the key's use of the ENTRY's session; the comment over-claimed a cross-date merge                                                       | **fixed**                  | A fold case with two foreign sessions on one date; comment corrected                                                                                                                                     |
| K6  | correctness | `readCsvLine`'s quoted branch untested                                                                                                                 | **fixed**                  | `read-row.test.ts` round-trips `csvRow`'s quoted cells; the `lists` test uses it                                                                                                                         |
| K7  | correctness | The contract over-claimed `session_type = workout`                                                                                                     | **fixed**                  | "…whose session is the athlete's; empty otherwise"                                                                                                                                                       |
| K8  | privacy     | The notice read as if program logging were live; "exactly as typed" wrong for movements; "a note" vague                                                | **fixed**                  | "Once the day page … ships"; exactly-as-typed for the workout name only; "a note on a logged entry or weigh-in"                                                                                          |
| K9  | privacy     | The sessions join did not exclude a hidden session                                                                                                     | **fixed**                  | `sessions.deleted_at IS NULL` in the same ON (no writer hides a session today, so no mutation)                                                                                                           |
| K10 | privacy     | Inventory §1a `sessions` row stale; the new throw's message carried the typed slug                                                                     | **fixed**                  | Row updated; the messages carry no value and no movement name                                                                                                                                            |
| K11 | reuse       | Stale comments (`verify.ts` V1-30 block, `strength-session-schema.test.ts`); hand-typed types; a repeated unit branch                                  | **fixed**                  | Comments reworded; `FirstLoggedFields &` and `Pick<StrengthMonthRow, …>`; `unitsForTrackingType` alone                                                                                                   |
| K12 | correctness | Departures: the proof renames by a direct `UPDATE`, not `saveWorkout`; the type test does not call `entryUnitFor`; the tripwire moved to `timing` only | **recorded**; `bool` added | The rename only needs `workouts.name` to change (`saveWorkout` never writes `sessions`, `save-workout.ts:203`); `fillRowValues` builds what the writer stores; the tripwire now pins `bool` and `timing` |
| K13 | reuse       | **P2:** move `resolvePrescribed`/`rolesNeedingLiveMatch` beside the fold so the proof runs the DAL's last step                                         | **to the board**           | Not fixed here (it moves the V1-22 fallback across packages); listed for the maintainer                                                                                                                  |
| K14 | reuse       | **P2:** "the session is the entry's athlete's" is now spelled in `amend-row.ts` and `export-month.ts`                                                  | **to the board**           | Not fixed here (a shared conjunct moves mutations 351 and 365's targets); listed for the maintainer                                                                                                      |
