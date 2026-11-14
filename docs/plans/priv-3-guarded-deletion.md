# PRIV-3: the household deletion as a guarded script, with a `db:verify` proof

> Backlog: [plan.md](../plan.md) row `PRIV-3` (`docs/plan.md:2050-2084`). Milestone:
> [beta-1](../milestones/beta-1.md) → "the remaining path", item 8 (`beta-1.md:465`).
> Branches: `db/priv-3-1-household-graph`, `db/priv-3-2a-erase-core`, `db/priv-3-2b-erase-household`
> and `db/priv-3-3-erase-athlete`. PR 4 (the purge) is a deferred section of this file. This plan PR is
> `docs/plan-priv-3` (plan only, no code). Every `file:line` was read on `origin/main` at `200a697`
> (2026-11-13). **Revised after a four-lens panel**; the log at the end records what changed.
>
> **Order, agreed with [`OPS-3`'s plan](./ops-3-restore-one-household.md)**, which consumes this
> plan's `household-graph.ts` and does not define its own:
>
> 1. PRIV-3 PR 1 (the graph and its proofs);
> 2. the `OPS-3` restore PR, and `OPS-2` PR 1b, which must land before PR 2b;
> 3. the `OPS-3` drill;
> 4. PRIV-3 PR 2a, then PR 2b (the erasure);
> 5. PR 3.
>
> The parallel-work rubric's gate 1 fails for these two tracks, because they share `runbooks.md`,
> `verify.ts` and `mutations/`. So they run as an order, not concurrently, and the order also makes
> the `OPS-3` rehearsal precede any real erasure.

## Goal

Today a household deletion is fourteen hand-typed SQL statements in
[runbooks.md](../runbooks.md) → "Delete a household and everyone in it (PRIV-1)"
(`runbooks.md:1140-1551`). The dry run, the check that the target is production, and the transaction
all rely on the operator being careful. The delete order is maintained by hand, and it has already
missed a table once: `household_members` would have aborted the transaction (`plan.md:2945-2949`).

This plan does four things:

1. **One committed list of per-household tables.** Both the deletion and `OPS-3`'s per-household
   restore use it. `db:verify` proves the list against the live catalog, so a new table that holds a
   household's data turns the build red until someone classifies it.
2. **A delete core in `packages/db`, typed `OwnerScope`.** It locks the household's parent rows,
   re-checks the pre-flight, and deletes in graph order inside one transaction. Any surprise makes it
   fail closed.
3. **A dry-run-first correction that wraps the core.** It refuses on every documented precondition it
   can check mechanically and prints the rest as a checklist.
4. **The per-athlete deletion.** The published notice already promises it (`notice.md:195-196`:
   _"the finest grain for a permanent removal is an athlete. Ask, and that is done"_), but no runbook
   describes how to do it.

## Acceptance

From the row, verbatim: _"Wraps runbooks.md's procedure so the dry run, the target-host print and the
one-transaction wrapper come from a runner rather than an operator's care … no household id may be
committed … The `db:verify` proof is the point, not the polish: it is the only thing that catches a
19th per-household table escaping the runbook's hand-maintained delete order."_

Done when:

- **PR 1.** `db:verify` fails if any of these holds, and two committed mutation patches turn it red:
  - a `public` base table is in neither `HOUSEHOLD_GRAPH` nor `REFERENCE_TABLES`, or is in both;
  - a foreign key points into the graph from outside it;
  - a child is listed after its parent;
  - a table reachable by foreign key from `profiles` is not marked athlete-grain;
  - **any row of a graph table is matched by no household's `rowsOf`, or by more than one** (P7).
    `OPS-3` asked for this proof, because a copy by household and an erasure by household both
    depend on it.
- **PR 2a.** `db:verify` runs the core on a fixture with at least one row in every graph table
  (soft-deleted rows included), next to a second household K. It proves that each graph table loses
  exactly H's rows, that K's id sets are identical table by table, and that the reference tables and
  the global `movements` rows are unchanged.
- **PR 2b.** `db:correct erase-household` reads its target from a hidden prompt into
  `ERASE_HOUSEHOLD_PUBLIC_ID`. As a dry run it prints:
  - the per-table counts and the pre-flight results;
  - the step-0b Clerk ids, under a privileged heading;
  - the manual checklist.

  It writes nothing and never echoes the target id. With `--apply` it refuses unless every gate
  passes, then calls the core. Runbook steps 2–5 become commands, and the ledger gains a `grain` field
  and a preview-reset field.

- **PR 3.** `erase-athlete` works at athlete grain and is scoped by **both** the household id and the
  athlete id. The notice says what it removes and what it keeps, the sign-in included.
- **Throughout.** Nothing in the repo ever holds a real household or profile `public_id`. The erasure
  entries' Applied cells read **"standing — never dated"**: with one or two households, a date alone
  identifies one.

## Retention items: what this plan covers

`plan.md:2071-2082` lists three items:

| Item                                                 | Where                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Hard delete on request, per athlete and household | PR 2a/2b (household), PR 3 (athlete)                                                                                                                                                        |
| 2. The purge window `N`                              | **PR 4, a deferred section of this plan.** ADR 0008 sets `N` "in that row's plan". It is built after `V1-9b` B1-3, because V1-9b's requirements touch B1's DAL, which is not on `main` yet  |
| 3. What a departed household's data becomes          | The ledger half is in PR 2b: a `grain` field, the preview reset, and the core as the replay `OPS-3` calls. The policy half (a household that leaves **without asking**) is open question Q3 |

**ADR 0009 removes one of the supports for the retention reasoning, and the conclusion still
stands.** `plan.md:2064` cited "the byte-faithful CSV export", and ADR 0009 retired that contract.
"Keep raw history, no summaries" still rests on:

- the engine's per-set history;
- CLONE-1's version record;
- the fact that a summary of a child's weight is still a child's health data;
- the trivial volume;
- 0009 decision 3(a): the export must _"stay complete for what the notice says it contains"_.

This PR re-states the bullet in place, with a date. The decision did not change, only one of its
supports did, so it is a re-statement rather than an Amendment block. The plans README calls that
boundary a judgement call.

## Design decisions

### D1. The target arrives through the environment, read by a hidden prompt, not a flag (Q1)

Three places say the deletion needs a `--household` flag: the row (`plan.md:2054-2056`), README rule 8
(`corrections/README.md:42-44`) and `beta-1.md:481-483`. They were written before
`household-claim-2026-10-25`, which takes its targets from the environment for reasons the maintainer
recorded (`registry.ts:697-705`). One of those reasons is that _"a command line is broadly visible via
`ps`, while its environment is readable only by its owner"_. That matters even more for the id of a
family that has asked to be erased.

- **The runbook reads the value with `read -rs ERASE_HOUSEHOLD_PUBLIC_ID`** and passes it inline,
  without `export`. Shell history then holds only the variable name. The draft had accepted history as
  a residual.
- **There is no argv change.** The runner still changes, but only for output (D4).
- **The variable names differ from the claim's `HOUSEHOLD_PUBLIC_ID`**, so a value left over from a
  claim never reaches an erasure.
- If Q1 says flags instead, that becomes a PR 0 in this file: `node:util` `parseArgs` in strict mode,
  declared `targets` per entry, and the claim converted at its seven call sites, CI among them.

README `:80-83` records a commitment: _"PRIV-3 converts this entry to flags … so the repo does not keep
two operator-input channels"_. The goal behind it, one channel, is met: under the env answer the claim
and the erasure share it. The means (flags) is not, so the commitment is replaced. PR 2b does that with
a **dated Amendment block**, because it records a decision.

### D2. The shared per-household table source is `packages/db/src/household-graph.ts`

```ts
// Shape, not final code.
export type HouseholdGraphTable = {
  table: PgTable & { id: PgColumn }; // name via getTableConfig(table).name, never re-typed
  grain: 'athlete' | 'household'; // 'athlete' = reached through profiles; P2 proves it
  /** The rows to erase. `athlete` narrows a profile-grain table to one profile *inside* the scope.
   *  NEVER a `deleted_at` conjunct (corrections README rule 8). */
  rowsOf: (scope: HouseholdScope, athlete?: ProfilePublicId) => SQL; // name shared with OPS-3's plan
};
export const HOUSEHOLD_GRAPH: readonly HouseholdGraphTable[]; // delete order = runbooks.md:1388-1403
export const REFERENCE_TABLES: readonly PgTable[]; // units, quantity_slots, activity_type_categories,
//                                                    activity_types, metric_definitions
```

**One predicate per table.** The draft had two, `rowsOf` and `rowsOfProfiles`, which could drift
apart. Every profile-grain predicate now goes through one private helper:
`profilesIn(scope, athlete?)` = `inHousehold(scope) [AND public_id = athlete]`. A raw profile-id
subquery never escapes the capability.

**The order and scoping follow the runbook, with three deliberate differences:**

1. **`prescription_targets` uses `profile ∈ H AND prescription ∈ H`, not `OR`.** `OR` was the one
   predicate that could delete another family's row instead of hitting an FK abort. With `AND`, a
   straddling row is left behind and the `prescriptions`/`profiles` delete aborts with `23503`, so the
   failure is closed.
2. **`movements` stays `= H`**, never `IS NULL OR` (`runbooks.md:1450-1456`).
3. **With `athlete` set, the core walks only the `grain: 'athlete'` tables and skips every
   household-grain table.** Household-grain predicates ignore `athlete`, so walking them would erase
   the whole household. P6 asserts that H's program, movements, members and household row survive.

**Placement.**

- The module sits in `src/` beside `schema.ts`, and `schema.ts`'s header gains a one-line pointer to
  it.
- It is **not** re-exported from the barrel.
- The two new leaves, `householdRowIs(scope)` and `householdMemberInHousehold(scope)`, go in
  `ownership.ts`. That is the one module allowed to unwrap a scope (`scope.test.ts:65-66`).
- ⚠️ `src/index.ts:52` re-exports `ownership.ts` wholesale, so those two leaves **do** reach
  `apps/web`. That is acceptable: they are equality predicates like the leaves already exported there.
  What stays out of the barrel is the graph and the core.
- `data-inventory.md` §1 (`:270`) and runbook step 4's table become pointers to this module.

**The interface for `OPS-3`** (planned in parallel):

- `HOUSEHOLD_GRAPH`, walked forward to extract and reversed to re-insert.
- The restore target must already hold `REFERENCE_TABLES` **and every `household_id IS NULL`
  `movements` row that H references**.
- **The ledger replay:** re-run the core at each ledger entry's `grain` before serving the data. The
  core is idempotent, so a replay is safe.
- These are **`OPS-3`'s** problems, and this module does not claim to solve them:
  - identity columns (`GENERATED ALWAYS` needs `OVERRIDING SYSTEM VALUE`);
  - `public_id` and `client_id` collisions on re-insert;
  - re-applying the purge after a restore.

### D3. The delete core is `packages/db/src/writers/erase-household.ts`, typed `OwnerScope`

`scope.ts:68-69` already promises that _"`PRIV-3`'s deletion inherit[s] the check by signature"_. The
core keeps that promise, which also lets the Beta-1 self-serve deletion reuse it rather than move it.

- It stays out of the barrel until that row needs it.
- The operator correction passes `ownerScope(householdScopeForScript(id))`.
- `household-scope-script.ts:25-31`'s list of callers gains the new one.

```text
eraseHousehold(exec, scope: OwnerScope, { athlete?, apply }) → ErasureReport
  BEGIN (one transaction, only when apply)
    SELECT pg_advisory_xact_lock(SEED_HOUSEHOLD_WRITE_LOCK)   -- OPS-2 D6: serialised with the seed
    SET LOCAL lock_timeout '5s'; SET LOCAL statement_timeout '60s'
    SELECT now(), pg_current_wal_lsn()            -- printed: the exact restore point (D4)
    SELECT … FOR UPDATE on H's households, profiles, sessions, supersets, entries, entry_sets,
           program_blocks, prescriptions and movements rows  -- every parent a new child row
                                                             -- could reference now waits on us
    pre-flight (a)–(d), H-relative               -- non-zero → throw, which rolls back
    count every graph table (count()::int, never rowCount)
    DELETE … RETURNING id, in graph order
  COMMIT
```

**Why the parents are locked first.** At READ COMMITTED each statement sees newly committed rows, so a
straddling row written after the re-check would otherwise be deleted silently. `FOR UPDATE` on the
parents conflicts with the `KEY SHARE` lock that an inserting child row takes, so no new reference can
land while the transaction is open. The `AND` predicate is the second line of defence.

**The final "all zero" re-count is dropped.** It would reuse `rowsOf`, so it reads zero by construction
and checks nothing. The real checks are the FK aborts and the global `movements` count, which must
stay above zero.

**Pre-flight (d) becomes household-relative.** A new
`householdMovementCrossRefs(exec, scope)` in `movement-ownership.ts` returns the two directions
separately:

- **¬H → H refuses**, with a pointer to the repoint procedure (`runbooks.md:1329-1340`);
- **H → ¬H passes**, because the runbook calls it benign.

The existing global census stays a census.

**Counts use drizzle `count()` or `::int`** (`movement-ownership.ts:67`). A raw `count(*)` comes back
from node-postgres as a string, and `'0'` would pass on PGlite but refuse on production.

### D4. What the correction (PR 2b) enforces and prints

| Guard                                                                                       | After PR 2b                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolve by `public_id`                                                                      | `uuidSchema` (`@mat-plan/shared`, `id.ts:18`). `liveHouseholdScope` gains `{ includeSoftDeleted: true }` (`registry.ts:80-87`), so there is no third lookup. A soft-deleted household is still erased                                                                                                                                                                                             |
| Right database                                                                              | Under `kind: 'erasure'` the runner **requires `DATABASE_URL_UNPOOLED`**, with no fallback (`target-url.ts:20`). It refuses if `hasHostOverride` (private today at `db-environment.ts:96`; PR 2b exports it) is true. It **refuses `--apply` if `current_database()` names the preview** (`namesPreviewDatabase`, `:122`): the preview copy is deleted by resetting the project, not by an erasure |
| Seed-id target (precondition 2)                                                             | **No refusal; a tombstone instead (D6).** `OPS-2` replaces precondition 2 with its check M4, which the operator runs **before every seed-id deletion**. The dry run prints M4 at the head of the checklist when the target or any of its profiles carries a committed seed id. M4's checks 2–4 need `gh`, so they stay operator steps                                                             |
| Two targets in one environment                                                              | `erase-household` refuses if `ERASE_ATHLETE_PUBLIC_ID` is set                                                                                                                                                                                                                                                                                                                                     |
| Pre-flight, lock, transaction                                                               | The core (D3)                                                                                                                                                                                                                                                                                                                                                                                     |
| `OPS-3` rehearsed, the 7-day pause, re-confirmation, restore branch, Clerk deletion, ledger | **Prose, printed as a numbered checklist** by the dry run, not code (see the panel log, S1/S2). The restore branch is cut **at the printed LSN**, inside Neon's 6-hour window. Its name is neutral, with no id or date, because Neon keeps branch names                                                                                                                                           |

**The output never names the target.** It says "the target household", never its `public_id`, and
never a person's name.

- Under `kind: 'erasure'` a refusal prints only its message and the constraint name. It never prints
  `err.stack` or drizzle's `Failed query … params`, which carry the bound id (`correct.ts:107-119`;
  rule 9).
