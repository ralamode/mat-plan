# FAM-1 11b — the row writer

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step
> 11b. Branch: `feat/fam-1-11b-row-writer`. Lane E ([day-writers.md](../features/day-writers.md)).
> **Rev 3**, after a five-lens panel and a re-review (§ Review-response log).

## Goal

A tick on any row of a program workout is stored once and answered with a typed result. One writer,
`logRow`, handles all seven tracking types. Un-tick and re-tick (`untickRow`, `retickRow`) come with
it. This PR does the writers and their `db:verify` proofs only. The Server Actions that call them are
step 12b, and the day page wires them in 12c.

**Roadmap alignment (2026-11-16):** advances `FAM-1` lane E. Gated by 11a (#438, merged), 4b
(`0025`, applied), step 5 (M7) and contract step C10. Lane S's 3b-0 (#461) goes first on
`write-path.md` and `hide.ts`. Checked against the private roadmap; nothing to add here.

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
- **Every rule in § The contract names the mutation patch that turns its proof red**, and
  `db:mutations` shows each one RED. A rule with no patch is listed as unproven, with the reason.
- The preview fake and the writer answer the same input the same way, apart from § Fake parity.
- After every writer proof, lane A's detectors for runbook pre-flight (f) and (g) and for a
  mismatched pair read zero rows.

## Decisions

### The maintainer's (relayed 2026-11-16; **confirmed first-hand in lane E's chat, 2026-11-16**)

| #   | Decision                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Code waits for 4b (now applied). This plan and its panel come first.                                                                                                   |
| M2  | A mismatched workout / prescription pair, and a write naming another household's workout, both answer `not_found`. `ROW_REFUSALS` has no reason of its own for either. |
| M3  | The weekday comes from the row's day, through `localWeekday` (`packages/shared/src/day.ts:42`).                                                                        |
| M4  | The writers take `today` as an argument (SCALE-1, `docs/plan.md:341`).                                                                                                 |
| M5  | `untickRow` and `retickRow` belong to 11b.                                                                                                                             |
| M6  | The revive is not in 11b. D18 as written stands: a replay of a hidden row answers `own_hidden` and writes nothing.                                                     |
| M7  | **11b keeps §5's gate: it includes the assignment check and merges only after step 5 is applied** (asked in lane E's chat, 2026-11-16). Until then it is a draft.      |

### Lane E's own calls (the panel may still challenge them)

- **An archived athlete:** the three writers answer `closed_day`, as `dayPageFlags` makes their day
  read-only (`apps/web/lib/entries/declared-day.ts`).
- **`retry` is never answered by the writer.** It is the client's answer to a transport failure; an
  unexpected database error throws.
- **A replay after a purge answers `not_found`.** A purge clears `entries.prescription_id`
  (`ON DELETE SET NULL`), so the pin (step 3) no longer matches. That differs from "a replay answers as
  the first call did", and is accepted: a purge is an author's deliberate act, and the row it leaves
  is read-only (D7).
- **`retickRow` does not check the schedule**, unlike `untickRow`, matching the fake
  (`fakes.ts:263-291`): a re-tick only puts back what was there a moment before, in the same visit.

## What 11b imports from contract step C10

The contract owner builds these as C10 (`feat/fam-1-c10-row-value-rules`, decided 2026-11-16).
**A lane never edits contract-owned files**, so 11b imports them and edits none of
`packages/shared/src/program/`, `packages/shared/src/day.ts` or the fake.

