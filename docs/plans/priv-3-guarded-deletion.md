# PRIV-3: the household and athlete deletions as guarded scripts, with `db:verify` proofs

> Backlog: [plan.md](../plan.md) row `PRIV-3` (`docs/plan.md:2308-2342`). Milestone:
> [beta-1](../milestones/beta-1.md) → "the remaining path", item 8 (`beta-1.md:485`).
> Branches: `db/priv-3-1-household-graph`, `db/priv-3-2a-erase-core`, `db/priv-3-2b-erase-household`
> and `db/priv-3-3-erase-athlete`. PR 4 (the purge) is a deferred section of this file. This plan PR is
> `docs/priv-3-plan` (plan only, no code).
>
> **Refreshed 2026-11-17** against `origin/main` `26fdb025`; every `file:line` was re-read there. The
> first draft (2026-11-13, `200a697`) predates FAM-1's five program tables, step 5's manual athlete
> erasure (#487), the `verify/` split, and `OPS-2`'s decisions (draft #494). § "What changed" lists the
> differences; the log at the end keeps round 1 and adds round 2.
>
> **Order across the three Beta 0 deletion tracks** (agreed with `OPS-2`'s draft #494 and `OPS-3`'s
> draft plan, neither on `main` yet). Gate 1 of `parallel-work.md` fails between them (`runbooks.md`,
> `verify.ts`, `mutations/`, `corrections/registry.ts`, the privacy docs), so they run in order:
>
> 1. PRIV-3 PR 1 (the graph and its proofs);
> 2. `OPS-2` PR 1, then the `OPS-3` restore PR;
> 3. the `OPS-3` drill;
> 4. PRIV-3 PR 2a, then PR 2b (the household erasure);
> 5. PRIV-3 PR 3 (the athlete erasure) and `OPS-2` PR 2 (the fixture athlete), one at a time, both on
>    `registry.ts`.
>
> **Separate from the PR order:** `SEC-6`'s production re-key runs before the **first deletion of a
> household or athlete that carries a committed seed id** (`OPS-2` Q2 (a)). It gates that one
> operation, not any PR here, and PR 2b's refusal (D4) enforces it.

_Roadmap alignment (2026-11-17): advances `PRIV-3` (Beta 0, remaining-path item 8); consumes `OPS-2`'s
decisions Q2 (re-key first), Q4 and Q6; puts `SEC-6` on the path of a seed-id deletion; scripts FAM-1
step 5's manual athlete erasure rather than designing a second one; checked against `ID-1`'s six
keep-open items (table in the log) and against the private roadmap; nothing to add here._

## What changed since the first draft

| First draft (2026-11-13)                                             | Now                                                                                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14 tables; the order from `runbooks.md:1388-1403`                    | **19 tables** (`data-inventory.md:300`); the order from step 4's table (`runbooks.md:1570-1590`), rows 1–14 with 8a and 9a–9d                                                |
| One `OR` predicate (`prescription_targets`) made `AND`               | **Two:** `program_assignments` (step 4's 9d) has the same `OR` and gets the same `AND` (D2)                                                                                  |
| Pre-flights (a)–(d); "the FK aborts are the real check"              | **(a)–(h).** (e), (f) and (g) guard `ON DELETE SET NULL` edges, where there is **no** abort to fall back on (D3)                                                             |
| "No runbook describes the per-athlete deletion"                      | Step 5 wrote one (`runbooks.md:1757-1910`) with a proven list, `ERASE_ATHLETE` (`verify/schema.ts:2218`). PR 1 moves that list into the graph; PR 3 scripts the runbook (D7) |
| D6: seed ids become scrubbed tombstones; `isSeedTombstone`; proof P8 | **Withdrawn.** `OPS-2` Q2 chose (a), re-key first _(maintainer, 2026-11-16)_. A seed-id target is **refused** instead (D4, D6)                                               |
| The core takes `SEED_HOUSEHOLD_WRITE_LOCK` (`OPS-2` D6)              | **Withdrawn**: `OPS-2` withdrew the lock. No lock between erasure and restore (D3)                                                                                           |
| Waits on "`OPS-2` PR 1b"; the lift check "M4"                        | `OPS-2` PR 1. The lift check (now M3) is not cited: after the re-key no production target carries a seed id, and a target that does is refused                               |
| Proofs in `verify.ts`; a `MINTED_SCOPES` entry each                  | Proofs in a new `scripts/verify/erasure.ts` module. A mint there needs only a named const, no `MINTED_SCOPES` entry (`scope.test.ts:429-437`)                                |
| PR 3: new notice copy on what an athlete deletion keeps              | Step 5 already published it (`notice.md:261-273`). PR 3 changes only the word "manual" where the runbook says it                                                             |
| Q4: does PR 3 ship in Beta 0? Q5: tombstone or hard delete           | Q4 answered: Beta 0 _(maintainer, 2026-11-14)_. Q5 answered by `OPS-2` Q2. **New:** Q6, whether PR 3 scripts step 5's optional program removal (4b)                          |
| `OPS-2` Q6 (the ramp expansion)                                      | No change here: the seed's expansion was never on this plan's path. `ramp_targets` stays a graph table                                                                       |

## Goal

Today a household deletion is a hand-typed procedure in [runbooks.md](../runbooks.md) → "Delete a
household and everyone in it (PRIV-1)" (`runbooks.md:1254-1756`): eight pre-flight queries and nineteen
DELETEs. The dry run, the check that the target is production, and the transaction all rely on the
operator's care. **Its order is proved by nothing:** the row (`plan.md:2316-2318`) and the runbook
(`:1615`) describe a `db:verify` proof of it, but none exists. Only steps 13→14 (`verify.ts:7377-7420`)
and 9a→9b (`verify/schema.ts:873`) are checked. The athlete erasure is better off: step 5 proved its
list against the catalog and pinned the runbook to it (`verify/schema.ts:2419-2436`). But it is still
typed by hand.

This plan does four things:

1. **One committed list of per-household tables**, `HOUSEHOLD_GRAPH`, with the athlete-grain tables
   marked. The household erasure, the athlete erasure and `OPS-3`'s restore all read it. `db:verify`
   proves it against the live catalog. Step 5's `ERASE_ATHLETE` becomes a derivation of it, not a
   second list.
2. **A delete core in `packages/db`, typed `OwnerScope`.** It locks the parent rows, re-runs every
   pre-flight inside the transaction, and deletes in graph order. Any surprise fails closed.
3. **`erase-household`, a dry-run-first correction that wraps the core.** It refuses on every
   precondition it can check mechanically and prints the rest as a checklist.
4. **`erase-athlete`**, the same for step 5's procedure, at athlete grain.

## Acceptance

From the row, verbatim: _"Wraps runbooks.md's procedure so the dry run, the target-host print and the
one-transaction wrapper come from a runner rather than an operator's care … no household id may be
committed … The `db:verify` proof is the point, not the polish: it is the only thing that catches a
19th per-household table escaping the runbook's hand-maintained delete order."_ (There are 19 now; the
proof catches the 20th.)

Done when:

- **PR 1.** `db:verify` fails if any of these holds, and committed mutation patches turn it red:
  - a `public` base table is in neither `HOUSEHOLD_GRAPH` nor `REFERENCE_TABLES`, or is in both;
  - a foreign key points into the graph from outside it;
  - a child is listed after its parent;
  - the set of `grain: 'athlete'` tables differs from the tables reachable by FK from `profiles`
    (step 5's `tablesReachableFromProfiles`, `verify/schema.ts:2193`, reused);
  - any row of a graph table is matched by no household's `rowsOf`, or by more than one (P7, asked by
    `OPS-3`).

  Step 5's proofs keep passing unchanged against the derived `ERASE_ATHLETE`.

- **PR 2a.** `db:verify` runs the core on a fixture with at least one row in every graph table
  (soft-deleted rows included), next to a second household K. Each graph table loses exactly H's rows,
  K's id sets are identical table by table, and the reference tables and the global `movements` rows
  are unchanged. Each pre-flight (a)–(h) refuses and rolls back.
- **PR 2b.** `db:correct erase-household` reads its target from a hidden prompt into
  `ERASE_HOUSEHOLD_PUBLIC_ID`. As a dry run it prints the per-table counts, the pre-flight results, the
  step-0b Clerk ids under a privileged heading, and the manual checklist. It writes nothing and never
  echoes the target id. With `--apply` it refuses unless every gate passes, then calls the core. The
  runbook's hand SQL for steps 2–5 is replaced by commands.
- **PR 3.** `erase-athlete` takes **both** a household id and an athlete id, refuses an athlete outside
  that household, and runs the core at athlete grain. Step 5's runbook SQL is replaced the same way.
- **Throughout.** Nothing in the repo ever holds a real household or profile `public_id`. The erasure
  entries' Applied cells read **"standing — never dated"**: with one or two households, a date alone
  identifies one.

## Retention items: what this plan covers

`plan.md:2329-2339` lists three items:

| Item                                                 | Where                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Hard delete on request, per athlete and household | PR 2a/2b (household), PR 3 (athlete)                                                                                                                                                        |
| 2. The purge window `N`                              | **PR 4, a deferred section of this plan.** ADR 0008 sets `N` "in that row's plan". Built after `V1-9b` B1-3                                                                                 |
| 3. What a departed household's data becomes          | The ledger half is in PR 2b: a `grain` field, the preview reset, and the core as the replay `OPS-3` calls. The policy half (a household that leaves **without asking**) is open question Q3 |

The retention bullet's re-statement for ADR 0009 is unchanged from the first draft and already in this
PR's `plan.md` edit: "keep raw history, no summaries" still rests on the engine's per-set history,
CLONE-1's version record, a summary of a child's weight still being health data, the trivial volume,
and 0009 decision 3(a).

## Design decisions

### D1. The target arrives through the environment, read by a hidden prompt, not a flag (Q1)

Unchanged in substance. Three places say the deletion needs a `--household` flag: the row
(`plan.md:2311-2313`), README rule 8 (`corrections/README.md:34-44`) and `beta-1.md:505-507`. They
predate `household-claim-2026-10-25`, which takes its targets from the environment for reasons the
maintainer recorded (`registry.ts:697-705`), one being that _"a command line is broadly visible via
`ps`, while its environment is readable only by its owner"_. That matters more for the id of a family
that has asked to be erased.

- **The runbook reads the value with `read -rs ERASE_HOUSEHOLD_PUBLIC_ID`** and passes it inline,
  without `export`. Shell history holds only the variable name.
- **There is no argv change.** The runner changes only for output (D4).
- **The variable names differ from the claim's `HOUSEHOLD_PUBLIC_ID`**, so a value left over from a
  claim never reaches an erasure.
- If Q1 says flags instead, that becomes a PR 0: `node:util` `parseArgs` in strict mode, declared
  `targets` per entry, and the claim converted at its call sites.

README `:80-83` commits _"PRIV-3 converts this entry to flags … so the repo does not keep two
operator-input channels"_. The goal, one channel, is met under the env answer; the means is not. PR 2b
replaces the commitment with a **dated Amendment block**.

### D2. The shared per-household table source is `packages/db/src/household-graph.ts`

```ts
// Shape, not final code.
export type HouseholdGraphTable = {
  table: PgTable & { id: PgColumn }; // name via getTableConfig(table).name, never re-typed
  grain: 'athlete' | 'household'; // 'athlete' = reachable by FK from profiles; P2 proves it
  /** The rows to erase. `athlete` narrows an athlete-grain table to one profile *inside* the scope.
   *  NEVER a `deleted_at` conjunct (corrections README rule 8). */
  rowsOf: (scope: HouseholdScope, athlete?: ProfilePublicId) => SQL; // name shared with OPS-3's plan
};
export const HOUSEHOLD_GRAPH: readonly HouseholdGraphTable[]; // order = runbooks.md:1570-1590
export const REFERENCE_TABLES: readonly PgTable[]; // units, quantity_slots, activity_type_categories,
//                                                    activity_types, metric_definitions
export const ATHLETE_GRAPH = HOUSEHOLD_GRAPH.filter((t) => t.grain === 'athlete');
```

**The 19 entries, in order** (`schema.ts` line of each table):

| #   | Table                               | Grain     | `rowsOf(H)`                            |
| --- | ----------------------------------- | --------- | -------------------------------------- |
| 1   | `entry_set_quantities` :567         | athlete   | entry_set ∈ entry_sets of 3            |
| 2   | `entry_sets` :493                   | athlete   | entry ∈ 3                              |
| 3   | `entries` :324                      | athlete   | profile ∈ 17                           |
| 4   | `supersets` :957                    | athlete   | session ∈ 5                            |
| 5   | `sessions` :861                     | athlete   | profile ∈ 17                           |
| 6   | `day_readiness` :1003               | athlete   | profile ∈ 17                           |
| 7   | `ramp_targets` :1034                | athlete   | profile ∈ 17                           |
| 8   | `prescription_targets` :1433        | athlete   | profile ∈ 17 **AND** prescription ∈ 10 |
| 9   | `prescription_quantities` :1379     | household | prescription ∈ 10                      |
| 10  | `prescriptions` :1248               | household | block ∈ 15                             |
| 11  | `block_day_workouts` :1182          | household | block ∈ 15                             |
| 12  | `workouts` :1125                    | household | block ∈ 15                             |
| 13  | `program_assignment_weekdays` :1564 | athlete   | assignment ∈ 14                        |
| 14  | `program_assignments` :1511         | athlete   | profile ∈ 17 **AND** block ∈ 15        |
| 15  | `program_blocks` :1068              | household | `household_id` = H                     |
| 16  | `movements` :763                    | household | `household_id` = H, never `IS NULL OR` |
| 17  | `profiles` :211                     | athlete   | `household_id` = H                     |
| 18  | `household_members` :175            | household | `household_id` = H                     |
| 19  | `households` :123                   | household | `id` = H                               |

This is step 4's order, renumbered (its 8a, 9, 9a, 9b, 9c, 9d, 10–14). **Filtered to `grain: 'athlete'`
it is exactly step 5's `ERASE_ATHLETE`, in order** (`verify/schema.ts:2218-2237`: 1–8, 13, 14, 17).
That was checked by hand while refreshing; PR 1 makes it an assertion.

**One predicate per table, through one helper.** Every athlete-grain predicate goes through a private
`profilesIn(scope, athlete?)` = `inHousehold(scope) [AND public_id = athlete]`. A raw profile-id
subquery never escapes the capability. With `athlete` set, `rowsOf` narrows rows 1–8, 13, 14 and 17
to that profile.

**Four deliberate differences from the runbook's text:**

1. **`prescription_targets` (8) is `profile ∈ H AND prescription ∈ H`, not `OR`.** `OR` could delete
   another family's row instead of hitting an FK abort. With `AND`, a straddling row is left behind
   and the `prescriptions` or `profiles` delete aborts with `23503`: fail closed.
2. **`program_assignments` (14) is `profile ∈ H AND block ∈ H`, not step 4's 9d `OR`** (new in this
   refresh). Same argument: a stray assignment of another family's child to H's block is left, and the
   `program_blocks` delete aborts. Pre-flight (h) refuses it first.