- The step-0b Clerk ids are printed once, under a `PRIVILEGED — do not paste` heading.

**`kind: 'erasure'` gets its own three runner strings** (`correct.ts:91-103`), following the
`kind: 'report'` precedent (`registry.ts:41-58`). Without them a not-found line under `--apply` would
print `✓ applied 1 change(s)`. The three strings:

- dry run: "would erase";
- applied: "erased; now do the checklist";
- not found: "NOT FOUND — nothing erased (already erased, never here, or a mistyped id)", exiting 0 on a dry run and **non-zero under `--apply`**. The erasure signals not-found by throwing a typed `ErasureTargetNotFound`, which the runner tells apart from zero changes, so a mistyped id never reports success. The ledger replay calls the core, not the CLI (D2), so the CLI does not need to be idempotent.

The runbook makes a production dry run that **finds** the household a precondition of `--apply`.

### D5. The Applied table and the rules

- The entries are `erase-household` and `erase-athlete`, with `issue: 'PRIV-3'`.
- README `:63-65` defines the Applied column as a date or `pending`. PR 2b adds a third value there:
  **`standing — never dated`**.
- Rule 6 gains: "a standing entry is an operation, not a record of a defect". Rule 8 gains the
  matching cross-reference.
- The `issue` docblock (`registry.ts:40`) gains "or the row that owns a standing operation".

