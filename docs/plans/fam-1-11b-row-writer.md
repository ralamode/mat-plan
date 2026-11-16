# FAM-1 11b — the row writer

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step
> 11b. Branch: `feat/fam-1-11b-row-writer`. Lane E ([day-writers.md](../features/day-writers.md)).

## Goal

A tick on any row of a program workout is stored once and answered with a typed result. One writer,
`logRow`, handles all seven tracking types. Un-tick and re-tick (`untickRow`, `retickRow`) come with
it. This PR does the writers and their `db:verify` proofs only. The Server Actions that call them are
step 12b, and the day page wires them in 12c.

**Roadmap alignment (2026-11-16):** advances `FAM-1` lane E. Gated by 11a (#438, merged) and 4b
(`0025`, applied). Step 5's assignments are not applied, so one check stays owed (§ Out of scope).
Checked against the private roadmap; nothing to add here.

## Acceptance

From the plan's §5 row 11b, verbatim:

> twin session; twin row; replay after Clear day; every type passes the shape CHECK; restore after
> re-✓; **a mismatched `workoutPublicId` / `prescriptionPublicId` pair is a typed refusal with no
> write, and so is another household's session that names this household's workout** (the
> runbook's pre-flight (f) assumes both)

Done when:

- `logRow`, `untickRow` and `retickRow` exist in `packages/db/src/writers/day/log-row.ts`. Each
  returns a `RowResult` (`packages/shared/src/program/day-shapes.ts:257`) and never throws for an
  expected case.
- Every 11b line in `packages/db/src/writers/day/owed.test.ts` (`:35-40`, `:49`) is a real proof in
  `packages/db/scripts/verify/day.ts`, and is deleted from the owed list.
- Each new rule has a committed mutation patch that turns `db:verify` red.
- The preview fake (`apps/web/app/design/program/fakes.ts:193-291`) and the writer give the same
  answer for the same input, apart from the differences listed under § Fake parity.

## Decisions taken into this plan

Relayed by the board as the maintainer's answers on 2026-11-16, and **to be confirmed first-hand**.
The panel may still challenge them.

| #   | Decision                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Code waits for 4b. This plan and its panel come first.                                                                                                                 |
| M2  | A mismatched workout / prescription pair, and a write naming another household's workout, both answer `not_found`. `ROW_REFUSALS` has no reason of its own for either. |
| M3  | The weekday comes from the row's day, through the shared day helpers (`localWeekday`, `packages/shared/src/day.ts:42`).                                                |
| M4  | The writers take `today` as an argument (SCALE-1, `AGENTS.md`). `isWritableDay` is used as it stands; its radius narrows at 12c (D32).                                 |
| M5  | `untickRow` and `retickRow` belong to 11b.                                                                                                                             |
| M6  | "Revive and amend" (D35) is **not** in 11b. Here `own_hidden` stays a refusal. The revive lands in 11c, in this same file.                                             |

## The contract, in order

### `logRow`

```ts
export async function logRow(
  db: NodePgDatabase<Schema>,
  args: {
    scope: HouseholdScope; // TEN-1: the third conjunct of isLiveProfile
    today: string; // the athlete's today, from the action (SCALE-1); never computed here
    activityTypeId: number; // 'workout_item', resolved app-side before the transaction (as strength)
    write: RowWrite; // already parsed by rowWriteSchema in the action (12b)
  },
): Promise<RowResult>;
```

It runs in one transaction. The checks below run in this order, and the first that fails answers.
The order follows the fake's, so a page and the preview refuse a write for the same reason.

1. **Profile.** `isLiveProfile(write.profilePublicId, scope)` → none: `not_found`.
2. **Window.** `!isWritableDay(write.day, today)` → `closed_day`.
3. **Replay, by `client_id`.** Look up the entry holding `write.clientId`, live or hidden. This is the
   classifier pattern of `writeCheckinEntries` (`writers/checkin.ts:104-143`), deliberately not
   `deleted_at`-guarded.
   - another profile's → `not_found`;
   - this profile's and hidden → `own_hidden` (D18);
   - this profile's and live → `ok`, with its stored values. Nothing is written.

   It runs before the program checks so that a replay answers as the first call did, even after the
   program has changed. The fake does the same (`fakes.ts:203-207`).

4. **Workout.** `workouts.public_id = write.workoutPublicId`, through its block, in `scope`'s
   household, on a **template** block. Not found, or another household's → `not_found` (M2). The
   workout or its block hidden → `program_changed`.
5. **Prescription.** `prescriptions.public_id = write.prescriptionPublicId AND workout_id = <the
workout's id>`. Not found → `not_found`, which covers a mismatched pair (M2). Hidden →
   `program_changed`.
6. **Scheduled.** A live `block_day_workouts` row for `(block, localWeekday(day), workout)` → else
   `not_scheduled`.
7. **Set.** `write.set > 1` on a type without set rows (`hasSetRows`) → `bad_value` (the corrected
   set rule on `rowWriteSchema`, #451).
8. **Slot.** If the live session for `(profile, day, workout)` already holds a live entry at
   `(prescription, set)` → `slot_taken`. The row arbiter repeats this check at insert time (step 10).
9. **Values (D13).** Fill and check, by `TRACKING_TYPE_FIELDS[movement.tracking_type]`
   (`pieces.ts:239`), as `storedValues` does in the fake (`fakes.ts:94-115`):
   - typed `reps` on a type with no reps, or a quantity in a slot other than the type's → `bad_value`;
   - reps: typed, else `wholeReps(prescription.target_reps)` (`pieces.ts:129`); neither → `bad_value`;
   - the type's quantity: typed, else the prescription's `prescription_quantities` row in that slot,
     if its `value_min` is set. Its unit must be the prescribed row's unit. None, or another unit →
     `bad_value`;
   - a value over the unit's ceiling (`MAX_QUANTITY_BY_UNIT`, `units.ts:310`) → `bad_value`.
10. **Writes,** each idempotent, in this order:
    - **Session.** Insert with a server-minted `client_id` (`newId()`), `session_type = 'workout'`
      (`SESSION_TYPE.workout`), `workout_id`, `workout_name` frozen from the workout, and `day_role`
      NULL. Use a bare `ON CONFLICT DO NOTHING`, then re-select the live row by `(profile, day,
workout)`, as `writers/bodyweight.ts:236-258` does. This is the append arbiter in A2 §6.
    - **Superset**, only when `prescription.superset_label` is set. Insert into `supersets` with
      `prescription_group = superset_label` and a server-minted `client_id`, using a bare
      `ON CONFLICT DO NOTHING`, then re-select live by `(session_id, prescription_group)`.
    - **Entry.** Insert with `client_id = write.clientId`, `prescription_id`, `prescription_set =
write.set`, `movement_id`, `movement_name` (the movement's label now), `activity_type_id`,
      `session_id`, `superset_id`, `superset_order = prescription.superset_order`, and the unit
      (§2: Check → `bool`, Reps → `count`, otherwise the prescribed unit). `kind` and `metric_key`
      stay NULL. `prescribed_snapshot = prescribedText(...)` (`program/prescribed-text.ts`; `''` is
      stored as `''`). Use a bare `ON CONFLICT DO NOTHING`. When nothing is inserted, classify what
      holds it:
      - the `client_id`'s holder → the replay answers of step 3 (a concurrent double-fire);
      - else the row arbiter's live holder → `slot_taken`;
      - else throw (not a shape the database can produce).
    - **Set row.** One `entry_sets` row (`idx` 1) and its quantity, through 11a's
      `insertEntrySetRows` (`writers/session-rows.ts`), widened as § File by file says.
11. → `{ ok: true, entryPublicId, values }`. `values` is what was stored, with the prescription's
    numbers filled in.

### `untickRow`

```ts
export async function untickRow(
  db: NodePgDatabase<Schema>,
  args: { scope: HouseholdScope; today: string; input: RowUntick },
): Promise<RowResult>;
```

1. Profile → `not_found`. 2. Window → `closed_day`.
2. Find the entry by `public_id`, for this profile on `input.day`, with `prescription_set IS NOT NULL`
   (a program row). None → `not_found`.
3. Already hidden → `ok` with its existing `hiddenAt` (the fake's replay, `fakes.ts:244-245`).
4. Its session's workout is no longer on that weekday (step 6 above) → `not_scheduled`.
5. `hideEntries(tx, { profilePublicId, scope, day, entryPublicIds: [id] })` (`writers/hide.ts:71`) →
   `{ ok: true, entryPublicId, values, hiddenAt }`.

### `retickRow`

```ts
export async function retickRow(
  db: NodePgDatabase<Schema>,
  args: { scope: HouseholdScope; today: string; input: RowRetick },
): Promise<RowResult>;
```

1. Profile → `not_found`. 2. Window → `closed_day`.
2. `restoreHidden(tx, { profilePublicId, scope, day, hiddenAt, entryPublicIds: [id] })`
   (`writers/hide.ts:212`). Map its answers: `ok` → `ok` with values (this includes an entry that
   was already live, the fake's `fakes.ts:272-274`); `slot_taken` → `slot_taken`; `changed` and
   `not_found` → `not_found`.

## File by file

| Path                                                 | Change | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/day/log-row.ts`             | NEW    | `logRow`, `untickRow`, `retickRow`, as above. Also two private helpers: `isScheduledOn(exec, blockId, workoutId, day)`, which both writers call, and `readRowValues(exec, entryId)`, which reads the stored `RowValues` for a replay or an un-tick.                                                                                                                                                                                                     |
| `packages/db/src/writers/day/index.ts`               | EDIT   | Re-export the three writers. The placeholder line goes.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/db/src/index.ts`                           | EDIT   | Export them for 12b's DAL.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/db/src/writers/session-rows.ts`            | EDIT   | Widen `insertEntrySetRows` to take each set's quantities rather than `weight`: `{ reps?, isBodyweight?, isBand?, status?, quantities: { slot, unit, value }[] }`. The dimension is derived per quantity. `reps` omitted → the column is omitted. This is the docblock's own instruction; no placeholder `reps` is ever written.                                                                                                                         |
| `packages/db/src/writers/strength-session.ts`        | EDIT   | Map each strength set's `weight` into `quantities: [{ slot: primary, unit, value }]` before calling. The emitted SQL is unchanged, and the strength proofs are the evidence.                                                                                                                                                                                                                                                                            |
| `packages/db/src/writers/hide.ts`                    | EDIT   | `restoreOne` step 4 learns the program row. For an item with `prescription_set IS NOT NULL`, a live holder at `(session_id, prescription_id, prescription_set)` → `slot_taken`. No swap (`keepInsteadOf` is bodyweight only). The race matcher (`isBodyweightSlotConflict`, `:280`) becomes a list of index names that includes `ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX`. Lane S's 3b-0 writes the same list; whichever PR merges second merges `main` in. |
| `packages/shared/src/day.ts`                         | EDIT   | Move `WRITABLE_DAY_RADIUS` and `isWritableDay` here from `apps/web/lib/entries/declared-day.ts:38-43`, which re-exports them, because `packages/db` cannot import the app. One definition, so the page and the writer cannot disagree about the window.                                                                                                                                                                                                 |
| `packages/db/scripts/verify/day.ts`                  | EDIT   | The proofs (§ Test plan).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/db/src/writers/day/owed.test.ts`           | EDIT   | Delete the 11b lines this PR proves.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/mutations/82-…`                 | NEW    | One patch and its `.expect` per rule (§ Test plan).                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/features/day-writers.md`                       | EDIT   | The file map, a sequence diagram of `logRow`, and invariants (the check order; a replay before the program checks; the classifier is unguarded).                                                                                                                                                                                                                                                                                                        |
| `docs/features/write-path.md`                        | EDIT   | `session-rows.ts`'s new input; `hide.ts`'s second slot.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `docs/features/strength-logging.md`                  | EDIT   | `session-rows.ts`'s new input (it co-owns the file, 11a).                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/features/delete-and-restore.md`                | EDIT   | A restore of a program row answers `slot_taken` when its slot is held.                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/changelog/<date>-feat-fam-1-11b-row-writer.md` | NEW    | The fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Test plan

All proofs go in `verify/day.ts` and run on PGlite through `db:verify`. They seed one fixture
household with a template block, two workouts on the week, one prescription of each tracking type
and one superset pair, plus a second household. The cases:

1. **Twin session:** two first ticks on one workout and day leave one session.
2. **Twin row:** a second `clientId` on a logged slot → `slot_taken`, one entry. A replay of the first
   `clientId` → `ok` with the same `entryPublicId` and values.
3. **Replay after Clear day:** hide the day's entries, then replay → `own_hidden`, nothing written.
4. **Every type passes the shape CHECK:** one ✓ per tracking type, both empty (the prescription's
   numbers) and typed, each read back. This includes a Check (`{ quantities: [] }`, unit `bool`), a
   Count in a non-mass unit, and a Distance in the distance slot.
5. **Empty ✓ (D13):** `target_reps = '8-12'` with no typed reps → `bad_value`; `value_min` NULL with
   no typed value → `bad_value`; a typed value in another unit → `bad_value`.
6. **The refusals:** `closed_day` (2 days back, and 2 days ahead); `not_scheduled` (a workout not on
   that weekday); `program_changed` (a hidden prescription, a hidden workout); `not_found` (a
   foreign profile, a foreign workout, a mismatched pair). Each asserts that no row was written.
7. **Set rule:** set 5 on a Weight × Reps with 3 sets → `ok` (an added set); set 2 on a Check →
   `bad_value`.
8. **Superset:** two members ticked → one `supersets` row with `prescription_group` set, and both
   entries attached to it.
9. **A foreign session naming our workout** (the runbook's pre-flight (f)): plant another
   household's session with `workout_id` = ours on the same day. A tick writes into our own session
   and never touches theirs.
10. **Snapshot:** `prescribed_snapshot = prescribedText(...)`, `''` for a Check.
11. **Un-tick / re-tick:** un-tick → `hiddenAt`; un-tick again → the same token; re-tick → `ok`. A
    re-tick after a new ✓ took the slot → `slot_taken` (the owed "restore after re-✓").
12. **Strength unchanged:** the existing strength proofs pass without edits after `insertEntrySetRows`
    widens.

Mutation patches (each must turn `db:verify` red on its named case): the replay check moved after
the program checks (3); the classifier `deleted_at`-guarded (3); the session re-select without
`workout_id` (1); the mismatched-pair conjunct dropped (6); the weekday check dropped (6); a
hard-coded `dimension: 'mass'` in `insertEntrySetRows` (4, a Duration); the hide-path holder lookup
removed (11).

Run: `pnpm verify` and `pnpm db:mutations`. There is no UI, so no screenshots or `e2e:local`.

## Fake parity

Two places where the writer and the fake differ, deliberately, and stay listed in `day-writers.md`:

- The fake reads `plan.writable` from a fixture; the writer uses `isWritableDay(day, today)`, which
  still accepts tomorrow until 12c narrows `WRITABLE_DAY_RADIUS` (D32). This is the one difference in
  answers until then.
- The fake has no household, so `not_found` for a foreign workout or a mismatched pair is the
  writer's alone. The fake answers `program_changed` for an unknown workout.

## Risks and rollback

- **A replay that attaches to the wrong row.** The bare `ON CONFLICT` swallows every unique conflict,
  so an insert that did nothing is always classified by its holder, never assumed to be a replay.
  This is the lesson from `bodyweight.ts` branch (c).
- **The widened `insertEntrySetRows` changes a strength row.** The strength proofs run unchanged, and
  the `dimension: 'mass'` patch proves the derivation is covered.
- **Lock order.** `restoreHidden` already sorts and locks one row at a time. `logRow` locks nothing
  beyond the inserts. The arbiters, not locks, decide a race.
- **Ownership.** Every lookup goes through `isLiveProfile` or the workout's `program_blocks.household_id
= scope`. Proof 6 covers each foreign case.
- **Rollback:** writers only, no migration. Revert the PR.

## Out of scope

- **The athlete is on that block on that day.** This needs step 5's `program_assignments`, which is
  not applied. When it is, the check goes after step 6 and answers `program_changed`: the workout is
  not on the athlete's day at all, which is how the fake answers a workout missing from the plan. It
  is listed as owed in `day-writers.md` and the owed tests.
- **The revive (D35/C9):** step 11c.
- **The Server Actions, the rate limit and Sentry wrapping:** step 12b.
- **Change (`amendRow`):** step 11c.

## Open questions

1. **A range prescription.** `prescription_quantities.value_max` can be set (D2), so what does an
   empty ✓ log? This plan proposes `bad_value` (ask for the number), because a range has no single
   number to copy. The resolver's `target` (12a) must say the same.
2. **Moving `isWritableDay` to shared** touches `apps/web/lib/entries/declared-day.ts`. That is
   lane S's file and lane C's reader, so it is a small seam. The alternative is to pass `writable:
boolean` into the writer, which lets the action decide the window, a weaker guard.

## Review-response log (adversarial panel)

_(The panel has not run yet.)_
