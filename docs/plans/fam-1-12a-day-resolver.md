# FAM-1 12a — the day resolver

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step
> 12a. Branch: `feat/fam-1-12a-day-resolver`. Lane E ([day-writers.md](../features/day-writers.md)).
> **Rev 1, a draft for the panel.** It proposes a split into 12a-i and 12a-ii (§ Split), waiting on
> the maintainer's answer.

## Goal

Turn an athlete and a day into the `DayPlan` the day page shows (`packages/shared/src/program/day-shapes.ts`):

- the programs the athlete is on that day, and the workouts in them, in order;
- each workout's items, rows and progress;
- what each logged row stored, and what was prescribed;
- PREVIOUS, what this athlete last logged for the same item and set.

This step is a read only. 12b's DAL wraps it, and 12c puts it on the page.

**Roadmap alignment (2026-11-17):** advances `FAM-1` lane E. Gated by 11b (#470, merged) and
contract step C17 (the fixture sources, below). It gates 12b (12a-i) and 12c (12a-ii). Checked
against the private roadmap; nothing to add here.

## Acceptance

From the plan's §5 row 12a, verbatim:

> **seeds the state each `DayPlan` fixture describes and deep-equals it** (parallel-work → "Once
> lanes run", 3); hand-written timestamps

Done when:

- For each fixture in `DAY_PLAN_FIXTURES`, `verify/day.ts` seeds its source world from
  `DAY_PLAN_FIXTURE_SOURCES` (C17). It runs the resolver, and the result deep-equals the fixture
  through `normalize-fixture.ts`.
- Each 12a line in `packages/db/src/writers/day/owed.test.ts` becomes a real proof and leaves the
  owed list.
- Each rule below names the mutation that turns its proof red (lane E's numbers: 110–129, then
  170–199), or is listed as unproven, with the reason.

## Decisions taken in

These come from the contract owner's answers of 2026-11-17, carried by C17.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | The resolver takes `today`. It computes `writable` (`inWritableWindow`), `future` and `canGoForward`; the DAL supplies `today` and adds `athletes`.                                                                                                                                                                                                                      |
| R2  | A workout's `name` is the frozen `sessions.workout_name` where only logged rows show (a closed day, or a workout that left the week). Elsewhere it is the live `workouts.name`. **`label` of a workout that left the week is `null`, behind one line** (open with the maintainer); there is no new column.                                                               |
| R3  | A writable day's rows are sets 1 to N, as prescribed, plus each LOGGED set beyond N. A gap below a logged extra set is not a row and is not counted.                                                                                                                                                                                                                     |
| R4  | A removed item's rows are grouped by `prescription_id`, or by the movement after a purge. They come after the live items, in first-logged order (`created_at`, then id). Its `name` is `movement_name` and its text is the snapshot. It has no target, notes or superset, and `previous` is `null`. Its `unit` is `null` when the type has no slot, else `entries.unit`. |
| R5  | PREVIOUS keys on the MOVEMENT and the set number. Two prescriptions of one movement share it, and this is a recorded limit.                                                                                                                                                                                                                                              |
| R6  | `programs` lists the programs on that day: current ones by their order in `currentPrograms`, then any the athlete has come off, by `(idx, id)`. `workouts` follows the same program order, then `block_day_workouts.idx`, then any workout logged that day that has left the week.                                                                                       |
| R7  | List each program once (the database can hold two current rows for one program).                                                                                                                                                                                                                                                                                         |
| R8  | C16 (#499): every saved item has a unit its type logs in and a target an empty ✓ can store. The resolver does not guard against either being missing.                                                                                                                                                                                                                    |

## The rules, field by field

**Signature (proposed):**

```ts
export async function resolveDayPlan(
  exec: Executor,
  args: { scope: HouseholdScope; profilePublicId: string; day: string; today: string },
): Promise<Omit<DayPlan, 'athletes'> | null>; // null: profile not live in scope
```

| Field                | Rule (source)                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `today`, `day`       | As passed.                                                                                                                                                                                                                                                                                             |
| `writable`           | `inWritableWindow(day, today)`, and not archived (as `dayPageFlags`).                                                                                                                                                                                                                                  |
| `future`             | `day > today`.                                                                                                                                                                                                                                                                                         |
| `onProgram`          | `'yes'` if any assignment is `assignmentOnDay(day)`; else `'not-this-day'` if any is `assignmentCurrentAsOf(today)`; else `'never'`. Always ANDed with a live template block in scope and the live profile.                                                                                            |
| `canGoForward`       | true on a past day. On today or later: true if some assignment is on `day + 1`.                                                                                                                                                                                                                        |
| `currentPrograms`    | `assignmentCurrentAsOf(today)`, once per program, ordered by `(idx, id)`.                                                                                                                                                                                                                              |
| `programs`           | R6.                                                                                                                                                                                                                                                                                                    |
| `workouts`           | R6. `scheduled`: `scheduledOn` (11b's rule) for a live workout of a program on that day.                                                                                                                                                                                                               |
| `progress`           | `done` counts the live logged rows of live items. `total` is each live item's prescribed rows (its sets, or 1) plus each logged set beyond them. Removed items count in neither.                                                                                                                       |
| `items`              | Live prescriptions in `idx` order, with a superset's members by `(superset_order, idx)` (L16: two members may share an order). Then removed items (R4). On a closed day, or for a workout that left the week, an item with no logged row is absent.                                                    |
| `target`             | `prescribedTarget(target_reps, live quantities)` (C10).                                                                                                                                                                                                                                                |
| `unit`               | `itemUnit(type, quantities)` (C13), or R4 for a removed item.                                                                                                                                                                                                                                          |
| `prescribedText`     | `prescribedText({ trackingType, sets, targetReps, quantities: target.quantities })`, the same call 11b freezes. On a closed day an item shows its logged rows' snapshot, if the fixture says so (to be confirmed by the deep-equal).                                                                   |
| `notes`, `restAfter` | `prescriptions.notes`. `rest_after` is on a group's last member, keyed by `superset_label`, only for groups with a shown item.                                                                                                                                                                         |
| `rows`               | A writable day uses R3. A closed day, or a workout that left the week, lists logged rows only. A future day lists none. `logged.values` come from `readRowValues` (11b's reader); `logged.prescribedText` from `prescribed_snapshot`. Un-ticked (hidden) entries are not logged rows.                  |
| `previous`           | `previous.ts`: the same profile, the same movement and the same `prescription_set`. Program rows only (`prescription_set IS NOT NULL`), live, `activity_date < day`; the latest such day; the first logged on it (`created_at`, then id). `null` on a day that is not writable, and on a removed item. |

**Reads:**

- `program_assignments`: through `queries/program-assignments.ts`. Its predicates are lane A's, and
  the stay-dark allowlist names `queries/day/day-plan.ts` only if the resolver names the table itself.
- `program_blocks`, `workouts`, `block_day_workouts`, `prescriptions`, `prescription_quantities`,
  `movements`, `sessions`, `entries`, plus `readRowValues`.
- Every select names its columns, as the stay-dark guard's patterns require.

## Split (proposed; the maintainer's call)

- **12a-i:** the resolver, without PREVIOUS (`previous` is `null` everywhere), with proofs for the
  writable-day, future-day and no-program fixtures.
  - **Gates:** C17. **Gates next:** 12b.
- **12a-ii:** `previous.ts`; the closed-day, workout-left-the-week, removed-item and come-off-program
  fixtures; renamed workouts; the duplicate-movement and shared-`superset_order` proofs.
  - **Gates:** 12a-i. **Gates next:** 12c.

## File by file

| Path                                                   | Change          | What                                                                                                                                                                                                          |
| ------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/day/day-plan.ts`              | NEW             | `resolveDayPlan`.                                                                                                                                                                                             |
| `packages/db/src/queries/day/previous.ts`              | NEW (12a-ii)    | `previousRows(exec, profileId, day, keys)`: one query for every row of the day.                                                                                                                               |
| `packages/db/src/queries/day/index.ts`, `src/index.ts` | EDIT            | Exports for 12b.                                                                                                                                                                                              |
| `packages/db/scripts/verify/day.ts`                    | EDIT            | A fixture seeder (world → rows through the real writers: lane P's program writers where they exist, else the ownership helpers; 11b's `logRow` for entries), the deep-equal per fixture, and the owed proofs. |
| `packages/db/src/writers/day/owed.test.ts`             | EDIT            | The 12a lines go.                                                                                                                                                                                             |
| `packages/db/scripts/mutations/NN-…` + `README.md`     | NEW/EDIT        | One patch per rule.                                                                                                                                                                                           |
| `docs/features/day-writers.md`                         | EDIT            | File map; invariants (the order rule; PREVIOUS's key; R3; which fields the DAL sets).                                                                                                                         |
| `apps/web/test/program-tables-stay-dark.test.ts`       | EDIT, if needed | Allowlist `day-plan.ts` with its reason.                                                                                                                                                                      |
| `docs/changelog/<date>-feat-fam-1-12a-….md`            | NEW             | The fragment.                                                                                                                                                                                                 |

## Test plan

- **Per fixture** (13+, after C17): seed `world`. If there is a `before`, seed that first, log its
  entries through `logRow`, then apply the edit through the real writers. Resolve with the fixture's
  `day` and `today`, and deep-equal through `normalize-fixture.ts`. Timestamps are hand-written on
  entries, so the tie-breaks are set by the proof rather than by `now()`.
- **Owed, beyond the fixtures:**
  - workouts in program order then week order; labels never sort;
  - PREVIOUS counts program rows only, its tie-break, and its null on a day that is not writable;
  - a closed day omits unlogged items and workouts;
  - progress (R3's gap; a removed item's rows);
  - look-ahead only while on a program;
  - prescribedText equals the renderer's output;
  - the duplicate-movement case (R5) and a shared `superset_order`.
- **Mutations:** one per rule above. For example: drop `assignmentOnDay` (onProgram); order workouts
  by assignment array (R6); list a gap row (R3); key PREVIOUS by prescription (R5); include hidden
  entries; order a superset by `idx` alone; take a closed day's name live (R2).
- Run `pnpm verify`. There is no UI, so no screenshots.

## Risks

- **A fixture that the database cannot express** (the frozen label, R2): built as `null`, and the
  fixture follows C17.
- **N+1 reads:** the resolver reads per day, not per row. PREVIOUS is one query for the day's rows.
- **Ownership:** every read goes through `isLiveProfile(scope)` and `templateBlockIn(scope)` /
  `programBlockOfProfile`, as 11b's are.

## Out of scope

`athletes` and the page (12b, 12c); Change (11c); the revive (D35, 11c); the export (14).

## Review-response log

_(The panel has not run.)_