| Export (`@mat-plan/shared`)                                                                                         | Used for                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fillRowValues(item, typed, target): RowValues \| null`                                                             | Step 10. `null` → `bad_value`. It refuses reps on a type without reps, a foreign or repeated slot, a missing number the target cannot supply, another unit, and a value over `quantityCeiling` (or a unit with no ceiling). |
| `prescribedTarget(targetReps: string \| null, quantities): PrescribedTarget`                                        | Step 10's target. Applies `wholeReps`; any `valueMax`, even one equal to the value, → `value: null` (the range rule). The writer converts numeric strings to numbers first.                                                 |
| `entryUnitFor(trackingType, prescribedUnit): Unit` (Duration → `min` and Time per set → `sec` whatever it is given) | `entries.unit`. It throws when a type that needs a unit is given none; step 10's re-check stops that from reaching it.                                                                                                      |
| `inWritableWindow(day, today)`, `WRITABLE_DAY_RADIUS`                                                               | Step 2. Today and yesterday, **never a day after today** (D32). The app's `isWritableDay` keeps accepting tomorrow until 12c.                                                                                               |
| The fake judges values before the set                                                                               | Parity with the writer, which has no slot pre-check.                                                                                                                                                                        |

**Fallback, from the contract owner:** if C10 is not on `main` when 11b is otherwise ready, 11b puts
the three pure functions in its own directory with their tests, merges, and tells the board. The
contract owner then moves them into shared, and 11c swaps the imports. The window comparison stays
local in the writer, with a comment naming C10.

## Requests to other owners

| To                 | Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | If declined                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Lane A             | Export from `verify/schema.ts`: the detectors `sessionsOnForeignWorkouts`, `entriesOnForeignPrescriptions`, `entriesOnAnotherWorkoutsPrescriptions`, `workoutSessionsOfAnotherType`, `workoutSessionsWithADayRole`, and the builder `mkTemplateBlock` (`verify/schema.ts:407`). `verify/schema.ts` has no shared `mkWorkout` or prescription builder: each proof block defines its own (`mkWorkout` returns `{ blockId, workoutId }` at `:1209` and a bare id at `:1657`; the prescription inserts are inline), so the request is for one exported `mkWorkout(exec, scope, blockId, name) → { id, publicId, blockId }` and one template-prescription builder. Copied into `verify/day.ts` with `TODO(lane A request)` until then. | Lane A hoists them into `verify/harness.ts`. |
| Harness owner (0c) | Export `asDb(tx)` beside `asTx` in `verify/harness.ts`: the `NodePgDatabase` cast a writer that opens its own transaction needs inside `rolledBack` (`verify/day.ts` holds a local copy).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | It stays local.                              |
| Contract owner     | Plan text: row 12b gains "a `cross_household` signal for a probed workout or prescription id" (`reportScopeMiss` covers profiles only, `apps/web/lib/dal/household.ts:521`). L16 names this plan's (f) proof and patch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | This plan's § Out of scope carries it.       |
| Contract owner     | NITs from the reuse lens, for C10's review: `apps/web/components/day/row-values.ts` `readTyped` restates the fill (`:80-125`) and `targetQuantity` (`:47-52`); `prescribedTarget` shares a name with the `prescription_targets` table (per-athlete loads).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Theirs to decide.                            |

## The contract, in order

Every writer runs in one transaction. **A refusal reached after the first insert leaves by a
sentinel throw** (`RowRefused`, like `restoreHidden`'s `ItemRefused`, `writers/hide.ts:231-249`), so
nothing a refused write began is committed. Mutation numbers come from lane E's block, 110 and up (the board, 2026-11-16); `P#` below are this
plan's labels.

**One named conjunct for "a program row of this athlete on this day"**, `programRowOf(profileId,
day)` (`entries.profile_id`, `activity_date`, `prescription_set IS NOT NULL`), used by step 3,
`untickRow` and `retickRow`.

### `logRow`

```ts
export async function logRow(
  db: NodePgDatabase<Schema>,
  args: {
    scope: HouseholdScope;
    today: string; // the athlete's today, from the action; never computed here
    activityTypeId: number; // ACTIVITY_TYPE_KEYS.workout_item, resolved app-side before the tx
    write: RowWrite; // parsed by rowWriteSchema in the action (12b)
  },
): Promise<RowResult>;
```

1. **Profile.** `isLiveProfile(profilePublicId, scope)` → none: `not_found`. Archived →
   `closed_day`. **P16:** drop the archived check → proof 6 (archived) goes red.
2. **Window.** `!inWritableWindow(day, today)` → `closed_day`. **P17:** drop it → proof 6 goes red.
3. **Replay, pinned.** `classifyRowHolder(exec, profileId, write)`, used here and after the entry
   insert. It finds the entry holding `write.clientId`, live or hidden (unguarded, the classifier
   pattern of `writers/checkin.ts:104-143`). It is a replay **only if** the holder is
   `programRowOf(profileId, write.day)`, its `prescription_set = write.set`, its prescription's
   `public_id = write.prescriptionPublicId`, and its session's workout's `public_id =
write.workoutPublicId`. A live holder like that → `ok` with its stored values; a hidden one →
   `own_hidden` (D18); any other holder → `not_found`. One proof and one patch per condition (3c–3h).
   It runs before the program checks, so a replay answers as the first call did after the program
   changes. **P2:** move it after step 5 → proof 3a answers `program_changed`. **P18:** add
   `deleted_at IS NULL` to the classifier → proof 3b answers `slot_taken`.
