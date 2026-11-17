---
feature: The program contract (FAM-1's shapes, fixtures, fakes and preview route)
owns:
  - packages/shared/src/program/
  - apps/web/app/design/program/
  # The scan of every state a fixture can load on the preview route. It reads the route's own
  # list, so a lane never edits it; a change to how the states are scanned is a contract change.
  - apps/web/e2e/program-preview-a11y.spec.ts
  # The two spellings `quantityText` is built from (`formatNumeric`, and seconds as `s`). Outside
  # `program/` because the CSV reads them too, and owned here so a change to either is a contract
  # change: they are the bytes frozen on every logged row.
  - packages/shared/src/quantity-spelling.ts
  # CAT-3's contract (the movement library): listed file by file, never the `catalog/` prefix,
  # because `catalog/data/` is the data lane's and gets its own guide with the first batch.
  - packages/shared/src/catalog/index.ts
  - packages/shared/src/catalog/vocabulary.ts
  - packages/shared/src/catalog/entry.ts
  - packages/shared/src/catalog/fixture.ts
  - packages/shared/src/catalog/approvals.ts
  - packages/shared/src/catalog/approvals.test.ts
  - packages/shared/src/catalog/catalog.test.ts
  - packages/shared/src/catalog/owed.test.ts
  - packages/shared/src/catalog/search.test.ts
  - .github/scripts/check-catalog-append-only.mjs
  # The search the picker and `existingItem` share. Moved here from movement-picker.md at CAT-3
  # C0a: the contract's next chunk adds the library's search beside `matchMovementOptions`.
  - packages/shared/src/movement-search.ts
  # Source-reading helpers for the contract's own scans (lifted from `quantity-text.test.ts`).
  - packages/shared/src/test-support/source-graph.ts
---

# The program contract

**Read this before changing a shape, a fixture, a fake or the preview route.** Everything here is
what two FAM-1 lanes agree on, so a change is felt by every lane that reads it.

## What this is

The program builder and the day page are built by several lanes at once
([FAM-1 plan](../plans/fam-1-family-program.md) §5 to §7). The contract is what lets them: the
shapes that pass between a screen and its data, named fixtures of each shape, in-memory fakes of the
two actions objects, and a route that mounts any screen with any fixture. A screen is built and
checked on a phone before its tables exist; a query is checked against the same fixture the screen
renders.

**Owner: the contract owner** (plan §5), not a lane. After step 0 it only makes contract changes.

## The map

```mermaid
flowchart LR
  PROTO[Accepted prototype v12] -->|transcribed, held by a test| FIX[program/fixtures]
  SHAPES[program shapes + ProgramActions, DayActions] --> FIX
  FIX --> REG[preview-registry.ts: screen × fixture]
  FIX --> FAKES[fakes.ts]
  SHAPES --> FAKES
  REG --> ROUTE["/design/program"]
  FAKES --> ROUTE
  ROUTE -->|mounts, with data + actions| SCREENS[lane B and C screens]
  REG --> SCAN[e2e/program-preview-a11y.spec.ts]
  FIX -->|deep-equal, through the normalizer| DATA[lane P and E queries]
```

## Files

| File                                              | What it is for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/program/pieces.ts`           | `RowValues`, `Superset`, the bounded texts, `TRACKING_TYPE_FIELDS` (which fields each tracking type has).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/shared/src/program/program-shapes.ts`   | The builder's shapes and action inputs: `WorkoutDraft`, `WeekDraft`, `ProgramList`, `ProgramView`, the dialog drafts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/shared/src/program/day-shapes.ts`       | `DayPlan`, the row writes, `RowResult` and its refusals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/shared/src/program/actions.ts`          | `ProgramActions` and `DayActions`: the only way a screen writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/shared/src/program/prescribed-text.ts`  | One renderer of a prescription as text, for all seven types. Its own subpath, not the root barrel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/shared/src/program/fixtures/`           | The named fixtures (`@mat-plan/shared/program/fixtures`): the prototype's data, transcribed in `world.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/shared/src/program/owed.test.ts`        | The `it.todo` tests still owed by lane A and the contract owner. Each lane with a guide keeps its own list in its own directory (invariant 9). Lane A has no remaining line: 4a-i and 4b proved the constants' columns in `verify/schema.ts` (a legacy prescription's `target_reps` and `sets` stay unbounded on purpose, as the file says; `program_blocks.name` is bounded for new and updated rows since lane A's tech-debt migration, and for existing rows once lane A's PR 2 validates it); step 3 wrote its three (in `units.test.ts` and `verify/schema.ts`), and adjusted `shapes.test.ts`' unit pins for `mi` and `(primary, count)`. |
| `apps/web/app/design/program/fakes.ts`            | `createFakeProgramActions`, `createFakeDayActions`: the prototype's rules over one fixture, with a `failNext()` switch. The program fake's clock is `ProgramView.today`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/app/design/program/picker-options.ts`   | The `picker-options` fixture. Here because its shape is the web's `MovementOptionDTO`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/app/design/program/preview-registry.ts` | Which screens exist and which fixtures each takes; the route's URL scheme. Data only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/app/design/program/preview-harness.tsx` | The client component that mounts a screen with a fixture and a fake, and feeds a fake's changes back as props.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/app/design/program/page.tsx`            | `/design/program`: the index of states, or one state. Behind `requireSession()`, `noindex`, linked from nowhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/e2e/program-preview-a11y.spec.ts`       | Walks every state of the registry: axe, 44px targets, no sideways scroll at 360px.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**The preview route's URLs:** `/design/program` lists every state.
`/design/program?screen=<programs-list|program|workout-editor|day>&fixture=<name>` mounts one, and
`&fail=next` makes the fake's next write answer `retry` (the "✓ that fails" state).