3. **`movements` stays `= H`**, never `IS NULL OR` (`runbooks.md:1634`).
4. **With `athlete` set, the core walks only `ATHLETE_GRAPH`.** Household-grain predicates ignore
   `athlete`, so walking them would erase the whole household. P6 asserts that H's program,
   movements, members and household row survive.

The `AND` forms change nothing at athlete grain that step 5's pre-flight 2 does not already refuse: a
target on another household's prescription, or an assignment to its block
(`athleteRowsOnAnotherHouseholdsProgram`, `verify/schema.ts:2308`).

**`ERASE_ATHLETE` becomes a derivation.** PR 1 replaces the list at `verify/schema.ts:2218-2237` with
`ATHLETE_GRAPH`. `eraseAthlete` and `athleteCounts` stay verify helpers, now generated from it, so step
5's completeness, runbook-pinning and sibling-unchanged proofs (`:2419-2436`, `:3041-3104`) keep running
on the list the script uses. `OPS-2` D10 planned to move `ERASE_ATHLETE` into an importable module for
its fixture-athlete correction. **PR 1 is that module**, and it lands first, so `OPS-2` PR 2 imports
`ATHLETE_GRAPH` rather than making a second list (passed back to `OPS-2`).

**Placement.**

- The module sits in `src/` beside `schema.ts`, and `schema.ts`'s header gains a one-line pointer.
- It is **not** re-exported from the barrel (`src/index.ts`).
- The two new leaves, `householdRowIs(scope)` and `householdMemberInHousehold(scope)`, go in
  `ownership.ts`, the one module allowed to unwrap a scope (`scope.test.ts:64-65`). `src/index.ts:62`
  re-exports `ownership.ts` wholesale, so they reach `apps/web`. That is acceptable: they are equality
  predicates like the leaves already there. The graph and the core stay out of the barrel.