### D6. Seed ids become scrubbed tombstones, not hard deletes (`OPS-2` D8 and its Q2)

[`ops-2-split-the-seed.md`](./ops-2-split-the-seed.md) D8 asks PRIV-3 to take a position. **PRIV-3
agrees: a tombstone, for the four committed seed ids only.** Those are `…010` and the three profile
ids, all from `@mat-plan/shared`.

**Why a tombstone.** Old seed code can run after a deletion from any stale checkout, and this repo
routinely has a dozen worktrees. Against a hard-deleted household, that code **re-creates** the
household and its named fixture athletes. Against a tombstone, it conflicts on the non-partial
`public_id` UNIQUE, finds a row that is not live, and **throws with nothing written** (`OPS-2` D8's
table). Prose cannot close a stale checkout; the data can.

**It still keeps the notice's promise** of _"permanently removed from the database, not hidden"_
(`notice.md:226-227`), because the tombstone holds **no personal data**:

- `name` becomes a fixed placeholder;
- `routine_config`, `avatar`, `birthdate`, `pin_hash`, `client_id` and `archived_at` become NULL;
- `created_at` and `updated_at` are reset to the deletion time, so nothing records when the family
  joined;
- `kind` keeps the seed's own value, which is NOT NULL and already public;
- every child row is hard-deleted as usual.

