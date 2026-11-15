# FAM-1 — the family program (d2: the milestone's plan)

> Milestone: [FAM-1](../milestones/fam-1-family-program.md), step **d2**. Branch: `docs/fam-1-d2-plan`.
> Authorized by [ADR 0007](../decisions/0007-scheduling-model.md) Amendments 1 and 2 (signed, #402).
> Checked against the accepted Beta 0 prototype, [v10](../prototypes/beta-0/index.html), and its
> [d3 round notes](../prototypes/beta-0/d3-round-1.md).
> **Roadmap alignment:** Beta 0's last milestone; it ends Beta 0 by moving the household onto a
> program it builds itself ([beta-1 → Beta 0](../milestones/beta-1.md#beta-0--one-invited-family)).

## Goal

One plan for the whole slice, so each of FAM-1's ~23 code PRs starts from a settled design instead of
its own plan. It cites the plans it takes from (SCHED-1, ASSIGN-1, V1-22 A4, TGT-1, PICK-1) and
takes **only this slice** of each. It settles everything the milestone and the ADR left to d2: the
seven tracking types (ITEM-1's section), the entries model for the new kinds, the prescribed-value
shape, the instructions length, the contract shapes that let lanes run in parallel, each lane's file
globs, and the questions the d3 panel raised.

A step's PR still owes its own short **step note** in its description (what it changes, file by
file, against this plan) and the panel AGENTS.md requires for its kind (a migration gets DB-safety; a
screen gets the UX panel's single reviewer, since d3 already panelled the design). A step that has to
depart from this plan amends it first (docs/plans/README.md → "amend it one way").

## Acceptance

The milestone's exit criteria, verbatim ([FAM-1 → exit criteria](../milestones/fam-1-family-program.md#fam-1-exit-criteria--done-when)),
plus, for this plan:

- Every "d2's call" in ADR 0007 Amendment 2 and in the milestone has a decision below (§1), with the
  alternatives rejected.
- Every step 1–16 has its files, its gate and its tests (§5).
- The contract (chunk 0) is specified to the field, with named fixtures (§4).
- Each lane's globs pass gate 1 of [parallel-work](../parallel-work.md) (§6).
- The engineering, DB-safety and privacy panels ran and are reconciled in the log below.

## What this plan takes from each source

| Source                                                    | Takes                                                                                                         | Leaves (Beta 1 unless noted)                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [ADR 0007](../decisions/0007-scheduling-model.md) A1 + A2 | every table, column, key and proof in Amendment 2 §1–10                                                       | rotation, the destructive `workouts` arc, MOT-1 tables (§9) |
| [SCHED-1](./sched-1-scheduling-model.md)                  | 1a (day primitives, `WEEKDAYS`) as step 2; 1c (assignment + weekday tables) as step 5, revised by A2 §7       | 1b, 1d (superseded by A2 §1), 1e                            |
| [ASSIGN-1](./assign-1-assignments.md)                     | "put on", Take off, several programs, the shifted-band order writer (steps 15–15c)                            | per-athlete days, Move, Change days, Undo                   |
| [V1-22 A4](./v1-22-a4-create-program.md)                  | A4-1 (revised as step 4a), A4-3a's writer shape (step 6), the name limits                                     | A4-3c, A4-4 (superseded by A2 §1)                           |
| [TGT-1](./tgt-1-typed-targets.md)                         | only the instructions column (`prescriptions.notes`, step 4b)                                                 | typed targets and ranges as targets                         |
| [PICK-1](./pick-1-movement-picker.md)                     | PR 3's `MovementPicker` (`apps/web/components/movements/movement-picker.tsx:83`) as the base of step 9        | PR 4 as planned; MOV-1                                      |
| [V1-22 program editor](./v1-22-program-editor.md)         | W1, the shifted-band writer design (A2 §7)                                                                    | chunks 3–5                                                  |
| [V1-9b](./v1-9b-delete-and-restore.md)                    | B0's `hideEntries` / `restoreHidden` (`packages/db/src/writers/hide.ts:71`, `:212`) for un-tick and Clear day | B1-3 (cut, 2026-11-15)                                      |
| Prototype v10                                             | every screen, state and copy; the frozen logged day; single values edit-only                                  | old entries (deferred until FAM-1 is done, 2026-11-15)      |

## 1. Decisions this plan makes

Each is a recommendation the panel attacks; the maintainer signs the plan by merging it.

| #   | Question (owner)                                              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Rejected, and why                                                                                                                                                                                         |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Tracking types (ITEM-1)                                       | `TRACKING_TYPES = ['check', 'count', 'reps', 'weight_reps', 'duration', 'time_sets', 'distance']` in `packages/shared`, labelled as in v10. On the **item** (`movements.tracking_type`), not the prescription: an item's history must mean one thing. §2 has each type's fields                                                                                                                                                                                                                                                                          | On the prescription: the same item could log as reps in one workout and seconds in another, and PREVIOUS would compare them                                                                               |
| D2  | Prescribed values (A2 §4: "d2 sets the shape")                | **`prescription_quantities`**, a child mirroring `entry_set_quantities` (`schema.ts:470-520`): `(prescription_id, slot, dimension, unit, value_min, value_max)`, composite FKs `(slot, dimension) → quantity_slots`, `(unit, dimension) → units`. `sets` and `reps` stay columns on `prescriptions` (they are today's, `schema.ts:951-982`). A single value has `value_max` NULL; a range is Beta 1 (TGT-1) but costs nothing to allow                                                                                                                   | Columns per type on `prescriptions`: ADR 0004's superseding note records that fixed columns overflowed on the second real program                                                                         |
| D3  | Entries for the new kinds (milestone gap)                     | **Every row is an `entries` row in the workout's session, with `entry_sets` per set row and `entry_set_quantities` for its numbers**, exactly the strength shape (`writers/strength-session.ts:168-295`). `kind` is `'strength'` for `weight_reps` and `reps` (export and PREVIOUS unchanged), and a new **`'item'`** for `check`, `count`, `duration`, `time_sets` and `distance`. A Check row is an `entry_sets` row with no quantity                                                                                                                  | A table per kind: five writers, five export paths, five hide paths. One kind for everything: moves today's strength rows' meaning and the export's `session_type` logic                                   |
| D4  | Instructions length (milestone)                               | `prescriptions.notes` bounded by the existing `FREE_TEXT_NOTE_MAX = 500` (`packages/shared/src/text.ts:8`) and `freeTextNoteSchema`, single line. v10's editor already counts to 500                                                                                                                                                                                                                                                                                                                                                                     | TGT-1c's 80: real instructions run to ~150 (milestone). A new const: there is one already                                                                                                                 |
| D5  | Name and label limits (A2 §2, §3)                             | `PROGRAM_NAME_MAX = 60`, `WORKOUT_NAME_MAX = 30`, `SLOT_LABEL_MAX = 30`, all new in `packages/shared/src/programs.ts`. Item names keep `MOVEMENT_NAME_MAX = 100` (`movements.ts:46`). Duplicate workout names in one program are **refused by the writer** ("Heavy A is already in this program"), not by an index                                                                                                                                                                                                                                       | An index on `lower(name)`: a rename swap (A↔B) would need a deferred constraint for a case a refusal handles                                                                                              |
| D6  | `session_type` for a template session (A2 §2)                 | One new value, **`'workout'`**, in `SESSION_TYPES` (`packages/shared/src/sessions.ts:14`) and the CHECK. `DAY_ROLE_TO_SESSION_TYPE` stays the fallback for legacy sessions. The export's `session_type` column for a template session is the frozen `workout_name` (step 14), quoted                                                                                                                                                                                                                                                                     | Reusing `'strength'`: a Check-only workout isn't strength, and MOT-1 will read it                                                                                                                         |
| D7  | **A logged day shows what was logged against** (v10; A2 §6–7) | **As-of reads, no snapshot blob.** The program writer **never updates a prescription or a week slot in place**: a save soft-deletes each changed row and inserts its replacement (unchanged rows are untouched). The day resolver reads a workout **as of the first write of that workout's session that day** (`sessions.created_at`): prescriptions with `created_at <= t AND (deleted_at IS NULL OR deleted_at > t)`. Before any ✓, it reads live. A workout removed from the week still shows on days whose session names it (`sessions.workout_id`) | A JSON snapshot on `sessions`: unauthorized by A2, duplicates rows the database already keeps, and can't be joined. Updating in place (today's seed habit): rewrites every past day, the defect v10 fixed |
| D8  | Ordering across programs on Today (A2 §3: "d2's call")        | Like v10: **time-of-day rank first** for the four suggested labels (Morning 0, After lunch 1, After school 2, Evening 3), any other label ranked **after Morning and before After lunch**; then the athlete's own program order (`program_assignments.idx`); then the week's `idx`. `SLOT_LABEL_RANKS` is a shared const, so the order is one table                                                                                                                                                                                                      | Program order only: a stretching program added second would push its Evening work above the family program's Morning habits. A time field per slot: a new column and a picker for one family              |
| D9  | Program slug (A2 §2)                                          | `movementSlug(name)`; on a household collision the writer appends `-2`, `-3`… There is **no `RESERVED_PROGRAM_SLUGS`**: it exists in no code (fact sheet), and the household-unique index (`schema.ts:935-937`) already separates a template block from the seeded `youth_daily_program`                                                                                                                                                                                                                                                                 | Building the reserved list: it guards a collision the suffix already handles                                                                                                                              |
| D10 | Step 1 without OPS-2's split                                  | **Step 1 removes the `seedProgram(PROGRAM_SEED)` call from `seed()`** (`packages/db/src/seed.ts:357`) and moves `PROGRAM_SEED` into the e2e fixtures path. It no longer waits on OPS-2, which has no plan or code (fact sheet). Existing program rows stay as data. This answers OPS-2's Q3                                                                                                                                                                                                                                                              | Waiting on OPS-2: a dependency with no plan on Beta 0's critical path                                                                                                                                     |
| D11 | Step 6 lands dark (milestone "for d2 to confirm")             | Confirmed: the writer has no caller until step 7, so **step 6 needs 4b, 5 and 5b, not step 1**. Slice 1 no longer waits on step 1                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                         |
| D12 | Lanes B and C merge dark (milestone)                          | Yes. B's routes (`/programs/**`) ship with **no link** until step 7 adds "Programs" to Home; C's components are **unmounted** until step 12 composes the page. Each PR tests against fixtures                                                                                                                                                                                                                                                                                                                                                            | A feature flag: a second mechanism for what "no link yet" already gives                                                                                                                                   |
| D13 | Empty ✓ (d3 question)                                         | A row **with a prescription** accepts an empty ✓ as the prescription (v10). A **single value with no prescription** (Bodyweight, Life) refuses ("Enter the minutes, then ✓."). Life has no program default in FAM-1, so v10's "unless the program's author set a default" stays unused                                                                                                                                                                                                                                                                   | A program default for Life: Life sits outside programs                                                                                                                                                    |
| D14 | Rest after a superset that splits or shrinks (d3 question)    | `rest_after` lives on the group's **last** prescription (A2 §4). When an edit leaves a group of one, the group and its `rest_after` are dropped on Save, and the editor shows the rest field only under a group of 2+ (v10)                                                                                                                                                                                                                                                                                                                              | Keeping an orphan rest note on a single item: nothing reads it                                                                                                                                            |
| D15 | Take off, then put back on (d3 question)                      | A new `program_assignments` row; the closed one stays as history. Its `idx` comes from the shifted-band writer (A2 §7). "Put someone on" lists a taken-off athlete as **"off since {date}"**, pickable                                                                                                                                                                                                                                                                                                                                                   | Reopening the old row: rewrites when they were on it                                                                                                                                                      |
| D16 | Bodyweight Change and its time (d3 question)                  | Change keeps the entry's time; the day page shows no time for bodyweight in FAM-1 (it showed `at` only in the prototype). A blank Change clears the value (single values, 2026-11-15) through `hideEntries`, never a tomb                                                                                                                                                                                                                                                                                                                                | Updating the time: a correction isn't a new weigh-in                                                                                                                                                      |
| D17 | A legacy athlete on the new day page (d3 question)            | **Every athlete gets the new page** (2026-11-15). An athlete with no open assignment sees Bodyweight and Life only, with "Not on a program yet → Programs". The legacy newest-block read **no longer renders on the day page** after step 12; it stays for the export and the snapshot writer until those are retired. Nobody uses the app yet, so no one loses a screen                                                                                                                                                                                 | Keeping the old strength form for legacy athletes: two day pages to maintain, against decision 0                                                                                                          |

## 2. ITEM-1: the seven types

| Type          | Label         | Prescribed (D2)                                           | A logged row                            | Rows per item     | `entries.kind` |
| ------------- | ------------- | --------------------------------------------------------- | --------------------------------------- | ----------------- | -------------- |
| `check`       | Check         | nothing                                                   | one `entry_sets` row, no quantity: done | 1                 | `item`         |
| `count`       | Count         | `primary` quantity: value + unit (any dimension: `10 lb`) | `primary` quantity, same unit           | 1                 | `item`         |
| `reps`        | Reps          | `sets`, `reps`                                            | `entry_sets.reps`                       | `sets`, + Add set | `strength`     |
| `weight_reps` | Weight × reps | `sets`, `reps`, `primary` quantity (mass)                 | `entry_sets.reps` + `primary` (mass)    | `sets`, + Add set | `strength`     |
| `duration`    | Duration      | `primary` quantity (time, `min`)                          | `primary` (time)                        | 1                 | `item`         |
| `time_sets`   | Time per set  | `sets`, `primary` quantity (time, `sec`)                  | `primary` (time) per set                | `sets`, + Add set | `item`         |
| `distance`    | Distance      | `sets`, `distance` quantity (length)                      | `distance` (length) per set             | `sets`, + Add set | `item`         |

- **Every item can be checked off** (R6): ✓ on an untouched row writes the prescription (D13).
- **"Write it" numbers are Count items** (R7). A worn load (vest) is a Count with a mass unit; the
  structured form is Beta 1.
- **The type lock:** a household item's type can change until it has any `entries` row; after that
  the writer refuses ("Push-ups has logs, so its type is fixed"). Global catalog rows are typed by the
  reference seed and never retyped by a household.
- **Reference data owed by step 3:** `quantity_slots` rows `(primary, time)`, `(primary, count)` and
  `(distance, length)` if missing, and unit `mi` (the prototype's "2 mi"; `UNIT_CODES` has `in cm ft m
yd`, `packages/shared/src/units.ts:42-57`). The step-3 PR checks each against the reference seed.

## 3. Schema, by migration

Migrations take the next number at merge (latest today: `0021_v1_9b_client_id_arbiters.sql`). Each
merges idle and is **observed applied before the deploy that ships its `schema.ts` change**, because
Drizzle's INSERT names every column (milestone §Staging). Each header names its A2 §4b route.

| Step    | Migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Route (A2 §4b)                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3**   | `movements.tracking_type text NOT NULL DEFAULT 'weight_reps'` + CHECK pinned to `TRACKING_TYPES` (`assertCheckCoversConst`). Constant default: metadata-only. The reference seed sets each global row's type (`MOVEMENT_SEED_ROWS` gains `trackingType`; the seed's movement upsert updates `tracking_type` on global rows only). `SESSION_TYPES` gains `'workout'` (D6) in the same migration                                                                                                                                                                                                                         | small tables; CHECKs added with the 0013 header justification                                                                                                             |
| **4a**  | `program_blocks.kind` (`BLOCK_KINDS`, default `'legacy'`), `program_blocks.client_id` + `UNIQUE (household_id, client_id)`; **`workouts`** (A2 §2, every column); **`block_day_workouts`** (A2 §3: partial slot key, composite FK, once per weekday, `weekday` CHECK 0–6, `idx >= 0`, `label` ≤ `SLOT_LABEL_MAX`); `sessions.workout_id` (FK `ON DELETE SET NULL`, covering index) + `sessions.workout_name`; the append arbiter on `sessions`; `supersets.prescription_group` + its arbiter (A2 §6). Builds **`assertCheckCoversIntConst`** in `verify.ts` (it doesn't exist; `verify.ts:1179` has only the text one) | FKs on `sessions`: same PR with `adding-foreign-key-constraint` ignore and the small-table justification (**first use; the header says so**). New tables: no lock concern |
| **4b**  | `prescriptions.workout_id` + composite FK; `day_role` DROP NOT NULL with the XOR CHECK (`-- squawk-ignore ban-drop-not-null` on the line above); partial `UNIQUE (workout_id, idx)`; `notes`, `rest_after`, `superset_label`, `superset_order` + pairing CHECK; **`prescription_quantities`** (D2)                                                                                                                                                                                                                                                                                                                     | **NOT VALID → VALIDATE** for the composite FK and XOR CHECK (the riskiest PR; the 0015/0016 precedent), so 4b is two PRs                                                  |
| **5**   | SCHED-1's `program_assignments` (with A2 §7's `idx` and its partial UNIQUE) and the weekday table, dark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | new tables                                                                                                                                                                |
| **11a** | `entries_kind_check` gains `'item'`; `entries_shape_check` admits an `item` row (the exact predicate is the step note's, proved both ways in `db:verify`)                                                                                                                                                                                                                                                                                                                                                                                                                                                              | CHECK replaced: NOT VALID → VALIDATE in the same PR is safe (`entries` is small); header says so                                                                          |

**Erasure, in the step that creates each table (A2 §8):** `docs/runbooks.md:1384-1403` gains, after
`prescriptions` and before `program_blocks`: weekday rows, `program_assignments`,
`block_day_workouts`, `prescription_quantities` (before `prescriptions`), `workouts`. Each step adds
its `docs/privacy/data-inventory.md` §1 row (assignments and a minor's session workout as **personal
data**) and seeds a row in `db:verify`'s erase proof. The step-3 pre-flight check for cross-household
pointers lands with 4a.

**Proofs:** every bullet of A2 §10 lands in the step that creates its object, plus:
`prescription_quantities` FKs reject a wrong `(unit, dimension)`; an `item` entry passes and a
malformed one fails; the as-of read (D7) returns a removed prescription for a day logged before the
removal.

## 4. The contract: chunk 0

One PR right after this plan, before any lane. ≈ 250 lines, in a **new directory**
`packages/shared/src/fam-1/`, each shape a zod schema + inferred type + named fixtures + a list of
the tests each consumer still owes (as `it.todo`).

```ts
// WorkoutDraft — builder (8–10b) → program writer (6)
{
  blockClientId: uuid, workoutClientId: uuid,
  name: string (1..WORKOUT_NAME_MAX), description: string | null (≤ FREE_TEXT_NOTE_MAX),
  items: Array<{
    prescriptionClientId: uuid, itemPublicId: string, trackingType: TrackingType,
    sets: int | null, reps: int | null,
    quantities: Array<{ slot: QuantitySlot, unit: Unit, value: number }>,   // value_min; ranges Beta 1
    notes: string | null (≤ FREE_TEXT_NOTE_MAX),
    superset: { group: string, order: int } | null,
    restAfter: string | null,      // only on a group's last item (D14)
  }> (≤ MAX_SESSION_MOVEMENTS? — see open question 3),
}

// DayPlan — day resolver (12) → Today (12's rendering, 13, 13b)
{
  profilePublicId, day: IsoDate, writable: boolean, future: boolean,
  programs: Array<{ programPublicId, name, order: int }>,          // the athlete's, in order
  workouts: Array<{
    programPublicId, workoutPublicId, label: string | null, name, description,
    frozenAt: Timestamp | null,                                  // D7: set once the session exists
    items: Array<{
      prescriptionPublicId, itemPublicId, name, trackingType, prescribedText, notes,
      superset: { letter: string, order: int } | null,
      rows: Array<{ set: int, prescribed: RowValues, previous: RowValues | null,
                    logged: { entryPublicId, values: RowValues } | null }>,
    }>,
    restAfter: Record<string /* group */, string>,
  }>,
  bodyweight: { entryPublicId, valueLb } | null,
  life: Array<{ key, label, entryPublicId: string | null, minutes: int | null }>,
}

// RowWrite — Today (13, 13b) → log writers (11a, 11b)
{
  clientId: uuid, profilePublicId, day: IsoDate,
  workoutPublicId, prescriptionPublicId, set: int,
  values: RowValues,            // { reps?: int, quantities: [{ slot, unit, value }] }
  done: boolean,                // false = un-tick → hideEntries
}
```

**Named fixtures** (each a `DayPlan` and, where it applies, a `WorkoutDraft`): `monday-two-programs`
(v10's Today: Morning habits + Heavy B + Conditioning + Evening stretch), `sunday-rest-stretch-only`,
`no-program`, `heavy-a-supersets` (A1/A2, B1/B2, rest after), `yesterday-frozen-after-edit` (D7),
`future-preview`, `new-workout-empty`, `every-type-once` (one item of each of the seven types).

A shape change after chunk 0 is a seam change: it goes through the contract's owner (integration),
and the lanes reading it wait (milestone → Lanes).

## 5. The steps, file by file

`N` = new file, `E` = edit. Paths under `apps/web/` and `packages/` as in the fact sheets. Gates are
the milestone's, with D10–D11 applied.

| Step | Files (N/E)                                                                                                                                                                                                                                                                                    | Tests                                                                                                           | Gate                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 0    | N `packages/shared/src/fam-1/{workout-draft,day-plan,row-write,fixtures,index}.ts`; E `packages/shared/src/index.ts`; N the four lane guides (§6)                                                                                                                                              | schema round-trips every fixture; `it.todo` list per consumer                                                   | this plan merged          |
| 1    | E `packages/db/src/seed.ts` (drop the `seedProgram(PROGRAM_SEED)` call, fix the stale "ships EMPTY" comment at :355); E the e2e fixtures seed to call it; E `docs/features/programming.md:354` (re-seed is insert-only, not "idempotent")                                                      | `db:verify` seed count; e2e still green                                                                         | d2 (D10)                  |
| 2    | SCHED-1 1a as planned: N `packages/shared/src/days.ts` (`WEEKDAYS`, day primitives)                                                                                                                                                                                                            | unit                                                                                                            | d2                        |
| 3    | N migration; E `schema.ts` (`movements.tracking_type`); N `packages/shared/src/tracking-types.ts`; E `catalog-movements.ts` (types per row), `sessions.ts`, `units.ts` (`mi`), the reference seed (`quantity_slots`)                                                                           | `assertCheckCoversConst`; every seed row typed; the lock (§2) is 6's                                            | d2                        |
| 4a   | N migration; E `schema.ts`; E `verify.ts` (`assertCheckCoversIntConst`, A2 §10 blocks/slots/identity/append/erasure); E runbook, inventory                                                                                                                                                     | A2 §10 as listed                                                                                                | 3 applied                 |
| 4b   | two migrations (NOT VALID, then VALIDATE); E `schema.ts`; E `verify.ts`                                                                                                                                                                                                                        | XOR both ways; slot keys; quantity FKs                                                                          | 4a applied                |
| 5    | SCHED-1 1c as revised: N migration; E `schema.ts`, `verify.ts`, runbook, inventory                                                                                                                                                                                                             | assignments proofs (A2 §10)                                                                                     | 4b applied                |
| 5b   | E `packages/db/src/queries/program-day.ts` (`programDayRows` block subquery :71-102 and `householdHasProgram` :192-202 filter `kind = 'legacy'`)                                                                                                                                               | byte-identical legacy output with a template block present (the four consumers)                                 | 4a applied · 5            |
| 6    | N `packages/db/src/writers/program/{create-program,save-workout,save-week,mint-item,shift-band}.ts`; N `packages/db/src/queries/program/{workout,week}.ts`                                                                                                                                     | `db:verify`: one-transaction save, never-update-in-place (D7), duplicate-name refusal, type lock, template-only | 4b · 5 · 5b (D11)         |
| 7    | N `apps/web/app/programs/actions.ts` (+ entries in `mutating-actions.ts:83`); N `apps/web/lib/dal/program/*.ts`; E Home (`apps/web/app/p/page.tsx`): "Programs" link                                                                                                                           | boundary tests as `actions.test.ts:363-468` (unauth, rate limit, wrong household, replay)                       | 6                         |
| 8    | N `apps/web/app/programs/{page,[programId]/page,[programId]/workouts/[workoutId]/page}.tsx`; N `apps/web/components/program/workout-editor/*.tsx`                                                                                                                                              | component tests against `WorkoutDraft` fixtures; e2e after 7                                                    | 0 (dark), 7 to mount      |
| 8b   | E `components/program/workout-editor/*` (supersets, rest after)                                                                                                                                                                                                                                | grouping rules (D14)                                                                                            | 8                         |
| 9    | N `components/program/item-picker/*` wrapping `MovementPicker` (multi-select, full screen, new item with type, sticky "Add n items")                                                                                                                                                           | multi-add order; new item type                                                                                  | 8                         |
| 10   | N `components/program/week-editor/*` (several days at once, once per day, labels)                                                                                                                                                                                                              | once-per-day skip message                                                                                       | 9                         |
| 10b  | N `components/program/copy-dialog.tsx`; E writer `save-workout.ts` (copy path, `copied_from_*`)                                                                                                                                                                                                | independence; name cap; frozen provenance                                                                       | 10                        |
| 11a  | N migration; N `packages/db/src/writers/program/log-row.ts` (item rows; un-tick → `hideEntries`)                                                                                                                                                                                               | idempotent replay; arbiter; as-of snapshot                                                                      | 4b applied · V1-9b B2     |
| 11b  | E `packages/db/src/writers/strength-session.ts` (template path: bare `ON CONFLICT DO NOTHING` + re-select by (profile, day, workout), as `writers/bodyweight.ts:236`; per-row append; superset via `prescription_group`); E `writers/prescribed-snapshot.ts` (from the workout's prescription) | twin-session race; append; superset inheritance                                                                 | 4b applied                |
| 12   | N `packages/db/src/queries/program/day-plan.ts` (resolver, D7, D8); N `apps/web/components/day/*` (rows, cards, look-ahead); E `apps/web/app/p/[profileId]/page.tsx` (compose; **remove** `CheckinForm`, `StrengthForm` and the "Logged entries" list, page.tsx:301-402)                       | `DayPlan` fixtures; e2e every day; the legacy read stays byte-identical for export                              | 2, 5, 11b · V1-24 3b-life |
| 13   | E `components/day/*` (Check, Duration, Count rows, done state)                                                                                                                                                                                                                                 | per type                                                                                                        | 11a, 12                   |
| 13b  | E `components/day/*` (set rows, PREVIOUS, linked supersets)                                                                                                                                                                                                                                    | per set; typed values survive (v10)                                                                             | 11b, 12                   |
| 14   | E `apps/web/lib/dal/export.ts`, `packages/db/src/queries/export-month.ts`, `packages/shared/src/csv/*` (RFC 4180 quoting, `row.ts:21-47`; `item` rows; `workout_name`); E `docs/privacy/notice.md` export paragraph                                                                            | a comma in a name round-trips; template session rows present                                                    | 11a                       |
| 15   | N `components/program/put-on-dialog.tsx`; N `writers/program/assign.ts` (all seven weekday rows; idx via shift-band)                                                                                                                                                                           | assignment proofs                                                                                               | 5, 7                      |
| 15b  | E `assign.ts` (Take off: `active_to` = today, or soft-delete if not started)                                                                                                                                                                                                                   | logged days keep their workout                                                                                  | 15                        |
| 15c  | E `day-plan.ts` (several programs, D8); N `components/day/program-order-dialog.tsx`                                                                                                                                                                                                            | order fixtures                                                                                                  | 15, 12                    |
| 16   | the household's run and a findings note                                                                                                                                                                                                                                                        | —                                                                                                               | all                       |

**Folded or moved:** step 14 stays separate from 11a (folding would put lanes A and D on
`write-path.md` together). The re-scoped V1-24 3b (Life and Bodyweight, edit-only) and V1-9b B2
(clear a day) are the feature thread's; step 12 composes their components.

## 6. Lanes and their globs

DX-14 item 9 ("most specific owner wins") lets a lane guide own a **new directory** under a hotspot
prefix. These guides are created by chunk 0:

| Guide                             | Owns                                                                   | Lane        |
| --------------------------------- | ---------------------------------------------------------------------- | ----------- |
| `docs/features/fam-1-writers.md`  | `packages/db/src/writers/program/`, `packages/db/src/queries/program/` | A           |
| `docs/features/fam-1-builder.md`  | `apps/web/app/programs/`, `apps/web/components/program/`               | B           |
| `docs/features/fam-1-today.md`    | `apps/web/components/day/`                                             | C           |
| `docs/features/fam-1-contract.md` | `packages/shared/src/fam-1/`                                           | integration |

`fam-1-schema.md` (milestone) is dropped: `schema.ts` and `migrations/` are lane A's alone and serial,
so a guide adds nothing. **Still on `write-path.md`, so ordered:** `seed.ts` (1),
`strength-session.ts` and `prescribed-snapshot.ts` (11b), `apps/web/lib/dal/*` flat files and
`actions.ts` (7, 12), `export-month.ts` (14), `program-day.ts` (5b, via `programming.md`). **Only
integration edits** `apps/web/app/p/[profileId]/page.tsx`. Gate 1 holds: no two lanes' globs
overlap, and every shared file has one ordered owner.

## Test plan

- **`db:verify`** (PGlite, `packages/db/scripts/verify.ts`): every A2 §10 proof and this plan's
  extras, in the step that creates the object.
- **Unit (Vitest):** contract round-trips; resolver ordering (D8) and as-of reads (D7) against
  fixtures; writer refusals; actions' boundary tests.
- **Components:** lanes B and C against fixtures only.
- **e2e (Playwright):** after 7 (build a program), after 12 (every day on the new page), after 13b
  (log a superset workout), after 15c (two programs). Each new route joins the a11y scan at 360px.
- `pnpm verify` before each PR; CI runs it except `db:mutations` (local, AGENTS.md).

## Risks / rollback

- **4b on a live table** (milestone's riskiest): NOT VALID → VALIDATE, observed applied between.
  Rollback: the constraint is dropped; no data moved.
- **5b changes the busiest read:** proved byte-identical on legacy data with a template block
  present; rollback is the filter's revert.
- **D7's never-update rule is easy to break** in a later PR: `db:verify` asserts the writer never
  issues an UPDATE on a live prescription's prescribed columns, and the `fam-1-writers.md` guide states
  the rule with its reason.
- **Twin sessions** on offline replay: the append arbiter plus re-select (11b).
- **A new column isn't dark:** each migration observed applied before its `schema.ts` deploys.
- **Personal data:** assignments and minors' session workouts enter the inventory and the erasure
  order in their own step; the household delete is proved with a row in every new table.
- **The day page swap (12)** removes three forms in one PR: e2e covers every day before merge;
  rollback is the revert (nobody uses the app yet).

## Out of scope / deferred

Everything in the milestone's "What moves to Beta 1", plus: old entries and history (until FAM-1 is
done, 2026-11-15; ask the maintainer then); ranges as targets; a program default for Life; a second
weigh-in defined by a program; picker search with no match beyond an empty state; loading, failed
save and offline states beyond a plain refusal (each step's UX reviewer checks them).

## Open questions (for the maintainer)

1. **D8, label order:** a custom label (for example "Before bed") ranks after Morning and before After
   lunch, as v10 does. Fine, or should custom labels sort last?
2. **D7, as-of reads** instead of a stored snapshot: the writer replaces changed rows instead of
   updating them. This is the main design choice in the plan.
3. **Caps:** a workout's items reuse `MAX_SESSION_MOVEMENTS = 12` and supersets `MAX_SESSION_SUPERSETS
= 6` (`strength-session.ts:31-36`)? The family's Morning habits has 6 items; 12 may be tight for a
   long session. Recommendation: a new `MAX_WORKOUT_ITEMS = 30`.

## Review-response log (adversarial panel)

_Pending: engineering (correctness, scope, architecture, reuse), DB-safety and privacy lenses._