- `data-inventory.md` §1 (`:298-338`) and runbook step 4's table become pointers to this module.

**The interface for `OPS-3`:**

- `HOUSEHOLD_GRAPH`, walked forward to extract and reversed to re-insert.
- The restore target must already hold `REFERENCE_TABLES` **and every `household_id IS NULL`
  `movements` row that H references**.
- **The ledger replay:** re-run the core at each ledger entry's `grain` before serving the data. The
  core is idempotent, so a replay is safe.
- **`OPS-3`'s problems, not solved here:** identity columns (`OVERRIDING SYSTEM VALUE`), `public_id` and
  `client_id` collisions on re-insert, re-applying the purge after a restore. The first draft's "a
  seed-id restore must replace its own tombstone" is **void**: there are no tombstones.

### D3. The delete core is `packages/db/src/writers/erase-household.ts`, typed `OwnerScope`

`scope.ts:67-70` promises that _"`PRIV-3`'s deletion inherit[s] the check by signature"_. The core
keeps it, which also lets the Beta 1 self-serve deletion reuse it rather than move it. It stays out of
the barrel. The operator correction passes `ownerScope(householdScopeForScript(id))`.
`household-scope-script.ts:25-31`'s list of callers gains the new one. That list also misses the
`scripts/verify/*.ts` modules that already mint scopes, so PR 2a corrects it.

```text
eraseHousehold(exec, scope: OwnerScope, { athlete?, removeBlocks?, apply }) → ErasureReport
  BEGIN (one transaction, only when apply)
    SET LOCAL lock_timeout '5s'; SET LOCAL statement_timeout '60s'
    SELECT now(), pg_current_wal_lsn()            -- printed: the exact restore point (D4)
    SELECT … FOR UPDATE on H's households, profiles, sessions, supersets, entries, entry_sets,
           program_blocks, workouts, prescriptions, program_assignments and movements rows
    pre-flight (a)–(h), H-relative (athlete grain: step 5's two)   -- non-zero → throw, rolls back
    count every walked table (count()::int, never rowCount)
    DELETE … RETURNING id, in graph order
  COMMIT
```

**Why the parents are locked first.** At READ COMMITTED each statement sees newly committed rows, so a
straddling row written after the re-check would otherwise be deleted or nulled silently. `FOR UPDATE` on
a parent conflicts with the `KEY SHARE` lock that an inserting child row takes, so no new reference to
H's rows can land while the transaction is open. `workouts` and `prescriptions` are in the set because
of (f) and (g) below; `program_assignments` because of `program_assignment_weekdays`.

**The pre-flights, and which of them is the only guard.**

| Pre-flight (`runbooks.md`)                                  | If missed                                                  | Backstop                 |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| (a) `prescription_targets` straddling, both ways :1408      | the `AND` leaves it, then `23503`                          | FK abort                 |
| (b) an outside entry in H's session :1411                   | `23503` on `sessions`                                      | FK abort                 |
| (c) an outside entry in H's superset :1413                  | `23503` on `supersets`                                     | FK abort                 |
| (d) ¬H → H movement :1421                                   | `23503` on `movements`; refuse, point at the repoint :1510 | FK abort                 |
| (d) H → ¬H movement                                         | benign: passes                                             | —                        |
| (e) another household's workout copied from H's :1435       | **`SET NULL` silently**; H's text left on their row        | **none: the check only** |
| (f) another household's session naming H's workout :1447    | **`SET NULL` silently**; H's `workout_name` left           | **none: the check only** |
| (g) another household's entry naming H's prescription :1458 | **`SET NULL` silently**; H's snapshot left                 | **none: the check only** |
| (h) an assignment across households :1471                   | the `AND` leaves it, then `23503`                          | FK abort                 |