4. **Workout.** `rowWorkout(tx, profileId, scope, workoutPublicId)`, exported from `log-row.ts`, so
   the two conjuncts below can be proven apart:
   - `templateBlockIn(scope)` (new in `writers/ownership.ts`: household and template, not live;
     `liveTemplateBlockIn` is recomposed from it), and
   - `programBlockOfProfile(profileId)` (new in `ownership.ts`: `program_blocks.household_id =
profiles.household_id`, column to column, so pre-flight (f) holds whatever a scope later widens
     to, ID-1 items 2 and 3; its second consumer is 11c's amend).

   Liveness is read off the returned row. Not found (foreign, hidden and foreign, missing) →
   `not_found`; the workout or its block hidden → `program_changed`.
   - **P3:** drop `programBlockOfProfile` → proof 4d (B's profile, `A_SCOPE`, H's workout returns a
     row) goes red.
   - **Existing patch 47, retargeted** to drop the scope conjunct from `templateBlockIn` → proof 4e
     (B's profile, `A_SCOPE`, B's workout) goes red, as well as its existing case. Patches 46–48 are
     retargeted to the recomposed function. _As built: 4e's red under 47 is shadowed, because 4a-i's
     assertion in `verify/schema.ts` fails first; 47's `.expect` stays 4a-i's._
   - **P19:** drop the `deleted_at` read → proof 6b goes red.

5. **Prescription.** `public_id` and `workout_id = <the workout's id>`, read with its live
   `prescription_quantities` in one statement, which **throws on two live rows in one slot**. Not
   found (this covers a mismatched pair) → `not_found`; hidden → `program_changed`. **P5:** drop
   `workout_id` → proof 6c (mismatched pair) goes red. **P6:** drop the quantities' `deleted_at`
   filter → proof 5a throws.
6. **Movement.** `movementIsAvailableTo(scope)`, re-checked in the transaction as
   `writeStrengthSession` does (`writers/strength-session.ts:252-280`) → else `not_found`. **P7.**
7. **Scheduled.** `scheduledOn(blockId, workoutId, day)`, a conjunct exported from
   `queries/day/scheduled.ts` (12a's `scheduled` flag uses it too) → else `not_scheduled`. **P8.**
8. **On the program that day** (M7, step 5). The assignment conjunct, added to `scheduled.ts` →
   else `program_changed`, which is how the fake answers a workout missing from the athlete's day.
   **P20:** drop it → proof 6d goes red.
9. **Set.** `set > 1` on a type without set rows (`hasSetRows`) → `bad_value`. **P9.**
10. **Values.** First, the prescription's type and unit are re-checked against `TRACKING_TYPE_FIELDS`
    (`dimensions`, the fixed `min`/`sec`); a malformed prescription → `bad_value`, not an FK 500
    (**P21**, proof 5b). Then `fillRowValues(item, write.values, prescribedTarget(...))` → `null`
    → `bad_value`.
11. **Writes.**
    - **Session:** server-minted `client_id`, `session_type = SESSION_TYPE.workout`, `workout_id`,
      `workout_name` frozen, `day_role` NULL. A bare `ON CONFLICT DO NOTHING`, then re-select live by
      `workoutSessionSlot(profileId, day, workoutId)`, **asserting exactly one row** (else throw), so a
      broken key fails whatever the row order. **P10:** drop `workout_id` → proof 1 throws. **P11:**
      drop `profile_id` → proof (f′) throws.
    - **Superset**, when `superset_label` is set: `prescription_group = superset_label`,
      server-minted `client_id`, a bare `ON CONFLICT`, then re-select live by
      `workoutSupersetSlot(sessionId, group)`, exactly one row. **P22:** write no
      `prescription_group` → proof 8 goes red.
    - **Entry:** `client_id`, `prescription_id`, `prescription_set`, `movement_id`, `movement_name`,
      `activity_type_id`, `session_id`, `superset_id`, `superset_order`, `unit = entryUnitFor(...)`,
      `prescribed_snapshot = prescribedText(...)` (`''` stays `''`). A bare `ON CONFLICT DO NOTHING`.
      On no insert: `classifyRowHolder`; else a live holder at `programRowSlot(sessionId,
prescriptionId, set)` → `slot_taken`; else throw. With no slot pre-check, a sequential twin tick
      goes through this branch. **P12:** drop the arbiter classification → proof 2 throws. **P23:**
      snapshot `''` for every type → proof 9 goes red.
    - **Set row:** `insertEntrySetRows` (`writers/session-rows.ts`), widened to take each set's
      quantities. Its input is derived (`Pick<RowValues,'reps'|'quantities'> &
Partial<Pick<StrengthSetInput,'isBodyweight'|'isBand'|'status'>>`), the dimension is derived
      per quantity, and `reps` omitted → the column is omitted. **P13:** `dimension: 'mass'`
      hard-coded → proof 4's Duration case goes red. _As built: wrong. The helper is shared with the
      strength writer, and `verify.ts`'s GAP-3 hold proof (a `sec` set) fails first with a raw FK
      error, which no `.expect` can name, so P13 has no patch; both proofs cover the line._
12. → `{ ok: true, entryPublicId, values }`, `values` read back from the stored row (`readRowValues`), so the first answer and a replay's agree after `numeric(8,3)` rounds (proof 2a, mutation 181).

### `untickRow`

```ts
export async function untickRow(
  db: NodePgDatabase<Schema>,
  args: { scope: HouseholdScope; today: string; input: RowUntick },
): Promise<RowResult>;
```

1. Profile → `not_found`; archived → `closed_day`.
2. Window → `closed_day`.
3. The entry by `public_id` within `programRowOf(profileId, input.day)` → else `not_found`. **P24:**
   drop the program-row condition → proof 10b goes red.
4. Live, and its session's workout is no longer `scheduledOn` that day (or was purged) →
   `not_scheduled`. **P25:** drop it → proof 10c goes red.
5. `hideEntries(tx, { …, entryPublicIds: [id] })` (`writers/hide.ts:71`). It returns the existing
   token for an entry already hidden, so the token is always read the one way `hide.ts` reads it.
   `{ notFound }` → `not_found`. → `{ ok: true, entryPublicId, values, hiddenAt }`.

### `retickRow`

```ts
export async function retickRow(
  db: NodePgDatabase<Schema>,
  args: { scope: HouseholdScope; today: string; input: RowRetick },
): Promise<RowResult>;
```

1. Profile → `not_found`; archived → `closed_day`.
2. Window → `closed_day`.
3. The entry within `programRowOf(profileId, input.day)` → else `not_found`, so a hidden weigh-in is
   never restored through the row action. **P14:** drop it → proof 10a goes red.
4. `restoreHidden(tx, { …, entryPublicIds: [id] })`, mapped through a `Record<RestoreReason, …>`, so
   a new restore reason is a compile error: `ok` → `ok` with values; `slot_taken` → `slot_taken`;
   `changed` and `not_found` → `not_found`.

### `hide.ts`

After #461 merges: append `ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX` to its `RESTORE_SLOT_INDEXES`. There
is no pre-check: a program row has no swap and no `heldBy`, and the restore's UPDATE hits the partial
row arbiter inside the item's savepoint, which works on one PGlite connection. **P15:** remove the
index from the list → proof 10 throws.

## File by file

| Path                                                                | Change   | What and why                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/day/log-row.ts`                            | NEW      | The three writers; `classifyRowHolder`, `rowWorkout`, `RowRefused`; the conjuncts `programRowOf`, `workoutSessionSlot`, `workoutSupersetSlot`, `programRowSlot`.                                                                                                                            |
| `packages/db/src/queries/day/scheduled.ts`                          | NEW      | `scheduledOn` and the step-5 assignment conjunct: one rule for the writer, 12a and 11c.                                                                                                                                                                                                     |
| `packages/db/src/queries/day/stored-row-values.ts`                  | NEW      | `readRowValues(exec, entryIds)`: live `entry_sets`, then their live quantities by set id. The parent filter is load-bearing, as at `apps/web/lib/dal/entries.ts:226-229`; **P26** drops it → proof 10 (re-tick values) goes red. Folding that DAL read onto this one is filed as tech debt. |
| `packages/db/src/writers/unique-violation.ts`                       | NEW      | `isUniqueViolationOn(error, indexNames)`, the one 23505 matcher (a board reuse item, 2026-11-16). `hide.ts`'s restore calls it; the row writer matches none (bare `ON CONFLICT`).                                                                                                           |
| `packages/db/src/writers/ownership.ts`                              | EDIT     | `templateBlockIn(scope)`, with `liveTemplateBlockIn` recomposed from it; `programBlockOfProfile(profileId)`.                                                                                                                                                                                |
| `packages/db/src/writers/session-rows.ts`                           | EDIT     | `insertEntrySetRows` takes quantities per set (derived input type).                                                                                                                                                                                                                         |
| `packages/db/src/writers/strength-session.ts`                       | EDIT     | Maps `weight` → `quantities: [{ slot: primary, unit, value }]` (in `strength-logging.md`'s queue, C10). The SQL is unchanged.                                                                                                                                                               |
| `packages/db/src/writers/hide.ts`                                   | EDIT     | One entry in `RESTORE_SLOT_INDEXES`.                                                                                                                                                                                                                                                        |
| `packages/db/src/writers/day/index.ts`, `src/index.ts`              | EDIT     | Export the writers for 12b.                                                                                                                                                                                                                                                                 |
| `packages/db/scripts/verify/day.ts`                                 | EDIT     | The proofs.                                                                                                                                                                                                                                                                                 |
| `packages/db/src/writers/day/owed.test.ts`                          | EDIT     | The 11b lines go.                                                                                                                                                                                                                                                                           |
| `packages/db/scripts/mutations/NN-…`, `46`–`48`, `README.md`        | NEW/EDIT | P2–P26 and the retargeted 46–48, one README row each.                                                                                                                                                                                                                                       |
| `docs/features/day-writers.md`                                      | EDIT     | File map; invariants (check order; the pinned replay; `programRowOf`; refusals after an insert throw; `not_found` and a guessed `clientId`); Fake parity.                                                                                                                                   |
| `docs/features/{write-path,strength-logging,delete-and-restore}.md` | EDIT     | `session-rows.ts`'s input; `ownership.ts`'s helpers; the restore list's program row.                                                                                                                                                                                                        |
| `docs/architecture.md`                                              | EDIT     | A `logRow` sequence diagram (the PR embeds the same one); §2f: the snapshot now has two freezing paths.                                                                                                                                                                                     |
| `docs/runbooks.md`                                                  | EDIT     | Pre-flight (f): "Step 11b's writer must refuse it (owed…)" becomes "Step 11b's writer refuses it: `programBlockOfProfile` in the workout lookup, proved by `verify/day.ts` 4d and mutation NN."                                                                                             |
| `docs/tech-debt.md`                                                 | EDIT     | The DAL's live-sets read and `readRowValues` are two reads of one shape.                                                                                                                                                                                                                    |
| `docs/changelog/<date>-feat-fam-1-11b-row-writer.md`                | NEW      | The fragment.                                                                                                                                                                                                                                                                               |

## Test plan

In `verify/day.ts`, on PGlite. The fixture is household H (`A_SCOPE`): a template block whose two
workouts are both scheduled on the proof day's weekday, one prescription of each tracking type, a
superset pair, a range prescription, a malformed prescription (a Duration in `lb`), a hidden quantity
row under a live one in the same slot, an archived athlete, and an athlete not on the block. Household
B (`B_SCOPE`) has its own fully valid template block, scheduled the same weekday. After every proof,
the (f), (g) and mismatched-pair detectors read `[]`; (f′) deletes its planted row before the sweep.

| #     | Proof                                                                                                                                                                                                           | Patch                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1     | Two workouts ticked on one day → two sessions, each with its own entry; a second tick reuses its session                                                                                                        | P10                                                                                              |
| 2     | Twin row: a second `clientId` on a logged set → `slot_taken`, one entry; a replay of the first → the same answer                                                                                                | P12                                                                                              |
| 3     | Replay after Clear day → `own_hidden`, nothing written                                                                                                                                                          | (D18)                                                                                            |
| 3a    | ✓, hide the prescription, replay → `ok`                                                                                                                                                                         | P2                                                                                               |
| 3b    | ✓ c1, un-tick, ✓ c2 on the same set, replay c1 → `own_hidden`                                                                                                                                                   | P18                                                                                              |
| 3c–3h | A reused `clientId` held by: another profile's program row; this profile's strength entry; this profile's row on another day; another set; another prescription; another workout → `not_found`, nothing written | one patch each                                                                                   |
| 4     | Each tracking type, empty ✓ and typed, read back; passes the shape CHECK; a kind-NULL check-in still passes                                                                                                     | P13                                                                                              |
| 4d    | `rowWorkout(B's profile, A_SCOPE, H's workout)` → nothing                                                                                                                                                       | P3                                                                                               |
| 4e    | `rowWorkout(B's profile, A_SCOPE, B's workout)` → nothing (47's red here is shadowed by 4a-i's)                                                                                                                 | 47                                                                                               |
| 5     | `bad_value` cases of `fillRowValues` as the writer reaches them: `'8-12'` reps; `value_min` NULL; a range; another unit; over the ceiling                                                                       | (C10's tests)                                                                                    |
| 5a    | A hidden quantity row under a live one is never copied                                                                                                                                                          | P6                                                                                               |
| 5b    | A malformed prescription (a Duration in `lb`) → `bad_value`                                                                                                                                                     | P21                                                                                              |
| 6     | `closed_day`: 2 days back; tomorrow (D32); an archived athlete                                                                                                                                                  | P16, P17                                                                                         |
| 6a    | `not_scheduled`: a workout not on that weekday                                                                                                                                                                  | P8                                                                                               |
| 6b    | `program_changed`: a hidden prescription; a hidden workout; a hidden block                                                                                                                                      | P19                                                                                              |
| 6c    | `not_found`: B's profile; B's workout (fully valid); B's hidden workout; a mismatched pair; a foreign movement on a prescription                                                                                | P5, P7                                                                                           |
| 6d    | `program_changed`: an athlete of H not on the block that day                                                                                                                                                    | P20                                                                                              |
| (f)   | B's live profile under `B_SCOPE` + H's workout and prescription → `not_found`; no session, superset or entry rows                                                                                               | (end to end; 4d is the patch's proof)                                                            |
| (f′)  | A planted B session naming H's workout; H's tick writes into H's own session                                                                                                                                    | P11                                                                                              |
| 7     | Set 5 on a 3-set Weight × Reps → `ok`; set 2 on a Check → `bad_value`                                                                                                                                           | P9                                                                                               |
| 8     | Two superset members → one `supersets` row with `prescription_group`, both entries attached                                                                                                                     | P22                                                                                              |
| 9     | `prescribed_snapshot = prescribedText(...)`; `''` for a Check                                                                                                                                                   | P23                                                                                              |
| 10    | Un-tick → token; again → the same token; re-tick → `ok` with its values; re-tick after a new ✓ took the set → `slot_taken`                                                                                      | P15, P26                                                                                         |
| 10a   | Re-tick of a hidden weigh-in → `not_found`                                                                                                                                                                      | P14                                                                                              |
| 10b   | Un-tick of a live weigh-in → `not_found`, still live                                                                                                                                                            | P24                                                                                              |
| 10c   | Un-tick after the workout leaves the weekday → `not_scheduled`                                                                                                                                                  | P25                                                                                              |
| 2a    | A distance of 40.12345: the first answer and a replay's are the same stored row (40.123)                                                                                                                        | 181                                                                                              |
| 3i    | A hidden row of another household holding the `clientId` → `not_found`, never `own_hidden`                                                                                                                      | 179                                                                                              |
| 8a    | A live linked row planted on a superset member's set: the ✓ inserts a fresh superset, meets the row arbiter, answers `slot_taken`, and leaves no superset (`RowRefused`)                                        | 178                                                                                              |
| 10d   | Un-tick and re-tick of another household's program row from H → `not_found`; its `deleted_at` unchanged                                                                                                         | (guarded twice: `programRowOf`'s profile, then `hideEntries` / `restoreHidden`'s scoped profile) |
| 10e   | Re-tick with a stale token (the row re-hidden since) → `not_found`, still hidden                                                                                                                                | 180                                                                                              |
| 11    | The existing strength proofs pass unchanged                                                                                                                                                                     | (regression guard)                                                                               |

**Unproven on PGlite, recorded with the reason:**

- A concurrent double-fire reaching step 11's `classifyRowHolder` needs a second connection. The
  classifier is step 3's helper (3a–3h cover it). _As built: `RowRefused`'s rollback IS provable on
  one connection, and 8a proves it (mutation 178), so it is no longer in this list._

**Size, recorded:** about 450 lines of production code and about 1,200–1,400 diff lines in all. Most
of it is acceptance proofs that cannot move, so no split brings it under 400.

Run: `pnpm verify` (which includes `db:mutations`). No UI, so no screenshots or `e2e:local`.

## Fake parity

- The fake has no household or archive, so `not_found` for a foreign id and `closed_day` for an
  archived athlete are the writer's alone. The fake answers `program_changed` for an unknown workout.
- A replay after the window has closed answers `closed_day` in both. A replay after a purge answers
  `not_found` in the writer only (the fake has no purge).

## Risks and rollback

- **A replay answered with another row:** prevented by the pinned classifier (3c–3h).
- **A refused write that leaves a session behind:** `RowRefused` (proof 8a).
- **A widened `insertEntrySetRows` changing a strength row:** the strength proofs run unchanged.
- **Ownership:** every id resolves inside the scope, and (f) does not depend on a scope being one
  household (4d). The `not_found` answer is uniform for public ids. A guessed `clientId` held by
  another household also answers `not_found`; that needs 74 random bits of a UUIDv7, and
  `day-writers.md` says so rather than claiming uniformity.
- **Rollback:** writers only, no migration. Revert the PR.

## Out of scope

- Change (`amendRow`) and the revive: 11c and later.
- The Server Actions, the rate limit, Sentry, and a `cross_household` signal for a probed workout or
  prescription id: 12b (§ Requests).

## Review-response log (adversarial panel)

> Panel cost (all on Opus 5.5: the Fable spend limit, the maintainer's decision of 2026-11-16):
> correctness 174k · 9m21s, scope 94k · 3m36s, architecture 116k · 6m43s, reuse 155k · 6m11s,
> security 105k · 5m57s.

| #   | Lens                                    | Critique (short)                                                                                               | Verdict      | Resolution                                                                                                                           |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | correctness, reuse                      | The replay classifier isn't pinned; a reused `client_id` answers `ok` with another row                         | **accepted** | Step 3: pinned to profile, program row, day, set and prescription; one helper for steps 3 and 11; P1                                 |
| C2  | correctness, scope, reuse, architecture | `hide.ts`: pre-check and matcher both answer `slot_taken`, so the patch can't go red                           | **accepted** | Catch-only, one entry in #461's `RESTORE_SLOT_INDEXES`; P15 removes it                                                               |
| C3  | correctness, scope                      | Four patches can't fail on their named case                                                                    | **accepted** | Proofs 1 (two workouts, one weekday), 3a, 3b and (f′) added; every rule names its patch (P1–P15)                                     |
| C4  | correctness, scope, architecture        | Step 5's assignment check dropped, against row 11b's gate                                                      | **accepted** | M7: the maintainer kept the gate; step 8, P20, proof 6d                                                                              |
| C5  | correctness                             | `prescription_quantities` not filtered to live rows                                                            | **accepted** | Step 5 reads live quantities in the same statement; P6                                                                               |
| C6  | correctness                             | A repeated slot is dropped or throws                                                                           | **accepted** | `bad_value`, in the shared fill rule (fake too)                                                                                      |
| C7  | correctness                             | Refusals after the first insert commit; the insert branch is never exercised                                   | **accepted** | `RowRefused` sentinel; the slot pre-check removed so proof 2 exercises the insert branch; the concurrent branch recorded as unproven |
| C8  | correctness, architecture, security     | `retickRow` restores any hidden entry                                                                          | **accepted** | Program-row pre-check; P14                                                                                                           |
| S1  | scope                                   | The slot pre-check duplicates the arbiter                                                                      | **accepted** | Removed; the fake's order moves to match (§ Requests)                                                                                |
| S2  | scope                                   | Size over 400                                                                                                  | **accepted** | Recorded in § Test plan; no split                                                                                                    |
| SE1 | security                                | No patch for (f); the proof tests a different case                                                             | **accepted** | Proof (f) as the acceptance states it, with P3; (f′) kept as the attach case with P11                                                |
| SE2 | security                                | (f) relies on a scope being one household (ID-1 2, 3)                                                          | **accepted** | `programBlockOfProfile`, a column-to-column conjunct                                                                                 |
| SE3 | security, reuse                         | A hidden foreign workout could answer `program_changed` (an existence oracle)                                  | **accepted** | Scope in the WHERE through `templateBlockIn`, liveness read after; proof 6c                                                          |
| SE4 | security, reuse                         | The prescription's movement isn't re-checked against the household                                             | **accepted** | Step 6, `movementIsAvailableTo`; P7                                                                                                  |
| SE5 | security                                | The runbook's (f) text goes stale                                                                              | **accepted** | Runbook and L16 in the file table                                                                                                    |
| SE6 | security                                | `not_found` uniformity doesn't hold for `client_id`                                                            | **accepted** | Stated in Risks and the guide                                                                                                        |
| SE7 | security                                | No `cross_household` signal for a workout probe                                                                | **accepted** | Out of scope, a 12b obligation                                                                                                       |
| R1  | reuse                                   | The fill rule would be a fourth copy                                                                           | **accepted** | Shared `fillRowValues` / `prescribedTarget` (§ Requests)                                                                             |
| R2  | reuse                                   | Natural-key predicates written inline twice                                                                    | **accepted** | `workoutSessionSlot`, `workoutSupersetSlot`, `programRowSlot`                                                                        |
| R3  | reuse                                   | The workout lookup re-types `liveTemplateBlockIn`                                                              | **accepted** | `templateBlockIn`, with `liveTemplateBlockIn` recomposed                                                                             |
| R4  | reuse                                   | `entries.unit` restates §2                                                                                     | **accepted** | `entryUnitFor` in shared (§ Requests)                                                                                                |
| R5  | reuse                                   | The proofs re-type lane A's detectors                                                                          | **accepted** | Imported (§ Requests to lane A)                                                                                                      |
| R6  | reuse                                   | Un-tick reads the token a second way                                                                           | **accepted** | Always through `hideEntries`                                                                                                         |
| R7  | reuse, architecture                     | `readRowValues` and `isScheduledOn` private, but 12a and 11c need them                                         | **accepted** | `queries/day/row-values.ts` and `queries/day/scheduled.ts`                                                                           |
| A1  | architecture                            | Moving `isWritableDay` isn't one definition; D32 is one-sided                                                  | **accepted** | `resolveDeclaredDay` calls it; 12c's row amended (§ Requests)                                                                        |
| A2  | architecture, scope                     | Mutation numbers collide with #461; README rows missing                                                        | **accepted** | Numbered after #461; README in the file table                                                                                        |
| A3  | architecture                            | M6 cites D35, which isn't on `main`, and commits 11c to the wrong file                                         | **accepted** | Removed; D18 stands                                                                                                                  |
| A4  | architecture                            | `docs/architecture.md` not updated; §2f becomes false                                                          | **accepted** | In the file table                                                                                                                    |
| A5  | architecture                            | Archived athlete, `retry`, the SCALE-1 citation, step numbering                                                | **accepted** | Lane E's calls; SCALE-1 cited to `docs/plan.md:341`; renumbered                                                                      |
| A6  | architecture                            | The `strength-session.ts` edit is outside the seam queue                                                       | **accepted** | Listed in § Requests                                                                                                                 |
| N   | correctness                             | Pin tomorrow; a range's target; a purged workout on un-tick; the kind-NULL check-in proof; a hidden-block case | **accepted** | Proofs 4, 5, 6, 6b; un-tick step 4                                                                                                   |
| —   | scope                                   | Split `hide.ts` or un-tick/re-tick into their own PR                                                           | **rejected** | Catch-only makes `hide.ts` one line; un-tick and re-tick are ~100 lines over existing primitives, and a split costs a full PR cycle  |
| —   | scope                                   | Keep the slot pre-check and mark the arbiter branch unproven                                                   | **rejected** | Dropping it proves the branch, at the cost of a one-line change to the fake                                                          |

### Engineering panel, round 2 (re-review of rev 2: correctness, security, reuse; Opus 5.5, medium effort)

> Panel cost: correctness 83k · 3m31s, security 70k · 2m11s, reuse 94k · 4m15s.

| #    | Lens                  | Critique (short)                                                                     | Verdict      | Resolution                                                                                                          |
| ---- | --------------------- | ------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| 2C1  | correctness, security | P3 and P4 cover for each other under a single-household scope, so neither can go red | **accepted** | `rowWorkout` is exported and proven directly where profile and scope disagree (4d, 4e); P4 folds into retargeted 47 |
| 2C2  | correctness           | The pin has five conditions and one proof                                            | **accepted** | 3c–3h, one patch each; the workout added to the pin                                                                 |
| 2C3  | correctness           | `untickRow` steps 3 and 4 have no proof                                              | **accepted** | 10b (P24), 10c (P25)                                                                                                |
| 2C4  | correctness           | 3b can't fail on P2                                                                  | **accepted** | 3b's patch is P18 (a guarded classifier)                                                                            |
| 2C5  | correctness           | (f′) contradicts the detector sweep                                                  | **accepted** | (f′) deletes its planted row before the sweep                                                                       |
| 2C6  | correctness           | 5a depends on row order                                                              | **accepted** | The quantities read throws on two live rows in one slot                                                             |
| 2C7  | correctness           | P13 listed against the strength proofs, which it can't redden                        | **accepted** | P13 → proof 4 (Duration); 11 is a regression guard                                                                  |
| 2C8  | correctness           | Rules with no patch (`RowRefused`, 6, 6b, 8, 9, step 10's re-check, step 8)          | **accepted** | P16–P23 added; `RowRefused` listed as unproven with the reason                                                      |
| 2C9  | correctness           | The session and superset re-selects depend on row order                              | **accepted** | Both assert exactly one row                                                                                         |
| 2C10 | correctness           | A replay after a purge answers `not_found`                                           | **accepted** | Recorded as lane E's call and in Fake parity                                                                        |
| 2C11 | correctness           | A replay with a mismatched workout answers `ok`                                      | **accepted** | The workout is in the pin (3h)                                                                                      |
| 2C12 | correctness           | `retickRow` checks less than `untickRow`                                             | **rejected** | It matches the fake (`fakes.ts:263-291`); a re-tick restores what was there a moment before in the same visit       |
| 2S1  | security              | The SE7 obligation isn't in 12b's row                                                | **accepted** | A request to the contract owner for 12b's row                                                                       |
| 2S2  | security              | `programBlockOfProfile` has one consumer (`ownership.ts`'s two-consumer rule)        | **accepted** | 11c's amend is the second, named in step 4                                                                          |
| 2R1  | reuse                 | `components/day/row-values.ts` restates the fill and `targetQuantity`                | **accepted** | Passed to the contract owner for C10 (not lane E's file)                                                            |
| 2R2  | reuse                 | `prescribedTarget` collides with the `prescription_targets` table                    | **accepted** | Passed to the contract owner (C10 names it)                                                                         |
| 2R3  | reuse                 | `readRowValues` is a second copy of the DAL's live-sets read                         | **accepted** | Named `stored-row-values.ts`; cites `entries.ts:226`; P26 proves the parent filter; folding filed as tech debt      |
| 2R4  | reuse                 | Recomposing `liveTemplateBlockIn` breaks patches 46–48, and P4 duplicates 47         | **accepted** | 46–48 retargeted, in the file table; P4 dropped in favour of 47                                                     |
| 2R5  | reuse                 | Lane A's builders not requested; the program-row predicate restated three times      | **accepted** | `mkWorkout` and the prescription builder added to the request; `programRowOf` named once                            |
| —    | (C10)                 | The contract owner builds the shared rules; a lane never edits contract files        | **accepted** | § What 11b imports from C10, with the owner's fallback                                                              |

### ID-1 keep-open items

| #   | Answer                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Clean: no column ties a profile to a login; the writer reads `profile_id` and the scope only.                                                                                                                           |
| 2   | Every id resolves through `isLiveProfile(…, scope)` and the scope-wrapping helpers in `ownership.ts`. SE2 adds a column-to-column conjunct, so a widened scope cannot pair one family's profile with another's workout. |
| 3   | Answered by SE2: (f) no longer depends on a scope being one household.                                                                                                                                                  |
| 4   | Clean: the arbiters key on profile (`uq_sessions_profile_day_workout`), never on `(household_id, profile)`.                                                                                                             |
| 5   | Clean: no age-based logic; an archived athlete is refused by `profiles.archived_at` state, not age.                                                                                                                     |
| 6   | Clean: no role check is added.                                                                                                                                                                                          |