**The screens it mounts** are the lanes' own: `apps/web/components/program-builder/`
([program-builder.md](./program-builder.md)) and `apps/web/components/day/`
([day-page.md](./day-page.md)). The data lanes are [program-writers.md](./program-writers.md) and
[day-writers.md](./day-writers.md).

### Helpers the lanes import

Small rules and names that more than one lane needs. 🔴 **Import these from `@mat-plan/shared`; do
not write your own.** A lane's own copy is a second definition that drifts (the first lane PRs each
wrote some of these, which is why they are here). All but `rolledBack` and `asDb` are in the root barrel and
safe in a `'use client'` component; those two are the proof modules' and come from the
`db:verify` harness. If a lane needs one that is missing, it asks the contract owner (invariant 1).

| Export                                                                                                               | Where                                                                             | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quantityText(value, unit)`                                                                                          | `packages/shared/src/program/quantity-text.ts`                                    | One quantity as text: `25 lb`, `30 s`, `7` for the plain `count`. The spelling `prescribedText` is built from, so a logged value and its prescription read alike.                                                                                                                                                                                                                                                                                            |
| `slotQuantity(item, quantities)`                                                                                     | `packages/shared/src/program/pieces.ts`                                           | The tracking type's quantity out of a list (`TRACKING_TYPE_FIELDS[type].slot`), or `null`. `item` is anything with a `trackingType`.                                                                                                                                                                                                                                                                                                                         |
| `DayWorkout`, `DayItem`, `DayRow`                                                                                    | `packages/shared/src/program/day-shapes.ts`                                       | The parts of a `DayPlan`, by name.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `hasStarted(athlete, today)`                                                                                         | `packages/shared/src/program/program-shapes.ts`                                   | An athlete has started on a program when `since <= today`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `MONDAY_FIRST`                                                                                                       | `packages/shared/src/day.ts`                                                      | The weekdays in the order a week is shown (1, 2, … 6, 0). Each member is still a `Weekday` (0 = Sunday).                                                                                                                                                                                                                                                                                                                                                     |
| `supersetLabels(items)`                                                                                              | `packages/shared/src/program/pieces.ts`                                           | The label each item shows for its superset (`A1`, `A2`, `B1`), as a parallel array; `null` for an item on its own. Letters are ordinal among the items passed, the number is the place among that group's items passed, and the `group` key is never shown. Pass the items a screen shows. After Z it goes on as AA (a saved workout has at most 15 groups, so only a draft of single-item groups gets there).                                               |
| `PLAIN_DECIMAL`, `isPlainDecimal(text)`                                                                              | `packages/shared/src/units.ts`                                                    | The shape of a quantity typed into a text field: a plain decimal with at most `QUANTITY_DECIMALS` places (`5`, `5.5`, `.5`; not `-5`, `1e3`, `0x10`, `5.`, `5 min`). The shape only: trim first, and check the unit's `quantityCeiling` after. Owned by [strength-logging.md](./strength-logging.md).                                                                                                                                                        |
| `WHOLE_NUMBER`, `isWholeNumber(text)`                                                                                | `packages/shared/src/units.ts`                                                    | The shape of reps as typed: digits only. It does not trim and sets no range (`repsSchema` holds 1..1000).                                                                                                                                                                                                                                                                                                                                                    |
| `ProgramListEntry`                                                                                                   | `packages/shared/src/program/program-shapes.ts`                                   | One program of a `ProgramList` (`ProgramList[number]`), by name.                                                                                                                                                                                                                                                                                                                                                                                             |
| `TRANSPORT_REFUSALS`, `TransportRefusal`                                                                             | `packages/shared/src/program/actions.ts`                                          | What a transport answers before the action runs: no session is `not_found`, over the rate limit is `retry`. A real action hands it to `enterMutation` and returns the refusal untouched (invariant 14).                                                                                                                                                                                                                                                      |
| `existingItem(options, name)`                                                                                        | `packages/shared/src/program/pieces.ts`                                           | The item a typed name already names, or `undefined`: its name's key or one of its aliases matches (`push ups` is Push-ups, `RDL` is Romanian Deadlift). Each option carries `isCatalog` (required: the picker's tie-break). The one rule for "this item exists" in `newItem`, for the real writer and the fake; it is the picker's `exact` or `aliasHit` (invariant 15).                                                                                     |
| `fillRowValues(item, typed, target)`                                                                                 | `packages/shared/src/program/pieces.ts`                                           | What a ✓ or a Change stores, or `null` for `bad_value`: typed numbers, else the prescription's (an amend passes `target: null`). The one value-fill rule, for the row writer, the amend and the fake (invariant 16).                                                                                                                                                                                                                                         |
| `loggedRowUnit(trackingType, logged)`                                                                                | `packages/shared/src/program/pieces.ts`                                           | The unit a logged row's numbers are in: its stored quantity's, `null` for a type with none. What a Change is judged in (invariant 27).                                                                                                                                                                                                                                                                                                                       |
| `prescribedTarget(targetReps, quantities)`, `PrescribedTarget`                                                       | `packages/shared/src/program/pieces.ts`                                           | A prescription's numbers as `DayItem.target` holds them: whole-number reps or `null`; a quantity with a `valueMax` (a range) has `value: null`. The day's read and the row writer both build the target with it.                                                                                                                                                                                                                                             |
| `entryUnitFor(type, prescribedUnit)`, `ENTRY_UNIT_WITHOUT_QUANTITY`                                                  | `packages/shared/src/program/pieces.ts`                                           | The unit a logged row's entry stores: `bool` for a Check, `count` for Reps, else the prescribed unit (plan §2). For the row writer and the export.                                                                                                                                                                                                                                                                                                           |
| `itemUnit(trackingType, quantities)`                                                                                 | `packages/shared/src/program/pieces.ts`                                           | The unit an item logs in, which is `DayItem.unit`: `null` for a Check or Reps, the type's fixed unit, else the prescription's unit in the type's slot. One definition for the day's read and the row writer, because `fillRowValues` refuses a quantity in any other unit.                                                                                                                                                                                   |
| `DAY_PLAN_FIXTURE_SOURCES`, `DayPlanFixtureSource`, `World`, `workoutDraft`, `programView`, `programOf`, `workoutOf` | `packages/shared/src/program/fixtures/index.ts` (the `/program/fixtures` subpath) | What each `DayPlan` fixture was built from: `{ world, athlete, day, before }`. A data lane's proof seeds `world` and deep-equals the fixture of the same name. `before` is the world before an edit, or `null`. `workoutDraft(world, programId, wid)` gives a workout as a `WorkoutDraft`, ready for the writer. `programView(world, programId)` gives a program's page as a `ProgramView`; its `week` is a `WeekDraft['days']`, ready for `saveWeek` (C27). |
| `showsOnlyLogged(day)`                                                                                               | `packages/shared/src/program/day-shapes.ts`                                       | Whether a day shows only what was logged: not writable and not a future day (a day before yesterday; an archived athlete's today or yesterday). There, an unlogged workout or item is absent and PREVIOUS is `null`. The fixture builder, the day resolver and the day screen all ask it (C23).                                                                                                                                                              |
| `lowerCaseUuidSchema`                                                                                                | `packages/shared/src/program/pieces.ts`                                           | An id as every shape here reads it: any uuid, handed back in lower case, so two spellings of one id compare equal after the parse (invariant 26). For an action or a query that parses an id of its own (a page's route parameter, say) and then compares it in JS.                                                                                                                                                                                          |
| `weekRepeatsAWorkout(draft)`                                                                                         | `packages/shared/src/program/program-shapes.ts`                                   | Whether a week names one workout twice on a day, asked of a draft `weekDraftSchema` refused: `saveWeek` answers `once_per_day` when it does, else `invalid`. Takes the raw input (anything), counts only slots whose id is a uuid, and reads two spellings of one id as one workout. Any repeat counts, whatever else is wrong. One definition for the fake and the writer (invariant 26).                                                                   |
| `emptyWeek()`                                                                                                        | `packages/shared/src/program/program-shapes.ts`                                   | A week with nothing on any day: every weekday present, each `[]`, as a `WeekDraft['days']`. A new object and new arrays on every call, so a caller may fill it. For a week read with no slots yet and a week editor's starting state (C26). `emptyWeek<Slot>()` is the same week for another slot type.                                                                                                                                                      |
| `inWritableWindow(day, today)`, `WRITABLE_DAY_RADIUS`                                                                | `packages/shared/src/day.ts`                                                      | Today and yesterday, never a day after today (plan D20, D32): what `DayPlan.writable` means and what a row write is held to. Pure; the caller supplies `today`. ⚠️ The older forms' `isWritableDay` (web) also accepts tomorrow until step 12c.                                                                                                                                                                                                              |
| `DEFAULT_TRACKING_TYPE`                                                                                              | `packages/shared/src/movements.ts`                                                | The type an item gets when none is named: `weight_reps`, the `movements.tracking_type` column's default. `packages/db/src/tracking-type-default.test.ts` holds the const and the schema's default equal.                                                                                                                                                                                                                                                     |
| `rolledBack(fn)`                                                                                                     | `packages/db/scripts/verify/harness.ts`                                           | For `db:verify` proof modules, not the app: runs a proof's writes in a transaction that is always rolled back, and rethrows the proof's own failure. Imported from `./harness`, beside `asTx` and `expectRejectedBy`.                                                                                                                                                                                                                                        |
| `asDb(tx)`                                                                                                           | `packages/db/scripts/verify/harness.ts`                                           | A proof's transaction as the database handle a query or a seed helper takes, where `asTx(tx)` is the handle a writer takes. Not in a barrel: import it from the harness, as `rolledBack`.                                                                                                                                                                                                                                                                    |

`quantityText` is client-safe because it reads its two primitives (`formatNumeric`, and seconds
spelled `s`) from `packages/shared/src/quantity-spelling.ts`, which imports nothing; `csv/value.ts`
re-exports `formatNumeric` from there and reads the same `s` into `CSV_UNIT_SUFFIX`, so the CSV's
bytes did not change. **This guide owns `quantity-spelling.ts`**: a change to `SECONDS_SUFFIX` or
`formatNumeric` changes the text frozen on every later logged row and every exported month, so it
is a contract change. `quantity-text.test.ts` scans every module `quantityText` reaches, and the
root barrel's whole graph, for `csv/` and for any package outside a short allowlist (`zod`; the
barrel adds `uuid`), so a `node:` builtin, `server-only` or `@mat-plan/shared/csv` fails it.

`quantityText` is for stored quantities: 0 to `MAX_STORABLE_QUANTITY` (99999.999), at most
`QUANTITY_DECIMALS` (3) decimals. Outside that range `formatNumeric` is not defined.

### The sets rule on save

`saveWorkoutSchema` refuses a draft whose items break this rule; `workoutDraftSchema`, which the
editor loads, does not (a card mid-edit may have no set count yet).

- An item whose tracking type is logged set by set (`TRACKING_TYPE_FIELDS[type].sets`: Reps,
  Weight × reps, Time per set, Distance) has `sets`, a whole number from 1 to
  `MAX_SETS_PER_MOVEMENT`.
- Every other item (Check, Count, Duration) has `sets: null`.

The issue is on the item's field (`['items', index, 'sets']`), so an editor can point at the card.
The fake's `saveWorkout` parses with the same schema and answers `invalid`, so the preview route
refuses what the real action will. Every `WorkoutDraft` fixture and every workout in the
prototype's world already keeps the rule (`save-workout.test.ts` holds that). The rule reads the
`trackingType` the draft carries; the writer still checks the item's real type.

### The unit rule on save

`saveWorkoutSchema` also refuses an item that could be saved and never logged (contract change
C16). `workoutDraftSchema` does not: a card whose type was just chosen has no unit yet.

- A type with a quantity (`TRACKING_TYPE_FIELDS[type].slot`) must have a unit, as `itemUnit` finds
  it: the type's fixed unit, or the unit of the prescribed quantity in the type's slot.
- So a **Count**, a **Weight × reps** and a **Distance** item each carry a quantity in their slot.
  Its `value` may be `null` ("log in this unit, no target"); the unit may not be missing.
- A **Duration** and a **Time per set** have a fixed unit and pass with no quantity. A **Check** and
  **Reps** measure nothing and pass with none.

- **The quantity in the type's slot is in a unit the type logs in** (`unitsForTrackingType`, what
  the editor's unit select offers; plan D27). A Count in `bool` could store no ✓, and a Duration
  prescribed in seconds would refuse an empty ✓, because a Duration logs in minutes.
- **A target is a number an empty ✓ can store.** Where the quantity has a `value`, the rule asks
  `fillRowValues` itself whether an empty ✓ on that target is stored. Today that refuses a value
  over its unit's ceiling (`quantityCeiling`: 1,001 of a count, 1,441 minutes). A blank target is
  not judged: the row asks for the number.

The issue is on the item's quantities (`['items', index, 'quantities']`), beside any `sets` issue on
the same card. The rule reads the `trackingType` the draft carries, as the sets rule does; the
writer still checks the item's real type. It looks at the type's own slot only: a quantity in
another slot, or a second one in the same slot, is the writer's to refuse.

## Invariants

1. 🔴 **A shape change goes through the contract owner, and the lanes reading it wait** (plan §4).
   A lane that finds the contract wrong or short stops and says what it needs
   ([parallel-work](../parallel-work.md) → "Once lanes run", 5). It does not widen a shape in its
   own PR: this guide is owed by every file here, so such a PR fails `guides:check` without it.
2. 🔴 **The fixtures are the accepted prototype's data, state for state** (plan §8).
   `fixtures/prototype.test.ts` runs the prototype's own data functions and requires the
   transcription to equal them. A fixture is changed by changing the prototype first. **Five
   fixtures are not prototype states and say so**: `every-type-once`,
   `closed-day-program-since-left` (C17), `archived-athlete-today` (C18),
   `closed-day-nothing-logged` and `archived-athlete-nothing-logged` (C22). Each is the
   prototype's data arranged to reach a rule no prototype state reaches. **And one field of one
   fixture differs from the prototype's own state, by the maintainer's decision** (2026-11-17):
   the workout that left the week in `workout-left-the-week` has no label, where v12 shows the
   label its slot had.
3. **A fixture is tested from both sides.** The screen renders it; the data lane seeds the state it
   describes and asserts its query deep-equals it, through `packages/db/scripts/verify/normalize-fixture.ts`
   or, stricter, with ids compared exactly through a fixture-id to public-id map the proof's seeder
   returns (12a does this: the normalizer cannot tell a public id from a client id).
4. 🔴 **Fakes on the preview route, real actions in production, never a mix** (plan §6). Nothing
   in `apps/web` outside `apps/web/app/design/program/` imports the fakes, `picker-options` or the
   fixtures subpath, and nothing outside it names the route: `fakes.test.ts` and
   `preview-registry.test.ts` scan `apps/web` for both. The data lanes' proofs in
   `packages/db/scripts/verify/` do import the fixtures subpath: that is invariant 3.
5. **A fake follows the prototype's rules and each rule has a test** (`fakes.test.ts`; plan §8,
   "Behaviour"). A fake and a real action parse an input with the same schema, so a screen sees the
   same refusal on the preview route and in production.
6. **An optional action that is not supplied is `undefined`, and the screen hides its control.** The
   fakes supply every member.
7. **The preview route reads no data.** Its only DAL call is the session check. It renders inside
   `AppShell` with `nav={false}`, so a screen gets production's measure and its one `<main>`, and
   the rail's real athletes are not shown beside fixture ones.
8. **One list of states, three readers.** The index, the route's parser and the a11y spec all read
   `preview-registry.ts`, which reads the contract's fixture lists. A new fixture is on the route
   and in the scan with no further edit.
9. 🔴 **No lane's step edits a file this guide owns.** If one had to, every lane would owe this
   guide and they would be one queue again. (One recorded exception: FAM-1 step 3 added the unit
   `mi` and `(primary, count)`, which the plan assigns to it, and so adjusted the unit pins in
   `shapes.test.ts`; maintainer-approved, 2026-11-15.) Two things keep it so. The harness test
   (`preview-harness.test.tsx`) mocks the four screens and asserts only what the harness hands
   them, so filling a stub in changes no file here; a screen's own output is tested beside the
   screen. And each lane's list of owed tests is a file in its own directory:
   `packages/db/src/writers/program/owed.test.ts` (P), `packages/db/src/writers/day/owed.test.ts`
   (E), `apps/web/components/program-builder/owed.test.ts` (B) and
   `apps/web/components/day/owed.test.ts` (C). Lanes A and S have no guide, so their lines stay in
   `packages/shared/src/program/owed.test.ts` and are edited under the seam rule, one PR at a time.
10. **Every text a person types is refused if it holds a control character** (a NUL reaches Postgres,
    which refuses it, and the action then throws instead of answering `invalid`).
    `control-chars.test.ts` sweeps every typed field of the write schemas; a field added to one
    joins that table. `freeTextNoteSchema` and `movementNameSchema` refuse only a line break (and a
    comma), so the contract adds the rule where it builds on them.
11. **The day case mounts what the page will, in the page's order** (plan D34): the `<h1>`, then
    `AthleteSwitcher`, `ProgramLine` and `NotOnAProgram`, then `DayScreen`. All four get the same
    `plan` object and the two that write get the same `actions`; the harness passes no `className` (it
    has no nav rail) and no `programsHref` until the Programs page exists (7b). The switcher's links
    come from `dayPreviewHrefFor`, which reads the fixture list, so each is a state the route lists.
    The parts are lane C's; their props are a contract with the page and this harness.
12. **The workout-editor case passes the draft's own program** (`program`, a `ProgramListEntry`), read
    from the fake's Programs list by the draft's `programPublicId`, as the real page will load it
    (7b). The screen's prop is optional; the harness always supplies it.
13. **An added set is a row only while it is logged**, in the fake as in the contract
    (`dayItemSchema.rows`, `rowWriteSchema`). ✓ on any set number with no logged row adds
    its row, and only that row (a type without set rows has no set past 1: `bad_value`); un-ticking an
    added set takes the row away, so the numbers may have a gap, and ticking it back returns it. ⚠️ A set that was
    already past the prescription in a fixture stays a row when un-ticked: a `DayItem` does not carry
    the prescribed set count, so the fake cannot tell it from a prescribed one.
14. **A transport refuses in two of the contract's own words, and they are named once**
    (`TRANSPORT_REFUSALS`, `program/actions.ts`): no session answers `not_found`, the same as an id
    from another household; over the rate limit answers `retry`. Both are members of
    `PROGRAM_REFUSALS` and `ROW_REFUSALS`, so one value is a `ProgramResult` and a `RowResult`. The
    web app's entry check returns them (`enterMutation(TRANSPORT_REFUSALS)`,
    [write-path.md](./write-path.md) invariant 1); a later API transport returns the same two.
    Neither list gains a "signed out" or "forbidden" member (ADR 0006). A fake calls no
    transport, so it never answers either word for these two reasons.

15. **`newItem` makes no second item for a name or an alias that already names one in the
    household's list, and it answers with the item's own name.** A typed name that `existingItem` matches selects that item
    (`existed: true`); it is not a refusal. The picker withholds "add as new" for the same two cases
    (`matchMovementOptions`' `exact` and `aliasHit`), so the client's guard and the server's answer
    are one rule: the guard saves a round trip, the server holds when the page is stale or the call
    did not come from the picker. `name` is on every success (the stored name, which is not always
    what was typed), so a card never shows `rdl` for Romanian Deadlift.
    Three limits, each on purpose: the options passed must carry `isCatalog` (the picker's
    tie-break, so the type requires it); a name whose key is empty (`S`) is refused by
    `newItemSchema`, since it could be matched to nothing, with a sentence a form shows as it is
    (`NEW_ITEM_NAME_MESSAGES.noKey`: "Give the item a longer name."; only a name of the letter `s`
    alone reaches it, so it must not ask for a letter); and the check is a read before the
    insert, so two calls in the same moment with names that share a key but not a slug can both
    insert (plan D25).

16. **One rule says what a row stores, and the fake uses the writer's** (`fillRowValues`, contract
    change C10). An empty ✓ takes the prescription's numbers; a number the type has no field for, a
    slot named twice, a quantity in another unit, a value over the unit's ceiling, and a missing
    number the prescription cannot supply are each `bad_value`. **The values are judged before the
    set**: the real writer has no slot pre-check and learns a set is taken from the database's
    arbiter at the insert, so a bad number on a logged set answers `bad_value`, not `slot_taken`,
    and the fake answers the same. A range (`valueMax`) is not a number an empty ✓ can accept
    (`prescribedTarget`); no FAM-1 screen writes one, and `prescribedText` does not render one.
    ⚠️ What a person sees follows from that order: a bad number on a set another phone has already
    logged is told the number is wrong, not that the page is out of date, so no Reload is offered
    until the number is fixed and the next ✓ answers `slot_taken`. `entryUnitFor` answers plan §2's
    table whatever unit it is handed for a type whose unit is fixed.

17. **A required name is not made only of characters that fold away** (`shortTextSchema`: a
    program's name, a workout's, a superset's group key and the keys of a day's `restAfter`;
    contract change C12). A name of zero-width or format characters only, or of combining marks
    only, is one character long, so a length check alone takes it; it must also fold to something
    (`foldName`). `invalid` otherwise. ⚠️ This is narrower than "can be seen": the braille blank and
    the Hangul filler characters draw as nothing and still pass, because `foldName` keeps them; they
    are named on the schema. An item's name is held to more by `movementNameSchema` (a letter) and
    `newItemSchema` (a key, invariant 15).

18. **A slot holds at most one entry** (plan D35, maintainer, 2026-11-16; a slot is one athlete,
    day, prescription and set). Program rows only: bodyweight and practice are not slots in this
    sense and keep "re-entry is a new row". A new ✓ on a set whose entry was un-ticked, or hidden by
    Clear day, brings that entry back: same `entryPublicId`, no second entry, however many times a
    row is un-ticked and ticked. The revived entry is what a new ✓ would have made but for its id:
    this ✓'s numbers and the prescription's text as it reads now. The rules are on `rowWriteSchema`
    (and, for a late re-tick, `rowRetickSchema`) and in the fake: the entry answers to the reviving
    ✓'s `clientId`; that id never revives its own hidden entry (`own_hidden`); a refused ✓ leaves the
    hidden entry untouched; a re-tick that arrives after the revive answers with the live entry.
    ⚠️ **One known limit:** the entry stores one `clientId`, so an id a revive replaced is forgotten.
    Replayed after the set is un-ticked again, it revives the entry with that old attempt's numbers
    (`fakes.test.ts` pins it). No screen re-sends such an attempt and there is no offline queue;
    closing it means keeping the replaced ids, which is a table. The maintainer accepted the limit
    (2026-11-16); it is revisited when an offline sync queue arrives. The real writer gets all of
    this at step 11c. Until then 11b inserts where 11c will revive, so two answers differ between the two
    steps: a re-tick after a new ✓ (`slot_taken` under 11b), and a replay of the first ✓'s id while
    its entry is hidden (`own_hidden` under 11b, and under 11c once that id has been replaced it
    is the limit above).

19. **Take off says what it did, and a same-day Put on is undone by it** (`takeOffSchema`,
    maintainer, 2026-11-16). A start that has not begun is removed. A start dated today with no
    live row logged under it is removed too, as if Put on had not been tapped. Any other start ends
    today. The answer's `lastDay` is today, or `null` for a removed start, and the screen words its
    message from that: a start dated today can be either, so `hasStarted` alone cannot say. ⚠️ The
    program fake holds no logged rows, so in the preview a start dated today is always removed.
20. **A copy may carry its own name, and no program ever holds two workouts with one name**
    (`CopyDraft.name`, optional; maintainer, 2026-11-16). Without a name, a copy into the workout's
    own program is named with " (copy)" and a copy into another program keeps the name. A name
    already used in the program it is copied into answers `name_taken`, in any program. The dialog
    then shows its Name field, prefilled, and the person copies again; it needs no list of the other
    program's workouts. ⚠️ The fake knows another program's names only by what it has copied there,
    so in the preview the clash is a second copy of one workout into the same other program.
21. **Put on undoes a Take off whose last day is today** (`assignDraftSchema`; maintainer,
    2026-11-16). An athlete already on a program is skipped by Put on, except one with a last day:
    that is cleared, and they stay on with no gap, one stretch, whichever day was picked. Such an
    athlete is still `on` in `candidates` and has `lastDay` in `athletes`; the dialog joins the two
    to list them as available.

22. **An item that is saved can be logged in its unit** (`saveWorkoutSchema`, contract change C16).
    The save, the row writer and the day's read ask one function, `itemUnit`, for the unit an item
    logs in. The save refuses an item for which it answers `null` while the type has a quantity,
    one whose quantity is in a unit its type does not log in (`unitsForTrackingType`), and one
    whose target `fillRowValues` would not store (over its unit's ceiling), so the row writer never
    meets a prescription whose empty ✓ it must refuse for its unit or its number.
    `save-workout.test.ts` holds that against `fillRowValues` for every type and unit, at a small
    value, a fraction, the unit's ceiling and one past it. Reps are outside the rule: reps text
    that is not a whole number is legal, and the row then asks for them. The workout
    editor asks for the unit before Save (lane B, #493), and the preview's fake parses with this
    schema; the program writer (6a-ii) refuses the same draft with `invalid`.

23. **A `DayPlan` fixture is built from an exported source, and the builder keeps the shape's own
    rules** (contract change C17). `DAY_PLAN_FIXTURE_SOURCES[name]` is the world a fixture was
    built from; the fixture is that source run through `dayPlan`, so the two cannot differ
    (`fixtures.test.ts`). A data lane seeds the source and deep-equals the fixture (invariant 3).
    Three rules the builder now keeps, each of which `day-shapes.ts` already stated or implied:
    - **Rows:** every prescribed set, plus each logged set beyond them. A gap below a logged extra
      set is not a row and is not counted.
    - **One order for a day's programs and its workouts:** current programs in the athlete's order,
      then any program since left (`order: null`), those in their own order (`idx`, then id).
      Current is a property of the program, not of an assignment row.
      `closed-day-program-since-left` holds it.
    - **Where only logged rows show, a workout has the name it was logged under**, not its name
      now. The same fixture holds a workout renamed after logging.
      The day resolver, not the DAL, sets `writable`, `future` and `canGoForward`, from the `today`
      it is given; the DAL adds `athletes`.

24. **`DayPlan.writable` is true exactly where the row writer would accept a ✓, and a workout
    whose slot is gone has no label** (contract change C18; the maintainer, 2026-11-17).
    - An archived athlete's day is never writable: today and yesterday read like a closed day,
      with only what was logged and no PREVIOUS. `archived-athlete-today` holds it. So a page
      never offers a ✓ the writer refuses with `closed_day`.
    - **The plan carries no `archived` field.** The page has the fact from the profile and says
      it once, in its own notice (maintainer, 2026-11-17: "One merged notice"; a field was
      proposed as C19 and dropped, #509). The preview harness shows that notice from the
      fixture's world, in the page's words (C20), with "Household settings" as plain text: a
      link there would leave the preview route (invariant 7). A future day is the same for an archived
      athlete as for anyone: `fixtures.test.ts` holds that.
    - `DayPlan.athletes` is the switcher's list: the household's athletes who are not archived,
      as the picker lists them. An archived athlete is not in it on their own day either, so a
      page takes the heading's name from the profile, never from this list (the preview harness
      reads it from the fixture's world).
    - A workout that left the week has `label: null`. The label is its slot's heading; the
      database keeps the workout's name on the session and has nowhere to keep that label.

25. **An id in a `DayWorkout` is one the household can use now** (contract change C21, from 12a-i's
    code review). `programPublicId` is non-null only for a live program; `workoutPublicId` only for
    a live workout of a live program. Hidden or purged, the id is `null` and the frozen name
    remains. `DayPlan.programs` and `currentPrograms` hold live programs only. A logged workout
    that is no longer live has `scheduled: false` and no label, as one that left the week does,
    and further has no description, every item built as a removed item is, and `progress` 0 of 0,
    so a hidden program's own text never reappears. (A workout that merely left the week is still
    live and keeps its description, its live items and its count.) **Liveness decides, never the
    assignment** (C24): a live workout logged on a day no live assignment covers any more is
    shown as one that left the week, ids kept, though its program is not in that day's
    `programs`; `onProgram` still follows the assignments. No FAM-1 action hides a
    program, and no fixture holds this: the day resolver's own proof does.
26. **An id has one spelling after the parse: lower case** (contract change C25, from 6a-ii's
    review). Every id in the shapes, a public id or a client id, is `lowerCaseUuidSchema`
    (`pieces.ts`): any uuid, handed back in lower case. Postgres reads `0193A2B4-…` and
    `0193a2b4-…` as one uuid and answers in lower case; `===`, a `Map` and a `Set` read them as
    two. So the "no two the same" checks (a workout's cards, a day's slots, a program order, a
    Put on's athletes) refuse one id written in two cases, and a replay under the other spelling
    of its client id is still a replay, in the fakes as in the writers. 🔴 **Read ids from the
    parsed value, never from the raw input after parsing it**, and do not name `uuidSchema` in
    `program-shapes.ts` or `day-shapes.ts`. **A refused parse hands back no value**, so the one
    place that must look at a refused draft, `saveWeek` deciding between `once_per_day` and
    `invalid`, asks `weekRepeatsAWorkout(draft)`, which folds the case itself; the fake does, and
    6b's writer is to. `id-case.test.ts` sweeps every schema that reads an
    id and scans both files for the case-keeping schema; a schema added with an id belongs in its
    table. Nothing changes for an id the app made (`newId`, `crypto.randomUUID` and Postgres all
    write lower case). A writer may still lower-case for itself; it is then doing nothing.
27. 🔴 **A Change is judged in the unit the row was logged in, never the item's unit now**
    (`loggedRowUnit`, contract change C28, from step 11c's plan). Saving a workout can edit a
    prescription's unit in place, so a row logged in lb can sit under an item that now reads kg.
    A Change fixes a number; it does not restate one in a new unit. Judged against the item, a
    kg number would be stored on a row still labelled lb: a load in the wrong unit. So an amend
    passes `fillRowValues` the row's own unit (`{ trackingType, unit: loggedRowUnit(…) }`, with
    no target), in the fake as in the writer: the lb row is changed in lb and a kg number answers
    `bad_value`. A new ✓ is not a Change and is still in the item's unit. The day screen is
    stricter and offers no Change at all on a row logged in another unit than the item's.
    **A row that does not hold what its type now logs has no unit to be changed in**
    (`loggedRowUnit` is `null`: no quantity in the type's slot, or one in a unit the type cannot
    be in), so a Change that sends a quantity for it is `bad_value`. No FAM-1 screen changes an
    item's type (plan D25), so nothing makes such a row today.

## Traps

- **`@mat-plan/shared`'s root barrel does not export the fixtures or `prescribedText`.** They are
  the `/program/fixtures` and `/program/prescribed-text` subpaths, because `'use client'`
  components import the barrel. That is a rule about the barrel: `prescribed-text.ts` is pure, so a
  client component may import its subpath directly for a whole prescription's line. For one
  quantity, `quantityText` is in the barrel.
- **`packages/shared` has no typecheck project of its own** ([AGENTS.md](../../AGENTS.md) → "Local
  hooks vs CI merge-gates"). Its files are checked through what `apps/web` and `packages/db` import.
- **The fixtures are deep-frozen.** Clone one before changing it (`structuredClone`); the fakes do.

## The movement library's contract (CAT-3)

The second contract this guide owns. [Its spec](../specs/cat-3-movement-library.md) is the source of
truth; this section is the map. The library's lanes (schema, data, picker) meet at these files as
FAM-1's lanes meet at the program shapes, and the same rule holds: **no lane edits a file listed
here; a change goes through the contract owner.**

| File                                            | What it holds                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/catalog/vocabulary.ts`     | `EQUIPMENT` (53 codes), `MUSCLES`, `MODALITIES`, `SUPERVISION` (each with a zod enum, named members and labels), `MEDIA_KINDS`, and `QUERY_SHORT_FORMS`. In the root barrel.                                                                                                                                                                                                                               |
| `packages/shared/src/catalog/entry.ts`          | `catalogMovementSchema` / `CatalogMovement` (one library entry: strict, no id), `catalogInstructionsSchema`, `catalogMediaSchema`, their caps, and `requiresNoEquipment`. In the root barrel.                                                                                                                                                                                                              |
| `packages/shared/src/catalog/fixture.ts`        | `CATALOG_FIXTURE` (24 generic entries) and `CATALOG_FIXTURE_IDS`. The subpath `@mat-plan/shared/catalog/fixture`. What a test, CI or preview database holds in place of the real library.                                                                                                                                                                                                                  |
| `packages/shared/src/catalog/approvals.ts`      | `entryHash`, `lockfileIssues`, `approvalIssues`: the checks behind `data/shipped.json` and `data/approved.json`. `node:crypto`, so server and test code only; not exported from the module's index.                                                                                                                                                                                                        |
| `packages/shared/src/catalog/data/`             | **The data lane's directory.** `CATALOG_MOVEMENTS` (empty until the first reviewed batch), `CATALOG_SLUGS`, `shipped.json`, `approved.json`. The subpath `@mat-plan/shared/catalog/data`. C0a created the files; the lane fills them and writes its guide.                                                                                                                                                 |
| `.github/scripts/check-catalog-append-only.mjs` | The step in CI's quality job that compares the two record files with the PR's base (`pnpm catalog:check` locally).                                                                                                                                                                                                                                                                                         |
| `packages/shared/src/catalog/catalog.test.ts`   | Criteria V1 to V3, V5, V6 and D2, and what the fixture covers. `approvals.test.ts` holds V4 and D3 (the lockfile, the approvals, the merge-base comparison). `owed.test.ts` lists only the criteria no test holds yet; lane B's proofs live in its picker's and the item picker's tests (`apps/web/components/movements/`, `apps/web/lib/movements/`, `apps/web/components/program-builder/item-picker/`). |
| `packages/shared/src/movement-search.ts`        | `searchMovementOptions` (the library's search: `matchMovementOptions`, plus equipment short forms and `near`, the near misses), `editsWithin`, `SEARCH_WORDS_MAX`. Beside `matchMovementOptions`, `foldMovementQuery` and `movementNameKey`, which [movement-picker.md](./movement-picker.md) describes. `catalog/search.test.ts` holds criteria P1 to P4 and the contract's half of P6.                   |

Invariants (the spec's rules, as they bind code here):

1. **A vocabulary is one const array**, and `EQUIPMENT`, `MUSCLES` and `MODALITIES` become stored
   data when the schema lane's tables ship: from then on a new, renamed or removed member is a
   migration, never an edit to `vocabulary.ts` alone.
2. **An entry has no id and no source.** `catalogMovementSchema` is strict. A catalog row's
   `public_id` is minted when it is seeded; the library is authored and reviewed in-house.
3. **A slug is set once.** It is `movementSlug` of the name or of an alias: a corrected name keeps
   its slug and the old name becomes an alias. It holds no comma and no line break, because the
   CSV export prints it. `shipped.json` pins every shipped slug to its tracking type.
4. **"No equipment" is computed** (`requiresNoEquipment`: the required set is empty) and stored
   nowhere. A scan of every package's source, the migrations and the app holds that nothing is
   named `noEquipment` or `no_equipment`, so the picker's filter switch needs another name.
5. **Every entry, and every edit to one, needs an approval line.** `approved.json` holds the
   SHA-256 of each entry the maintainer approved, by batch; an entry whose content has no matching
   hash fails `approvals.test.ts`, whichever field changed. Both record files only grow, which the
   merge-base check holds; a base it cannot read fails the check. A batch PR is merged by the
   maintainer. **An entry is written exactly as it parses** (no stray spaces): the hash and the
   seed read it as written.
6. **The library stays out of the browser.** The root barrel reaches the vocabularies and the
   entry schema and never `catalog/data/` or `approvals.ts` (a scan). Import the data through its
   subpath, on the server.
7. **`CATALOG_FIXTURE` shares no slug and no name key with the legacy `MOVEMENT_SEED_ROWS`, and no
   alias with the legacy picker's**, which a fixtures database also holds until those lists are
   retired. So its short alias is `SLRDL`, not `RDL`.
8. **A data file imports the entry type and its own directory, nothing else**: `catalog/data/`
   holds literal entries, never code.
9. **Instructions are our own words, written as they will be read; media is reserved.** An
   entry's optional `instructions` is one or more plain lines (no blank line, no space at a line's
   end, at most `CATALOG_INSTRUCTIONS_MAX` characters, **no character a reader cannot see and no
   web address**), reviewed and hashed with the entry. Its
   optional `media` is a kind and a key into the app's own store, **never a URL**, and no entry in
   the library or the fixture may set it until a media plan lifts that test. Both stay in the
   const and are read by slug, like aliases: no column holds them.
10. 🔴 **`exact` and `aliasHit` are always `matchMovementOptions`' own, for the query as typed.**
    They are what withholds "Use as typed", and the server's `existingItem` reads the same two.
    `searchMovementOptions` adds rows (through a short form, as near misses) and never changes
    those answers: `db row` finds Dumbbell row and a household may still make an item called
    "db row". With no short form in the query its `matches` and `someWords` are
    `matchMovementOptions`' too, in the same order.
11. **A short form is equipment, not a movement.** `QUERY_SHORT_FORMS` expands a whole query word
    inside the search only: never in `movementNameKey`, and never as an entry's alias. Rows found
    only that way come after the others and count as matches.
12. **A near miss is offered only when nothing matches, and never picked by Enter.** Every query
    word must be in the option: part of its name, or (five letters or more, same first letter)
    within one edit of a word of its name or of an alias; two edits from nine letters. Or the
    same test on the whole query and a whole name or alias with the spaces out. The search
    reads `MOVEMENT_NAME_MAX` characters of a query; a query of more than `SEARCH_WORDS_MAX` words
    gets the plain match only; and it builds no `RegExp` from a query or a name.

## Changing it

- **A new state:** add the fixture to `fixtures/index.ts` and to the list of its shape
  (`DAY_PLAN_FIXTURES` and the like). The route, its index and the scan pick it up.
- **A new screen:** add it to `PREVIEW_SCREENS` and a `case` to `preview-harness.tsx`.
- **A new rule in a fake:** write its test in `fakes.test.ts` first, against a named fixture.
- Re-run: `pnpm test`, and `pnpm e2e:local e2e/program-preview-a11y.spec.ts` for the route.