The first draft called the FK aborts "the real checks". **For (e), (f) and (g) there is no abort.** The
in-transaction re-check under the parent locks is what stops H's typed text surviving in another
family's rows, so P4 proves each of them refuses.

**One definition per pre-flight query.** Step 5 and FAM-1 4a already wrote these joins as verify
helpers, each proved to find a planted row: `crossHouseholdWorkoutCopies` (`verify/schema.ts:408`),
`assignmentsAcrossHouseholds` (`:2144`), `strayEntriesInAthletesSessions` (`:2290`),
`athleteRowsOnAnotherHouseholdsProgram` (`:2308`), `blocksOnlyThisAthleteWasOn` (`:2277`) and
`othersOnTheseBlocks` (`:2331`). PR 2a moves the ones the core uses into
`packages/db/src/queries/erasure-preflight.ts`, takes them from bigint ids to a scope, and points the
verify call sites at them. Mutations 201, 204, 205 and 206 patch those helpers in `verify/schema.ts`
today. They are regenerated against the new file in the same PR, with their `.expect` lines unchanged.

**Pre-flight (d) becomes household-relative.** A new `householdMovementCrossRefs(exec, scope)` in
`movement-ownership.ts` returns the two directions separately. The global census
(`crossHouseholdMovementRefs`, `:61`) stays a census.

**No lock between erasure and restore.** `OPS-2` withdrew `SEED_HOUSEHOLD_WRITE_LOCK` (its D6) and left
an erasure/restore lock to these two tracks. Both run as one operator's procedure, one transaction
each, with merges frozen. A restore and an erasure of the same household at once is an operator error
that a lock would turn into a wait, not prevent. **Rejected** as code for no failure the procedure
allows.

**The final "all zero" re-count is dropped.** It would reuse `rowsOf` and read zero by construction.
The checks that mean something are the pre-flights, the FK aborts, and the global `movements` count
staying above zero.

**Counts use drizzle `count()` or `::int`** (`movement-ownership.ts:67`). A raw `count(*)` comes back
from node-postgres as a string, and `'0'` would pass on PGlite but refuse on production.

### D4. What `erase-household` (PR 2b) enforces and prints

| Guard                                                                                       | After PR 2b                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolve by `public_id`                                                                      | `uuidSchema` (`@mat-plan/shared`). `liveHouseholdScope` gains `{ includeSoftDeleted: true }` (`registry.ts:80-87`), so there is no third lookup. A soft-deleted household is still erased                                                                                                                                                                                        |
| Right database                                                                              | Under `kind: 'erasure'` the runner **requires `DATABASE_URL_UNPOOLED`**, with no fallback (`target-url.ts:19-21` falls back today). It refuses if `hasHostOverride` (private at `db-environment.ts:96`; PR 2b exports it) is true, and **refuses `--apply` if `current_database()` names the preview** (`namesPreviewDatabase`, `:122`): the preview copy is reset, never erased |
| **Seed-id target (precondition 2)**                                                         | **Refuses** when the household's `public_id`, or any of its profiles' (hidden ones included), equals a committed seed constant from `@mat-plan/shared`: _"re-key first (`SEC-6`)"_. Under `OPS-2` Q2 (a) no production row should carry one by the time it is deleted, so this refusal is the mechanical form of that decision. It replaces the first draft's tombstone row      |
| Two targets in one environment                                                              | `erase-household` refuses if `ERASE_ATHLETE_PUBLIC_ID` is set                                                                                                                                                                                                                                                                                                                    |
| Pre-flight, lock, transaction                                                               | The core (D3)                                                                                                                                                                                                                                                                                                                                                                    |
| `OPS-3` rehearsed, the 7-day pause, re-confirmation, restore branch, Clerk deletion, ledger | **Prose, printed as a numbered checklist** by the dry run, not code (round 1, S1/S2). The restore branch is cut **at the printed LSN**, inside Neon's 6-hour window. Its name is neutral, with no id or date                                                                                                                                                                     |

**The output never names the target.** It says "the target household", never its `public_id`, and
never a person's name. Under `kind: 'erasure'` a refusal prints only its message and the constraint
name, never `err.stack` (`correct.ts:114`) or drizzle's `Failed query … params`, which carry the bound
id (rule 9). The step-0b Clerk ids are printed once, under a `PRIVILEGED — do not paste` heading.

**`kind: 'erasure'` gets its own three runner strings** (`correct.ts:63-103`), following the `kind:
'report'` precedent (`registry.ts:42-57`). Without them a not-found line under `--apply` would print
`✓ applied 1 change(s)`:

- dry run: "would erase";
- applied: "erased; now do the checklist";
- not found: "NOT FOUND — nothing erased (already erased, never here, or a mistyped id)", exit 0 on a
  dry run and **non-zero under `--apply`**, signalled by a typed `ErasureTargetNotFound`.

The runbook makes a production dry run that **finds** the household a precondition of `--apply`.

### D5. The Applied table and the rules

Unchanged. The entries are `erase-household` and `erase-athlete`, `issue: 'PRIV-3'`. README `:63-65`
gains a third Applied value, **`standing — never dated`**. Rule 6 gains "a standing entry is an
operation, not a record of a defect"; rule 8 the matching cross-reference. The `issue` docblock
(`registry.ts:41`) gains "or the row that owns a standing operation".

### D6. Seed ids: refused, re-keyed first (withdrawn: the tombstone)

The first draft answered `OPS-2`'s Q2 with scrubbed tombstones. Round 2 of `OPS-2`'s panel found that a
tombstone contradicts the notice's _"permanently removed from the database, not hidden"_
(`notice.md:275-276`) and that the first draft's scrub kept `birthdate`, `avatar`, `pin_hash`, `kind`
and timestamps. **The maintainer chose (a), re-key first** _(2026-11-16)_. So:

- no tombstone writer, no `isSeedTombstone`, no proof P8, and no notice or inventory change for one;
- a seed-id target is **refused** (D4); the operator re-keys through `SEC-6` first, and the family's
  rows are then hard-deleted like anyone's;
- old seed code run after such a deletion can at worst re-create **role-named fixture rows** under the
  seed ids, or throw. That is junk, not personal data, and `OPS-2` owns it (its D8 and D10).

`SEC-6`'s plan owes the answer to `ID-1`'s "a `public_id` is the athlete's for life", since a re-key
changes it once. That is not this plan's, but it is now on this plan's path.

### D7. The athlete erasure scripts step 5 (PR 3)

Step 5 (`runbooks.md:1757-1910`) decided who may ask and what the procedure is _(maintainer,
2026-11-16)_. PR 3 turns its SQL into the core at athlete grain and adds no policy:

- **The target:** `ERASE_HOUSEHOLD_PUBLIC_ID` **and** `ERASE_ATHLETE_PUBLIC_ID`, both by hidden prompt.
  The athlete must resolve inside that household with no `deleted_at` filter, or it refuses. This is
  step 2's "assert their household".