What survives is a `public_id` that **this public repo already contains**, so the tombstone adds no
identifier that git does not already publish. SEC-6 owns re-keying those ids. Inventory §8 gains a row
for the tombstone. The notice does not change: a seed id only ever belongs to the maintainer's own
household, never to an invited family.

**What this changes in the design:**

- The core writes the tombstone **instead of** the final `DELETE` for that row. For a household, its
  profiles are tombstoned too, and its members are deleted.
- **The tombstone shape comes from one exported writer**, in `erase-household.ts`. `OPS-2`'s proof
  uses it (P8).
- A re-run finds the tombstone through `includeSoftDeleted` and does nothing.
- The purge (PR 4) never touches a hidden household or profile (requirement 3), so it never removes a
  tombstone.
- The core takes `SEED_HOUSEHOLD_WRITE_LOCK` (`OPS-2` D6) before its row locks. The seed takes the same
  lock first, so the two cannot deadlock.
- **For `OPS-3`:** restoring a seed-id household hits its own tombstone on the `public_id` UNIQUE, so
  the restore must **replace** the tombstone rather than insert beside it. This is passed back to
  `OPS-3`.

**Rejected: a hard delete, relying on `OPS-2`'s 30-day re-run window and "fresh `origin/main` only"
prose.** That covers GitHub re-runs but leaves stale-checkout hand-runs open. The maintainer decides
(Q5); the recommendation is the tombstone.

## File-by-file changes

### PR 1: `db/priv-3-1-household-graph` (about 330 lines with P7, no migration)

