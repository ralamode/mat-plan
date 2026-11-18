# PRIV-3: the household and athlete deletions as guarded scripts, with `db:verify` proofs

> Backlog: [plan.md](../plan.md) row `PRIV-3` (`docs/plan.md:2308-2342`). Milestone:
> [beta-1](../milestones/beta-1.md) → "the remaining path", item 8 (`beta-1.md:485`).
> PRs, by this plan's ids: **1** `db/priv-3-1-household-graph` · **2a** `db/priv-3-2a-erase-core` · **2b**
> `db/priv-3-2b-erase-household` · **3** `db/priv-3-3-erase-athlete` · **3b** (Q6)
> `db/priv-3-3b-remove-programs` · **4** the purge, a deferred section of this file. This plan PR is
> `docs/priv-3-plan` (plan only, no code).
>
> **Refreshed 2026-11-17** against `origin/main` `26fdb025`; every `file:line` was re-read there. The
> first draft (2026-11-13, `200a697`) predates FAM-1's five program tables, step 5's manual athlete
> erasure (#487), the `verify/` split and `OPS-2`'s decisions (draft #494). § "What changed" lists the
> differences; round 2 of the log records a six-lens panel on this text.

## Where this sits

Pillar **Privacy** (`PRIV-*`). Beta 0, remaining-path item 8: `PRIV-1`'s "deletion run once end to end"
box. This plan is the whole row; PR 4 waits on `V1-9b` B1-3.

**Order across the Beta 0 deletion tracks** _(re-ordered 2026-11-18: `OPS-3` moved to before the first invite, #628; the fresh start's chunks from the [CAT-3 spec](../specs/cat-3-movement-library.md))_. Gate 1
of `parallel-work.md` fails between them on `runbooks.md`, `verify.ts`, `mutations/`,
`corrections/registry.ts` and the privacy docs, so they run in order:

1. ✅ PRIV-3 PR 1 (the graph and its proofs, #520) and RC, `create-household` (#546);
2. `OPS-2` PR 1 (#592);
3. PRIV-3 PR 2a (the erasure core). It adds code only;
4. CAT-3 R0's code PR, the one-shot erasure of the seeded household, then, after CAT-3 A2, R1, the
   fresh start's runbook and step 5's correction ([plan](./priv-3-fresh-start-prep.md));
5. R2, the fresh start, on the maintainer's go;
6. PRIV-3 PR 2b (the household erasure), PR 3, then PR 3b, one at a time on `registry.ts`. (`OPS-2`
   PR 2, the fixture athlete, is retired: after R2 it has no target.)

`OPS-3`'s restore drill is not in this order: #628 moves it to before the first invite. It was never a gate on 2a, only a shared
file set, and the fresh start does not wait for it (K15).

**Against FAM-1** (in build). Three of PRIV-3's PRs touch files FAM-1 has assigned:

- **Lane A** owns `packages/db/scripts/verify/schema.ts` and `packages/db/src/writers/ownership.ts`
  (`docs/milestones/fam-1-family-program.md:8-11`), and has open work on them (#496, then its `VALIDATE` PR). PR 1
  edits both, PR 2a and PR 3 edit `verify/schema.ts`.
- `docs/features/write-path.md` owns `packages/db/src/writers/` and `scope.ts`, and FAM-1 makes that
  guide one queue (`docs/milestones/fam-1-family-program.md:4-6`).
- The privacy docs (`runbooks.md`, `data-inventory.md`, `notice.md`) are a FAM-1 seam.

So each of PRs 1, 2a, 2b and 3 enters those queues as a **guest**, as `OPS-2` and `SCALE-3` did, adds
its row to FAM-1's §6 seam table (`docs/plans/fam-1-family-program.md`), and the board orders it after lane A's `VALIDATE` PR. Keeping the
erasure's own code in its own directory with its own guide (D2) is what keeps the guest turns short:
only the `ownership.ts` leaves, the `household-scope-script.ts` caller list and `verify/schema.ts` are
shared.

**Separate from the PR order** _(amended 2026-11-18)_: the household that carries
`SEED_HOUSEHOLD_PUBLIC_ID` is erased by CAT-3 R0's one-shot entry at the fresh start (K7), with **no
`SEC-6` re-key first**, so `OPS-2` PR 2 and D10 have no target in production after R2 and are retired
([plan](./priv-3-fresh-start-prep.md)). PR 2b's seed-id refusal (D4) still stands for any later
deletion.

_Roadmap alignment (2026-11-17): advances `PRIV-3` (Beta 0, remaining-path item 8); consumes `OPS-2`'s
decisions Q2 (re-key first), Q4 and Q6; puts `SEC-6` on the path of the seed household's deletion;
scripts FAM-1 step 5's manual athlete erasure rather than designing a second one; checked against
`ID-1`'s six keep-open items (the table in round 2 of the log) and against the private roadmap;
nothing to add here._

## What changed since the first draft

| First draft (2026-11-13)                                       | Now                                                                                                                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14 tables; the order from `runbooks.md:1388-1403`              | **19 tables**; the order from step 4's table (`runbooks.md:1570-1590`)                                                                                           |
| One `OR` predicate made `AND`                                  | **Two:** `program_assignments` (step 4's 9d) gets the same `AND` (D2)                                                                                            |
| Pre-flights (a)–(d); "the FK aborts are the real check"        | **(a)–(h).** (e), (f) and (g) guard the only three `ON DELETE SET NULL` edges, which have **no** abort to fall back on; P2 now pins the set of such edges (D3)   |
| "No runbook describes the per-athlete deletion"                | Step 5 wrote one (`runbooks.md:1757-1910`) with a proven list. PR 1 makes that list a filter of the graph; PR 3 scripts the runbook (D7)                         |
| D6: seed ids become scrubbed tombstones                        | **Withdrawn.** `OPS-2` Q2 chose re-key first _(maintainer, 2026-11-16)_. The **live** seed household and its **live** seed profiles are refused instead (D4, D6) |
| The core takes `SEED_HOUSEHOLD_WRITE_LOCK`                     | **Withdrawn** with `OPS-2` D6. No erasure/restore lock; a merge freeze in the checklist instead (D3, D4)                                                         |
| Modules spread over `src/`, `writers/`, `queries/`, `scripts/` | One directory, `packages/db/src/erasure/`, with its own guide, `docs/features/erasure.md` (D2)                                                                   |
| Q4 (PR 3 in Beta 0) and Q5 (tombstone or hard delete) open     | Q4 answered: Beta 0 _(maintainer, 2026-11-14)_. Q5 answered by `OPS-2` Q2. **New:** Q6, a PR 3b that scripts step 5's optional program removal                   |

## Goal

Today a household deletion is a hand-typed procedure in [runbooks.md](../runbooks.md) → "Delete a
household and everyone in it (PRIV-1)" (`runbooks.md:1254-1756`): eight pre-flight queries and nineteen
DELETEs. The dry run, the check that the target is production, and the transaction all rely on the
operator's care. **Its order is proved by nothing.** The row (`plan.md:2316-2318`) and the runbook
(`:1615`) describe a `db:verify` proof of it that does not exist; only steps 13→14
(`verify.ts:7377-7420`) and 9a→9b (`verify/schema.ts:873`) are checked. The athlete erasure is better
off: step 5 proved its list against the catalog and pinned the runbook to it
(`verify/schema.ts:2419-2436`), but it is still typed by hand.

This plan does four things:

1. **One committed list of per-household tables**, `HOUSEHOLD_GRAPH`, with the athlete-grain tables
   marked. Both erasures and `OPS-3`'s restore read it, and `db:verify` proves it against the live
   catalog: its tables, their order, which of them hang off `profiles`, and which foreign keys into it
   do not abort. Step 5's list becomes a filter of it.
2. **A delete core typed `OwnerScope`.** It locks every parent row, re-runs every pre-flight inside
   the transaction, and deletes in graph order. Any surprise fails closed.
3. **`erase-household`**, a dry-run-first correction over the core. It refuses on every precondition
   it can check mechanically and prints the rest as a checklist.
4. **`erase-athlete`**, the same for step 5's procedure, at athlete grain.

## Acceptance

From the row, verbatim: _"Wraps runbooks.md's procedure so the dry run, the target-host print and the
one-transaction wrapper come from a runner rather than an operator's care … no household id may be
committed … The `db:verify` proof is the point, not the polish: it is the only thing that catches a
19th per-household table escaping the runbook's hand-maintained delete order."_ (There are 19 now; the
proof catches the 20th.)

Done when:

- **PR 1.** `db:verify` fails, and a committed mutation proves it can, when:
  - a `public` base table is in neither `HOUSEHOLD_GRAPH` nor `REFERENCE_TABLES`, or in both;
  - a foreign key points into the graph from outside it, or a child is listed after its parent;
  - the athlete-grain set differs from the tables reachable from `profiles` (step 5's existing
    assertion, now fed by the graph);
  - a foreign key into the graph whose delete rule is not `NO ACTION` is missing from a committed
    allowlist that maps each one to its pre-flight;
  - a row of household A is also matched by household B's predicates, or a planted row is matched by
    any household but its own (P7).
- **PR 2a.** `db:verify` runs the core on a fixture with a row in every graph table (hidden rows
  included) beside a second household K. Each graph table loses exactly H's rows; K's id sets, the
  reference tables and the global `movements` rows are unchanged. Each pre-flight (a)–(h) refuses,
  **naming itself**, and rolls back.
- **PR 2b.** `db:correct erase-household` reads its target through a hidden prompt into
  `ERASE_HOUSEHOLD_PUBLIC_ID`. Its dry run prints the per-table counts, the pre-flight results, the
  household's Clerk ids under a privileged heading (each marked if it holds a live membership
  elsewhere), and the checklist. It writes nothing and never prints the target id. With `--apply` it
  refuses unless every gate passes, then calls the core. The runbook's hand SQL for steps 2–5 is
  replaced by commands.
- **PR 3.** `erase-athlete` takes **both** a household id and an athlete id, refuses an athlete
  outside that household, and runs the core at athlete grain. Step 5's runbook SQL is replaced the
  same way.
- **Throughout.** Nothing in the repo ever holds a real household or profile `public_id`. The erasure
  entries' Applied cells read **"standing — never dated"**: with one or two households, a date alone
  identifies one.

## Retention items: what this plan covers

`plan.md:2329-2339` lists three items:

| Item                                                 | Where                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Hard delete on request, per athlete and household | PRs 2a/2b (household), PR 3 (athlete)                                                                                                                                                       |
| 2. The purge window `N`                              | **PR 4, a deferred section of this plan.** ADR 0008 sets `N` "in that row's plan". Built after `V1-9b` B1-3                                                                                 |
| 3. What a departed household's data becomes          | The ledger half is in PR 2b: a `grain` field, the preview reset, and the core as the replay `OPS-3` calls. The policy half (a household that leaves **without asking**) is open question Q3 |

The retention bullet's re-statement for ADR 0009 is unchanged from the first draft and is in this PR's
`plan.md` edit.

## Design decisions

### D1. The target arrives through the environment, read by a hidden prompt, not a flag (Q1)

Three places say the deletion needs a `--household` flag: the row (`plan.md:2311-2313`), README rule 8
(`corrections/README.md:34-44`) and `beta-1.md:505-507`. They predate `household-claim-2026-10-25`,
which takes its targets from the environment for reasons the maintainer recorded
(`registry.ts:697-705`), one being that _"a command line is broadly visible via `ps`, while its
environment is readable only by its owner"_. That matters more for the id of a family that has asked to
be erased.

- **The runbook reads each value with `read -rs`** and passes it inline, never `export`ed, then
  `unset`s it. Shell history holds only the variable names.
- **There is no argv change.** The runner changes only for output (D4).
- **The names are one `as const` map in the erasure module**, and differ from the claim's
  `HOUSEHOLD_PUBLIC_ID`, so a value left over from a claim never reaches an erasure.
- If Q1 says flags instead, that becomes a PR 0: `node:util` `parseArgs` in strict mode, declared
  `targets` per entry, and the claim converted at its call sites.

README `:80-83` commits _"PRIV-3 converts this entry to flags … so the repo does not keep two
operator-input channels"_. The goal, one channel, is met under the env answer; the means is not. PR 2b
replaces the commitment with a **dated Amendment block**.

### D2. One directory, one guide: `packages/db/src/erasure/`

```text
packages/db/src/erasure/
  graph.ts      HOUSEHOLD_GRAPH, REFERENCE_TABLES, ATHLETE_GRAPH, the FK delete-rule allowlist   (PR 1)
  preflight.ts  one join fragment per shape, exposed as a census and as (scope, athlete?)       (PR 2a, 3)
  erase.ts      the core                                                                          (PR 2a, 3)
docs/features/erasure.md   owns that directory and scripts/verify/erasure.ts                 (PR 1)
                           + scripts/corrections/erasure-gates.ts(+test), with the file        (PR 2b)
```

`check-feature-guides.mjs:74-94` charges a file to its most specific owner, so this guide, not
`write-path.md`, owns the erasure's own files. It carries the invariants that live between them: graph
order follows the FK catalog, the `AND` predicates, pre-flights under the parent locks, never a
`deleted_at` filter, and the `OPS-3` interface. Outside it stay only the two new `ownership.ts` leaves
(`scope.test.ts:64-65` makes that the one module allowed to unwrap a scope) and the registry entries
(D4). The directory is **not** re-exported from the barrel; the Beta 1 self-serve deletion will add a
named export the way `src/index.ts:6-19` does.

```ts
// graph.ts — shape, not final code.
export type HouseholdGraphTable = {
  table: PgTable & { id: PgColumn }; // name via getTableConfig(table).name, never re-typed
  grain: 'athlete' | 'household'; // GRAIN, one `as const` in this module
  /** The rows to erase. `athlete` (a profile public_id) narrows an athlete-grain table to one
   *  profile *inside* the scope. NEVER a `deleted_at` conjunct (corrections README rule 8). */
  householdRows: (scope: HouseholdScope, athlete?: string) => SQL;
};
export const HOUSEHOLD_GRAPH: readonly HouseholdGraphTable[]; // order = runbooks.md:1570-1590
export const REFERENCE_TABLES: readonly PgTable[];
export const ATHLETE_GRAPH = HOUSEHOLD_GRAPH.filter((t) => t.grain === GRAIN.athlete);
/** Every FK into the graph whose delete rule is not NO ACTION, and what makes it safe. */
export const NON_ABORTING_EDGES: readonly { fk: string; guard: 'cascade' | 'e' | 'f' | 'g' }[];
```

The predicate is named `householdRows`, not the first draft's `rowsOf`, which `verify/harness.ts:191`
already exports to every verify module (passed back to `OPS-3`, which cited `rowsOf`).

**The 19 entries, in order**, with the leaf each predicate is built from:

| #   | Table                               | Grain     | `householdRows(H)`                     | Leaf                                     |
| --- | ----------------------------------- | --------- | -------------------------------------- | ---------------------------------------- |
| 1   | `entry_set_quantities` :567         | athlete   | entry_set ∈ entry_sets of 3            | via 3                                    |
| 2   | `entry_sets` :493                   | athlete   | entry ∈ 3                              | via 3                                    |
| 3   | `entries` :324                      | athlete   | profile ∈ 17                           | `profilesIn`                             |
| 4   | `supersets` :957                    | athlete   | session ∈ 5                            | via 5                                    |
| 5   | `sessions` :861                     | athlete   | profile ∈ 17                           | `profilesIn`                             |
| 6   | `day_readiness` :1003               | athlete   | profile ∈ 17                           | `profilesIn`                             |
| 7   | `ramp_targets` :1034                | athlete   | profile ∈ 17                           | `profilesIn`                             |
| 8   | `prescription_targets` :1433        | athlete   | profile ∈ 17 **AND** prescription ∈ 10 | `profilesIn` + via 10                    |
| 9   | `prescription_quantities` :1379     | household | prescription ∈ 10                      | via 10                                   |
| 10  | `prescriptions` :1248               | household | block ∈ 15                             | `programBlockInHousehold` (`:284`)       |
| 11  | `block_day_workouts` :1182          | household | block ∈ 15                             | `programBlockInHousehold`                |
| 12  | `workouts` :1125                    | household | block ∈ 15                             | `programBlockInHousehold`                |
| 13  | `program_assignment_weekdays` :1564 | athlete   | assignment ∈ 14                        | via 14                                   |
| 14  | `program_assignments` :1511         | athlete   | profile ∈ 17 **AND** block ∈ 15        | `profilesIn` + `programBlockInHousehold` |
| 15  | `program_blocks` :1068              | household | `household_id` = H                     | `programBlockInHousehold`                |
| 16  | `movements` :763                    | household | `household_id` = H                     | `movementInHousehold` (`:231`)           |
| 17  | `profiles` :211                     | athlete   | `household_id` = H                     | `profilesIn`                             |
| 18  | `household_members` :175            | household | `household_id` = H                     | `householdMemberInHousehold` (new)       |
| 19  | `households` :123                   | household | `id` = H                               | `householdRowIs` (new)                   |

This is step 4's order renumbered (its 8a, 9, 9a–9d, 10–14). **Filtered to athlete grain it is exactly
step 5's `ERASE_ATHLETE`, in order** (`verify/schema.ts:2218-2237`; checked by hand, and confirmed by
the DB-safety and correctness lenses). Every athlete-grain predicate goes through one private
`profilesIn(scope, athlete?)` = `inHousehold(scope) [AND public_id = athlete]`, so a raw profile-id
subquery never escapes the capability.

⚠️ **The neighbouring leaves are traps:** `templateBlockIn` / `liveTemplateBlockIn` (`ownership.ts:561,
575`) miss legacy and hidden blocks, and `movementIsAvailableTo` (`:265`) is the `IS NULL OR` form
difference 3 forbids.

**Four deliberate differences from the runbook's text:**

1. **`prescription_targets` (8) is `profile ∈ H AND prescription ∈ H`, not `OR`.** `OR` could delete
   another family's row instead of hitting an FK abort. With `AND`, a straddling row is left behind and
   the `prescriptions` or `profiles` delete aborts with `23503`: fail closed.
2. **`program_assignments` (14) is `profile ∈ H AND block ∈ H`, not 9d's `OR`.** Same argument: a stray
   assignment of another family's child to H's block is left, and `program_blocks` aborts. Pre-flight
   (h) refuses it first.
3. **`movements` stays `= H`**, never `IS NULL OR` (`runbooks.md:1634`).
4. **With `athlete` set, the core walks only `ATHLETE_GRAPH`.** Household-grain predicates ignore
   `athlete`, so walking them would erase the whole household.

**PR 1 brings the runbook into line** so the text people type and the graph agree from that PR on:
step 4's rows 8 and 9d become `AND` (two lines), and `:1615`'s claim of a proof is corrected to cite
P1/P2 for the graph and say the runbook table is replaced in PR 2b. No pin is added for a table PR 2b
deletes.

**Step 5's list becomes a filter.** PR 1 replaces `ERASE_ATHLETE` (`verify/schema.ts:2218-2237`) with
`ATHLETE_GRAPH`. `eraseAthlete` and `athleteCounts` stay as **interim** verify helpers generated from
it, and are deleted in PR 3, when step 5's sibling proof runs through the core instead (P6). Two
details of step 5's fixture must change with it: its prescription is taken `ORDER BY id LIMIT 1` from
the whole table (`verify/schema.ts:2945-2949`) and must be pinned to household A's blocks, or the `AND`
leaves it; and its "no row remains" check counts with the eraser's own predicates (`:3094-3098`), so P6
measures by raw `profile_id` instead.

`OPS-2` D10 planned to move `ERASE_ATHLETE` into an importable module. **PR 1 is that module**, so
`OPS-2` PR 2 imports `ATHLETE_GRAPH`. Its "refuses if any count is non-zero" must skip the `profiles`
row, which is the target itself (passed back to `OPS-2`).

**The interface for `OPS-3`:**

- `HOUSEHOLD_GRAPH`, walked forward to extract and reversed to re-insert.
- The restore target must already hold `REFERENCE_TABLES` **and every `household_id IS NULL`
  `movements` row that H references**.
- **The ledger replay** re-runs the core at each ledger entry's `grain` before serving the data. An
  athlete entry records only the profile `public_id` (`runbooks.md:1908-1912`), so the replay resolves
  the household **from the restored profile row**. No ledger field is added, and nothing pins an
  athlete to a household.
- **`OPS-3`'s problems, not solved here:** identity columns (`OVERRIDING SYSTEM VALUE`), `public_id` and
  `client_id` collisions, re-applying the purge. The first draft's "a seed-id restore must replace its
  own tombstone" is **void**.

### D3. The core is `src/erasure/erase.ts`, typed `OwnerScope`

`scope.ts:67-70` promises that _"`PRIV-3`'s deletion inherit[s] the check by signature"_; the core keeps
it. The correction passes `ownerScope(householdScopeForScript(id))`, which returns `OwnerScope | null`
(`scope.ts:104`); `null` is a named refusal, never a crash. `household-scope-script.ts:25-31`'s caller
list gains the core and the `scripts/verify/*.ts` modules it already misses.

```text
eraseHousehold(exec, scope: OwnerScope, { athlete?, apply }) → ErasureReport
  BEGIN (one transaction, only when apply)
    SET LOCAL lock_timeout '5s'; SET LOCAL statement_timeout '60s'
    SELECT now(), pg_current_wal_lsn()      -- printed (D4); PGlite supports it (probed 2026-11-17)
    SELECT … FOR UPDATE on PARENT_TABLES' rows in the scope     -- derived, below
    pre-flights, H-relative (athlete grain: step 5's two)     -- non-zero → ErasurePreflightRefused
    count every walked table (count()::int, never rowCount)
    DELETE … RETURNING id, in graph order; each RETURNING length must equal its count
  COMMIT
```

**The lock set is derived, not listed.** `PARENT_TABLES` = every graph table that is the parent of a
foreign key (11 today: `households`, `profiles`, `sessions`, `supersets`, `entries`, `entry_sets`,
`program_blocks`, `workouts`, `prescriptions`, `program_assignments`, `movements`). P2 asserts the
derived set against the catalog, and a source pin asserts the mode is `FOR UPDATE`: `FOR NO KEY UPDATE`
does not conflict with the `KEY SHARE` an inserting child takes. At athlete grain the core locks the
same tables narrowed to P's rows (P's sessions, supersets, entries, assignments, profile) plus H's
`program_blocks` and `prescriptions` that P's rows reference. ⚠️ PGlite has one connection, so no proof
can show a concurrent insert waiting; the derivation and the pin are what is provable. A deadlock or
`lock_timeout` aborts the whole transaction, and the operator re-runs the dry run.

**Why the parents are locked first.** At READ COMMITTED each statement sees newly committed rows, so a
straddling row written after the re-check would otherwise be deleted or nulled silently. `FOR UPDATE` on
a parent conflicts with the `KEY SHARE` lock an inserting child takes, so no new reference to H's rows
lands while the transaction is open.

**The pre-flights, and which of them is the only guard.** Each refuses with a typed
`ErasurePreflightRefused { check, direction? }`, so P4 can tell a pre-flight from the FK backstop.

| Pre-flight (`runbooks.md`)                                  | If missed                                           | Backstop                 | Join today                                                      |
| ----------------------------------------------------------- | --------------------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| (a) `prescription_targets` straddling, both ways :1408      | the `AND` leaves it, then `23503`                   | FK abort                 | `athleteRowsOnAnotherHouseholdsProgram` (`vs:2308`), one arm    |
| (b) an outside entry in H's session :1411                   | `23503` on `sessions`                               | FK abort                 | `strayEntriesInAthletesSessions` (`vs:2290`)                    |
| (c) an outside entry in H's superset :1413                  | `23503` on `supersets`                              | FK abort                 | the same                                                        |
| (d) ¬H → H movement :1421                                   | `23503` on `movements`                              | FK abort                 | `crossHouseholdMovementRefs` (`movement-ownership.ts:61`)       |
| (d) H → ¬H movement                                         | benign: passes                                      | —                        | the same                                                        |
| (e) another household's workout copied from H's :1435       | **`SET NULL` silently**; H's text left on their row | **none: the check only** | `crossHouseholdWorkoutCopies` (`vs:408`)                        |
| (f) another household's session naming H's workout :1447    | **`SET NULL` silently**; H's `workout_name` left    | **none: the check only** | `sessionsOnForeignWorkouts` (`vs:1167`)                         |
| (g) another household's entry naming H's prescription :1458 | **`SET NULL` silently**; H's snapshot left          | **none: the check only** | `entriesOnForeignPrescriptions` (`vs:1178`)                     |
| (h) an assignment across households :1471                   | the `AND` leaves it, then `23503`                   | FK abort                 | `assignmentsAcrossHouseholds` (`vs:2144`); the other arm of (a) |

(`vs` = `scripts/verify/schema.ts`.) **For (e), (f) and (g) there is no abort**, which is the first
draft's error corrected: the in-transaction re-check under the parent locks is what stops H's typed
text surviving in another family's rows. The set of such edges is exactly three today
(`schema.ts:392-394`, `:892`, `:1136`); P2's allowlist makes a fourth a red build.

**One join per shape, two views of it.** The joins above already exist and are proved to find planted
rows. Several are **censuses** over the whole database whose call sites assert "none anywhere"
(`vs:795, 868, 2786, 2854, 2882`), and `verify/day.ts:36-43` imports (f) and (g). So `preflight.ts`
holds one SQL fragment per shape and exposes it twice: the unscoped census (verify's existing exports
re-export it, so `day.ts` is untouched) and a `(scope, athlete?)` check built from the same fragment
plus `profilesIn` or the household filter. At athlete grain (b)+(c) is step 5's pre-flight 1 and
(a)+(h) is its pre-flight 2, so the athlete erasure uses the same functions, not a second set. (d)
follows the same rule inside `movement-ownership.ts`, whose header calls a second copy of that join a
defect (`:19`). The household shapes move in PR 2a; step 5's athlete-only helpers
(`blocksOnlyThisAthleteWasOn`, `othersOnTheseBlocks`) move only when their consumer lands (PR 3b), with
mutations 204 and 206.

**On a (d) ¬H→H refusal**, the runbook's repoint (`:1510-1516`) used to run inside the delete
transaction. Under the core it is its own guarded transaction first, by hand until `TEN-2c-1`
automates it; then the dry run is re-run. The refusal message names that path.

**No lock between erasure and restore.** `OPS-2` withdrew `SEED_HOUSEHOLD_WRITE_LOCK` and left any
such lock to these two tracks. Both are one operator's procedure, one transaction each, and the D4
checklist freezes merges to `main` for the duration. A restore and an erasure of the same household at
once is an operator error a lock would turn into a wait, not prevent.

**Checks that read zero by construction are not checks.** The first draft's final re-count is dropped.
In its place: each `RETURNING` length equals its pre-delete count, and the count of
`household_id IS NULL` `movements` rows is unchanged.

**Counts use drizzle `count()` or `::int`** (`movement-ownership.ts:67`). A raw `count(*)` comes back
from node-postgres as a string, and `'0'` would pass on PGlite but refuse on production.

### D4. What `erase-household` (PR 2b) enforces and prints

The entry sits in `registry.ts` with the others (`CORRECTIONS`, `:818`); its `run` calls
`src/erasure/`. The pure gates live in `scripts/corrections/erasure-gates.ts` with a colocated test.

| Guard                          | After PR 2b                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolve by `public_id`         | `uuidSchema`, then an unfiltered `householdScopeByPublicId` (a hidden household is still erased). Not `requireLiveHouseholdScope`, whose error message carries the id (`registry.ts:96-102`)                                                                                                                                                                                                                                                                               |
| Right database                 | `correctionTargetUrl({ kind })` in `target-url.ts`, the one function that picks the database (`:4-18`), returns nothing under `kind: 'erasure'` without `DATABASE_URL_UNPOOLED`. The runner refuses on that, on `hasHostOverride` (`db-environment.ts:107`, exported by CAT-3 R0), and on `--apply` when `current_database()` names the preview (`namesPreviewDatabase`, `:122`). Messages use `DB_ENV_MESSAGE`'s builder (`:134`)                                         |
| **Seed id (precondition 2)**   | **Refuses** when the household's `public_id`, or a **live** profile's, is in `SEED_PUBLIC_IDS`: _"re-key first (`SEC-6`)"_. That is exactly `SEC-6`'s acceptance, "no committed constant equals a **live** production `public_id`" (`plan.md:1114-1116`). A hidden role-named fixture (`OPS-2` D10's) is erased like any row. The pure gate is unit-tested; a `db:verify` case proves the query feeding it                                                                 |
| Two targets in one environment | Refuses if `ERASE_ATHLETE_PUBLIC_ID` is set                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Pre-flight, lock, transaction  | The core (D3)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The rest                       | **A numbered checklist printed by the dry run**: `OPS-3` rehearsed, for an outside family only (Q7); **merges to `main` frozen and the last `migrate.yml` run green** (a merge mid-erasure would wedge its migration behind the row locks); the 7-day pause and re-confirmation; **a Neon restore branch cut immediately before `--apply`** (the printed LSN is extra precision: a missed branch can be cut at it within Neon's 6-hour window); Clerk deletion; the ledger |

`SEED_PUBLIC_IDS` is a set beside the constants in `packages/shared/src/seed-ids.ts` (✅ **created by RC**, #546, as CAT-3's R0 moved it; 2b reads it and does not add it), the pattern of
`MOVEMENT_SEED_PUBLIC_IDS` (`catalog-movements.ts:400-406`), with a `db:verify` assertion that every
household and profile row the seed writes is in it, so a fifth seed id cannot slip past. (A prefix test
was tried once and was wrong, `movement-ownership.ts:99-101`.)

**The Clerk ids.** `household_members` is unique on `clerk_user_id` only among live rows
(`schema.ts:190-195`), so one sign-in can be hidden in H and live in K (the "freed slot",
`runbooks.md:199-206`). Printing it for deletion would let the operator delete another household's
member. The dry run marks each id **yes/no: has a live membership elsewhere**, never which household,
and the checklist says not to delete those. Runbook step 0b has the same gap today; PR 2b fixes it
there too.

**The output never names the target**, nor a person. Drizzle 0.45.4's `DrizzleQueryError` puts the
bound parameters in its **message** (`Failed query: …\nparams: …`, `drizzle-orm/errors.js:10-13`), and
`correct.ts:107-114` prints `err.message`, `cause.message` and `err.stack`. So under `kind: 'erasure'`
the runner prints only an `ErasurePreflightRefused` or `ErasureTargetNotFound` (fixed text, the
pre-flight letter and a count) and, for anything else, only `cause.code` and `cause.constraint`. A unit
test feeds it a `DrizzleQueryError` whose params hold a UUID and asserts the output does not.

**Its own three runner strings** (`correct.ts:63-103`), following the `kind: 'report'` precedent
(`registry.ts:42-57`): dry run "would erase"; applied "erased; now do the checklist"; not found "NOT
FOUND — nothing erased (already erased, never here, or a mistyped id)", exit 0 on a dry run and
**non-zero under `--apply`**. The runbook makes a production dry run that **finds** the household a
precondition of `--apply`.

### D5. The Applied table and the rules

Unchanged. The entries are `erase-household` and `erase-athlete`, `issue: 'PRIV-3'`. README `:63-65`
gains a third Applied value, **`standing — never dated`**. Rule 6 gains "a standing entry is an
operation, not a record of a defect"; rule 8 the matching cross-reference; the `issue` docblock
(`registry.ts:41`) "or the row that owns a standing operation".

### D6. Seed ids: refused while live, re-keyed first (withdrawn: the tombstone)

`OPS-2`'s round-2 panel found that a tombstone contradicts the notice's _"permanently removed from the
database, not hidden"_ (`notice.md:275-276`), and that the first draft's scrub kept `birthdate`,
`avatar`, `pin_hash`, `kind` and timestamps. **The maintainer chose re-key first** _(2026-11-16)_. So:

- no tombstone writer, no `isSeedTombstone`, no proof P8, no notice or inventory change for one;
- a **live** seed-id target is refused (D4); `SEC-6` re-keys it first, and the family's rows are then
  hard-deleted like anyone's;
- old seed code run after such a deletion can at worst re-create role-named fixture rows under the seed
  ids, or throw: junk, not personal data, and `OPS-2`'s (its D8 and D10).

`SEC-6`'s plan owes `ID-1`'s "a `public_id` is the athlete's for life", for any re-key outside the fresh
start. _(Amended 2026-11-18.)_ At the fresh start no re-key runs; the seeded profiles' ids end once,
before any athlete identity is in use, and the starting athletes' notice sentence is changed by R2's
close-out ([plan](./priv-3-fresh-start-prep.md) D5), not by `SEC-6`.

### D7. The athlete erasure scripts step 5 (PR 3)

Step 5 (`runbooks.md:1757-1910`) decided who may ask and the procedure _(maintainer, 2026-11-16)_. PR 3
turns its SQL into the core at athlete grain and **adds and restates no policy**:

- **The target:** `ERASE_HOUSEHOLD_PUBLIC_ID` **and** `ERASE_ATHLETE_PUBLIC_ID`, both by hidden prompt.
  The athlete must resolve inside that household with no `deleted_at` filter, or it refuses: step 2's
  "assert their household".
- **Who asked:** `ERASE_REQUESTER`, whose values are `HOUSEHOLD_ROLE.owner` and `PROFILE_KIND.adult`.
  Under the adult value it **refuses unless the profile's `kind` is `PROFILE_KIND.adult`**, step 2's
  assertion made mechanical. Unlike the first draft's `ERASE_CONFIRMED_ON`, which round 1 cut as
  theatre, it is checked against the database, not against the operator's word. The checklist **does
  not paraphrase** "Who may ask": it prints the runbook section's heading, a named constant in the gates
  module with a unit assertion that `docs/runbooks.md` contains it, and the instruction to follow it
  there, so nothing the maintainer decided (the household may cancel; for an adult, the
  owner confirms which profile is theirs, is told first and cannot cancel; the adult's copy goes to the
  adult) is restated in a second place.
- **Pre-flights:** (b)+(c) and (a)+(h) at athlete grain, the same functions as D3.
- **The report:** the dry run prints the blocks only P was on as `public_id`s under the privileged
  heading, for the household's keep-or-remove answer at the start of the pause.
- **Seed ids:** only the **target profile's** `public_id` is checked. An athlete added through the app
  in the seed household is erasable today (`notice.md:272-273`, `runbooks.md:1782-1785`), and stays so.
- **Sign-in:** an athlete erasure deletes no membership (`household_members` has no profile link,
  `schema.ts:175-186`) and prints no Clerk id, as step 0 and the ledger (`:1908-1912`) already say.

**The optional program removal (step 4b) is PR 3b (Q6).** It runs as **its own guarded transaction
after the athlete erasure commits**, not inside it. The dry-run report cannot be recomputed after
the commit (P's assignments are gone), so what the correction checks is narrower and says so: each
listed block is **an H block with no assignment rows and no other references**; the others-check (`othersOnTheseBlocks`) loses its `profile_id <> P` arm. It walks graph rows 8–12 and 15
filtered to the listed blocks, under `FOR UPDATE` on those blocks, their workouts and their
prescriptions (`PARENT_TABLES` narrowed to the blocks, so the mode pin covers it), taken before the
re-checks with `SET LOCAL lock_timeout` and `statement_timeout`. It re-counts each to zero (the "removed, not hidden" proof for those
blocks), and reads `ERASE_REMOVE_BLOCKS` by hidden prompt. The core keeps two modes, and there is no
ordering trap before step 10. **Without 3b**, a household that answers "remove" means running the whole
athlete erasure by hand: 4b cannot follow a script that has already committed.

### D8. The fresh start's one-shot erasure (CAT-3 R0)

The seeded household is erased once, at the fresh start, by a dated entry with **no target**,
`erase-seeded-household-<date>`, through 2a's core. It refuses outside production and once the
household is gone, and its gate is pure and unit-tested. `erase-household`'s seed-id refusal (D4) and its
proof are **unchanged**: the one-shot entry does not call that gate, and no re-key runs first (K7
deletes the household, so a re-key would buy nothing). It redacts inside the entry, as RC's `create-household` does, adds no `kind` and leaves `correct.ts` untouched; 2b keeps `kind: 'erasure'` as planned here. **2b adopts RC's `corrections/redact.ts`** rather than writing its own (RC's plan). The design, its runbook (R1) and step 5's correction are in
[priv-3-fresh-start-prep.md](./priv-3-fresh-start-prep.md).

## File-by-file changes

Mutation numbers come from the block the FAM-1 board assigned to this track, **260–289** (2026-11-17),
taken in PR order. `verifyErasure` is a fifth module called **last** in `verify.ts:9864-9867` (**ruled 2026-11-17** by the roadmap thread, the harness owner since FAM-1 0c: one import and one
call, last, the block comment naming it; it deletes only its own fixture households or works inside
`rolledBack`; step 5's existing proofs are not moved out of `verify/schema.ts`; every edit to that file,
an `export` included, is lane A's to agree and the board's to order); last means step 5's assertions see an
athlete-grain defect first, so this plan's own mutations target household-grain tables and household
arms, and each `.expect` is confirmed by running `pnpm db:mutations` before it is committed.

### PR 1: `db/priv-3-1-household-graph` (about 420 lines, no migration)

| Path                                                                          | Change | What and why                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/erasure/graph.ts`                                            | NEW    | `HOUSEHOLD_GRAPH`, `REFERENCE_TABLES`, `ATHLETE_GRAPH`, `NON_ABORTING_EDGES`, `GRAIN` (D2)                                                                                    |
| `docs/features/erasure.md`                                                    | NEW    | The guide (D2)                                                                                                                                                                |
| `packages/db/src/writers/ownership.ts`                                        | EDIT   | `householdRowIs`, `householdMemberInHousehold`. Lane A's file, `write-path.md`'s guide                                                                                        |
| `docs/features/write-path.md`                                                 | EDIT   | The two leaves                                                                                                                                                                |
| `packages/db/scripts/verify/erasure.ts`                                       | NEW    | P1, P2, P7, and `populateEveryGraphTable(exec, scope)` with its coverage guard, reusing step 5's builders (`mkKid`, `mkAssignment`, `mkTemplateBlock`)                        |
| `packages/db/scripts/verify.ts`, `verify/harness.ts:235`, `src/scope.test.ts` | EDIT   | The fifth module call; the harness's "four modules" text; `'erasure'` added to `scope.test.ts`'s by-name module list                                                          |
| `packages/db/scripts/verify/schema.ts`                                        | EDIT   | `ERASE_ATHLETE` → `ATHLETE_GRAPH`; step 5's fixture prescription pinned to household A's blocks (D2). Lane A's file                                                           |
| `packages/db/scripts/mutations/109-*.patch`                                   | EDIT   | Regenerated against `graph.ts`; same `.expect`                                                                                                                                |
| `mutations/NN-graph-forgets-a-table.*`                                        | NEW    | Drops `block_day_workouts` (household grain): P1 red                                                                                                                          |
| `mutations/NN-graph-parent-first.*`                                           | NEW    | Moves `workouts` before `prescriptions`: P2 red                                                                                                                               |
| `mutations/NN-edge-not-allowlisted.*`                                         | NEW    | Removes `sessions.workout_id` from `NON_ABORTING_EDGES`: P2 red                                                                                                               |
| `mutations/NN-predicate-drops-household.*`                                    | NEW    | Drops the household conjunct from row 15's entry **in `graph.ts`** (never the shared `programBlockInHousehold`): P7 red                                                       |
| `mutations/NN-pa-and-becomes-or.*`                                            | NEW    | Widens row 14 to `OR` only when `athlete` is unset: P7's straddle red                                                                                                         |
| `mutations/NN-pt-and-becomes-or.*`                                            | NEW    | The same for row 8: P7's target straddle red (109 widens by prescription at athlete grain, a different defect)                                                                |
| `mutations/README.md`                                                         | EDIT   | The rows; 109's file                                                                                                                                                          |
| `docs/runbooks.md`                                                            | EDIT   | Step 4's rows 8 and 9d to `AND`; `:1615` corrected; a pointer to the graph                                                                                                    |
| `docs/privacy/data-inventory.md` §1                                           | EDIT   | §1a's per-column table **stays** (it is the notice's evidence); one line says P1 proves its table set against the graph; a dated re-read                                      |
| `docs/architecture.md`                                                        | EDIT   | A flowchart: graph → core (locks, pre-flights, deletes) → the two corrections → ledger → `OPS-3` replay, with the athlete-grain tables marked. Copied into the PR description |
| changelog fragment                                                            | NEW    |                                                                                                                                                                               |

### PR 2a: `db/priv-3-2a-erase-core` (about 330 lines, more than half proofs; household grain only)

| Path                                                | Change | What and why                                                                                                                                                                                   |
| --------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/erasure/erase.ts`                  | NEW    | The core at household grain (D3); the `athlete` option arrives in PR 3                                                                                                                         |
| `packages/db/src/erasure/preflight.ts`              | NEW    | The fragments for (a)–(h); censuses and `(scope)` checks (D3)                                                                                                                                  |
| `packages/db/src/queries/movement-ownership.ts`     | EDIT   | (d)'s household-relative view, from the existing join                                                                                                                                          |
| `packages/db/src/writers/household-scope-script.ts` | EDIT   | "Who may call it". `write-path.md`'s guide                                                                                                                                                     |
| `packages/db/scripts/verify/schema.ts`              | EDIT   | The census helpers re-export from `preflight.ts`; call sites and `day.ts` unchanged. Lane A's file                                                                                             |
| `packages/db/scripts/verify/erasure.ts`             | EDIT   | P3, P4, P5, on households built for each proof                                                                                                                                                 |
| `packages/db/scripts/verify.ts`                     | EDIT   | **Proof (5) at `:7377-7420` is deleted**: P2's allowlist (which names `household_members`' NO ACTION FK by omission) and P3 subsume it                                                         |
| `mutations/{201,205}-*.patch`                       | EDIT   | Regenerated against `preflight.ts`; same `.expect`                                                                                                                                             |
| `mutations/NN-erasure-respects-soft-delete.*`       | NEW    | Adds `isNull(entries.deletedAt)` in `erase.ts`'s walk, **only when `athlete` is unset**, so step 5 cannot see it once PR 3 routes through the core: P3 red (wrapped in `assert.doesNotReject`) |
| `mutations/NN-erasure-skips-preflight-{e,f,g}.*`    | NEW    | Three: each drops one `SET NULL` check, so P4's planted pointer is nulled, not refused                                                                                                         |
| `mutations/NN-erasure-skips-preflight-h.*`          | NEW    | Drops (h): the FK still aborts, but P4 asserts `check: 'h'`, so it goes red                                                                                                                    |
| `mutations/NN-households-row-filters-hidden.*`      | NEW    | Adds `isNull(households.deletedAt)` to row 19: P5, measured by raw id, red                                                                                                                     |
| `mutations/NN-lock-mode-weakens.*`                  | NEW    | `FOR UPDATE` → `FOR NO KEY UPDATE`: the source pin red                                                                                                                                         |

### PR 2b: `db/priv-3-2b-erase-household` (about 230 lines of code, plus the runbook rewrite)

| Path                                                                                  | Change | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/registry.ts`                                         | EDIT   | The `kind` union and the `erase-household` entry; `householdScopeByPublicId` is R0's (reused); the claim docblock (`:697-705`) as an Amendment                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/corrections/erasure-gates.ts` + `.test.ts`                       | EDIT   | R0 creates it; 2b adds the general seed-id gate, two targets and the redacted output                                                                                                                                                                                                                                                                                                                                                              |
| `packages/db/scripts/correct.ts`                                                      | EDIT   | `kind: 'erasure'`: the three strings and the redacted catch                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/scripts/corrections/target-url.ts` + `.test.ts`                          | EDIT   | `correctionTargetUrl({ kind })` and `targetIsLocalOrPreview()` are R0's (reused); `correctionTargetHost()` extracted from `correct.ts:47-53`                                                                                                                                                                                                                                                                                                      |
| `packages/shared/src/seed-ids.ts`                                                     | —      | Reads `SEED_PUBLIC_IDS` (RC created it, #546); no edit                                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/shared/src/db-environment.ts`                                               | —      | `hasHostOverride` is exported by R0; no edit                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/db/scripts/verify/erasure.ts`                                               | EDIT   | P5b; the seed-set assertion; the Clerk-id "live elsewhere" case                                                                                                                                                                                                                                                                                                                                                                                   |
| `mutations/NN-resolver-filters-hidden.*`, `NN-seed-query-drops-hidden-household.*`    | NEW    | P5b red; the seed query's `db:verify` case red                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/corrections/README.md`                                           | EDIT   | Rule 8 and `:80-83` as an Amendment, conditional on Q1; the Applied definition and rows (D5)                                                                                                                                                                                                                                                                                                                                                      |
| `docs/runbooks.md`                                                                    | EDIT   | Household steps 2–5 become `read -rs` → dry run → read the output → `--apply` → `unset`. **The hand SQL is deleted.** Step 0b gains the "live elsewhere" rule. Precondition 2 becomes "refused while live until `SEC-6` re-keys" (or edits `OPS-2` PR 1's rewrite of it). The (d) repoint becomes its own transaction. The ledger gains `grain`, the restore-point LSN, and "mat-plan-preview: database recreated (date)" (`runbooks.md:818-820`) |
| `docs/privacy/data-inventory.md`, `docs/plan.md`, `docs/milestones/beta-1.md:505-507` | EDIT   | §8's ledger fields; the step citations that pointed at the deleted SQL (`:35, 350, 363, 406, 410, 792`); the PRIV-3 row; a dated re-statement of "needs a flag"                                                                                                                                                                                                                                                                                   |

### PR 3: `db/priv-3-3-erase-athlete` (about 200 lines)

| Path                                                                                                                    | Change | What and why                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/erasure/erase.ts`, `preflight.ts`                                                                      | EDIT   | The `athlete` option; the `(scope, athlete?)` checks                                                                                                                                                                       |
| `packages/db/scripts/corrections/registry.ts`                                                                           | EDIT   | `erase-athlete` (D7)                                                                                                                                                                                                       |
| `packages/db/scripts/corrections/erasure-gates.ts` + test                                                               | EDIT   | The requester gate; the target-profile-only seed check                                                                                                                                                                     |
| `packages/db/scripts/verify/erasure.ts`                                                                                 | EDIT   | P6                                                                                                                                                                                                                         |
| `packages/db/scripts/verify/schema.ts`                                                                                  | EDIT   | `eraseAthlete`, `athleteCounts` and step 5's sibling proof (`:3041-3104`) deleted; the proof **moves** to `verify/erasure.ts` as part of P6, so it runs last. Step 5's catalog-completeness assertion stays. Lane A's file |
| `mutations/NN-athlete-walks-whole-graph.*`, `NN-athlete-resolver-drops-household.*`, `NN-requester-gate-ignores-kind.*` | NEW    | P6 red, each through its own typed refusal (`ErasureAthleteNotInHousehold` for the resolver, not the core's not-found)                                                                                                     |
| `mutations/200-runbook-order-drifts.{patch,expect}`                                                                     | DELETE | Its runbook table goes (next row); `runbookEraseAthleteLists` goes with it. The list's proof against the catalog stays                                                                                                     |
| `docs/runbooks.md`                                                                                                      | EDIT   | "Erase one athlete" steps 2–4 become commands; "Who may ask" is untouched                                                                                                                                                  |

### PR 3b (Q6): `db/priv-3-3b-remove-programs` (about 150 lines)

The program removal (D7): a correction, `blocksOnlyThisAthleteWasOn` and `othersOnTheseBlocks` moved
into `preflight.ts` with mutations 204 and 206 regenerated, proof P6b with one mutation, and runbook
step 4b replaced. An unlisted block's workouts and prescriptions keep the same id sets. A mutation
that drops the re-check's session arm turns P6b red.

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
   purged**: removing one goes through this plan's core and its ledger. FAM-1's hidden program rows are
   added to the list when PR 4 is re-panelled.
4. The first run purges rows hidden before PRIV-3; its dry run counts them.
5. `OPS-3` re-applies the purge after a restore.

## Test plan

All proofs run in `db:verify` (PGlite, also in CI) and `pnpm db:mutations`. Every destructive proof
builds its own households with `populateEveryGraphTable`, so no proof depends on another having run;
P3 and P6 commit (their erased households are gone, their K households stay, like any other fixture).

- **P1, partition (PR 1).** Over `information_schema.tables` (`public`, `BASE TABLE`): every table is in
  exactly one list; every entry exists; every table with a `household_id` or `profile_id` column is in
  the graph.
- **P2, catalog (PR 1).** Over `pg_constraint` (`contype = 'f'`), `workouts`' self-FK excepted:
  - a parent in the graph implies a child in the graph at a **lower** index;
  - the FKs into the graph with `confdeltype <> 'a'` deep-equal `NON_ABORTING_EDGES`;
  - `PARENT_TABLES` deep-equals the graph tables that are some FK's parent.

  The athlete-grain set against `tablesReachableFromProfiles` is **step 5's existing assertion**
  (`vs:2419-2423`), now fed by the graph; it is not repeated here.

- **P7, partition by household (PR 1; asked by `OPS-3`).** Inside `rolledBack`, because the database
  holds other households (`harness.ts:238-242`). Household B is given a row in every graph table:
  - **disjoint:** no row is matched by both `householdRows(A_SCOPE)` and `householdRows(B_SCOPE)`;
  - **planted coverage:** each planted row is matched by its own household's predicate only;
  - **straddles:** a `prescription_targets` row (profile A, prescription B) and a `program_assignments`
    row (profile A, block B, no weekdays) are matched by **neither**.

  "Matched by none" is P3's per-table zero-delta, not P7's.

- **P3, behavioural (PR 2a).** H holds a row in **every** graph table, hidden ones included (entry,
  profile, membership, block, workout, assignment), an owned movement, and a target and an assignment
  with both references inside H; K mirrors it. After the core: H's counts, as deltas around the
  fixture, are zero; **K's id sets** are identical table by table; the reference tables and the
  `household_id IS NULL` movements are identical. A second run is not-found. A variant plants a Clerk
  id hidden in H and live in K: the report marks it.
- **P4, refusals roll back (PR 2a).** Each of (a), (b), (c), (d) ¬H→H, (e), (f), (g) and (h), planted
  alone, refuses with `ErasurePreflightRefused` naming **that** check, with every id unchanged **and**
  the planted row's nullable pointer unchanged (what catches a `SET NULL`). (d) H→¬H does **not**
  refuse.
- **P5 (PR 2a).** The core, given a hidden household's scope, erases it; measured by raw id.
- **P5b (PR 2b).** `householdScopeByPublicId` finds a hidden household.
- **Seed (PR 2b).** Unit: a seed household id refuses; a live seed profile refuses; a **hidden** seed
  profile does not; at athlete grain, an app-added athlete in a seed household does not. `db:verify`:
  the query feeding the gate sees the household and its live profiles; the seed writes only ids in
  `SEED_PUBLIC_IDS`.
- **Output (PR 2b, unit).** A `DrizzleQueryError` with a UUID in its params prints no UUID; the
  not-found path exits non-zero under `--apply`.
- **P6 (PR 3).** At athlete grain, through the core: the athlete's rows in every `ATHLETE_GRAPH` table
  are gone, measured by raw `profile_id`; a sibling athlete and K are untouched; H's program, movements,
  members and household row survive. **H's household id with K's athlete id refuses with `ErasureAthleteNotInHousehold`**; each of the two
  athlete pre-flights refuses; the adult requester on a child profile refuses.
- Run: `pnpm --filter @mat-plan/db db:verify && pnpm db:mutations && pnpm verify`.

**What none of this proves:** that production holds no pre-flight-shaped rows (the dry run measures
that), and that a concurrent insert waits on the locks (PGlite has one connection).

## Risks / rollback

| Risk                                                                     | Mitigation                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| A predicate reaches another family's row                                 | `AND` on targets and assignments; parents locked before the re-check; P3 compares K's ids; P7                      |
| H's text survives in another family's rows through a `SET NULL` edge     | (e)–(g) re-run under the locks; P4 asserts the pointer; one mutation each; P2 makes a fourth such edge a red build |
| The proved list and the scripted list drift                              | One list; one join per pre-flight shape; step 5's helpers are interim and go in PR 3                               |
| A Clerk sign-in of another household is deleted                          | "Live elsewhere" marked; the checklist; P3's variant                                                               |
| The maintainer's household can never be erased                           | The refusal is the live set, the same set `SEC-6` re-keys; a hidden fixture is not refused                         |
| The target id leaks into pasted output                                   | Never printed; drizzle's message redacted, not only the stack; unit-tested                                         |
| A merge lands mid-erasure                                                | The checklist freezes merges and checks the last `migrate.yml` run                                                 |
| No restore point after an irreversible run                               | A branch cut before `--apply` is a checklist step; the LSN is the fallback inside 6 hours                          |
| PGlite and node-postgres behave differently                              | `count()` / `::int`; P3 runs the core as production does (`pg_current_wal_lsn()` works on PGlite)                  |
| `verify.ts` keeps growing (9,869 lines; DX-12's trigger, `plan.md:2508`) | Proofs in `verify/erasure.ts`; `verify.ts` loses proof (5)                                                         |
| A real erasure goes wrong                                                | The restore branch, plus `OPS-3` for an outside family (Q7)                                                        |

**Rollback.** PRs 1 and 2a add code and change no procedure beyond PR 1's two `AND`s. Reverting PR 2b
or PR 3 brings the hand-SQL section back from git history. A wrong **run** is recovered from the
restore branch, never from git.

## Alternatives considered

- **A `--household` flag.** Not recommended (D1); PR 0 if Q1 says so.
- **A separate `db:erase` command.** It would duplicate the runner's dry-run, refusal and pool handling
  for one consumer. The `kind` discriminator is the precedent's answer.
- **The core in `scripts/`.** The Beta 1 self-serve deletion would have to move it, and `scope.ts:67-70`
  would be rewritten.
- **The core under `src/writers/`** (the first draft). `write-path.md` would own it by prefix and its
  queue would carry every PRIV-3 PR; its own directory and guide do not.
- **Keep step 5's list in `verify/` and write a second in `src/`.** Two lists, one proved.
- **Scope the census helpers.** Their call sites assert "none anywhere"; a scoped form would weaken them.
- **Derive the delete order from the catalog at run time.** It cannot know how each table is scoped,
  and production would run an unreviewed sort. The catalog **proves** the list instead.
- **`ON DELETE CASCADE`.** It reports nothing; the counts are the proof.
- **`SERIALIZABLE` instead of `FOR UPDATE`.** It turns a concurrent app write into a retry. Explicit
  locks make the writers wait.
- **Refuse any profile carrying a seed id, hidden too** (this refresh's first text). No re-key reaches a
  hidden row, so the seed household could never be erased.
- **Tombstones for seed ids** (the first draft's D6). Withdrawn by `OPS-2` Q2.
- **The program removal inside the athlete transaction.** A third core mode and a step-10 ordering trap
  for an operation that is safe after commit (D7).
- **Keep the hand SQL as a fallback.** That is the unproven second path.

## Out of scope / deferred

- Deleting Clerk accounts through the Backend API. Step 6 stays manual, with the ids printed.
- Automating (d)'s repoint (`TEN-2c-1`), and the corrections that clear (e)–(h) rows.
- The self-serve deletion. It reuses the core; its UI, step-up and authority belong to its own row.
- `SEC-6`'s re-key, its `ID-1` answer and its notice edit.
- **Flagged, not owned here:**
  - the notice promises the 7-day pause but **no upper bound on how long a response takes**;
  - the notice says the original athletes cannot yet be erased but says nothing of the original
    household, which precondition 2 also blocks.

  Both belong to the `PRIV-1` sign-off pass.

## Maintainer decisions

All answered _(maintainer, 2026-11-17, relayed by the FAM-1 board)_ unless dated otherwise. Ids are
kept from the first draft.

1. **Q1. The target channel: the environment, read by a hidden prompt** (D1). No PR 0. PR 2b replaces
   README `:80-83`'s flag commitment with an Amendment, and re-states "needs a flag" in the row and
   `beta-1.md`.
2. **Q2. `N` = 30 days**, set in PR 4 with the restore window and the notice change.
3. **Q3. Nothing automatic during the beta** for a household that leaves without asking; the notice's
   ask-once-at-the-end stands. Revisit before self-serve sign-up.
4. **Q4. PR 3 ships in Beta 0** _(2026-11-14; confirmed 2026-11-17)_.
5. **Q5. Re-key first, then an ordinary hard delete** _(`OPS-2` Q2, 2026-11-16)_ (D6).
6. **Q6. Script the program removal as PR 3b** (D7).
7. **Q7. A deletion of the maintainer's own family's data does not wait for `OPS-3`'s drill**
   _(2026-11-18)_; the drill gates outside families only (#628).
8. **Q8. Removing one program, workout or item on request has no pause**; its restore branch is held 3
   days _(2026-11-18)_.
9. **Q9. An adult athlete on a removed program is told first, on their own channel, and cannot cancel**
   _(2026-11-18)_.
10. **Q10. A typed item a log still names is refused, and the household is told which athletes**
    _(2026-11-18)_.
11. **The principle, for every removal, in the runbook now and in the app later** _(2026-11-18,
    verbatim)_: _"we should not have one members change like this affect the others data in the long run
    - perhaps we could warn the adult/owner deleting that this may affect data and propose archiving or
      renaming it unless they are ok with changing the data and tell them who it affects. In the end, I
      would not want this to hurt eventual reporting"_. So: say who is affected, offer archive or rename
      first, remove only on explicit acceptance, and never delete or orphan another athlete's log rows.
      PR 3b's correction and any in-app removal are held to it.

**Board and harness, 2026-11-17.** The fifth module is ruled (above). Lane A has no open PR on its
two files, so PR 1 is cut now; whichever of it and lane A's `VALIDATE` PR merges second merges `main`.
Lane E's #505 goes first on `runbooks.md`. **Still open, lane A's:** the `verify/schema.ts` edits PR 1
asks for (D2: `ERASE_ATHLETE` derived in place, the fixture pin, three exports). If lane A declines the
derivation while its own PRs are open, the interim is two lists tied by a deep-equal in `verifyErasure`,
with its own mutation and a tech-debt entry to collapse them. **Open until PR 3, with lane A:** whether
step 5's sibling proof calls the core (2R5); it stays in `verify/schema.ts` either way.

## Review-response log (adversarial panel)

### Round 2 (2026-11-17, the refresh)

> Lenses: correctness, scope, architecture, reuse (the four standing), DB-safety, privacy. All on
> **Opus 5.5**, not Fable: the account's Fable spend limit applies until 2026-11-19 _(maintainer,
> 2026-11-16)_. The FAM-1 board asked for Fable after the reset on a plan this consequential; that
> re-run is offered, not done.
> Panel cost: correctness 154.5k · 9m28s; scope 100.0k · 3m42s; architecture 153.8k · 9m03s; reuse
> 158.6k · 7m14s; DB-safety 163.9k · 8m24s; privacy 130.8k · 6m26s.

Every finding was checked against the tree before its verdict. **Six BLOCKING (four distinct), all
resolved.** Ids: B = blocking, S = should, N = nit; lens letters C, Sc, A, R, D, P.

| #    | Lens(es)   | Critique                                                                                                                                                                           | Verdict                       | Resolution                                                                                                                                                                                                                         |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2B1  | P, A       | 🔴 The seed refusal counted **hidden** profiles; `SEC-6` re-keys only **live** rows and `OPS-2` D10 hides the fixture athlete, so the maintainer's household could never be erased | **accepted**                  | D4 refuses the household id and **live** profiles only, the same set as `SEC-6`'s acceptance; D7 checks only the target profile; unit cases for both; order pinned: `OPS-2` PR 2 applied, then the re-key                          |
| 2B2  | P          | 🔴 A Clerk id hidden in H can be live in K; the dry run would print it for deletion                                                                                                | **accepted**                  | "Live elsewhere: yes/no" beside each id; the checklist; P3's variant; runbook step 0b fixed in PR 2b                                                                                                                               |
| 2B3  | D, C       | 🔴 P7 read whole tables through `A_SCOPE`/`B_SCOPE` in a database that holds other households, so it is red on a clean tree                                                        | **accepted**                  | P7 is disjointness plus planted coverage, inside `rolledBack`; "matched by none" is P3's                                                                                                                                           |
| 2B4  | C, D, R    | 🔴 With `ERASE_ATHLETE` derived from the graph, step 5's assertions (run first) catch every athlete-grain mutation, so four new `.expect`s would name the wrong proof              | **accepted**                  | Mutations target household-grain tables and arms; the `OR` patch widens only with `athlete` unset; both `OR` patches widen with `athlete` unset; P2's grain clause dropped (step 5's is the one); each `.expect` run before commit |
| 2B5  | A          | 🔴 Lane A owns `verify/schema.ts` and `ownership.ts`; `write-path.md` owns `writers/`; the privacy docs are a FAM-1 seam. No queue was named                                       | **accepted**                  | § Where this sits: a guest in each queue, a seam-table row, after lane A's `VALIDATE` PR; `write-path.md` in the file tables; the `schema.ts` header pointer dropped                                                               |
| 2S1  | A          | The erasure is a feature: files in five places, owned by no guide or by `write-path.md` by accident                                                                                | **accepted**                  | `src/erasure/` and `docs/features/erasure.md` (D2)                                                                                                                                                                                 |
| 2S2  | Sc         | PR 2a shipped an athlete path and four mutation regenerations that nothing tested until PR 3                                                                                       | **accepted**                  | 2a is household grain only; the athlete option and step 5's helpers move with their proofs                                                                                                                                         |
| 2S3  | Sc         | Q6's alternative was misstated, its size understated, and its in-transaction form adds a mode and an ordering trap                                                                 | **accepted**                  | PR 3b, a separate transaction after commit; the alternative restated; ~150 lines with a mutation                                                                                                                                   |
| 2S4  | Sc         | PR numbering disagreed across the plan, `plan.md` and the fragment; the breakdown was written three times                                                                          | **accepted**                  | The plan's ids everywhere; the row gets one sentence and the link                                                                                                                                                                  |
| 2S5  | Sc         | `beta-1.md` row 8 still read "2 PRs, M + S"; `SEC-6` absent from the table                                                                                                         | **accepted**                  | Row 8 updated in this PR, with `SEC-6` as a dependency of the end-to-end run on the seed household                                                                                                                                 |
| 2S6  | Sc, R      | Three proofs each built "a row in every table"; P6 depended on P3 destroying H                                                                                                     | **accepted**                  | `populateEveryGraphTable`, reusing step 5's builders; each proof builds its own households                                                                                                                                         |
| 2S7  | R, A, C, D | (f) and (g) already have detectors; the two census helpers cannot be scoped without weakening their proofs; (d)'s new view would be a second copy                                  | **accepted**                  | One fragment per shape, census and scoped views; the pre-flight table names each existing join; (d) built inside `movement-ownership.ts`                                                                                           |
| 2S8  | R          | Household and athlete pre-flights are the same shapes twice                                                                                                                        | **accepted**                  | `(scope, athlete?)` on the same functions                                                                                                                                                                                          |
| 2S9  | R, C, D    | No list of seed ids; the gate's database half untested                                                                                                                             | **accepted**                  | `SEED_PUBLIC_IDS` with a seed-writes-only-these assertion; a `db:verify` case and a mutation                                                                                                                                       |
| 2S10 | R          | `eraseAthlete`/`athleteCounts` stay as a second walker                                                                                                                             | **accepted**                  | Interim; deleted in PR 3 when step 5's proof calls the core                                                                                                                                                                        |
| 2S11 | R          | Between PR 1 and PR 2b the runbook's `OR` and the graph's `AND` disagree                                                                                                           | **accepted**                  | PR 1 edits the two runbook lines; no pin for a table PR 2b deletes                                                                                                                                                                 |
| 2S12 | R, A       | The no-fallback URL rule in `correct.ts` is a second resolver; non-URL gates in `target-url.ts`                                                                                    | **accepted**                  | `correctionTargetUrl({ kind })`; gates in `erasure-gates.ts`                                                                                                                                                                       |
| 2S13 | R          | Name the leaves the predicates use, and the traps beside them                                                                                                                      | **accepted**                  | A leaf column in D2's table; the traps named                                                                                                                                                                                       |
| 2S14 | D          | The catalog proved the tables, not the delete rules (e)–(g) rely on; deleting proof (5) lost the one FK-rule proof                                                                 | **accepted**                  | `NON_ABORTING_EDGES` and P2's clause, with a mutation                                                                                                                                                                              |
| 2S15 | D          | Nothing proved the lock set; athlete-grain locks unstated                                                                                                                          | **accepted, partly provable** | `PARENT_TABLES` derived and asserted; a source pin on the mode, with a mutation; athlete-grain set written. Contention itself is unprovable on PGlite, stated                                                                      |
| 2S16 | D          | Rejecting a lock rested on a merge freeze no procedure states                                                                                                                      | **accepted**                  | A checklist item, with the reason (a merge's migration wedges behind the row locks)                                                                                                                                                |
| 2S17 | D, P       | The restore branch moved from "before" to "after, from the LSN, within 6 hours"                                                                                                    | **accepted**                  | Cut before `--apply`; the LSN is the fallback                                                                                                                                                                                      |
| 2S18 | D          | (d)'s repoint no longer fits the delete transaction                                                                                                                                | **accepted**                  | Its own guarded transaction, then a fresh dry run; the refusal names it                                                                                                                                                            |
| 2S19 | C          | (e) and (g) had no mutation                                                                                                                                                        | **accepted**                  | One each                                                                                                                                                                                                                           |
| 2S20 | C          | P4 could not tell a pre-flight from the FK backstop for (a)–(d), (h)                                                                                                               | **accepted**                  | `ErasurePreflightRefused { check }`; a mutation dropping (h)                                                                                                                                                                       |
| 2S21 | C          | PR 3 and P5 had no mutations                                                                                                                                                       | **accepted**                  | Three for PR 3, one for P5 (measured by raw id)                                                                                                                                                                                    |
| 2S22 | P, A       | "Prints only its message" prints drizzle's bound params                                                                                                                            | **accepted**                  | Typed refusals with fixed text; otherwise code and constraint only; a unit test                                                                                                                                                    |
| 2S23 | P          | An athlete in the seed household would be refused, contradicting the notice                                                                                                        | **accepted**                  | Merged into 2B1: target profile only                                                                                                                                                                                               |
| 2S24 | P          | D7 paraphrased step 5's rule and dropped parts of it ("the household may cancel"; the owner confirms which profile; the adult's copy)                                              | **accepted**                  | The checklist points at "Who may ask" instead of restating it                                                                                                                                                                      |
| 2S25 | P, A       | The `ID-1` table the alignment line cites did not exist                                                                                                                            | **accepted**                  | Below                                                                                                                                                                                                                              |
| 2S26 | P          | The athlete replay could not find its household from the ledger                                                                                                                    | **accepted**                  | It resolves from the restored profile row; no new ledger field                                                                                                                                                                     |
| 2S27 | P          | Turning inventory §1 into a pointer would delete the notice's evidence; step citations would dangle                                                                                | **accepted**                  | §1a stays with a P1 line; citations re-pointed in PR 2b                                                                                                                                                                            |
| 2S28 | A          | `corrections/erasure.ts` would import `registry.ts`'s private resolvers                                                                                                            | **accepted**                  | Entries stay in `registry.ts`; logic in `src/erasure/`                                                                                                                                                                             |
| 2S29 | A          | No architecture diagram for a new subsystem                                                                                                                                        | **accepted**                  | `architecture.md` flowchart in PR 1                                                                                                                                                                                                |
| 2S30 | A          | `kind` gate belongs in `@mat-plan/shared` beside `readsHouseholdProgram`                                                                                                           | **rejected**                  | One consumer, an operator tool in `scripts/`, not an app authority; it uses `PROFILE_KIND.adult` and is recorded in the `ID-1` table as a reader the policy module must absorb                                                     |
| 2N1  | Sc         | `ERASE_REQUESTER` is a typed value like the cut `ERASE_CONFIRMED_ON`                                                                                                               | **rejected, justified**       | It is checked against the database, not the operator's word (D7)                                                                                                                                                                   |
| 2N2  | Sc, A      | `includeSoftDeleted` contradicts `liveHouseholdScope`'s name; P5 proves a state nothing writes                                                                                     | **partly**                    | `householdScopeByPublicId`; P5 kept (a cheap guard against a future writer), measured by raw id                                                                                                                                    |
| 2N3  | Sc         | Cut the "What changed" table                                                                                                                                                       | **rejected**                  | Lane C and `OPS-3` reconcile against it; it is seven rows                                                                                                                                                                          |
| 2N4  | Sc         | The host-override refusal is redundant                                                                                                                                             | **rejected**                  | An existing helper; one line; it stops a URL that names production but resolves elsewhere                                                                                                                                          |
| 2N5  | R          | `rowsOf` clashes with `harness.ts:191`; `ProfilePublicId` does not exist; env names, grain and requester values as consts                                                          | **accepted**                  | `householdRows`; `string`; one `as const` each. Passed back to `OPS-3`                                                                                                                                                             |
| 2N6  | C, D       | Step 5's fixture prescription is unpinned; its "no row remains" reads zero by construction; count vs `RETURNING`; global movements unchanged                                       | **accepted**                  | All four in D2, D3 and P6                                                                                                                                                                                                          |
| 2N7  | C          | Retiring mutation 200 must delete its files                                                                                                                                        | **accepted**                  | PR 3 table                                                                                                                                                                                                                         |
| 2N8  | P, D       | `ERASE_REMOVE_BLOCKS` channel; `unset`; 4b's re-count; "project reset" is "database recreated"                                                                                     | **accepted**                  | D1, D7, PR 2b                                                                                                                                                                                                                      |
| 2N9  | A          | `ownerScope` returns `null`; 2a's wait on the drill unexplained; a later barrel export                                                                                             | **accepted**                  | D3; § Where this sits; D2                                                                                                                                                                                                          |
| 2X1  | probe      | Does PGlite support `pg_current_wal_lsn()`?                                                                                                                                        | **settled**                   | Yes (`0/16EF9D0`, 2026-11-17). No verify-only skip; round 1's P6 caveat is void                                                                                                                                                    |

**Re-review** (one light pass per lens that raised a BLOCKING, same agents, on `2b0d4d4f`). Every
earlier finding was confirmed resolved; no BLOCKING. New, all **accepted**:

| #   | Lens | Critique                                                                                                                       | Resolution                                                                                                                            |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 2R1 | A    | The guide would own `erasure-gates.ts` in PR 1, before the file exists, failing `guides:check`                                 | The entry arrives with the file in PR 2b                                                                                              |
| 2R2 | A    | The fifth module call is "the board's call" but unanswered; `scope.test.ts`'s by-name list; the seam-table file and full paths | Marked waiting on the board, recorded before PR 1 merges; `scope.test.ts` in PR 1; full paths                                         |
| 2R3 | P    | D7's pointer to "Who may ask" is unpinned, and PR 3 removes the only pin on that section                                       | The heading is a named constant with an assertion that the runbook contains it                                                        |
| 2R4 | D    | PR 3b deletes behind three `SET NULL` edges with no stated lock set; "re-checks the report" overclaims                         | `FOR UPDATE` on the listed blocks, workouts and prescriptions before the re-checks, with timeouts; the check restated; a P6b mutation |
| 2R5 | C    | Routing step 5's sibling proof through the core from `verify/schema.ts` (runs first) brings 2B4 back in PR 3                   | That proof moves into `verify/erasure.ts` as part of P6; the soft-delete patch applies only with `athlete` unset                      |
| 2R6 | C    | P7's target straddle had no mutation; 109 is a different widening                                                              | `pt-and-becomes-or`, household arm only                                                                                               |
| 2R7 | C    | Two mutations lacked a target precise enough to fail as claimed                                                                | Row 15's entry in `graph.ts`; a typed `ErasureAthleteNotInHousehold` for P6                                                           |

**Passed back.**

- **To `OPS-2`:** PR 2 imports `ATHLETE_GRAPH`, and its count must skip the target's own `profiles`
  row.
- **To `OPS-3`:**
  - the shared predicate is `householdRows`, not `rowsOf`;
  - there are no tombstones;
  - the athlete replay resolves its household from the restored profile row.
- **To `SEC-6`:**
  - it runs after `OPS-2` PR 2 is applied;
  - it owns the notice's "cannot yet" sentence.
- **To the FAM-1 board:** a fifth `verify` module call (an answer owed before PR 1 merges); guest turns for lane A, `write-path.md` and the
  privacy docs.

**`ID-1`'s six keep-open items** (`plan.md:1341-1370`):

| #   | Item                                                          | This plan                                                                                                                                                                                           |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The principal is a login, never a profile                     | Not touched: an operator script, no session                                                                                                                                                         |
| 2   | Every access decision goes through `getHouseholdScope()`      | Not touched in the app. The script mints its scope through `householdScopeForScript`, the sanctioned script path, and the core takes `OwnerScope`                                                   |
| 3   | "Two memberships throws" is Beta 0's invariant, not the model | **Answered:** the Clerk-id report does not assume one household per person; it marks an id live in another household and the checklist keeps it (2B2)                                               |
| 4   | Nothing pins an athlete to a household                        | **Answered:** no new key, index or ledger field on `(household, profile)`; the replay resolves the household from the profile row (2S26)                                                            |
| 5   | No age-based permission logic; `birthdate` is `ID-1`'s        | **Answered:** the requester gate reads `profiles.kind`, never `birthdate`, applies the maintainer's 2026-11-16 decision, and lives in `scripts/`. It is a reader `ID-1`'s policy module must absorb |
| 6   | Household roles stay a shared const plus a CHECK              | Not touched: the requester values come from `HOUSEHOLD_ROLE` and `PROFILE_KIND`                                                                                                                     |

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
