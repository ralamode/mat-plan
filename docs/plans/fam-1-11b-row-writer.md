# FAM-1 11b — the row writer

> Backlog: [plan.md](../plan.md) row `FAM-1`, the [FAM-1 plan](./fam-1-family-program.md) §5 step
> 11b. Branch: `feat/fam-1-11b-row-writer`. Lane E ([day-writers.md](../features/day-writers.md)).
> **Rev 2**, after a five-lens panel (§ Review-response log).

## Goal

A tick on any row of a program workout is stored once and answered with a typed result. One writer,
`logRow`, handles all seven tracking types. Un-tick and re-tick (`untickRow`, `retickRow`) come with
it. This PR does the writers and their `db:verify` proofs only. The Server Actions that call them are
step 12b, and the day page wires them in 12c.

**Roadmap alignment (2026-11-16):** advances `FAM-1` lane E. Gated by 11a (#438, merged), 4b
(`0025`, applied) and, per §5's gate, step 5 (Q1 below). Lane S's 3b-0 (#461) goes first on
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

### Relayed by the board as the maintainer's answers (2026-11-16), **to be confirmed first-hand**

| #   | Decision                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Code waits for 4b (now applied). This plan and its panel come first.                                                                                                   |
| M2  | A mismatched workout / prescription pair, and a write naming another household's workout, both answer `not_found`. `ROW_REFUSALS` has no reason of its own for either. |
| M3  | The weekday comes from the row's day, through `localWeekday` (`packages/shared/src/day.ts:42`).                                                                        |
| M4  | The writers take `today` as an argument (SCALE-1, `docs/plan.md:341`). `isWritableDay` is used as it stands until 12c (D32).                                           |
| M5  | `untickRow` and `retickRow` belong to 11b.                                                                                                                             |

### Open, for the maintainer

- **Q1. Step 5's assignment check.** §5 row 11b requires "a template block the athlete is on that
  day" and gates 11b on step 5 being applied (review fix B2: "11b waits for 5"). **Proposed:** keep
  that gate. Write the code now, include the check, and merge only after step 5 is observed applied.
  The alternative is to merge without the check, amend row 11b, name the step that owns the check,
  and gate 12b on it. Until the check exists, any athlete in the household could log any template
  workout of that weekday.

### Lane E's own calls (the panel may still challenge them)

- **An archived athlete:** `logRow`, `untickRow` and `retickRow` answer `closed_day`, as
  `dayPageFlags` makes their day read-only (`apps/web/lib/entries/declared-day.ts`).
- **`retry` is never answered by the writer.** It is the client's answer to a transport failure, and
  an unexpected database error throws.
- **The revive** (a ✓ on a slot held by the athlete's own hidden entry) is not in this plan. D18 as
  written stands: a replay of a hidden row answers `own_hidden` and writes nothing. If the contract
  owner's D35 reaches `main`, it is a later step with its own plan.

## Requests to other owners (11b depends on these)

Sent 2026-11-16. Each names the fallback if declined.

| To             | Request                                                                                                                                                                                                                                                                                                                                                                                          | If declined                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Contract owner | **One value-fill rule:** `fillRowValues` moves from the fake (`fakes.ts:94-115`) into `packages/shared/src/program/`. It adds two refusals: a repeated slot, and a value over `quantityCeiling`. `prescriptionTarget` is added too, with the **range rule** (`value_max` set → no single target). So is `entryUnitFor(type, prescribedUnit)`. The fake, the writer, 11c and 12a all import them. | Not acceptable: the writer would be a fourth copy of the fill rule.       |
| Contract owner | The fake's slot check moves after its value check, so a bad value on a taken slot answers `bad_value` (the writer's order).                                                                                                                                                                                                                                                                      | Keep a slot pre-check in the writer and mark its arbiter branch unproven. |
| Contract owner | `isWritableDay` and `WRITABLE_DAY_RADIUS` move to `packages/shared/src/day.ts`, and `resolveDeclaredDay` calls it. 12c's row is amended: D32's narrowing changes the function's shape, not the radius.                                                                                                                                                                                           | The action passes `writable: boolean`, which is a weaker guard.           |
| Contract owner | Plan text: row 11b's gate (Q1); runbook pre-flight (f) and L16 name the proof that now holds (f); the `strength-logging.md` queue lists 11b's `strength-session.ts` edit.                                                                                                                                                                                                                        | This PR edits them, with the owner's review.                              |
| Lane A         | Export the `verify/schema.ts` detectors (`sessionsOnForeignWorkouts`, `entriesOnForeignPrescriptions`, `entriesOnAnotherWorkoutsPrescriptions`, `workoutSessionsOfAnotherType`, `workoutSessionsWithADayRole`, `mkTemplateBlock`).                                                                                                                                                               | Lane A hoists them into `verify/harness.ts`.                              |

## The contract, in order

Every writer runs in one transaction. **A refusal reached after the first insert leaves by a
sentinel throw** (`RowRefused`, as `restoreHidden`'s `ItemRefused`, `writers/hide.ts:231-249`), so
nothing a refused write began is committed. Mutation numbers are assigned after #461 merges (it
takes 82–90); `P#` below are this plan's labels.

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

1. **Profile.** `isLiveProfile(profilePublicId, scope)` → none: `not_found`. Archived → `closed_day`.
2. **Window.** `!isWritableDay(day, today)` → `closed_day`.
3. **Replay, pinned.** One helper, `classifyRowHolder(exec, profileId, write)`, used here and after
   the entry insert. It finds the entry holding `write.clientId`, live or hidden (unguarded, the
   classifier pattern of `writers/checkin.ts:104-143`). It is a replay **only if** the holder is this
   profile's, is a program row (`prescription_set IS NOT NULL`), is on `write.day`, has `set =
write.set`, and its prescription's `public_id = write.prescriptionPublicId`. A live holder like
   that → `ok` with its stored values; a hidden one → `own_hidden` (D18); any other holder →
   `not_found`. Pinning it like the bodyweight writer (`writers/bodyweight.ts:236-252`) means a
   reused `client_id` never answers with another row. **P1:** drop the pin → the "strength id reused"
   proof goes red.
   It runs before the program checks, so a replay answers as the first call did after the program
   changes. **P2:** move it after step 5 → the "replay after the prescription is hidden" proof
   answers `program_changed`.
4. **Workout.** Found through `templateBlockIn(scope)`, a new helper in `writers/ownership.ts`
   (household and template, NOT live; `liveTemplateBlockIn` is recomposed from it), **and**
   `programBlockOfProfile(profileId)`, also new in `ownership.ts`: `program_blocks.household_id =
profiles.household_id`, a column-to-column conjunct, so pre-flight (f) holds whatever a scope
   later widens to (ID-1 items 2 and 3). Liveness is read off the row: not found (which covers
   foreign, hidden-and-foreign, and missing) → `not_found`; the workout or its block hidden →
   `program_changed`. **P3:** drop `programBlockOfProfile` → proof (f) goes red. **P4:** drop the
   scope conjunct → the foreign-workout proof goes red.
5. **Prescription.** `public_id` and `workout_id = <the workout's id>`, read **with its live
   `prescription_quantities` in one statement**, so a concurrent edit cannot mix old sets with new
   loads in the snapshot. Not found (this covers a mismatched pair) → `not_found`; hidden →
   `program_changed`. **P5:** drop `workout_id` → the mismatched-pair proof goes red. **P6:** drop the
   quantities' `deleted_at` filter → the "hidden quantity in the same slot" proof goes red.
6. **Movement.** `movementIsAvailableTo(scope)` on the prescription's movement, re-checked in the
   transaction as `writeStrengthSession` does (`writers/strength-session.ts:252-280`) → else
   `not_found`. **P7:** drop it → the "foreign movement on a prescription" proof goes red.
7. **Scheduled.** `scheduledOn(blockId, workoutId, day)`, a conjunct exported from a new
   `queries/day/scheduled.ts`, which 12a's `scheduled` flag also uses → else `not_scheduled`.
   **P8:** drop the weekday → the "not on that weekday" proof goes red.
8. **On the program that day** (step 5, Q1). The assignment conjunct joins `scheduledOn` → else
   `program_changed`, which is how the fake answers a workout missing from the athlete's day.
9. **Set.** `set > 1` on a type without set rows (`hasSetRows`) → `bad_value`. **P9:** drop it → the
   "set 2 on a Check" proof goes red.
10. **Values.** `fillRowValues(item, write.values, prescriptionTarget(...))` (shared; § Requests) →
    `null` → `bad_value`. It covers reps on a type without reps, a foreign or repeated slot, a
    missing number with no target (a range has none), another unit, and a value over the unit's
    ceiling. The type and unit are re-checked against `TRACKING_TYPE_FIELDS` (`dimensions`, the fixed
    `min`/`sec`), so a malformed prescription answers `bad_value`, not an FK 500.
11. **Writes.**
    - **Session:** server-minted `client_id`, `session_type = SESSION_TYPE.workout`, `workout_id`,
      `workout_name` frozen, `day_role` NULL. A bare `ON CONFLICT DO NOTHING`, then re-select live by
      `workoutSessionSlot(profileId, day, workoutId)` (a named conjunct, like `bodyweightSlot`).
      **P10:** drop `workout_id` from it → the "two workouts on one day" proof goes red. **P11:** drop
      `profile_id` → proof (f′) goes red.
    - **Superset**, when `superset_label` is set: `prescription_group = superset_label`,
      server-minted `client_id`, a bare `ON CONFLICT`, then re-select live by
      `workoutSupersetSlot(sessionId, group)`.
    - **Entry:** `client_id`, `prescription_id`, `prescription_set`, `movement_id`, `movement_name`,
      `activity_type_id`, `session_id`, `superset_id`, `superset_order`, `unit =
entryUnitFor(type, prescribedUnit)`, `prescribed_snapshot = prescribedText(...)` (`''` stays
      `''`). A bare `ON CONFLICT DO NOTHING`. On no insert: `classifyRowHolder` (step 3); else a live
      holder at `programRowSlot(sessionId, prescriptionId, set)` → `slot_taken`; else throw. **No slot
      pre-check**, so a sequential twin tick goes through this branch and `db:verify` proves it.
      **P12:** drop the arbiter classification → the twin-row proof throws.
    - **Set row:** `insertEntrySetRows` (`writers/session-rows.ts`), widened to take each set's
      quantities. Its input is derived (`Pick<RowValues,'reps'|'quantities'> &
Partial<Pick<StrengthSetInput,'isBodyweight'|'isBand'|'status'>>`), the dimension is derived
      per quantity, and `reps` omitted → the column is omitted. **P13:** `dimension: 'mass'`
      hard-coded → the Duration proof goes red.
12. → `{ ok: true, entryPublicId, values }`.

### `untickRow`

```ts
export async function untickRow(
  db: NodePgDatabase<Schema>,
  args: { scope: HouseholdScope; today: string; input: RowUntick },
): Promise<RowResult>;
```

1. Profile → `not_found`; archived → `closed_day`.
2. Window → `closed_day`.
3. The entry by `public_id`, this profile, `input.day`, a program row (`prescription_set IS NOT
NULL`) → else `not_found`.
4. Live, and its session's workout is no longer `scheduledOn` that day (or was purged) →
   `not_scheduled`.
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
3. The same program-row pre-check as `untickRow` → else `not_found`, so a hidden weigh-in is never
   restored through the row action. **P14:** drop it → the "re-tick a hidden weigh-in" proof goes red.
4. `restoreHidden(tx, { …, entryPublicIds: [id] })`, mapped through a `Record<RestoreReason, …>`, so
   a new restore reason is a compile error: `ok` → `ok` with values; `slot_taken` → `slot_taken`;
   `changed` and `not_found` → `not_found`.

### `hide.ts`

After #461 merges: append `ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX` to its `RESTORE_SLOT_INDEXES`. There
is no pre-check: a program row has no swap and no `heldBy`, and the restore's UPDATE hits the partial
row arbiter inside the item's savepoint, which works on one PGlite connection. **P15:** remove the
index from the list → the "re-tick after a new ✓" proof throws.

## File by file

| Path                                                                         | Change   | What and why                                                                                                                                |
| ---------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/day/log-row.ts`                                     | NEW      | The three writers, `classifyRowHolder`, `RowRefused`, and the slot conjuncts `workoutSessionSlot`, `workoutSupersetSlot`, `programRowSlot`. |
| `packages/db/src/queries/day/scheduled.ts`                                   | NEW      | `scheduledOn` (and the step-5 conjunct): one rule for the writer, 12a and 11c.                                                              |
| `packages/db/src/queries/day/row-values.ts`                                  | NEW      | `readRowValues(exec, entryIds)`: the stored `RowValues`, for a replay, un-tick, 12a and 11c.                                                |
| `packages/db/src/writers/ownership.ts`                                       | EDIT     | `templateBlockIn(scope)`, with `liveTemplateBlockIn` recomposed from it; `programBlockOfProfile(profileId)`.                                |
| `packages/db/src/writers/session-rows.ts`                                    | EDIT     | `insertEntrySetRows` takes quantities per set (derived input type).                                                                         |
| `packages/db/src/writers/strength-session.ts`                                | EDIT     | Maps `weight` → `quantities: [{ slot: primary, unit, value }]`. The SQL is unchanged.                                                       |
| `packages/db/src/writers/hide.ts`                                            | EDIT     | One entry in `RESTORE_SLOT_INDEXES`.                                                                                                        |
| `packages/db/src/writers/day/index.ts`, `src/index.ts`                       | EDIT     | Export the writers for 12b.                                                                                                                 |
| `packages/shared/src/program/…`, `src/day.ts`, `fakes.ts`, `declared-day.ts` | EDIT     | Per § Requests, if the contract owner has 11b make them.                                                                                    |
| `packages/db/scripts/verify/day.ts`                                          | EDIT     | The proofs.                                                                                                                                 |
| `packages/db/src/writers/day/owed.test.ts`                                   | EDIT     | The 11b lines go.                                                                                                                           |
| `packages/db/scripts/mutations/NN-…` + `README.md`                           | NEW/EDIT | P1–P15, one row each in the README's table.                                                                                                 |
| `docs/features/day-writers.md`                                               | EDIT     | The file map, the invariants (check order; the pinned replay; refusals after an insert throw), Fake parity.                                 |
| `docs/features/{write-path,strength-logging,delete-and-restore}.md`          | EDIT     | `session-rows.ts`'s input; `ownership.ts`'s helpers; the restore list's program row.                                                        |
| `docs/architecture.md`                                                       | EDIT     | A `logRow` sequence diagram (the PR embeds the same one), and §2f: the snapshot now has two freezing paths.                                 |
| `docs/runbooks.md`, the FAM-1 plan                                           | EDIT     | Pre-flight (f) and L16 name P3 and its proof (§ Requests).                                                                                  |
| `docs/changelog/<date>-feat-fam-1-11b-row-writer.md`                         | NEW      | The fragment.                                                                                                                               |

## Test plan

In `verify/day.ts`, on PGlite. The fixture is household H (`A_SCOPE`): a template block whose two
workouts are **both scheduled on the proof day's weekday**, one prescription of each tracking type, a
superset pair, a range prescription, a hidden quantity row under a live one in the same slot, and an
archived athlete. Household B (`B_SCOPE`) has its own fully valid template block, scheduled the same
weekday. After every proof, the (f), (g) and mismatched-pair detectors read `[]`.

| #    | Proof                                                                                                                                                                                                      | Patch                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1    | Two workouts ticked on one day → two sessions, each holding its own entry; a second tick reuses its session                                                                                                | P10                     |
| 2    | Twin row: a second `clientId` on a logged set → `slot_taken`, one entry; replay of the first → same answer                                                                                                 | P12                     |
| 3    | Replay after Clear day → `own_hidden`, nothing written                                                                                                                                                     | (D18)                   |
| 3a   | ✓, hide the prescription, replay → `ok` (not `program_changed`)                                                                                                                                            | P2                      |
| 3b   | ✓ c1, un-tick, ✓ c2 on the same set, replay c1 → `own_hidden`                                                                                                                                              | P2                      |
| 3c   | A strength entry's `client_id` reused on a ✓ → `not_found`, nothing written                                                                                                                                | P1                      |
| 4    | Each tracking type, empty ✓ and typed, read back; passes the shape CHECK; a kind-NULL check-in still passes                                                                                                | P13                     |
| 5    | Empty ✓: `'8-12'` reps, a `value_min` NULL, a range, another unit, a repeated slot, over the ceiling → `bad_value`                                                                                         | (shared fn's own tests) |
| 5a   | A hidden quantity row in the same slot is never copied                                                                                                                                                     | P6                      |
| 6    | `closed_day`: 2 days back; an archived athlete. Tomorrow → `ok` (pinned, so 12c must flip it)                                                                                                              | —                       |
| 6a   | `not_scheduled`: a workout not on that weekday                                                                                                                                                             | P8                      |
| 6b   | `program_changed`: a hidden prescription; a hidden workout; a hidden block                                                                                                                                 | —                       |
| 6c   | `not_found`: B's profile; B's workout with B's prescription (fully valid); B's **hidden** workout; a mismatched pair (H's workout, H's other workout's prescription); a foreign movement on a prescription | P4, P5, P7              |
| (f)  | B's live profile + H's workout and prescription, scheduled → `not_found`; no session, superset or entry rows                                                                                               | P3                      |
| (f′) | A planted B session naming H's workout on that day; H's tick writes into H's own session                                                                                                                   | P11                     |
| 7    | Set 5 on a 3-set Weight × Reps → `ok`; set 2 on a Check → `bad_value`                                                                                                                                      | P9                      |
| 8    | Two superset members → one `supersets` row with `prescription_group`, both entries attached                                                                                                                | —                       |
| 9    | `prescribed_snapshot = prescribedText(...)`; `''` for a Check                                                                                                                                              | —                       |
| 10   | Un-tick → token; un-tick again → the same token; re-tick → `ok`; re-tick after a new ✓ took the set → `slot_taken`                                                                                         | P15                     |
| 10a  | Re-tick of a hidden weigh-in → `not_found`                                                                                                                                                                 | P14                     |
| 11   | The existing strength proofs pass unchanged                                                                                                                                                                | P13                     |

**Unproven on PGlite, recorded:** a concurrent double-fire reaching step 11's `classifyRowHolder`
branch needs two connections. Proof 2 covers the arbiter branch sequentially. The classifier is the
same helper as step 3's, which P1 and P2 cover.

**Size, recorded:** about 450 lines of production code and about 1,100–1,300 diff lines in all. Most
of it is acceptance proofs that cannot move, so no split brings it under 400.

Run: `pnpm verify` (which includes `db:mutations`). There is no UI, so no screenshots or `e2e:local`.

## Fake parity

- The fake reads `plan.writable`; the writer uses `isWritableDay(day, today)`, which accepts tomorrow
  until 12c (D32).
- The fake has no household or archive, so `not_found` for a foreign id and `closed_day` for an
  archived athlete are the writer's alone. The fake answers `program_changed` for an unknown workout.
- A replay after the window has closed answers `closed_day` in both.

## Risks and rollback

- **A replay answered with another row:** prevented by the pinned classifier (P1).
- **A refused write that leaves a session behind:** prevented by `RowRefused` rolling back.
- **A widened `insertEntrySetRows` changing a strength row:** the strength proofs run unchanged.
- **Ownership:** every id resolves inside the scope; (f) is structural (P3). The `not_found` answer is
  uniform for public ids. A guessed `clientId` held by another household also answers `not_found`;
  that needs 74 random bits of a UUIDv7, and `day-writers.md` says so rather than claiming uniformity.
- **Rollback:** writers only, no migration. Revert the PR.

## Out of scope

- The revive (D35/C9, not on `main`); Change (`amendRow`): 11c.
- The Server Actions, the rate limit, Sentry, and a `cross_household` signal for a probed workout or
  prescription id (`reportScopeMiss` covers profiles only, `apps/web/lib/dal/household.ts:521`): 12b.

## Review-response log (adversarial panel)

> Panel cost (all on Opus 5.5: the Fable spend limit, the maintainer's decision of 2026-11-16):
> correctness 174k · 9m21s, scope 94k · 3m36s, architecture 116k · 6m43s, reuse 155k · 6m11s,
> security 105k · 5m57s.

| #   | Lens                                    | Critique (short)                                                                                               | Verdict       | Resolution                                                                                                                           |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | correctness, reuse                      | The replay classifier isn't pinned; a reused `client_id` answers `ok` with another row                         | **accepted**  | Step 3: pinned to profile, program row, day, set and prescription; one helper for steps 3 and 11; P1                                 |
| C2  | correctness, scope, reuse, architecture | `hide.ts`: pre-check and matcher both answer `slot_taken`, so the patch can't go red                           | **accepted**  | Catch-only, one entry in #461's `RESTORE_SLOT_INDEXES`; P15 removes it                                                               |
| C3  | correctness, scope                      | Four patches can't fail on their named case                                                                    | **accepted**  | Proofs 1 (two workouts, one weekday), 3a, 3b and (f′) added; every rule names its patch (P1–P15)                                     |
| C4  | correctness, scope, architecture        | Step 5's assignment check dropped, against row 11b's gate                                                      | **open (Q1)** | Proposed: keep the gate and include the check                                                                                        |
| C5  | correctness                             | `prescription_quantities` not filtered to live rows                                                            | **accepted**  | Step 5 reads live quantities in the same statement; P6                                                                               |
| C6  | correctness                             | A repeated slot is dropped or throws                                                                           | **accepted**  | `bad_value`, in the shared fill rule (fake too)                                                                                      |
| C7  | correctness                             | Refusals after the first insert commit; the insert branch is never exercised                                   | **accepted**  | `RowRefused` sentinel; the slot pre-check removed so proof 2 exercises the insert branch; the concurrent branch recorded as unproven |
| C8  | correctness, architecture, security     | `retickRow` restores any hidden entry                                                                          | **accepted**  | Program-row pre-check; P14                                                                                                           |
| S1  | scope                                   | The slot pre-check duplicates the arbiter                                                                      | **accepted**  | Removed; the fake's order moves to match (§ Requests)                                                                                |
| S2  | scope                                   | Size over 400                                                                                                  | **accepted**  | Recorded in § Test plan; no split                                                                                                    |
| SE1 | security                                | No patch for (f); the proof tests a different case                                                             | **accepted**  | Proof (f) as the acceptance states it, with P3; (f′) kept as the attach case with P11                                                |
| SE2 | security                                | (f) relies on a scope being one household (ID-1 2, 3)                                                          | **accepted**  | `programBlockOfProfile`, a column-to-column conjunct                                                                                 |
| SE3 | security, reuse                         | A hidden foreign workout could answer `program_changed` (an existence oracle)                                  | **accepted**  | Scope in the WHERE through `templateBlockIn`, liveness read after; proof 6c                                                          |
| SE4 | security, reuse                         | The prescription's movement isn't re-checked against the household                                             | **accepted**  | Step 6, `movementIsAvailableTo`; P7                                                                                                  |
| SE5 | security                                | The runbook's (f) text goes stale                                                                              | **accepted**  | Runbook and L16 in the file table                                                                                                    |
| SE6 | security                                | `not_found` uniformity doesn't hold for `client_id`                                                            | **accepted**  | Stated in Risks and the guide                                                                                                        |
| SE7 | security                                | No `cross_household` signal for a workout probe                                                                | **accepted**  | Out of scope, a 12b obligation                                                                                                       |
| R1  | reuse                                   | The fill rule would be a fourth copy                                                                           | **accepted**  | Shared `fillRowValues` / `prescriptionTarget` (§ Requests)                                                                           |
| R2  | reuse                                   | Natural-key predicates written inline twice                                                                    | **accepted**  | `workoutSessionSlot`, `workoutSupersetSlot`, `programRowSlot`                                                                        |
| R3  | reuse                                   | The workout lookup re-types `liveTemplateBlockIn`                                                              | **accepted**  | `templateBlockIn`, with `liveTemplateBlockIn` recomposed                                                                             |
| R4  | reuse                                   | `entries.unit` restates §2                                                                                     | **accepted**  | `entryUnitFor` in shared (§ Requests)                                                                                                |
| R5  | reuse                                   | The proofs re-type lane A's detectors                                                                          | **accepted**  | Imported (§ Requests to lane A)                                                                                                      |
| R6  | reuse                                   | Un-tick reads the token a second way                                                                           | **accepted**  | Always through `hideEntries`                                                                                                         |
| R7  | reuse, architecture                     | `readRowValues` and `isScheduledOn` private, but 12a and 11c need them                                         | **accepted**  | `queries/day/row-values.ts` and `queries/day/scheduled.ts`                                                                           |
| A1  | architecture                            | Moving `isWritableDay` isn't one definition; D32 is one-sided                                                  | **accepted**  | `resolveDeclaredDay` calls it; 12c's row amended (§ Requests)                                                                        |
| A2  | architecture, scope                     | Mutation numbers collide with #461; README rows missing                                                        | **accepted**  | Numbered after #461; README in the file table                                                                                        |
| A3  | architecture                            | M6 cites D35, which isn't on `main`, and commits 11c to the wrong file                                         | **accepted**  | Removed; D18 stands                                                                                                                  |
| A4  | architecture                            | `docs/architecture.md` not updated; §2f becomes false                                                          | **accepted**  | In the file table                                                                                                                    |
| A5  | architecture                            | Archived athlete, `retry`, the SCALE-1 citation, step numbering                                                | **accepted**  | Lane E's calls; SCALE-1 cited to `docs/plan.md:341`; renumbered                                                                      |
| A6  | architecture                            | The `strength-session.ts` edit is outside the seam queue                                                       | **accepted**  | Listed in § Requests                                                                                                                 |
| N   | correctness                             | Pin tomorrow; a range's target; a purged workout on un-tick; the kind-NULL check-in proof; a hidden-block case | **accepted**  | Proofs 4, 5, 6, 6b; un-tick step 4                                                                                                   |
| —   | scope                                   | Split `hide.ts` or un-tick/re-tick into their own PR                                                           | **rejected**  | Catch-only makes `hide.ts` one line; un-tick and re-tick are ~100 lines over existing primitives, and a split costs a full PR cycle  |
| —   | scope                                   | Keep the slot pre-check and mark the arbiter branch unproven                                                   | **rejected**  | Dropping it proves the branch, at the cost of a one-line change to the fake                                                          |

### ID-1 keep-open items

| #   | Answer                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Clean: no column ties a profile to a login; the writer reads `profile_id` and the scope only.                                                                                                                           |
| 2   | Every id resolves through `isLiveProfile(…, scope)` and the scope-wrapping helpers in `ownership.ts`. SE2 adds a column-to-column conjunct, so a widened scope cannot pair one family's profile with another's workout. |
| 3   | Answered by SE2: (f) no longer depends on a scope being one household.                                                                                                                                                  |
| 4   | Clean: the arbiters key on profile (`uq_sessions_profile_day_workout`), never on `(household_id, profile)`.                                                                                                             |
| 5   | Clean: no age-based logic; an archived athlete is refused by `profiles.archived_at` state, not age.                                                                                                                     |
| 6   | Clean: no role check is added.                                                                                                                                                                                          |
