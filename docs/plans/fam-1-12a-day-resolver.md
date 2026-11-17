# FAM-1 12a — the day resolver

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step
> 12a. Branch: `feat/fam-1-12a-day-resolver`. Lane E ([day-writers.md](../features/day-writers.md)).
> **Rev 3**, after a five-lens panel and a re-review (§ Review-response log). The split (§ Split)
> and the archived-athlete rule (Q1) wait on the maintainer.

## Goal

Turn an athlete and a day into the `DayPlan` the day page shows (`packages/shared/src/program/day-shapes.ts`):

- the programs the athlete is on that day, and their workouts, in order;
- each workout's items, rows and progress;
- what each logged row stored, and what it was logged against;
- PREVIOUS: what the athlete last logged for the same movement and set.

This step is a read only. 12b's DAL wraps it, and 12c puts it on the page.

**Roadmap alignment (2026-11-16):** advances `FAM-1` lane E. It is gated by 11b (#470, merged) and
contract step C17 (#504: the fixture sources, plus the `build.ts` fixes for R3 and R6). It gates 12b.
`ID-1`: no key or cache is keyed on `(household, profile)`, and no branch reads `profiles.kind`.
`programBlockOfProfile` ties history to the athlete's CURRENT household, so after an `ID-1` move the
old household's workouts disappear (fail-closed). That is `ID-1`'s "take your history" question,
recorded here, not decided. Checked against the private roadmap; nothing to add here.

## Acceptance

From the plan's §5 row 12a, verbatim:

> **seeds the state each `DayPlan` fixture describes and deep-equals it** (parallel-work → "Once
> lanes run", 3); hand-written timestamps

Done when:

- For each fixture in 12a's set (§ Split), `verify/day.ts`:
  - seeds its source from `DAY_PLAN_FIXTURE_SOURCES` (C17);
  - resolves it;
  - compares it to the fixture with **ids mapped exactly**. The seeder returns fixture id → the
    `public_id` each insert RETURNED, never what the resolver returns. The fixture is translated
    through that map, throwing on any UUID the map does not hold, then compared with
    `assert.deepStrictEqual` after a JSON round trip, **never through `normalizeFixture`**, which
    relabels every UUID and would let a returned `client_id` pass (C1).
- **A round trip per writable fixture family**, after the deep-equal: the returned `workoutPublicId`
  and `prescriptionPublicId` tick an UNLOGGED row through `logRow` → `ok` (a logged set answers
  `slot_taken`), and a returned `entryPublicId` un-ticks through `untickRow` → `ok`.
- **Every 12a line in `owed.test.ts` is mapped:** either to the fixture that proves it, or to a new
  proof (§ Test plan).
- **Every rule no fixture exercises names a mutation**, or is listed as unproven with the reason.

## Decisions

From the contract owner (2026-11-16, C17):

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The resolver takes `today`; the DAL supplies it and adds `athletes`. `writable = inWritableWindow(day, today) && !archived`, in ONE place. That is the interim rule (Q1, with the maintainer), so the page never offers a tick the writer refuses (`log-row.ts:152`). `future` is `day > today`; `canGoForward` is computed here.                                                                                                                                                              |
| R2  | Where only logged rows show (a closed day, or a workout that left the week), `name` is the frozen `sessions.workout_name`. Otherwise it is the live name. A left-the-week workout's `label` is open with the maintainer: the proof compares `workout-left-the-week` with that one workout's `label` set aside (12a-ii).                                                                                                                                                                        |
| R3  | Writable rows: sets 1..N as prescribed, plus each LOGGED set beyond N. A gap is neither a row nor counted.                                                                                                                                                                                                                                                                                                                                                                                     |
| R4  | A removed item: grouped by `prescription_id` (the movement after a purge, an unproven fallback since no writer purges yet). Its rows are their OWN item even when the workout holds that movement live again. Placed after the live items, in first-logged order. Name, text and unit come from the lowest-numbered set's entry (first logged on a tie); `unit` is null when the type has no slot, else `entries.unit`. No target, notes or superset; `previous` is null. (#504's shape text.) |
| R5  | PREVIOUS keys on the MOVEMENT and the set number (a recorded limit: two prescriptions of one movement share it).                                                                                                                                                                                                                                                                                                                                                                               |
| R6  | `programs`: the current ones by their `currentPrograms` order, then the ones the athlete has left, by `(idx, id)` among themselves. `workouts` follows the same program order, then `block_day_workouts.idx`, then the workouts that left the week, in the order their first live row that day was logged (`created_at`, then id), whichever program they are in.                                                                                                                              |
| R7  | Each program is listed once. A program's `order` is its index in `currentPrograms`: current is a property of the program, not of a row. It is placed by its open or upcoming row's `idx`, else its closed row's. Each workout is listed once. A one-row type (Check, Count, Duration) has exactly one row, whatever its entries' set numbers.                                                                                                                                                  |
| R8  | C16 (#499): a saved item always has a loggable unit and a target. No guard for either.                                                                                                                                                                                                                                                                                                                                                                                                         |

Lane E's own, from the panel:

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Two anchors.** The live branch is anchored on the assignment, with `liveTemplateBlockIn(scope)` ∧ `programBlockOfProfile`. The logged branch is anchored on the athlete, with `programRowOf(profileId, day)`. It LEFT JOINs a **scoped** workout (the workout ⋈ its block under `templateBlockIn(scope)` ∧ `programBlockOfProfile`, as a nested join or subquery) and, the same way, a scoped prescription (the prescription ⋈ ITS OWN block). Never gate only the block join, or H's `prescriptions` columns leak. **The drop is a WHERE on the raw FK:** `(sessions.workout_id IS NULL OR scoped_workout.id IS NOT NULL) AND (entries.prescription_id IS NULL OR scoped_prescription.id IS NOT NULL)`. A condition in an ON clause can only null the joined columns; it never drops the row. So a foreign pointer (runbook (f)/(g)) is dropped, and a purged pointer (NULL) keeps the row with null ids (`day-shapes.ts:97`). Residual: after a purge the resolver cannot tell foreign from purged, so pre-flight (f)/(g) is the only control then. |
| E2  | **The movement is read under `movementIsAvailableTo(scope)`**, so an item is absent exactly where 11b's writer answers `not_found` (11b's fixture `p.foreignMove`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| E3  | **Hidden entries are never logged rows**, and a session counts only through its live entries. A session outlives its entries (`hideEntries` never hides a session). A live entry with no live set throws, with internal ids only (#498).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| E4  | **Program rows only.** The day's entries go through `programRowOf` AND `entries.movement_id IS NOT NULL`, the latter added in the day read and not in `programRowOf`, whose behaviour 11b relies on. No schema CHECK ties `prescription_set` to a movement row, and only 11b's writer sets it. So a weigh-in, a practice or a check-in on that day never enters a DayPlan. Bodyweight is privileged (SECURITY.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E5  | **The prescription's derived terms** (`quantities`, `target`, `unit`, `text`) come from ONE pure function in `queries/day/prescription-terms.ts`. It wraps the shared `itemUnit`, `prescribedTarget` and `prescribedText`, plus the numeric conversion and the two-in-one-slot throw, and 11b's `logRow` calls it too. So the live heading and the frozen snapshot cannot diverge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E6  | **Superset placement:** a group sits at its first member's `idx`; members are ordered by `(superset_order, idx)`; `superset.order` is the position in the group. A group of one has no rest (D14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E7  | **Exports:** `packages/db` exports `resolveDayPlan` and its type by name only, never `export *` from `queries/day`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## The rules, field by field

**Signature:**

```ts
export async function resolveDayPlan(
  exec: Executor,
  args: { scope: HouseholdScope; profilePublicId: string; day: string; today: string },
): Promise<Omit<DayPlan, 'athletes'> | null>; // null: profile not live in scope (uniform, no oracle)
```

| Field                              | Rule                                                                                                                                                                                                                                                                       | Proved by                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `writable`, `future`               | R1 (and Q1)                                                                                                                                                                                                                                                                | fixtures; archive proof (Q1)                                          |
| `onProgram`                        | `'yes'`: an assignment `assignmentOnDay(day)`; `'not-this-day'`: one `assignmentCurrentAsOf(today)`; else `'never'`. All through E1's live anchor.                                                                                                                         | fixtures; hidden-block proof                                          |
| `canGoForward`                     | true on a past day; else true iff an assignment is on `day + 1` (E1's live anchor)                                                                                                                                                                                         | new proofs (`active_to = today`; a past day before a gap)             |
| `currentPrograms`                  | `assignmentCurrentAsOf(today)`, R7                                                                                                                                                                                                                                         | fixtures; two-rows proof                                              |
| `programs`, `workouts`             | R6, R7                                                                                                                                                                                                                                                                     | fixtures (C17's come-off fixture); reverse-insert seeding             |
| `scheduled`                        | `scheduledOn`                                                                                                                                                                                                                                                              | fixtures                                                              |
| `progress`                         | `done` counts live logged rows of live items; `total` is the prescribed rows (sets, or 1) plus logged sets beyond them. Removed items count in neither.                                                                                                                    | fixtures; un-tick proof                                               |
| `items`                            | E6, then R4. On a closed day, or for a left-the-week workout, an item with no live logged row is absent.                                                                                                                                                                   | fixtures; shared-order proof                                          |
| `target`, `unit`, `prescribedText` | E5 (live). Where only logged rows show, an item's heading is what its FIRST-LOGGED row was logged against (the earliest `created_at`, then id; #504's shape text). Each row still carries its own `logged.prescribedText`.                                                 | fixtures; edited-then-closed proof (12a-ii)                           |
| `notes`, `restAfter`               | `prescriptions.notes`; `rest_after` on a group's last member, for a shown group of two or more                                                                                                                                                                             | fixtures                                                              |
| `rows`                             | R3 (writable); logged rows only (closed, or left the week); none (future). `logged.values` from `readRowValues`, `logged.prescribedText` from `prescribed_snapshot`. E3.                                                                                                   | fixtures; un-tick proofs                                              |
| `previous`                         | `previous.ts`: the same `profile_id`, movement and `prescription_set`; `programRowOf`'s conjunct before `day`; live; the latest day; then `created_at`, then id. Null on a day that is not writable, and on a removed item. Takes ids the caller has already proved owned. | fixtures; sibling and foreign-athlete proof; equal-`created_at` proof |

**Reads:**

- The assignment reads are in `queries/day/scheduled.ts`, which is lane E's and already on the
  stay-dark allowlist. That keeps "12a and 11b move to `assignmentDueOn` together" in one file
  (`onProgramOn(profileId, day)`, composed by `isOnProgramThatDay` and the resolver).
- The other tables, through `day-plan.ts` and `previous.ts`. Every select names its columns.
- `programRowOf` and the slot conjuncts move from `writers/day/log-row.ts` to `queries/day/` (a read
  does not import a writer module). `log-row.ts` re-imports them.

## Split (proposed; the maintainer's call)

- **12a-i:** the resolver and PREVIOUS. It proves the fixtures whose `source.before === null`, chosen
  by that test, not a list; `closed-day-logged-only` is among them. **Gates:** C17. **Gates next:** 12b
  (and 12c's e2e).
- **12a-ii:** the before → log → edit replay; R2's frozen name; R4's removed items; R6's come-off tail;
  the closed-day heading rule (the first-logged row's text); their fixtures (`today-stretching-first`, `yesterday-edited-after-logging`,
  `closed-day-program-since-left`, and `workout-left-the-week` once its label is decided). **Gates:**
  12a-i, and the lane P writers each edit replays (6a-ii, 6b, 6c, 6d), or a recorded decision to apply
  the edits with direct SQL. **Gates next:** 15.

## File by file (12a-i)

| Path                                                   | Change   | What                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/day/day-plan.ts`              | NEW      | `resolveDayPlan`.                                                                                                                                                                                                                                                                                       |
| `packages/db/src/queries/day/previous.ts`              | NEW      | `previousRows(exec, profileId, day, keys)`: one query for the day's rows.                                                                                                                                                                                                                               |
| `packages/db/src/queries/day/prescription-terms.ts`    | NEW      | E5's pure function.                                                                                                                                                                                                                                                                                     |
| `packages/db/src/queries/day/program-rows.ts`          | NEW      | `programRowOf` and the slot conjuncts, moved from `log-row.ts`.                                                                                                                                                                                                                                         |
| `packages/db/src/queries/day/scheduled.ts`             | EDIT     | `onProgramOn`; the assignment reads.                                                                                                                                                                                                                                                                    |
| `packages/db/src/writers/day/log-row.ts`               | EDIT     | Imports E5 and the moved conjuncts. No behaviour change. The mutation patches whose context moves with the code are **regenerated** against their new homes, each still red on its own `.expect`: `117`, `118` (session slot), `129` (snapshot), `173`–`177` (replay pin), with their `README.md` rows. |
| `packages/db/src/queries/day/index.ts`, `src/index.ts` | EDIT     | Named exports (E7).                                                                                                                                                                                                                                                                                     |
| `packages/db/scripts/verify/day-plan.ts`               | NEW      | The fixture seeder and proofs (`verify/day.ts` is 1,455 lines). Lane E owns it through a new `owns:` line.                                                                                                                                                                                              |
| `packages/db/scripts/verify/day.ts`                    | EDIT     | Calls `verifyDayPlan`.                                                                                                                                                                                                                                                                                  |
| `packages/db/src/writers/day/owed.test.ts`             | EDIT     | The 12a-i lines go.                                                                                                                                                                                                                                                                                     |
| `packages/db/scripts/mutations/NN-…`, `README.md`      | NEW/EDIT | About 8, from the new block (§ Test plan).                                                                                                                                                                                                                                                              |
| `docs/features/day-writers.md`                         | EDIT     | `owns:`, file map, invariants (E1–E7), `day-writers.md:44`'s export decision, a read-path diagram.                                                                                                                                                                                                      |
| `docs/architecture.md`                                 | EDIT     | The day read path (§2d still describes the legacy read).                                                                                                                                                                                                                                                |
| `docs/tech-debt.md`                                    | EDIT     | The seeder's direct inserts fold into lane P's `seedProgramFixtures` at 6c.                                                                                                                                                                                                                             |
| `docs/changelog/<date>-feat-fam-1-12a-….md`            | NEW      | The fragment.                                                                                                                                                                                                                                                                                           |

The FAM-1 plan rows, the milestone chart and the roadmap entry for the split are the contract
owner's (the #500 precedent).

## Test plan

**The seeder** (`verify/day-plan.ts`, test-only, owned by lane E):

- Programs, workouts, the week, prescriptions, quantities and assignments are written with direct
  inserts, **in reverse order**, so ids never match `idx`. Each assignment also gets its seven
  weekday rows, as a put-on writes them (`schema.ts`, `programAssignments`; `db:verify` flags an
  assignment without them).
- ⚠️ A world's `assign.to` is the first day OFF, so `active_to = to − 1`.
- **Entries:** a world has no timestamps; "first logged" is entry order `n` (`build.ts`). So entries go
  through `logRow` in DESCENDING `n` (ids then run opposite to `n`), with `today` set to each entry's
  own day so the window lets older entries through. Then `created_at` is UPDATEd to hand-written
  stamps that RISE with `n`. A `created_at` tie-break is then decided by `created_at`, and the
  fixture's first-logged order holds (e.g. 11-13's Splits: w1 `{min:5}` before w5 `{min:4}`).
- It returns fixture id → the RETURNING `public_id` of each insert.

**Fixtures:** 12a-i's set (`before === null`), deep-equalled with ids mapped exactly, plus the round
trip.

**Owed lines, mapped:**

| Owed line                                         | Proved by                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| deep-equals each fixture                          | the fixture loop                                                                                |
| program order, then week order; labels never sort | `today-two-programs` (and `today-stretching-first`, 12a-ii)                                     |
| PREVIOUS counts only program rows                 | **new**: a weigh-in and a strength entry on the same movement the day before                    |
| PREVIOUS takes the first logged                   | **new**: equal `created_at`, decided by id; `today-two-programs` (splits)                       |
| PREVIOUS is null on a day that is not writable    | `closed-day-logged-only`                                                                        |
| a closed day omits unlogged items and workouts    | `closed-day-logged-only`                                                                        |
| progress                                          | `yesterday-half-done`; **new**: an un-tick lowers `done`, and an un-ticked extra set's row goes |
| look-ahead                                        | **new**: `active_to = today` (false today, true yesterday); a past day before a gap (true)      |
| the day page's `prescribedText` is the renderer's | the fixture loop: `build.ts` renders every item with `prescribedText`, and E5 is the resolver's |
| progress, "not removed items' rows" half          | **12a-ii** (removed items); that half of the line stays owed until then                         |

**Other new proofs** (12a-i):

- **Ownership:**
  - a profile of another household under H's scope → `null`, identical to a missing one;
  - a planted (f) session, (g) entry and (h) assignment, each carrying H's REAL text (the (f)
    session's `workout_name` is H's workout name; the (g) entry's `prescribed_snapshot` and its
    superset's `prescription_group` are H's rendering and label, as the runbook describes the defect).
    Each proof asserts BOTH that no H id or string appears in F's DayPlan AND that the row itself is
    absent: no workout for the (f) session, nothing in `rows` or `progress` from the (g) entry (E1);
  - `p.foreignMove` is absent (E2);
  - a sibling and an F athlete logging the same movement and set earlier do not reach PREVIOUS.
- **Hidden:** an un-ticked row is not logged; a left-the-week workout whose rows are all un-ticked is
  absent; PREVIOUS skips a hidden row.
- **Order:** `superset_order` opposite to `idx` (E6); two current rows for one program (R7); a hidden
  block (onProgram `never`, gone from `currentPrograms`, `canGoForward` false).
- **No foreign rows:** a weigh-in, a practice and a check-in on the day are absent (E4).

**Mutations** (only for rules no fixture exercises; the deep-equal guards the rest):

- PREVIOUS loses its profile;
- hidden entries are counted;
- a superset is ordered by `idx` alone;
- `assignmentOnDay` becomes `assignmentCurrentAsOf`;
- **E1's WHERE drop is removed**, so an (f) session and a (g) entry fall to the purged path, and the
  planted-row proofs go red;
- the movement read loses `movementIsAvailableTo`;
- `canGoForward` tests `day` instead of `day + 1`;
- the day read loses E4's `movement_id IS NOT NULL` (the weigh-in proof plants a weigh-in that carries
  a `prescription_set`).

That is 8, with numbers from lane E's next block.

**Recorded as having no mutation of their own, with the reason:**

- PREVIOUS's program-row conjunct: implied by its `prescription_set = N` key, since a legacy row's set
  is NULL and a weigh-in has no movement. The proof stays as documentation.
- `programBlockOfProfile` in the logged join: through `resolveDayPlan` the profile's household always
  equals the scope's, so `templateBlockIn(scope)` alone gives the same answer. It is proven where the
  two can differ, in 11b's 4d (`rowWorkout`, mutation 111).

Run `pnpm verify`. There is no UI.

## Risks

- **A fixture the database cannot express:** R2's label; that one workout's `label` is set aside in the
  comparison (12a-ii).
- **N+1 reads:** one query per kind per day; PREVIOUS is one query.
- **Ownership:** E1, E2 and E4, each with a planted-row proof and a mutation.

## Out of scope

`athletes` and the page (12b, 12c); Change (11c); the revive (D35, 11c); the export (14). 14's
grouping must match R4's key: when 14 is built, it reads the grouping helper rather than restating it.

## Open questions

- **Q1 (maintainer, through the board):** an archived athlete's day. The interim rule is R1 (`writable`
  false, so it takes the closed-day shape). The alternative is a separate `archived` flag that keeps
  today's shape, which is a shape change.
- **Q4 (maintainer):** the split.
- **The label of a workout that left the week (maintainer):** R2.

Q2 and Q3 are answered (#504's shape text; the exact id map) and folded into R4, R6, R7, the field
table and the Acceptance.

## Review-response log

### Engineering panel, round 1 (rev 1; Opus 5.5)

> Panel cost: correctness 171k · 8m59s, scope 102k · 6m17s, architecture 155k · 7m35s, reuse 119k ·
> 3m33s, security 121k · 4m07s.

| #   | Lens                             | Critique (short)                                                | Verdict              | Resolution                                                                                                                                                              |
| --- | -------------------------------- | --------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | correctness                      | The deep-equal can't tell a public id from a client id          | **accepted**         | Ids mapped exactly; a round trip through `logRow` and `untickRow`                                                                                                       |
| C2  | correctness, scope, architecture | 12a-i without PREVIOUS fails most writable fixtures             | **accepted**         | PREVIOUS in 12a-i; split on `before`                                                                                                                                    |
| C3  | correctness, architecture        | The closed-day `prescribedText` rule was left "to be confirmed" | **accepted**         | Q2a, proposed from `build.ts`; a proof in 12a-ii                                                                                                                        |
| C4  | correctness, architecture, reuse | The archive fold changes the day's shape and contradicts #504   | **accepted**         | Q1 to the contract owner; not folded until it is answered                                                                                                               |
| C5  | correctness                      | Hidden entries unproven; a session outlives its entries         | **accepted**         | E3 and three hidden proofs                                                                                                                                              |
| C6  | correctness                      | Order mutations survive: insert order equals `idx`              | **accepted**         | Reverse-insert seeding; an opposite-order superset proof                                                                                                                |
| C7  | correctness                      | `canGoForward` branches and the live-block rule unproven        | **accepted**         | Two look-ahead proofs and a hidden-block proof                                                                                                                          |
| C8  | correctness                      | R6 and R7 leave placement and the left-the-week order undefined | **accepted**         | R7 placement; Q2b and Q2d                                                                                                                                               |
| S1  | security                         | Rows reached through a FK (f)/(g) leak another household's text | **accepted**         | E1, two anchors; planted-row proofs; a mutation                                                                                                                         |
| S2  | security                         | The movement read is unscoped                                   | **accepted**         | E2                                                                                                                                                                      |
| S3  | security                         | Assignment reads lack the both-parents rule                     | **accepted**         | E1's live anchor on every assignment read                                                                                                                               |
| S4  | security                         | No ownership proofs                                             | **accepted**         | The ownership proofs                                                                                                                                                    |
| S5  | security                         | PREVIOUS's profile conjunct is unproven                         | **accepted**         | Sibling and F-athlete proof; a mutation                                                                                                                                 |
| S6  | security                         | Bodyweight kept out only by an unnamed predicate                | **accepted**         | E4 and a proof                                                                                                                                                          |
| A1  | architecture, scope              | "The real writers" don't exist yet; a second seeder             | **accepted**         | Direct inserts, test-only, a tech-debt entry for 6c; 12a-ii gated on lane P's writers                                                                                   |
| A2  | architecture                     | The stay-dark edit is certain; the read's home                  | **accepted**         | The assignment reads in `scheduled.ts`                                                                                                                                  |
| A3  | architecture                     | Logged rows through a purged workout would be dropped           | **accepted**         | E1's logged anchor, LEFT JOIN                                                                                                                                           |
| A4  | architecture, reuse              | Rules 11c and 14 need would be private                          | **accepted**         | `program-rows.ts`, `prescription-terms.ts`; R4's key read by 14                                                                                                         |
| A5  | architecture                     | `export *` would leak internal-id helpers                       | **accepted**         | E7                                                                                                                                                                      |
| A6  | architecture                     | `workout-left-the-week` would be red                            | **accepted**         | Carved out until the label decision                                                                                                                                     |
| A7  | architecture                     | No diagram owner; `architecture.md` §2d is stale                | **accepted**         | Both in 12a-i's file table                                                                                                                                              |
| SC1 | scope                            | One mutation per rule is over-built, and the numbers don't fit  | **accepted**         | About 8, for rules no fixture exercises; a new block requested                                                                                                          |
| SC2 | scope                            | Most owed lines are already proved by fixtures                  | **accepted**         | The owed-line map                                                                                                                                                       |
| SC3 | scope                            | The split isn't written into the plan or the milestone chart    | **accepted**         | The contract owner's, after the maintainer answers                                                                                                                      |
| SC4 | scope                            | 12c needn't wait for 12a-ii                                     | **accepted**         | 12a-ii gates 15                                                                                                                                                         |
| R1  | reuse                            | The prescription's derived terms would be re-spelled            | **accepted**         | E5                                                                                                                                                                      |
| R2  | reuse                            | The rows and progress rule is in three places                   | **accepted, partly** | The resolver follows the shape's text, and #504 fixes `build.ts`. A shared pure function would mean editing the contract owner's `build.ts`, so it's offered, not taken |
| R3  | reuse                            | Superset `order` and `restAfter` differ from `build.ts`         | **accepted**         | E6                                                                                                                                                                      |
| R5  | reuse                            | The on-program conjunct would be copied                         | **accepted**         | `onProgramOn` in `scheduled.ts`                                                                                                                                         |
| R6  | reuse                            | `currentPrograms` has a second consumer (6c)                    | **accepted**         | Exported from `queries/day/` for 6c                                                                                                                                     |
| —   | scope                            | Hide PREVIOUS from the comparison instead                       | **rejected**         | It weakens the acceptance without saying so                                                                                                                             |
| —   | reuse                            | Put the assignment read in `queries/program-assignments.ts`     | **rejected**         | That is lane A's step-5 file, not a seam in §6                                                                                                                          |

### Engineering panel, round 2 (re-review of rev 2: correctness, security; Opus 5.5, medium)

> Panel cost: correctness 120k · 6m09s, security 75k · 2m24s.

| #        | Lens                  | Critique (short)                                                                              | Verdict      | Resolution                                                                                     |
| -------- | --------------------- | --------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| 2S1      | security              | E1's ON-clause scope can't drop a row; foreign looks like purged                              | **accepted** | A WHERE drop on the raw FK; each table scoped by its own block                                 |
| 2S2, 2C3 | security, correctness | The `programBlockOfProfile` mutation can't go red through `resolveDayPlan`                    | **accepted** | Replaced by a mutation removing the WHERE drop; the conjunct is recorded as proven in 11b's 4d |
| 2S3      | security              | The planted (f)/(g) rows need H's real text, plus an absence check                            | **accepted** | Pinned in the ownership proofs                                                                 |
| 2S4      | security              | E4 rests on the writers, not the schema                                                       | **accepted** | `movement_id IS NOT NULL` in the day read, plus its mutation                                   |
| 2C1      | correctness           | The seeder's `created_at` rule has no source and its direction breaks today's Splits PREVIOUS | **accepted** | `logRow` in descending `n`, then stamps rising with `n`                                        |
| 2C2      | correctness           | The exact-id comparison must bypass `normalizeFixture`                                        | **accepted** | The map from RETURNING; throw on unknown UUIDs; `deepStrictEqual` after JSON                   |
| 2C4      | correctness           | The PREVIOUS program-row mutation can't go red                                                | **accepted** | Dropped; recorded as implied by the set key                                                    |
| 2C5      | correctness           | Moving `programRowOf` breaks patches 117, 118, 129, 173–177                                   | **accepted** | Listed for regeneration in the file table                                                      |
| 2C6      | correctness           | Q2a contradicts #504; Q2b–d are already answered there                                        | **accepted** | Adopted #504's text (R4, R6, R7, the heading rule)                                             |
| 2C7      | correctness           | Q1 gates nothing                                                                              | **accepted** | The contract owner's interim rule in R1                                                        |
| 2C8      | correctness           | The owed map and the round trip are incomplete                                                | **accepted** | Two owed lines added; the round trip ticks an unlogged row after the deep-equal                |
| —        | correctness           | Assignments need their seven weekday rows; the "(B1)" cite; E5 should wrap the shared helpers | **accepted** | All three in rev 3                                                                             |