- **Who asked:** `ERASE_REQUESTER=owner|adult`, required. Under `adult` it **refuses unless the profile
  is `kind = 'adult'`** (step 2's assertion, now mechanical). The checklist prints the rule for that
  requester: the owner may cancel during the pause; for an adult, **the owner is told before anything
  happens and cannot cancel, only the adult can** (`runbooks.md:1767-1775`). The script cannot verify a
  person; the verified channel stays prose.
- **Pre-flights:** step 5's two, `strayEntriesInAthletesSessions` and
  `athleteRowsOnAnotherHouseholdsProgram`, from the shared module (D3).
- **The report:** the dry run prints `blocksOnlyThisAthleteWasOn` as `public_id`s under the privileged
  heading, for the household's keep-or-remove answer at the start of the pause.
- **The optional program removal (step 4b), Q6.** Recommended: `ERASE_REMOVE_BLOCKS`, a list of block
  `public_id`s. Inside the transaction, before the assignments go, the core re-runs the report and
  **refuses any listed block it no longer lists**, runs `othersOnTheseBlocks`, which must read 0, and
  after the profile deletes those blocks' rows in step 4b's sub-order (graph rows 8–12, 15, filtered to
  the blocks). The alternative leaves 4b as hand SQL, the unproven second path this row removes.
- **Seed ids:** a seed profile id is refused, as in D4.
- **Sign-in:** an athlete erasure deletes no membership (`household_members` has no profile link,
  `schema.ts:175-186`), as step 0 and the notice (`notice.md:261-273`) already say.

## File-by-file changes

Mutation numbers are taken from a block the FAM-1 board assigns (the highest in use is 207). `NN` below.

### PR 1: `db/priv-3-1-household-graph` (about 330 lines, no migration)

| Path                                                                             | Change | What and why                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/household-graph.ts`                                             | NEW    | `HOUSEHOLD_GRAPH`, `REFERENCE_TABLES`, `ATHLETE_GRAPH` (D2). The `athlete` parameter is used by verify's derived `eraseAthlete` from this PR |
| `packages/db/src/writers/ownership.ts`                                           | EDIT   | `householdRowIs`, `householdMemberInHousehold`                                                                                               |
| `packages/db/src/schema.ts`                                                      | EDIT   | Header pointer to the graph                                                                                                                  |
| `packages/db/scripts/verify/erasure.ts`                                          | NEW    | P1, P2, P7; registered with the harness like the other `verify/` modules                                                                     |
| `packages/db/scripts/verify/schema.ts`                                           | EDIT   | `ERASE_ATHLETE` (`:2218-2237`) becomes `ATHLETE_GRAPH`; `eraseAthlete`/`athleteCounts` generated from it. Step 5's assertions unchanged      |
| `packages/db/scripts/mutations/109-*.patch`                                      | EDIT   | Regenerated: it patches `ERASE_ATHLETE`'s `prescription_targets` scope, which moves. Same `.expect`                                          |
| `packages/db/scripts/mutations/NN-graph-forgets-a-table.*`                       | NEW    | Drops `day_readiness`: P1 red                                                                                                                |
| `packages/db/scripts/mutations/NN-graph-parent-first.*`                          | NEW    | Moves `entries` after `sessions`: P2 red                                                                                                     |
| `packages/db/scripts/mutations/NN-predicate-drops-household.*`                   | NEW    | Drops the household conjunct from one athlete-grain predicate: P7 red                                                                        |
| `packages/db/scripts/mutations/NN-pt-and-becomes-or.*`, `NN-pa-and-becomes-or.*` | NEW    | Widens 8 and 14 back to `OR`: P7's straddle rows matched twice, red                                                                          |
| `packages/db/scripts/mutations/README.md`                                        | EDIT   | The new rows; 109's file                                                                                                                     |
| `docs/runbooks.md`, `docs/privacy/data-inventory.md` §1                          | EDIT   | Pointers to the graph. `:1615`'s claim of a proof becomes true and cites P1/P2                                                               |
| changelog fragment                                                               | NEW    |                                                                                                                                              |

### PR 2a: `db/priv-3-2a-erase-core` (about 330 lines, more than half proofs)

| Path                                                              | Change | What and why                                                                                                                                                     |
| ----------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/erase-household.ts`                      | NEW    | The core (D3). Not in the barrel                                                                                                                                 |
| `packages/db/src/queries/erasure-preflight.ts`                    | NEW    | (a)–(h) and step 5's two, moved from `verify/schema.ts` (D3), scope-typed                                                                                        |
| `packages/db/src/queries/movement-ownership.ts`                   | EDIT   | `householdMovementCrossRefs(exec, scope)`                                                                                                                        |
| `packages/db/src/writers/household-scope-script.ts`               | EDIT   | "Who may call it" gains the core's caller and the `verify/` modules it misses                                                                                    |
| `packages/db/scripts/verify/erasure.ts`                           | EDIT   | P3–P5. A named-const scope for H (`ERASE_H_SCOPE`); no `MINTED_SCOPES` entry is required under `verify/` (`scope.test.ts:435-437`)                               |
| `packages/db/scripts/verify/schema.ts`                            | EDIT   | Call sites of the moved helpers point at the shared module                                                                                                       |
| `packages/db/scripts/verify.ts`                                   | EDIT   | **Proof (5) at `:7377-7420` is deleted**: P2 and P3 subsume it                                                                                                   |
| `packages/db/scripts/mutations/{201,204,205,206}-*.patch`         | EDIT   | Regenerated against `erasure-preflight.ts`; same `.expect`                                                                                                       |
| `packages/db/scripts/mutations/NN-erasure-respects-soft-delete.*` | NEW    | Adds `isNull(entries.deletedAt)`. The leftover row makes `profiles` abort, so P3 wraps the core in `assert.doesNotReject` and the `.expect` names that assertion |
| `packages/db/scripts/mutations/NN-erasure-skips-preflight-f.*`    | NEW    | Drops (f) from the core: P4's planted session is nulled, not refused, so P4 goes red. One mutation stands for the three `SET NULL` checks                        |

### PR 2b: `db/priv-3-2b-erase-household` (about 200 lines of code, plus the runbook rewrite)

| Path                                                                                     | Change | What and why                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/erasure.ts`                                             | NEW    | `erase-household` (D4)                                                                                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/correct.ts`                                                         | EDIT   | `kind: 'erasure'`: the three strings, the `DATABASE_URL_UNPOOLED` requirement, the redacted catch                                                                                                                                                                                                                                                           |
| `packages/db/scripts/corrections/registry.ts`                                            | EDIT   | The `kind` union; `liveHouseholdScope({ includeSoftDeleted })`; the entry; the claim docblock (`:697-705`) as an Amendment                                                                                                                                                                                                                                  |
| `packages/db/scripts/corrections/target-url.ts` + `.test.ts`                             | EDIT   | `correctionTargetHost()`, extracted from `correct.ts:47-53`. The pure gates (**seed id**, two targets, preview name, host override) are unit-tested here, following the `fixtureBindIsAllowed` idiom                                                                                                                                                        |
| `packages/shared/src/db-environment.ts`                                                  | EDIT   | Export `hasHostOverride`                                                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/mutations/NN-erasure-skips-hidden-household.*`                      | NEW    | Adds `isNull(households.deletedAt)` to the resolver: P5b red                                                                                                                                                                                                                                                                                                |
| `packages/db/scripts/corrections/README.md`                                              | EDIT   | Rule 8 and `:80-83` as an Amendment, conditional on Q1; the Applied definition and rows (D5)                                                                                                                                                                                                                                                                |
| `docs/runbooks.md`                                                                       | EDIT   | Household steps 2–5 become `read -rs` → dry run → read the output → `--apply`. **The hand-typed SQL is deleted.** Precondition 2 becomes "refused until `SEC-6` re-keys", unless `OPS-2` PR 1 has already rewritten it, in which case this PR edits that text. The ledger gains `grain`, the restore-point LSN and "mat-plan-preview: project reset (date)" |
| `docs/privacy/data-inventory.md` §8, `docs/plan.md`, `docs/milestones/beta-1.md:505-507` | EDIT   | The new ledger fields; the PRIV-3 row; a dated re-statement of "needs a flag"                                                                                                                                                                                                                                                                               |

### PR 3: `db/priv-3-3-erase-athlete` (about 180 lines; about 250 if Q6 says the removal is scripted)

| Path                                                         | Change | What and why                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/erasure.ts`                 | EDIT   | `erase-athlete` (D7)                                                                                                                                                                                                                                                                                                                            |
| `packages/db/src/writers/erase-household.ts`                 | EDIT   | `removeBlocks`, if Q6 says so                                                                                                                                                                                                                                                                                                                   |
| `packages/db/scripts/corrections/target-url.ts` + `.test.ts` | EDIT   | The requester gate (`adult` ⇒ `kind = 'adult'`) as a pure function, unit-tested                                                                                                                                                                                                                                                                 |
| `packages/db/scripts/verify/erasure.ts`                      | EDIT   | P6 (and P6b under Q6). A fresh named-const household scope, because P3 destroyed H                                                                                                                                                                                                                                                              |
| `docs/runbooks.md`                                           | EDIT   | "Erase one athlete" steps 2–4 (and 4b) become commands. **`runbookEraseAthleteLists` and mutation 200 pin step 4's table and step 3's count block**; those blocks go, so the pin is deleted with them, and mutation 200 is retired in the README, not left patching nothing. The proof that matters, the list itself against the catalog, stays |
| `docs/privacy/notice.md` + `pnpm privacy:generate`           | EDIT   | Only if it still says the athlete erasure is manual; the list of what remains is unchanged                                                                                                                                                                                                                                                      |

### PR 4: the purge window `N` (deferred section, re-panelled before it is built)

Unchanged from the first draft. **Gated on `V1-9b` B1-3**, carrying V1-9b's three requirements
(`v1-9b-delete-and-restore.md:260-275`); ADR 0008 `:63` and `:157` require it to set `N` **and** the
restore window together, with the notice change in the same PR.

**Proposed: `N` = 30 days. The maintainer decides (Q2).** It covers a parent's missed weekly review with
margin (ADR 0008's design case), matches the common "recently deleted" convention, and covers one export
month for the on-request full copy. 14 days leaves too little margin after one missed review; 7 is
rejected for the same reason; 90 or more keeps a child's deleted data for a quarter for little gain.

**Requirements fixed now:**

1. Restorable ⇔ `deleted_at > now() - N`, and purgeable is its exact complement, both on the
   **database's** `now()`.
2. Restore re-checks the boundary inside its own `UPDATE`, with a typed refusal.
3. The purge covers the entry grain and its children, plus orphaned `sessions` / `supersets`, and says
   whether soft-deleted `household_members` rows are purged. **A hidden profile or household is never
   purged**: removing one goes through this plan's core and its ledger. Hidden **program** rows
   (FAM-1's `deleted_at` on blocks, workouts and assignments) are added to this list when PR 4 is
   re-panelled.
4. The first run purges rows hidden before PRIV-3; its dry run counts them.
5. `OPS-3` re-applies the purge after a restore.

## Test plan

All proofs run in `db:verify` (PGlite, also in CI) and `pnpm db:mutations`. The gates are unit tests.

- **P1, partition (PR 1).** Over `information_schema.tables` (`public`, `BASE TABLE`): every table is in
  exactly one list; every list entry exists; every table with a `household_id` or `profile_id` column
  is in the graph.
- **P2, catalog closure, order and grain (PR 1).** For every `pg_constraint` with `contype = 'f'`,
  `workouts`' self-FK excepted: a parent in the graph implies a child in the graph at a **lower** index.
  The `grain: 'athlete'` set deep-equals `tablesReachableFromProfiles()`, and `ATHLETE_GRAPH`'s order
  deep-equals step 5's runbook table (the existing assertion, now fed by the graph).
- **P7, row partition (PR 1; asked by `OPS-3`).** On fixture households A and B through the existing
  `A_SCOPE`/`B_SCOPE` (read-only), with rows added so every graph table has rows in both:
  - every row is matched by **exactly one** of `rowsOf(A_SCOPE)`, `rowsOf(B_SCOPE)`, except a global
    `movements` row, matched by **neither**;
  - two straddle rows, a `prescription_targets` row (profile A, prescription B) and a
    `program_assignments` row (profile A, block B), are each matched by **zero**;
  - mutations: predicate-drops-household, pt-and-becomes-or, pa-and-becomes-or.
- **P3, behavioural (PR 2a).** H holds a row in **every** graph table, including a soft-deleted entry,
  profile, membership, block, workout and assignment; an owned movement; and a target and an
  assignment with both references inside H. K mirrors it. A guard asserts the fixture covers every
  graph entry. After the core: H's counts, as **deltas around the fixture inserts**, are zero; **K's
  id sets** are identical table by table; the reference tables and global movements are identical. A
  second run returns not-found.
- **P4, refusals roll back (PR 2a).** Each of (a), (b), (c), (d) ¬H→H, (e), (f), (g) and (h), planted
  alone, refuses with every id unchanged **and** the planted row's nullable pointer unchanged, which is
  the part that catches a `SET NULL`. (d) H→¬H does **not** refuse.
- **P5 (PR 2a).** The core, given a soft-deleted household's scope, erases it.
- **P5b (PR 2b).** `liveHouseholdScope({ includeSoftDeleted })` finds a soft-deleted household.
- **Gates (PR 2b, unit).** Seed id on the household or on any profile refuses; two targets refuse;
  preview name refuses `--apply`; host override refuses.
- **P6 (PR 3).** At athlete grain: a sibling athlete and K are untouched; H's program, movements,
  members and household row survive; the athlete's rows in every `ATHLETE_GRAPH` table are gone. **H's
  household id with K's athlete id refuses**; each of step 5's pre-flights refuses; `adult` on a child
  profile refuses. **P6b (Q6):** a listed block that is no longer only P's refuses; `othersOnTheseBlocks`
  non-zero refuses; otherwise the blocks' rows are gone and a sibling's sessions keep their
  `workout_id`.
- Run: `pnpm --filter @mat-plan/db db:verify && pnpm db:mutations && pnpm verify`.

**What none of this proves:** that production holds no pre-flight-shaped rows. The dry run measures that
when it runs.

## Risks / rollback

| Risk                                                                     | Mitigation                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| A predicate reaches another family's row                                 | `AND` on targets and assignments; parent rows locked before the re-check; P3 compares K's ids; P7                   |
| H's text survives in another family's rows through a `SET NULL` edge     | (e)–(g) re-run under the locks; P4 asserts the pointer is unchanged; a mutation drops (f)                           |
| The proved list and the scripted list drift                              | One list: `ERASE_ATHLETE` is derived from the graph; the pre-flight queries are shared                              |
| PGlite and node-postgres behave differently                              | `count()` / `::int`, never `rowCount`. P3 runs the core exactly as production does                                  |
| Wrong database                                                           | `DATABASE_URL_UNPOOLED` required, host override refused, preview refused by the name the server reports             |
| A typo'd id reads as success                                             | The not-found string names that possibility; a found production dry run is the runbook's precondition for `--apply` |
| The target id leaks into pasted output                                   | Never printed; the catch is redacted; Clerk ids and block ids only under the privileged heading                     |
| A seed-id household is erased before the re-key                          | Refused (D4); `SEC-6` re-keys first                                                                                 |
| A restore resurrects an erased athlete                                   | The ledger's `grain` and a replay at that grain (D2)                                                                |
| `verify.ts` keeps growing (9,869 lines; DX-12's trigger, `plan.md:2508`) | The proofs go in `verify/erasure.ts`; `verify.ts` only loses proof (5)                                              |
| A real erasure goes wrong                                                | The restore branch at the printed LSN, plus `OPS-3`. The `OPS-3` rehearsal stays a runbook precondition             |

**Rollback.** PRs 1 and 2a only add code and change no procedure. Reverting PR 2b or PR 3 brings back the
hand-SQL runbook section from git history. A wrong **run** is recovered from the restore branch, never
from git.

## Alternatives considered

- **A `--household` flag.** Not recommended (D1); it becomes PR 0 if Q1 says so.
- **A separate `db:erase` command.** It would duplicate the runner's dry-run, refusal and pool handling
  for one consumer. The `kind` discriminator is the precedent's answer.
- **The delete engine in `scripts/`.** Rejected (D3): the Beta 1 self-serve deletion would have to move
  it, and `scope.ts:67-70`'s promise would be rewritten.
- **Keep step 5's `ERASE_ATHLETE` in `verify/` and write a second list in `src/`.** Two lists, one
  proved; the drift this row exists to stop.
- **Derive the delete order from the catalog at run time.** A derived order cannot know how each table
  is scoped (targets, assignments, movements), and production would run an unreviewed sort. The catalog
  **proves** the list instead.
- **`ON DELETE CASCADE`.** A cascade reports nothing, and the counts are the proof.
- **`SERIALIZABLE` instead of `FOR UPDATE`.** It turns a concurrent app write into a serialization
  failure to retry. Explicit locks make the parents' writers wait.
- **Tombstones for seed ids** (the first draft's D6). Withdrawn by `OPS-2` Q2 (a): they contradict the
  notice, and the re-key removes the need.
- **Keep the hand SQL as a fallback.** That is the unproven second path.

## Out of scope / deferred

- Deleting Clerk accounts through the Backend API. Step 6 stays manual, with the ids printed.
- Automating pre-flight (d)'s repoint (`TEN-2c-1`), and the corrections that clear (e)–(h) rows.
- The self-serve deletion. It reuses the core; its UI, step-up and authority belong to its own row.
- `SEC-6`'s re-key and its answer to `ID-1`'s lifetime-identity item.
- **Flagged, not owned here:** the notice promises the 7-day pause but **no upper bound on how long a
  response takes**. That belongs to the `PRIV-1` sign-off pass.

## Open questions (maintainer)

Ids are kept from the first draft; answered ones stay listed.

1. **Q1. The target channel.** Recommendation: **the environment, read by a hidden prompt** (D1). The
   alternative is flags (PR 0).
2. **Q2. `N`.** Recommendation: **30 days**; the alternative is 14. It is set in PR 4.
3. **Q3. A household that leaves without asking.** Recommendation: **nothing automatic during the
   beta**. The notice already commits to asking once when the beta ends. Revisit before self-serve
   sign-up.
4. **Q4. Does PR 3 ship inside Beta 0?** **Answered: yes** _(maintainer, 2026-11-14)_; the notice
   promises it.
5. **Q5. How a seed id is deleted.** **Answered by `OPS-2` Q2 (a)** _(maintainer, 2026-11-16)_: re-key
   first, then an ordinary hard delete (D6).
6. **Q6. Does PR 3 script step 5's optional program removal (4b)?** Recommendation: **yes**, as
   `ERASE_REMOVE_BLOCKS` inside the same transaction (D7), about 70 more lines and one proof. The
   alternative keeps 4b as hand SQL inside an otherwise scripted erasure.

## Review-response log (adversarial panel)

### Round 2 (2026-11-17, the refresh)

_Pending: the panel runs on this text._

### Round 1 (2026-11-13, the first draft)

> Panel cost: correctness: 117.8k tokens · 220s; simplicity + reuse: 78.4k · 99s; architecture:
> 92.4k · 143s; privacy/security + DB-safety: 103.4k · 189s.

Eight BLOCKING, all resolved then. Lenses: C = correctness, S = simplicity/reuse, A = architecture, P =
privacy/DB-safety. Rows the refresh overtook are marked **(superseded 2026-11-17)** and kept.

| #   | Lens         | Critique                                                                                                                            | Verdict                              | Resolution                                                                                                                  |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| B1  | C            | The athlete erasure had no household conjunct; `rowsOfProfiles(SQL)` bypassed the capability                                        | **accepted**                         | One `rowsOf(scope, athlete?)` through `inHousehold`; PR 3 requires both ids; P6 adds a cross-household refusal              |
| B2  | C, P         | The `prescription_targets` `OR` deletes other families' rows; P3's fixture contradicted pre-flight (a); the re-check was not atomic | **accepted**                         | `AND`, fail closed; `FOR UPDATE` on the parents before the re-check. The refresh extends it to `program_assignments`        |
| B3  | A, C         | "No runner change" was false: `correct.ts` would print "✓ applied 1 change(s)" for not-found                                        | **accepted**                         | `kind: 'erasure'` with its own strings                                                                                      |
| B4  | A            | The `OPS_3_REHEARSED_ON` code gate was circular with `OPS-3`'s own drill                                                            | **accepted**                         | Gate removed                                                                                                                |
| B5  | A, P         | Athlete erasures were missing from the ledger and the replay                                                                        | **accepted**                         | Ledger `grain`; replay at that grain                                                                                        |
| B6  | A, C         | The `OPS-3` interface omitted global movements and identity columns                                                                 | **accepted**                         | A stated precondition; identity and collisions named as `OPS-3`'s                                                           |
| B7  | S, A         | `scope.test.ts`'s `MINTED_SCOPES` guard was in no file table                                                                        | **accepted** (superseded 2026-11-17) | Then: a `MINTED_SCOPES` entry. Now: the proofs live under `verify/`, where a named const suffices (`scope.test.ts:435-437`) |
| B8  | S            | PR 2 at "~400 lines" was not credible                                                                                               | **accepted**                         | Split into 2a and 2b                                                                                                        |
| S1  | S, P         | `ERASE_CONFIRMED_ON` and `ERASE_EXPECT_HOST` are theatre                                                                            | **accepted**                         | Cut; server-reported checks instead                                                                                         |
| S2  | P            | The `OPS-3` gate "is a real control"                                                                                                | **rejected**                         | A control that blocks the drill meant to satisfy it is worse than the ordering plus the checklist                           |
| S3  | S            | PR 3 should wait for demand                                                                                                         | **partly**                           | Kept; Q4 since answered "Beta 0"                                                                                            |
| S4  | S, A         | `N` and other out-of-scope content belong elsewhere                                                                                 | **partly**                           | PR 4's deferred section of this file                                                                                        |
| S5  | S            | Reuse the host parse, `uuidSchema`, the resolver and the fixture builders; delete proof (5)                                         | **accepted**                         | Done, with citations                                                                                                        |
| S6  | S            | P1 should source-scan the predicates for `deletedAt`                                                                                | **rejected**                         | A text scan is brittle; the mutation proves the behaviour                                                                   |
| A1  | A            | The delete engine belongs in `src/writers`, typed `OwnerScope`                                                                      | **accepted**                         | D3                                                                                                                          |
| A2  | A            | The barrel leaks the new `ownership.ts` leaves                                                                                      | **accepted, stated**                 | Harmless predicates; the graph and core stay out                                                                            |
| A3  | A            | The Applied, rule-6 and `issue` definitions need editing                                                                            | **accepted**                         | D5                                                                                                                          |
| A4  | A            | Amendment form for the README commitment and the plan.md reasoning                                                                  | **partly**                           | The README commitment gets one; the plan.md bullet is an in-place re-statement                                              |
| A5  | A            | `REFERENCE_TABLES` as strings; the `householdIs` name                                                                               | **accepted**                         | `PgTable[]`; `householdRowIs`                                                                                               |
| P1  | P            | The target id and parameters reach pasteable output                                                                                 | **accepted**                         | Never printed; redacted catch                                                                                               |
| P2  | P            | The shell-history residual is avoidable                                                                                             | **accepted**                         | `read -rs`, no `export`                                                                                                     |
| P3  | P            | A preview dry run is vacuous                                                                                                        | **accepted**                         | Project reset only; `--apply` refuses a preview database                                                                    |
| P4  | P            | Two targets in one environment                                                                                                      | **accepted**                         | Each refuses when the other's variable is set                                                                               |
| P5  | P            | Athlete-grain membership was unproven; an athlete deletion keeps the sign-in                                                        | **accepted**                         | P2's catalog rule; the notice says it since step 5                                                                          |
| P6  | P            | Make the restore point exact                                                                                                        | **accepted**                         | LSN and `now()` printed. ⚠️ If PGlite lacks `pg_current_wal_lsn()`, verify skips only that line                             |
| P7  | P, C         | Purge rules                                                                                                                         | **accepted**                         | PR 4 requirements 1–5                                                                                                       |
| C1  | C            | Pre-flight (d) over-refuses                                                                                                         | **accepted**                         | A household-relative helper; only ¬H→H refuses                                                                              |
| C2  | C            | Mutation fails on `23503`, not on an assertion                                                                                      | **accepted**                         | `assert.doesNotReject`                                                                                                      |
| C3  | C            | `count(*)` types differ by driver; the final re-count reads zero by construction                                                    | **accepted**                         | `count()` / `::int`; the re-count dropped. The refresh corrects "the FK aborts are the real check" for (e)–(g)              |
| C4  | C            | P3 should compare ids; P1/P2 edge cases; P4 lacked (c)                                                                              | **accepted**                         | Test plan                                                                                                                   |
| X1  | `OPS-3` plan | PR 1 should prove every row belongs to exactly one household                                                                        | **accepted**                         | P7; with `AND`, straddles match zero households                                                                             |
| X2  | `OPS-3` plan | Order: PR 1 → `OPS-3` restore → drill → PR 2                                                                                        | **accepted**                         | Header                                                                                                                      |
| X3  | `OPS-3` plan | Shared names and idioms                                                                                                             | **reconciled**                       | `rowsOf` kept; `OPS_3_REHEARSED_ON` and `ERASE_EXPECT_HOST` dropped                                                         |
| R1  | re-review    | An athlete erasure would also walk the household-grain tables                                                                       | **accepted**                         | D2 difference 4                                                                                                             |
| R2  | re-review    | P5 tested a resolver that only lands in PR 2b                                                                                       | **accepted**                         | P5 tests the core; P5b in PR 2b                                                                                             |
| R3  | re-review    | P6 needs a new minted scope                                                                                                         | **accepted** (superseded 2026-11-17) | A named const under `verify/`                                                                                               |
| R4  | re-review    | A not-found under `--apply` exited 0                                                                                                | **accepted**                         | `ErasureTargetNotFound`, non-zero                                                                                           |
| R5  | re-review    | `entries` was not locked                                                                                                            | **accepted**                         | In the `FOR UPDATE` set                                                                                                     |
| X4  | `OPS-2` plan | Q2: tombstone or hard delete for seed ids                                                                                           | **superseded 2026-11-17**            | Then: tombstones (D6). Now: `OPS-2` Q2 (a), re-key first; a seed-id target is refused                                       |
| X5  | `OPS-2` plan | Replace the seed refusal with M4                                                                                                    | **superseded 2026-11-17**            | The refusal returns, keyed to the re-key, not to the lift check                                                             |
| X6  | `OPS-2` plan | Take `SEED_HOUSEHOLD_WRITE_LOCK`                                                                                                    | **superseded 2026-11-17**            | `OPS-2` withdrew the lock                                                                                                   |
| X7  | own finding  | A seed-id restore hits its own tombstone                                                                                            | **superseded 2026-11-17**            | No tombstones                                                                                                               |
| X8  | `OPS-3` plan | Export `isSeedTombstone`                                                                                                            | **superseded 2026-11-17**            | No tombstones; passed back to `OPS-3`                                                                                       |
| N1  | P            | `N` = 30 collides with other 30-day numbers                                                                                         | **rejected**                         | Not shared with an operator procedure                                                                                       |