| Path                                                                                     | Change | What and why                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/household-graph.ts`                                                     | NEW    | `HOUSEHOLD_GRAPH` and `REFERENCE_TABLES` (D2). The `athlete` parameter is typed now and unused until PR 3                 |
| `packages/db/src/writers/ownership.ts`                                                   | EDIT   | `householdRowIs`, `householdMemberInHousehold`                                                                            |
| `packages/db/src/schema.ts`                                                              | EDIT   | Header pointer to the graph                                                                                               |
| `packages/db/scripts/verify.ts`                                                          | EDIT   | P1, P2                                                                                                                    |
| `packages/db/scripts/mutations/NN-graph-forgets-a-table.*`                               | NEW    | Drops `day_readiness`, so P1 goes red. The number is taken at implementation, because V1-9b branches may claim `41` first |
| `packages/db/scripts/mutations/NN-graph-parent-first.*` + README row                     | NEW    | Moves `entries` after `sessions`, so P2 goes red                                                                          |
| `packages/db/scripts/mutations/NN-predicate-drops-household.*`, `NN-pt-and-becomes-or.*` | NEW    | P7's two mutations                                                                                                        |
| `docs/runbooks.md`, `docs/privacy/data-inventory.md` §1                                  | EDIT   | Pointers to the graph                                                                                                     |
| changelog fragment                                                                       | NEW    |                                                                                                                           |

### PR 2a: `db/priv-3-2a-erase-core` (about 300 lines, more than half of them proofs)

| Path                                                              | Change | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/erase-household.ts`                      | NEW    | The core (D3). Not in the barrel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/db/src/queries/movement-ownership.ts`                   | EDIT   | `householdMovementCrossRefs(exec, scope)`, which returns the two directions separately                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/db/src/writers/household-scope-script.ts`               | EDIT   | Add the core's caller to "Who may call it"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/scripts/verify.ts`                                   | EDIT   | P3–P5. Fixture rows are inserted with `asPg`, as proof (5) does, reusing `insertSession` / `insertSessionEntry` / `insertSuperset` (`verify.ts:1731-1807`). The core needs a scope for H, and `scope.test.ts:418-426` requires every `householdScopeForScript(` call in `verify.ts` to be a **named const listed in `MINTED_SCOPES`**. A mint hidden inside a helper would fail that guard. So **`scope.test.ts` is edited**: it gains one entry, `ERASE_H_SCOPE`, with the reason "the household the erasure proof destroys, so it cannot be `A_SCOPE`". **Proof (5) at `:7488-7533` is deleted**, because P2 and P3 subsume it |
| `packages/db/src/scope.test.ts`                                   | EDIT   | That `MINTED_SCOPES` entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/scripts/mutations/NN-erasure-respects-soft-delete.*` | NEW    | Adds `isNull(entries.deletedAt)`. The leftover row makes the `profiles` delete abort, so P3 wraps the core in `assert.doesNotReject` and the `.expect` names that assertion (`mutations.mjs:60` matches only `AssertionError`)                                                                                                                                                                                                                                                                                                                                                                                                   |

### PR 2b: `db/priv-3-2b-erase-household` (about 200 lines of code, plus the runbook rewrite)

| Path                                                                                     | Change | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/erasure.ts`                                             | NEW    | `erase-household` (D4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/db/scripts/correct.ts`                                                         | EDIT   | `kind: 'erasure'`: the three strings, the `DATABASE_URL_UNPOOLED` requirement, the redacted catch                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/db/scripts/corrections/registry.ts`                                            | EDIT   | The `kind` union; `liveHouseholdScope({ includeSoftDeleted })`; the new entry; the claim docblock (`:697-705`) as an Amendment                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/db/scripts/corrections/target-url.ts` + `.test.ts`                             | EDIT   | `correctionTargetHost()`, extracted from `correct.ts:47-53` rather than copied. The pure gates (seed, two targets, preview name, host override) are unit-tested here, following the `fixtureBindIsAllowed` idiom                                                                                                                                                                                                                                                                               |
| `packages/shared/src/db-environment.ts`                                                  | EDIT   | Export `hasHostOverride`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/db/scripts/mutations/NN-erasure-skips-hidden-household.*`                      | NEW    | Adds `isNull(households.deletedAt)` to the resolver, so P5b goes red. Moved here from 2a, because the resolver it mutates lands in this PR                                                                                                                                                                                                                                                                                                                                                     |
| `packages/db/scripts/corrections/README.md`                                              | EDIT   | Rule 8 and `:80-83` as an Amendment, conditional on Q1; the Applied definition and rows (D5)                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/runbooks.md`                                                                       | EDIT   | Steps 2–5 become `read -rs` → dry run → read the output → `--apply`. **The hand-typed SQL is deleted**, because it is the unproven second path this row exists to remove. The ledger gains three fields: `grain` (household or athlete), the restore-point LSN, and "mat-plan-preview: project reset (date)". A project reset is the **only** accepted outcome for the preview: a production `public_id` never exists there (`service-setup.md:38-40`), so a dry run against it proves nothing |
| `docs/privacy/data-inventory.md` §8, `docs/plan.md`, `docs/milestones/beta-1.md:481-483` | EDIT   | The new ledger fields; the PRIV-3 row; a dated re-statement of "needs a flag"                                                                                                                                                                                                                                                                                                                                                                                                                  |

### PR 3: `db/priv-3-3-erase-athlete` (about 150 lines)

| Path                                               | Change | What and why                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/corrections/erasure.ts`       | EDIT   | `erase-athlete` **requires both `ERASE_HOUSEHOLD_PUBLIC_ID` and `ERASE_ATHLETE_PUBLIC_ID`**. The athlete must resolve inside that household, without a `deleted_at` filter, or it refuses. Pre-flight (b′/c′): another profile's entries pointing at this athlete's sessions or supersets. A seed profile id becomes a tombstone (D6)                                                     |
| `packages/db/scripts/verify.ts`                    | EDIT   | P6                                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/db/src/scope.test.ts`                    | EDIT   | One `MINTED_SCOPES` entry for P6's fresh household, because P3 already destroyed H                                                                                                                                                                                                                                                                                                        |
| `docs/runbooks.md`                                 | EDIT   | A "Delete one athlete" section that links to the household section's preconditions rather than repeating them; its ledger entry records `grain = athlete` and the profile `public_id`                                                                                                                                                                                                     |
| `docs/privacy/notice.md` + `pnpm privacy:generate` | EDIT   | What an athlete deletion removes, and what it **keeps**: the household's program and movement names, and **every membership and sign-in account**, because `household_members` has no link to a profile (`schema.ts:173-186`). It must not echo "sign-in accounts are deleted too" (`notice.md:228`). The "short record" bullet (`:243-246`) is extended to cover an athlete's identifier |

### PR 4: the purge window `N` (deferred section, re-panelled before it is built)

**Gated on `V1-9b` B1-3.** It carries V1-9b's three requirements
(`v1-9b-delete-and-restore.md:260-275`). As ADR 0008 `:63` and `:157` require, it sets `N` **and** the
restore window together, with the notice change in the same PR.

**Proposed: `N` = 30 days. The maintainer decides (Q2).**

- It covers a parent's missed weekly review with margin. ADR 0008's design case is a child deleting
  something and a parent finding out later.
- It matches the common 30-day "recently deleted" convention, so the notice's "a set number of days"
  surprises nobody.
- It covers one export month for the on-request full copy, which includes hidden rows until they are
  purged (`v1-9b-delete-and-restore.md:184`).

**Alternatives.** 14 days matches one cycle of the two-week program, but leaves too little margin after
one missed review. 7 days is rejected for the same design case. 90 days or more keeps a child's deleted
data for a quarter for little gain.

**Requirements fixed now:**

1. Restorable ⇔ `deleted_at > now() - N`, and purgeable is its exact complement. Both use the
   **database's** `now()`, never the app clock. V1-9b's "last full local day" is a display derived from
   this, not a second boundary.
2. Restore re-checks the boundary inside its own `UPDATE`, with a typed refusal. Restore and purge run
   at different `now()`s, and the re-check settles that race.
3. The purge covers the entry grain and its children, plus orphaned `sessions` / `supersets` (V1-9b
   requirement 2). It must say whether soft-deleted `household_members` rows (Clerk ids, inventory
   §8) are purged. **A hidden profile or household is never purged**: removing one goes through this
   plan's erasure core and its ledger.
4. The first run purges rows hidden before PRIV-3, including two weigh-ins a correction hid
   (`v1-9b-delete-and-restore.md:49`). Its dry run counts them.
5. `OPS-3` re-applies the purge after a restore.

## Test plan

All proofs run in `db:verify` (PGlite) and `pnpm db:mutations`; `db:verify` also runs in CI. The gates
are unit tests (PR 2b).

- **P1, partition (PR 1).** Over `information_schema.tables`, filtered to `table_schema = 'public'`
  and `table_type = 'BASE TABLE'`:
  - every table is in exactly one of the two lists;
  - every list entry exists;
  - every table with a `household_id` or `profile_id` column is in the graph.
- **P2, catalog closure and order (PR 1).** For every `pg_constraint` with `contype = 'f'`, self-FKs
  excepted:
  - a parent in the graph implies a child in the graph, at a **lower** index;
  - every table reachable by foreign key from `profiles` has `grain: 'athlete'`.
- **P7, row partition (PR 1; asked by `OPS-3`).** Uses the existing two fixture households A and B,
  through the **existing** `A_SCOPE` and `B_SCOPE`. It is read-only, so no new `MINTED_SCOPES` entry
  is needed. First, rows are added so that every graph table has rows in both households.
  - Every row of every graph table is matched by **exactly one** of `rowsOf(A_SCOPE)` and
    `rowsOf(B_SCOPE)`.
  - The one exception is a `movements` row with `household_id IS NULL`, which must be matched by
    **neither**.
  - Then a deliberate straddling row is inserted: a `prescription_targets` row whose profile is A's
    and whose prescription is B's. It must be matched by **zero** households, so neither erasure
    selects it and the foreign-key abort takes over.
  - Mutations: one drops the household conjunct from a single profile-grain predicate (the row is
    matched twice, so P7 goes red), and one widens `prescription_targets` from `AND` to `OR` (the
    straddle is matched twice, so P7 goes red).
- **P3, behavioural (PR 2a).**
  - H holds a row in **every** graph table: a soft-deleted entry, profile and membership; an owned
    movement; and a `prescription_targets` row with **both** of its references inside H. K mirrors
    it.
  - A guard asserts the fixture covers every `HOUSEHOLD_GRAPH` entry.
  - After the core runs with `apply`: H's per-table counts, measured as **deltas around the fixture
    inserts**, are zero; **K's per-table id sets** are identical; the reference tables and the global
    movements are identical.
  - A second run returns not-found.
- **P4, refusals roll back (PR 2a).**
  - Pre-flight (a), (b) and (c), and (d) in its ¬H→H direction, each refuse with all ids unchanged.
  - (d) in its H→¬H direction does **not** refuse.
  - A leftover straddling row aborts with `23503` and rolls back.
- **P5 (PR 2a).** The core, handed a soft-deleted household's scope, erases it.
- **P5b (PR 2b).** `liveHouseholdScope({ includeSoftDeleted })` finds a soft-deleted household.
- **P8, seed ids (PR 2a; aligned with `OPS-2`).** H carries `SEED_HOUSEHOLD_PUBLIC_ID` and a seed profile id. After the core runs, both are in D6's tombstone shape and every child row is gone. Running `seedProductionDatabase` afterwards writes nothing and logs `OPS-2`'s skip line. A second core run is a no-op. `OPS-2` PR 1b's own proof, which runs old seed code against a hand-built tombstone, switches to the core's output here, so the repo keeps one tombstone writer.
- **P6 (PR 3).** At athlete grain: a sibling athlete and K are untouched, and H's program and
  movements survive. **H's household id paired with K's athlete id refuses**, and (b′) refuses.
- **Mutations:** graph-forgets → P1; parent-first → P2; predicate-drops-household → P7;
  pt-and-becomes-or → P7; respects-soft-delete → P3;
  skips-hidden-household → P5b.
- Run: `pnpm --filter @mat-plan/db db:verify && pnpm db:mutations && pnpm verify`.

**What none of this proves:** that production holds no pre-flight-shaped rows. The dry run measures
that when it runs.

## Risks / rollback

| Risk                                                                        | Mitigation                                                                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A predicate reaches another family's row                                    | `AND` on `prescription_targets`; parent rows locked before the re-check; P3 compares K's ids                                                    |
| PGlite and node-postgres behave differently                                 | `count()` / `::int`, never `rowCount`. P3 runs the core exactly as production does                                                              |
| Wrong database                                                              | `DATABASE_URL_UNPOOLED` is required, the host override is refused, and the preview is refused by the name the server reports                    |
| A typo'd id reads as success                                                | The not-found string names that possibility, and a found production dry run is the runbook's precondition for `--apply`                         |
| The target id leaks into pasted output                                      | It is never printed, the catch is redacted, and the Clerk ids appear only under the privileged heading                                          |
| A restore resurrects an erased athlete                                      | The ledger's `grain` field and a replay at that grain (D2)                                                                                      |
| `verify.ts` keeps growing (9,169 lines; DX-12's trigger, `plan.md:2243`)    | Roughly +110, +200 and +60 across three PRs, and −45 for proof (5). Flagged so the maintainer can call the trigger before PR 2a                 |
| Old seed code runs after a seed-id deletion (stale checkout, GitHub re-run) | D6's tombstones: old code fails closed and writes nothing (P8, and `OPS-2`'s old-code proof). `OPS-2`'s M4 runs before every seed-id deletion   |
| A real erasure goes wrong                                                   | The restore branch at the printed LSN, plus `OPS-3`. The `OPS-3` rehearsal stays a runbook precondition, and beta-1 sequences row 8 after row 6 |

**Rollback.** PRs 1 and 2a only add code and change no procedure. Reverting PR 2b brings back the
hand-SQL runbook from git history. A wrong **run** is recovered from the restore branch, never from git.

## Alternatives considered

- **A `--household` flag.** Not recommended (D1); it becomes PR 0 if Q1 says so.
- **A separate `db:erase` command.** It would duplicate the runner's dry-run, refusal and pool handling
  for a single consumer. The `kind` discriminator is the precedent's answer to the same problem.
- **The delete engine in `scripts/`.** Rejected (D3): the Beta-1 self-serve deletion would have to
  move it, and `scope.ts:68-69`'s promise would have to be rewritten.
- **Derive the delete order from the catalog at run time.** A derived order cannot know how each
  table is scoped (`prescription_targets`, `movements`), and production would then run an unreviewed
  sort. The catalog is used to **prove** the list instead.
- **`ON DELETE CASCADE`.** A cascade reports nothing, and the counts are the proof
  (`runbooks.md:1405-1407`).
- **`SERIALIZABLE` instead of `FOR UPDATE`.** It works, but it turns a concurrent app write into a
  serialization failure the operator has to retry. Explicit locks make the parents' writers wait.
- **Keep the hand SQL as a fallback.** That is the unproven second path.

## Out of scope / deferred

- Deleting Clerk accounts through the Backend API. Step 6 stays manual, with the ids printed.
- Automating pre-flight (d)'s repoint (`TEN-2c-1`).
- The self-serve deletion. It reuses the core, but its UI, step-up and authority belong to its own row.
- **Flagged, not owned here:** the notice promises the 7-day pause but **no upper bound on how long a
  response takes**. That belongs to the `PRIV-1` sign-off pass, not to a script PR.

## Open questions (maintainer)

1. **Q1. The target channel.** Recommendation: **the environment, read by a hidden prompt** (D1). The
   alternative is flags (PR 0).
2. **Q2. `N`.** Recommendation: **30 days**; the alternative is 14. It is set in PR 4.
3. **Q3. A household that leaves without asking.** Recommendation: **nothing automatic during the
   beta**. The notice already commits to asking once when the beta ends (`notice.md:163`). Revisit
   before self-serve sign-up.
4. **Q4. Does PR 3 ship inside Beta 0?** Recommendation: **yes, right after PR 2b**. The notice already
   promises it, and it is about 150 lines. The alternative is to build it when the first request
   arrives, using the 7-day pause as the window to ship it. Not recommended, because it ties a family's
   request to the maintainer's free hours.
5. **Q5. How a seed id is deleted (`OPS-2` Q2, decided jointly).** Recommendation: **a scrubbed
   tombstone for the four committed seed ids** (D6). The alternative is a hard delete plus the 30-day
   window and prose, which leaves a stale checkout able to re-create the household.

## Review-response log (adversarial panel)

> Panel cost: correctness: 117.8k tokens · 220s; simplicity + reuse: 78.4k · 99s; architecture:
> 92.4k · 143s; privacy/security + DB-safety: 103.4k · 189s. (Cost only. It can never show what a
> cheaper lens missed.)

Every critique was re-checked against the tree before it was accepted or rejected. **Eight BLOCKING,
all resolved.** Lenses: C = correctness, S = simplicity/reuse, A = architecture, P =
privacy/DB-safety.

| #   | Lens                                                | Critique                                                                                                                                       | Verdict                        | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | C                                                   | The athlete erasure had no household conjunct; `rowsOfProfiles(SQL)` bypassed the capability                                                   | **accepted**                   | One `rowsOf(scope, athlete?)` through `inHousehold`; PR 3 requires both ids; P6 adds a cross-household refusal case                                                                                                                                                                                                                                                                                                                           |
| B2  | C, P                                                | The `prescription_targets` `OR` deletes other families' rows; P3's "each arm" fixture contradicted pre-flight (a); the re-check was not atomic | **accepted**                   | `AND`, so it fails closed; `FOR UPDATE` on the parents before the re-check; the fixture puts both references in H                                                                                                                                                                                                                                                                                                                             |
| B3  | A, C                                                | "No runner change" was false: `correct.ts:91-103` would print "✓ applied 1 change(s)" for not-found                                            | **accepted**                   | `kind: 'erasure'` with its own strings; D1 now says "no **argv** change"                                                                                                                                                                                                                                                                                                                                                                      |
| B4  | A                                                   | The `OPS_3_REHEARSED_ON` code gate was circular with `OPS-3`'s own drill and replay                                                            | **accepted**                   | Gate removed (see S2)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| B5  | A, P                                                | Athlete erasures were missing from the ledger and the replay, so a restore would resurrect them                                                | **accepted**                   | Ledger `grain`; replay at that grain; the notice's ledger bullet extended                                                                                                                                                                                                                                                                                                                                                                     |
| B6  | A, C                                                | The `OPS-3` interface omitted global movements and identity columns                                                                            | **accepted**                   | Global movements are a stated precondition; identity and collisions are named as `OPS-3`'s                                                                                                                                                                                                                                                                                                                                                    |
| B7  | S, A                                                | `scope.test.ts`'s `MINTED_SCOPES` guard was in no file table                                                                                   | **accepted**                   | Fixture rows inserted with `asPg`. The one scope the core needs is a named const with its own justified `MINTED_SCOPES` entry. A mint hidden in a helper would fail `scope.test.ts:418-426`; this was found while revising                                                                                                                                                                                                                    |
| B8  | S                                                   | PR 2 at "~400 lines" was not credible                                                                                                          | **accepted**                   | Split into 2a (core and proofs) and 2b (correction and runbook); gates cut                                                                                                                                                                                                                                                                                                                                                                    |
| S1  | S, P                                                | `ERASE_CONFIRMED_ON` and `ERASE_EXPECT_HOST` are theatre: a typed copy of the same environment                                                 | **accepted**                   | Both cut. The host check is replaced by **server-reported** checks built on existing helpers: preview name, host override, unpooled only                                                                                                                                                                                                                                                                                                      |
| S2  | P                                                   | The `OPS-3` gate "is a real control"                                                                                                           | **rejected**, with reason      | A control that blocks the drill meant to satisfy it (B4) is worse than beta-1's ordering (row 8 after row 6) plus the printed checklist. Re-adding it later is a single constant                                                                                                                                                                                                                                                              |
| S3  | S                                                   | PR 3 should wait for demand                                                                                                                    | **partly**                     | Kept and sized; its timing is Q4, with Beta 0 recommended because the notice already promises it                                                                                                                                                                                                                                                                                                                                              |
| S4  | S, A                                                | `N` and other out-of-scope content belong elsewhere                                                                                            | **partly**                     | Moved into PR 4's deferred section **of this file**, per A's ADR 0008 point; the draft's Q5 is now just "flagged"                                                                                                                                                                                                                                                                                                                             |
| S5  | S                                                   | Reuse the host parse, `uuidSchema`, the resolver and the fixture builders; delete proof (5)                                                    | **accepted**                   | All five done, with citations                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S6  | S                                                   | P1 should source-scan the predicates for `deletedAt` instead of using a mutation                                                               | **rejected**                   | A text scan is brittle; the mutation proves the behaviour                                                                                                                                                                                                                                                                                                                                                                                     |
| A1  | A                                                   | The delete engine belongs in `src/writers`, typed `OwnerScope` (`scope.ts:68-69`)                                                              | **accepted**                   | D3                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A2  | A                                                   | The barrel leaks the new `ownership.ts` leaves                                                                                                 | **accepted, stated**           | The leaves are harmless predicates; the graph and the core stay out of the barrel                                                                                                                                                                                                                                                                                                                                                             |
| A3  | A                                                   | The Applied, rule-6 and `issue` definitions need editing                                                                                       | **accepted**                   | D5                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A4  | A                                                   | Use the Amendment form for the README `:80-83` commitment and for the plan.md reasoning                                                        | **partly**                     | The README commitment (a decision) gets an Amendment. The plan.md bullet stays an in-place re-statement: the decision is unchanged, and the form is the README's named judgement call                                                                                                                                                                                                                                                         |
| A5  | A                                                   | `REFERENCE_TABLES` as strings; the `householdIs` name                                                                                          | **accepted**                   | `PgTable[]`; renamed `householdRowIs`                                                                                                                                                                                                                                                                                                                                                                                                         |
| P1  | P                                                   | The target id and parameters reach pasteable output                                                                                            | **accepted**                   | Never printed; the erasure catch is redacted                                                                                                                                                                                                                                                                                                                                                                                                  |
| P2  | P                                                   | The shell-history residual is avoidable                                                                                                        | **accepted**                   | `read -rs`, no `export`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P3  | P                                                   | A preview dry run is vacuous                                                                                                                   | **accepted**                   | A project reset is the only accepted preview outcome; `--apply` refuses a preview database                                                                                                                                                                                                                                                                                                                                                    |
| P4  | P                                                   | Two targets in one environment                                                                                                                 | **accepted**                   | Each refuses when the other's variable is set; the athlete erasure requires its household                                                                                                                                                                                                                                                                                                                                                     |
| P5  | P                                                   | Athlete-grain membership was unproven; an athlete deletion keeps the sign-in                                                                   | **accepted**                   | P2's catalog rule; notice copy in PR 3                                                                                                                                                                                                                                                                                                                                                                                                        |
| P6  | P                                                   | Make the restore point exact                                                                                                                   | **accepted**                   | LSN and `now()` printed; neutral branch name. ⚠️ If PGlite lacks `pg_current_wal_lsn()`, verify skips only that line                                                                                                                                                                                                                                                                                                                          |
| P7  | P, C                                                | Purge rules: database `now()`, restore re-check, membership scope, the restore/purge race                                                      | **accepted**                   | PR 4 requirements 1–5                                                                                                                                                                                                                                                                                                                                                                                                                         |
| C1  | C                                                   | Pre-flight (d) over-refuses: it is global and sums both directions                                                                             | **accepted**                   | A household-relative helper; only ¬H→H refuses                                                                                                                                                                                                                                                                                                                                                                                                |
| C2  | C                                                   | Mutation 43 fails on `23503`, not on an assertion                                                                                              | **accepted**                   | `assert.doesNotReject`; a resolver mutation added                                                                                                                                                                                                                                                                                                                                                                                             |
| C3  | C                                                   | `count(*)` types differ by driver, and the final re-count reads zero by construction                                                           | **accepted**                   | `count()` / `::int`; the re-count dropped, and the FK aborts named as the real check                                                                                                                                                                                                                                                                                                                                                          |
| C4  | C                                                   | P3 should compare ids, not totals; P1/P2 edge cases; P4 lacked (c)                                                                             | **accepted**                   | All in the Test plan                                                                                                                                                                                                                                                                                                                                                                                                                          |
| X1  | `OPS-3` plan                                        | PR 1 should prove every row of every graph table belongs to exactly one household                                                              | **accepted**                   | P7, plus two mutations. Our `AND` form changes one detail: a straddle row is matched by **zero** households rather than one, and widening to `OR` is what turns P7 red. `OPS-3` asked for that mutation in its `OR` form                                                                                                                                                                                                                      |
| X2  | `OPS-3` plan                                        | Order: PR 1 → `OPS-3` restore → drill → PR 2                                                                                                   | **accepted**                   | Header. 2a and 2b both go after the drill, because they share `verify.ts`, `runbooks.md` and `mutations/` with `OPS-3`                                                                                                                                                                                                                                                                                                                        |
| X3  | `OPS-3` plan (read against this plan's first draft) | It cites `OPS_3_REHEARSED_ON` as the gate on PR 2, `ERASE_EXPECT_HOST` as its idiom, and `rowsOf`                                              | **reconciled**                 | `rowsOf` is kept as the shared name. `OPS_3_REHEARSED_ON` stays **dropped**: under the agreed order PR 2 merges after the drill, so a constant set at PR 2's merge could never block anything, and the order itself is the control. `ERASE_EXPECT_HOST` is gone (S1), so the server-reported checks in D4 are the idiom to share. **Passed back to `OPS-3`** to update its header item 4, its `RESTORE_EXPECT_HOST` row and its rollback line |
| R1  | re-review                                           | An athlete erasure would also walk the household-grain tables                                                                                  | **accepted**                   | D2 item 3: with `athlete` set, the core walks only athlete-grain tables                                                                                                                                                                                                                                                                                                                                                                       |
| R2  | re-review                                           | P5 and its mutation test a resolver that only lands in PR 2b                                                                                   | **accepted**                   | P5 now tests the core; P5b and the mutation moved to PR 2b                                                                                                                                                                                                                                                                                                                                                                                    |
| R3  | re-review                                           | P6 needs a new minted scope, and `scope.test.ts` was missing from PR 3's file table                                                            | **accepted**                   | Added to PR 3's table                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R4  | re-review                                           | `run` returns `string[]`, so a not-found under `--apply` exited 0                                                                              | **accepted**                   | A typed `ErasureTargetNotFound`, non-zero under `--apply`; the replay goes through the core                                                                                                                                                                                                                                                                                                                                                   |
| R5  | re-review                                           | `entries` was not locked, so a new `entry_sets` row could still land                                                                           | **accepted**                   | `entries` and `entry_sets` added to the `FOR UPDATE` set                                                                                                                                                                                                                                                                                                                                                                                      |
| X4  | `OPS-2` plan                                        | Q2: tombstone or hard delete for seed ids                                                                                                      | **accepted (recommended), Q5** | D6. The scrub list goes beyond `OPS-2`'s (birthdate, avatar, pin, client id, timestamps), so a tombstone carries nothing but an id that is already public                                                                                                                                                                                                                                                                                     |
| X5  | `OPS-2` plan                                        | Replace the seed refusal with M4, run before every seed-id deletion                                                                            | **accepted**                   | D4 row; the dry run prints M4. Its checks need `gh`, so they stay operator steps                                                                                                                                                                                                                                                                                                                                                              |
| X6  | `OPS-2` plan                                        | Take `SEED_HOUSEHOLD_WRITE_LOCK`                                                                                                               | **accepted**                   | It is the first statement in the core's transaction, matching the seed's lock order                                                                                                                                                                                                                                                                                                                                                           |
| X7  | own finding                                         | A seed-id restore hits its own tombstone                                                                                                       | **passed to `OPS-3`**          | D6, last bullet                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N1  | P                                                   | `N` = 30 collides with other 30-day numbers                                                                                                    | **rejected**                   | Unlike 7, it is not shared with an operator procedure; the nearest clash came from Q5, which is dropped                                                                                                                                                                                                                                                                                                                                       |
