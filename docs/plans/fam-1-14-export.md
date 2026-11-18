# FAM-1 14 — The export carries what the day page logs

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step 14. Branch: `feat/fam-1-14-export`. Lane E. **Draft, for the panel and then the maintainer's
> approval.** No implementation code is committed before that approval.

## Goal

What a person logs in the app reaches their export, in a file a spreadsheet opens.

Today two things fall out (both are in the code, `apps/web/lib/dal/export.ts`):

1. **Program rows.** A ✓ on the day page writes one entry per set (11b). The export writes each as
   its own `strength-log` row with `sets=1`. It never writes the workout's name. A **Count** logged
   in `count`, or any ✓ whose quantity is `count`, makes the **whole export throw**
   (`assertExportableUnit`, `packages/shared/src/csv/value.ts:62`). So once 12c puts the program on
   the day page, a Count ✓ breaks the athlete's export.
2. **Check-ins.** The check-ins file is header-only (`buildCheckins([])`, `export.ts:198`). Practice,
   Wake, habits and calisthenics are stored as entries, and none of them reach the export. The
   privacy notice says so (`docs/privacy/notice.md:237-240`).

**Split** _(proposed)_: **14a** fixes the program rows; **14b** writes the check-ins file. One plan,
two PRs.

- **12c waits on 14a only.** 12c is what makes program rows loggable, so 14a closes the gap 12c
  opens. The check-ins gap predates FAM-1: 3b-page (#418) took the old check-in forms away, and the
  Life section already writes practice and the other Life items. 14b does not block 12c.

**Roadmap alignment (2026-11-17):** advances `FAM-1` lane E. Gated by 11b (#470, merged). 14a gates
12c. Checked against the private roadmap; nothing to add here (the export's direction is public, in
ADR 0009). `ID-1`: nothing new is keyed on the household; the export is still scoped by
`isLiveProfile(publicId, scope)`.

## Acceptance

From §5 row 14 (`fam-1-family-program.md:575`), verbatim:

> a comma in a workout name round-trips; template rows of each type

Done when:

- **14a**
  - One `strength-log` row per **(session, prescription)**, not per set. A ✓ on sets 1–3 of Heavy A's
    bench reads `…,bench-press,3,8,25,…`, as a strength-form row of the same sets would.
  - A new **`workout`** column carries the session's frozen `workout_name`. It is never an id, and
    it is empty for a row logged outside a program.
  - Every tracking type exports a row, and none throws: Check, Count (in every unit it takes, `count`
    included), Reps, Weight × reps, Duration, Time per set and Distance.
  - A workout name with a comma or a double quote round-trips: parsed back by an RFC 4180 reader, the
    cell reads the name exactly.
  - The notice's export paragraph says the strength log carries the program's rows and the workout's
    name.
- **14b**
  - The check-ins file carries one row per logged check-in, in a shape stated below.
  - Hidden rows stay out, as everywhere else in the export.
  - The notice's "does not yet include" list loses check-ins.

## 14a — program rows in the strength log

### File by file

- **EDIT `packages/db/src/queries/export-month.ts`** (`strengthMonthRows`). Add three columns to the
  select: `prescriptionId: entries.prescription_id`, `prescriptionSet: entries.prescription_set` and
  `workoutName: sessions.workout_name`. No new join, and no change to the WHERE or the ORDER BY.
  Everything stays scoped by `isLiveProfile`.
- **EDIT `apps/web/lib/dal/export.ts`** (`foldStrengthRows`). The fold key becomes:
  - `p:<sessionId>:<prescriptionId>` for a **program row** (`prescriptionSet !== null`, the same
    test as `programRow()`);
  - `e:<entryId>` for everything else, which is today's behaviour unchanged.

  A program row's sets are the entries' single sets, in `prescription_set` order. The other columns
  come from the **lowest set's** entry, the same rule the day resolver uses for a removed item (R4):
  `prescribed` (its frozen snapshot), `notes` and `status`. Insertion order still follows the query's
  ORDER BY, so a program row sits where its first set was logged.

- **EDIT `packages/shared/src/csv/strength-log.ts`.** `STRENGTH_LOG_HEADER` gains **`workout`** as the
  **last** column, and `StrengthLogRow` gains `workoutName: string | null`.
  - Last, not after `session_type`: a reader that addresses columns by position keeps working, and
    one that reads by name does not care.
- **EDIT `packages/shared/src/csv/row.ts`.** `workout` joins `QUOTABLE`. It is quoted the RFC 4180 way
  when it holds a comma **or a double quote**. The legacy rule (raw inch marks, quote only on a comma)
  stays for `notes` and `prescribed`, whose byte tests are kept (ADR 0009 §4). The docblock's "never
  RFC-4180" is narrowed to say which columns.
- **EDIT `packages/shared/src/csv/value.ts` and `load.ts`** — the `count` unit. A quantity in `count`
  is written in the **`reps`** column as a bare number, with `load` empty: `…,plank-taps,1,25,,…`.
  - It is never written bare in `load`, where a bare number means pounds. That misreading is the one
    the tripwire exists to prevent.
  - `bool` and `timing` stay refused: no program row stores either as a quantity (a Check stores no
    quantity, `ENTRY_UNIT_WITHOUT_QUANTITY`). A refusal there is still a real bug.
  - ⚠️ **A decision for the maintainer** (Q1).
- **EDIT `packages/shared/src/csv/aggregate.ts`.** A Check row has no sets field
  (`TRACKING_TYPE_FIELDS.check.sets === false`) and one ✓. It exports `sets=1` with `reps` and `load`
  empty, which is what `aggregateMovement` already gives one set row with no reps and no quantity. No
  code change is expected; a test pins it.
- **Tests.**
  - `apps/web/lib/csv/strength-log.test.ts` (new `describe`) covers:
    - one row per tracking type;
    - the workout column;
    - a comma, a double quote and both, parsed back by a ten-line RFC 4180 reader in the test (no
      dependency);
    - the `count` spelling.
  - `apps/web/lib/dal/export-prescribed.test.ts` gains the fold cases:
    - three sets of one prescription make one row;
    - one movement twice in a workout makes two rows;
    - a removed prescription's rows stay their own row;
    - a legacy strength entry is unchanged.
  - The existing byte tests stay unchanged except for the new trailing column. Each fixture row gains
    one trailing `,`, which ADR 0009 §4 allows ("until a PR changes them").
- **`db:verify`** (`packages/db/scripts/verify/day.ts`, after the 11c proofs): log Heavy A through
  `logRow` (three bench sets, one Check, one Count in `count`), then read `strengthMonthRows`.
  - The proof asserts the three new columns, that a hidden set is absent, and that a row from another
    athlete's session is absent.
  - **Mutations:** three, numbers to be given by the board:
    1. the select drops `workout_name`;
    2. the select reads `workouts.name` (live) instead of the frozen `sessions.workout_name`, so a
       renamed workout exports its new name;
    3. `prescription_set` is read from the wrong table.
- **Docs.**
  - `docs/csv-export-contract.md`: the `workout` column, the fold, and the `count` spelling.
  - `docs/privacy/notice.md`: the export paragraph.
  - `docs/privacy/data-inventory.md:243`: "the frozen workout name" is now exported.
  - `docs/features/write-path.md`: the export seam, plus the stale `export.ts → prescribedFor` cite
    at :797.
  - Changelog fragment.

### Alternatives rejected

- **Aggregate in SQL** (`GROUP BY session, prescription`). The fold already exists in the DAL and is
  keyed by set id for the slash-lists, and a second aggregation path would drift from it.
- **One row per set, as today.** That reads as three one-set exercises where the athlete did one
  three-set exercise. The row says "aggregate".
- **The `workout` column after `session_type`.** It reads better in a spreadsheet, but it moves every
  later column for a positional reader. Last costs nothing.
- **RFC 4180 for the whole file.** That's correct, but it rewrites every legacy byte test (inch marks
  in `notes`). It belongs in its own PR if wanted; ADR 0009 calls RFC 4180 "preferred", not required.
- **`count` spelled `25ct` in `load`.** It's possible, but `reps` already means "how many", and a new
  suffix is an invented token a reader must learn.

### Risks

- **A wrong number in the load column is the injury risk** this exporter is built around. The `count`
  rule keeps every bare `load` number a pound, and a test asserts no program row writes a bare
  non-lb number into `load`.
- **The fold key.** A program row folded on the wrong key would merge two cards of one movement into
  one row. The key is the prescription, not the movement, and the "one movement twice" fold case
  pins it.
- **Byte tests.** Every legacy fixture gains a trailing comma. That is the one intended byte change,
  stated here so the reviewer can check nothing else moved.

## 14b — the check-ins file

The legacy header (`date,stance,ladder,bridge,mobility,pressure,reaction,shot,notes`) predates every
check-in the app logs today. None of those nine columns maps to practice minutes, Wake or a habit.

**Proposed:** replace it with one long-format file, `data/checkins/<id>/<YYYY-MM>.csv`. Its header is
`date,activity,value,unit,notes`, with one row per live check-in entry, ordered like the strength
log. For example, `2026-11-17,practice,90,min,` or `2026-11-17,wake,06:40,,`.

- `activity` is the activity type's key, with `_` written as `-`, as `movement` is.
- A Wake time is written as clock time.
- A boolean habit is written `done`.

This is a **format change** the notice must describe (ADR 0009 §3(a)). Its own file-by-file comes
after the maintainer answers Q2, so 14a does not wait on it.

## Out of scope

- The readiness colour, the "how it felt" notes and per-athlete targets. They stay on the notice's
  "not yet" list.
- The zip export's rate limit and empty-export behaviour (tech-debt rows, unchanged).
- Bodyweight's role check (`.github/SECURITY.md:134` reads "the household operator"; the export
  checks household membership). This is a question for the security lens, not a change here.
- The data inventory's claim that `feel` is exported (`data-inventory.md:448`), which the notice
  contradicts (`notice.md:239`). Neither file is touched by 14a beyond its export lines. It goes to
  the board as a docs fix for the inventory's owner.

## Questions for the maintainer

- **Q1 — a Count in `count`.** Proposed: the number goes in `reps`, and `load` is empty. Alternative:
  a suffix in `load` (`25ct`).
- **Q2 — the check-ins file's shape.** Proposed: the long format above, which replaces the legacy
  nine columns. Alternative: keep the nine-column header and add columns per check-in.
- **Q3 — the split.** 14a first, so 12c can merge; 14b next.

## Review-response log

_(The panel runs next.)_
