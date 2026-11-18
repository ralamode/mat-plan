# PRIV-3: preparing the fresh start (CAT-3 chunks R0 and R1)

## Where this sits

- **Pillar:** privacy and operations (`PRIV-3`'s owner). **Milestone:** Beta 0, the fresh start before
  FAM-1's trial week ([CAT-3 spec](../specs/cat-3-movement-library.md) → "The fresh start, in order").
- **This plan:** the last two chunks to build before R2, the fresh start itself.
  - **R0** is three things:
    - the deltas to `PRIV-3`'s own plan, applied in this PR;
    - the deltas to `OPS-2`'s plan and the `SEC-6` row, which R0's code PR applies (#592 merged 2026-11-18);
    - the dated one-shot correction that erases the seeded household, built in R0's code PR.
  - **R1** is step 5's correction, R4's report, and the runbook section.
- **Built already:** RC, `create-household` (#546), and `PRIV-3` PR 1, the graph (#520).
- **Gates:**
  - R0's code PR waits for `PRIV-3` PR 2a (the core); #592 (`OPS-2` PR 1) merged on 2026-11-18.
  - R1's PR waits for R0 and for CAT-3 **A2** on `main`. A2 rewrites the report R1 extends and exports
    `movementIsCatalog()`; both of A2's PRs are needed, the mechanism (A2-i) and the switch (A2-ii).
  - R2 waits for the spec's preconditions: A2-ii deployed, and the maintainer's go.

_Roadmap alignment (2026-11-18): advances `PRIV-3` and `CAT-3` chunks R0 and R1; consumes K7 (the
fresh start removes everything) and K15 (not a normal deletion). `SEC-6`'s production exposure closes by
deletion, not by a re-key. `OPS-3` moved to "before the first invite" (#628) and gates nothing here.
**`ID-1`:**

- The fresh start ends the seeded profiles' `public_id`s once, before any athlete identity is in use.
  K4 means nothing depends on them, and `ID-1`'s "a `public_id` is the athlete's for life" applies from
  step 9's new profiles.
- RC's plan answers the six keep-open items for the accounts it binds. Nothing here adds a column, a
  scope or an authority check, and D2 counts households without assuming one per person.

Checked against the private roadmap; nothing else to add._

## Goal

Before R2, everything it needs is on `main` and has been dry-run against production, printing counts
only:

- a correction that erases the seeded household, and refuses without this sitting's dry-run total;
- a correction that deletes the old global movements, and refuses while anything references them;
- a report that shows the result;
- a runbook section, with the restore procedure, that an operator can follow in one sitting.

## Acceptance

The spec's R1 to R5 (`cat-3-movement-library.md` → "The fresh start (chunk R)"), and its R0 row:

> `PRIV-3`: a dated one-shot correction that takes no target, erases the seeded household through
> 2a's core, refuses outside production and once the target is gone, has a pure, unit-tested gate,
> and leaves `erase-household`'s seed-id refusal and its proof unchanged (or `OPS-2` D9's re-key run
> just before; the owner chooses); `PRIV-3`'s order no longer puts `OPS-3` ahead of 2a for this run,
> and `SEED_PUBLIC_IDS` moves from its 2b to chunk RC.

Done when:

- `erase-seeded-household-<date>` and `delete-legacy-movements-<date>` are in `registry.ts`. Each has:
  - a dry run that prints counts only (no account id, no `public_id`), which `db:verify` scans;
  - a pure gate with a colocated unit test of every branch;
  - `db:verify` cases for its success path, its second run and each refusal that a wiring mistake could
    drop.
- Every `db:verify` case has a mutation that turns it RED. Numbers are taken in PR order (`NN-*`;
  § Mutation numbers).
- `movementsOwnershipReport` prints R4's counts.
- `runbooks.md` has:
  - the restore procedure, filling the stub at "Cut a Neon RESTORE branch";
  - "The fresh start (CAT-3 R2)", steps 0–9, each with a "Second run:" line.
- `data-inventory.md` §5 names each removal path in the PR that adds it.

## Design

### D1. R0: `erase-seeded-household-<date>`, a one-shot entry

**It finds its target and erases it through the core:**

- It resolves `SEED_HOUSEHOLD_PUBLIC_ID` itself, with an unfiltered `householdScopeByPublicId` (added
  here beside `liveHouseholdScope`, `registry.ts:88`; 2b reuses it). A hidden household is still
  erased.
- It erases through 2a's core, `src/erasure/erase.ts`, at household grain. So it gets the same
  pre-flights (a)–(h), the same lock and the same order as every household deletion. It is not a
  second walk.

**The owner's choice, as the R0 row allows:** no re-key first. K7 deletes the household, so a re-key
would be a write made only to be deleted, and it would put `SEC-6` on the critical path. `erase-household`
and its seed-id refusal arrive with 2b, after R2, unchanged by this plan; R0 adds no override to them.

**Production, by elimination.** There is no positive test for production: its database is named
`mat_plan`, like a local one (`target-url.ts:57-62`). So the entry refuses everything it can recognise
as not production:

- **The URL, before connecting.** It reads `correctionTargetUrl({ kind: 'erasure' })`, which R0 brings
  forward from 2b's plan into `target-url.ts`. It returns nothing without `DATABASE_URL_UNPOOLED` (no
  fallback to `DATABASE_URL`), so the guard and the runner resolve the same string (`target-url.ts:9-22`,
  2b's panel row 2S12). The gate refuses on that URL when:
  - it is unset;
  - it is local, or its database is the preview's (`correctionTargetIsLocal()`,
    `correctionTargetIsPreview()`; an unknown target is neither, as today);
  - **its database name is missing:** a separate predicate, `correctionTargetDatabaseIsUnnamed()`. A
    no-path URL makes `pg` connect to `$PGDATABASE` or the user's name; the security lens confirmed this
    on the installed `pg-connection-string@2.14.1`. **Each caller refuses on it in its own direction**,
    and it is not folded into a shared local-or-preview helper. `seedHouseholdClaimIsAllowed` must not
    treat it as local or preview, or a no-path URL would let a seed-household claim bind remotely.
  - it carries a host override: `hasHostOverride`, exported here from `db-environment.ts`.
- **The database, inside the transaction.** It reads `current_database()` on the connection that writes.
  It refuses unless that equals the URL's name and does not name the preview. This also closes the
  socket and no-path cases.
- **Pure, with a unit test.** The gate, `seededHouseholdErasureIssue(target, observed)`, takes those
  two values. Its colocated test drives every branch.
- **The same gap in RC.** `create-household`'s preview refusal (#546, `registry.ts:886`) accepts a
  no-path URL, so it also refuses on the unnamed predicate. `target-url.test.ts` gains two cases:
  `create-household` refuses `postgres://u:p@ep-x.invalid`, and a seed-household claim against it is
  refused too.

**Tied to this sitting's dry run.** Under `--apply` the entry requires `EXPECT_ERASED_ROWS`:

- That is the total the dry run printed, a number with no personal data.
- **The mechanism:** the entry opens the transaction and passes its `tx` to 2a's core as `exec` (the core
  runs inside it, its own transaction a savepoint), then compares the core's deleted total with the
  expected one and throws on a mismatch, which rolls back everything. An unset or malformed value, parsed
  as an integer ≥ 0, refuses before the core is called. 2a's signature needs no change. If 2a's core
  turns out to commit on its own, this becomes a delta to 2a (an `expectedTotal` checked before its first
  `DELETE`), raised before R0 is cut.
- `db:verify` asserts that after a mismatched `--apply` **every graph table's rows are unchanged**, so a
  compare that ran after a commit would also go red.
- So a bare `--apply`, or one run with an earlier sitting's number, refuses. This is the interlock D2
  already had, on the more harmful of the two.

**Once the target is gone:**

- A dry run prints "the seeded household is not here; nothing to erase" and exits 0.
- `--apply` throws `CorrectionRefusal` inside `run()`. It is a throw rather than a runner exit code so
  that `db:verify`, which calls `run()` directly, can see it (`correct.ts:116`).
- There is no "mistyped id" wording: the entry takes no id.

**Output and errors:**

- Counts only. **No Clerk id and no `public_id`** in any line, though the core's report carries Clerk
  ids for 2b. The entry prints only the per-table counts and the total.
- `db:verify` scans the found path's dry-run and applied lines with RC's (6k) console-sink pattern
  (`verify.ts:7609-7611`).
- The core's typed errors (`ErasurePreflightRefused`, `ErasureTargetNotFound`) are mapped, inside the
  entry's own `try`, to a `CorrectionRefusal` built from their fixed fields: the check's letter and a
  count, never `.message`. Everything else goes through `redactedFailure` (`redact.ts`).
- This is `createHousehold`'s pattern (`registry.ts:884, 944-946`). R0 adds no `kind` and does not
  edit `correct.ts`; 2b keeps `kind: 'erasure'` as its own plan has it.
- The applied line reads "erased. Do NOT delete any Clerk user: the accounts are kept (K15), and step 7
  binds them."

**Accounts are kept (K15).** The core deletes the `household_members` rows and never calls Clerk. RC then
binds the same accounts: its in-transaction check finds no live membership, because the core removed it.

**Another household found.** The dry run also prints `households not in SEED_PUBLIC_IDS: live N,
hidden M`, **on the found and the not-found path alike**, so step 4 can read it after step 3. It is **printed, never a refusal**: after R2 the family's own household is outside the set,
and this entry must stay usable as R4's remedy. Both must read 0 at step 0 (D4). If not, the fresh start stops: no tool here
removes another household, and 2b comes after R2.

**Constants.** `EXPECT_ERASED_ROWS` and step 5's three `EXPECT_*` names are exported from
`erasure-gates.ts`, as `CREATE_HOUSEHOLD_ACCOUNTS_ENV` is from `accounts.ts:24`. The `ERASE_*` refusal is
dropped: nothing reads those variables until 2b.

**Applied** is a dated entry, `issue: 'PRIV-3 · CAT-3 R0'`. K15's departures are named:

- no waiting period;
- accounts kept;
- no restore drill;
- **no export offered by the system**: the household takes its export at step 0, or the go records
  that it declined.

The README states the departure from rule 8 beside RC's (`corrections/README.md:42-44`): the target is
a committed constant, the operator decided it with no request, and K7 is public. The go and its date go
in the ledger, not the Applied row.

### D2. R1: `delete-legacy-movements-<date>`, step 5's correction

**What it deletes:** the **old** global movements only:

- `household_id IS NULL AND movementIsCatalog() IS NOT TRUE`, the spec's one predicate, imported from A2
  (NULL-safe: a predicate that can be NULL for an old row would otherwise select nothing and report
  "nothing to do"; the success case plants a legacy row with `modality` NULL), **or** `public_id` in
  `MOVEMENT_SEED_PUBLIC_IDS`, so an old row hand-`UPDATE`d to carry a `modality` (R4's count (2)) is also
  removed, the reference refusal still applying;
- with their `movement_equipment` and `movement_muscles` rows first.

Catalog rows are never touched.

- So a second run deletes nothing, before step 6 or after it.
- It stays usable after step 7 as R4's remedy, if old seed code writes the old rows back.
- A run between steps 6 and 7 cannot delete the fresh catalog.

This answers the question the first draft put to the spec's owner. Whether step 6's "zero skipped" then
holds, with any catalog rows A2-ii seeded before step 5, is A2's E1/E2 proof (spec, "The seed"). R1
cites it, not a hope. There is **no household refusal**: R4 says step 5 is kept as the remedy after the
household is back, so the reference refusal below is the guard.

**The references come from the catalog (R3):**

- They are read from `pg_constraint` (`contype = 'f'`, `confrelid = 'public.movements'::regclass`), with
  `conkey`/`confkey` mapped through `pg_attribute` and the two join tables excepted.
- **A multi-column FK is a refusal**, never a skip.
- Each count is built with `sql.identifier(nsp, rel)` and `sql.identifier(att)`, never `sql.raw`, and has
  **no `deleted_at` filter**, because a hidden row still holds the FK.
- A non-zero count refuses, naming the table and the count.
- The reader lives in `queries/movement-ownership.ts`, "ONE definition of 'a movement is REFERENCED'"
  (`:5-25`). `db:verify` asserts that its table set equals that module's two hand-listed tables plus the
  two join tables, so a new FK turns both definitions red together.

**The transaction:**

1. `SET LOCAL lock_timeout`/`statement_timeout`, as every writing correction (`registry.ts:434-435`).
2. `SELECT id … FOR UPDATE` on the legacy rows, then **re-run the reference count under the lock** and
   refuse if it is non-zero. The gate also refuses any FK into `movements` whose `confdeltype` is not
   `a` or `r` (NO ACTION or RESTRICT): a `SET NULL` or `CASCADE` edge would let the delete change
   household rows silently, which is the household graph's `NON_ABORTING_EDGES` lesson (`graph.ts:228`).
   Today every such FK is NO ACTION.
3. Delete the join rows and the movements by `id = ANY(<the locked ids>)`, so a row committed after the
   lock is never swept up. PGlite has one connection and cannot show that race, so this and the
   `FOR UPDATE` are held by a **source pin**, as 2a's lock mode is, not by a behavioural mutation.
4. Require each deleted count (`count()::int`) to equal the same-transaction count **and** the dry run's:
   three expected values, `EXPECT_LEGACY_MOVEMENTS`, `EXPECT_LEGACY_EQUIPMENT` and
   `EXPECT_LEGACY_MUSCLES`, each parsed as an integer ≥ 0.
5. If nothing is found, return "nothing to do" before comparing.

**The dry run always prints every count** (references per table, legacy movements, both join tables) and
any "would refuse: …" reason, and exits 0. Only `--apply` refuses. So the dry run against production
before R2 shows numbers, not a refusal.

**Not limited to production, on purpose.** The reference refusal is D2's only guard. Against a local or
preview database it deletes unreferenced legacy rows, which the seed puts back.

**Errors** go through `redactedFailure` inside the entry, as RC's do. The gate,
`legacyMovementDeletionIssue({ references, compositeFks, expected, found })`, is pure and has a
colocated test.

### D3. R4: the counts on `movementsOwnershipReport`

R1 builds on A2's version of the report (A2 re-predicates its discriminators), not today's. It widens
the existing seed-namespace line (`registry.ts:678`) rather than adding a parallel one. Its counts, all of
which must be 0:

1. households and profiles whose `public_id` is in `SEED_PUBLIC_IDS`;
2. movements whose `public_id` is in `MOVEMENT_SEED_PUBLIC_IDS`, all rows;
3. global movements that are `NOT movementIsCatalog()`;
4. catalog entries with no global catalog row on their slug. This is read from the table, not from a
   seed log: `ON CONFLICT DO NOTHING` reports success while inserting nothing (`docs/lessons.md` →
   Database), so a skip count cannot see a missing row.

A hand `UPDATE` that gave an old row a `modality` shows in (2). The report prints counts only. F1, which
retires `MOVEMENT_SEED_PUBLIC_IDS`, lands after R4's second run or keeps (2) working; the spec's F1 row
is told.

### D4. R1: the runbook

**"Restore from a Neon branch"** fills the stub at "Cut a Neon RESTORE branch before a destructive/backfill
migration" (`runbooks.md:1223`). The household delete, the migration rollback and the fresh start all
point at it.

- **Cut:** a branch of the production project's default branch, with no compute attached and readable
  by the project's members only. Record its name and expiry in the ledger, never in git.
- **Restore:**
  - the Neon operation that resets the default branch onto it, which keeps the connection strings;
  - what is lost: everything after the cut;
  - why no migration journal reconcile is needed while merges are frozen, checked against
    `__drizzle_migrations`.
  - A branch with no compute can still be restored from. ⚠️ _Unverified against Neon's docs at the
    time of writing_; R1 cites the page it relied on.
- **Never attach compute to the branch during steps 3–8.** It passes every gate in D1: same name, same
  rows, the seeded household found.
- **Delete:** on the expiry date, record the deleted date, and then delete the ledger entry once Neon's
  6-hour point-in-time window has also passed.

**"The fresh start (CAT-3 R2)"** is marked **one time**. The spec's post-R2 cleanup row removes it, so it
does not become a permanent runbook of dated steps nobody re-runs. R5's line sits above the first
command. The steps:

- **Step 0:**
  - the households check from D1's dry run (only the seeded household exists);
  - the household takes each athlete's in-app export, and is offered the full copy, hidden rows included
    (the household delete's step 1: the in-app export is partial). Either is taken, or the go records
    that it was declined;
  - the close-out notice PR is open as a draft (D5).
- **Steps 1–9:** the spec's, each with a **"Second run:"** line. The branches:
  - **Step 4 re-runs D1's dry run:** it must print "the seeded household is not here" and other
    households live 0, hidden 0. A household found there stops the fresh start.
  - If step 6's log shows a skipped entry, re-run step 5, then step 6.
  - **If the run stops after step 3,** the close-out's athlete and household sentences still land: they
    became true at step 3, whatever happens later.
- **Step 7** points at RC's "What R1 must carry" (`priv-3-rc-create-household.md:275-287`) instead of
  copying it.
- **The production connection string** is read once with `read -rs`, passed inline as `"$var"`, and
  `unset` at step 8. It is never typed into a command line, and history is the leak
  (`runbooks.md:566`).
- **Every production command runs in the operator's own terminal**, never in an agent session, so no
  credential or count reaches a transcript.
- **The output stays on the terminal.** It is never pasted into a PR, an issue or the Applied row.
- **The never-restore rule, widened:** once step 7 has run, production is never restored to any point
  before step 3, whether from the branch or by point-in-time restore.

**The ledger entry** is added to the ledger's field table (`runbooks.md:1813-1820`), not restated
elsewhere:

| Field                  | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| Grain                  | household                                                     |
| Household `public_id`  | the seed household's constant                                 |
| Verifying channel      | "the maintainer's go (K15)", with its date and role           |
| Clerk ids              | none (K15)                                                    |
| Export                 | in-app export and full copy: each taken, or declined (the go) |
| Apply date             |                                                               |
| Branch name and expiry |                                                               |
| Branch-deleted date    |                                                               |

### D5. The notice and inventory sentences

R0's row lists:

- the notice's sentences on the seeded athletes and on shared movement names;
- inventory §1b's paragraph on leftover global rows;
- inventory §8.

They describe production after R2.

**When they land:**

- Before R2, #592's wording holds: the starting athletes "are removed together … when the app is started
  fresh". This plan leaves it alone.
- During the sitting and after it, the close-out PR carries every passage that goes stale. It is opened
  as a draft at step 0 and merged at step 8's unfreeze.
- If the sitting stops after step 3, its athlete and household sentences merge anyway.

**What the close-out changes.** The list is drafted against `main`, where #592 now is. The known
passages:

- the notice:
  - the starting athletes' sentence and #592's "one exception" sentence;
  - limitations 2 and 3 on shared names (`notice.md:134-146`);
  - "Movement names";
  - "Last updated", and the re-review line;
- the inventory:
  - #592's §5 paragraph;
  - §1b's leftover-rows paragraph;
  - §4's movements row (`:529`);
  - §8's movement-name row (`:876`);
- `notice-content.ts`, regenerated with `pnpm --filter web privacy:generate`.

It adds a dated "What changed on …" entry: the history was erased on the maintainer's decision, the
accounts were kept, there was no pause, and the restore point is held 7 days. The movement-names sentence
is drafted as: _"Every name in the app's own list is written by the project. A name your household types
that is not already in the list is stored as your household's own, and is deleted with your household.
Please type only the name of an exercise there, never a person's name or anything personal."_

**§5's removal paths do not wait for the close-out.** R0's PR adds R0's path, and R1's PR adds D2's.
Each path exists from its own merge.

## R0's deltas to other plans

### Applied in this PR: `priv-3-guarded-deletion.md`

- **The order:** it drops `OPS-3`, which #628 moves to before the first invite. The new order is:
  1. PR 1 and RC;
  2. `OPS-2` PR 1;
  3. 2a;
  4. R0, then R1, after A2;
  5. R2;
  6. 2b, 3 and 3b.

  The `SEC-6` note under it says the re-key no longer runs for the seeded household, which K7 erases.

- **2b's file table:**
  - `seed-ids.ts` now reads `SEED_PUBLIC_IDS` and no longer adds it;
  - `erasure-gates.ts` becomes EDIT, since R0 creates it;
  - `householdScopeByPublicId`, `correctionTargetUrl({ kind })` and the `hasHostOverride` export are
    marked "from R0".
- **D4's checklist line** gains "(Q7)". "`hasHostOverride` … exported" is corrected to "exported by R0".
- **D6:** the starting athletes' notice sentence is R2's close-out, and `SEC-6` owns it only for a
  re-key outside the fresh start. `ID-1`'s for-life item is answered here (§ Where this sits).
- **D8** points at this plan.
- **Q7** is narrowed to the maintainer's own family, citing #628's rule.

### Applied by R0's code PR: `OPS-2`'s plan and `plan.md`'s `SEC-6` row

- **`OPS-2` Q2 and D8:**
  - After R2 no production row carries a seed id, so Q2's re-key has nothing left to act on.
  - D8's table stands. Old code run after R2 can at worst re-create role-named fixture rows, which
    R4's second run finds and D1's entry removes.
- **`OPS-2` PR 2 and D10** (hiding the fixture athlete by the seed household's id): after R2 they have
  no target in production. They are retired, and the order above drops them.
- **`OPS-2` D9 and `SEC-6`:**
  - The acceptance is narrowed to _"no live production household, profile or movement carries a
    committed seed constant as its `public_id`"_.
  - After R2 that holds by deletion, and R4 checks it.
  - The `rate-limit.ts` docblock clause stays with `SEC-6`, as a docs-only follow-up.

## File-by-file

### This PR (plan only)

| Path                                    | Change | What                                                                        |
| --------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `docs/plans/priv-3-fresh-start-prep.md` | NEW    | This plan                                                                   |
| `docs/plans/priv-3-guarded-deletion.md` | EDIT   | § Applied in this PR                                                        |
| `docs/plan.md`                          | EDIT   | `PRIV-3`'s row: links this plan; RC is "merged 2026-11-18", not "in review" |

### R0's code PR: `db/priv-3-r0-erase-seeded-household` (after 2a; about 300 lines, half proofs)

| Path                                                            | Change | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/db/scripts/corrections/registry.ts`                   | EDIT   | `householdScopeByPublicId`; the dated entry (D1)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/db/scripts/corrections/erasure-gates.ts` + `.test.ts` | NEW    | `seededHouseholdErasureIssue`; the `EXPECT_*` names                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/db/scripts/corrections/target-url.ts` + `.test.ts`    | EDIT   | `correctionTargetUrl({ kind })`; `targetIsLocalOrPreview()`; a missing database name is not production; RC's claim uses it                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/shared/src/db-environment.ts` + `.test.ts`            | EDIT   | Export `hasHostOverride` (so `db:mutations` runs locally: `packages/shared`)                                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/db/scripts/verify/erasure.ts`                         | EDIT   | Its own `withEnv` and console sink (verify.ts and harness.ts are PR 1's only, fam-1-family-program.md:716). Inside `rolledBack`, with a remote-looking target whose path is `/postgres` (PGlite's `current_database()`): the erasure, its output scan, the expected-total refusal with every graph table unchanged after it, the second run's throw, the preview and no-path refusals; a `…/mat_plan` target as the name-mismatch refusal. RC's no-path claim and `create-household` cases |
| `packages/db/scripts/mutations/NN-*`                            | NEW    | The gate stops refusing a preview; a no-path URL passes; the expected total is ignored; an account id is printed; not-found under `--apply` returns instead of throwing                                                                                                                                                                                                                                                                                                                    |
| `packages/db/scripts/corrections/README.md`                     | EDIT   | The Applied row; the rule-8 departure                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/features/erasure.md`                                      | EDIT   | `owns:` `erasure-gates.ts`; the third caller of the core                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/architecture.md`                                          | EDIT   | §8a: a node for the one-shot entry                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/privacy/data-inventory.md`                                | EDIT   | §5: the one-shot erasure                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/plans/ops-2-split-the-seed.md`, `docs/plan.md`            | EDIT   | § Applied by R0's code PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### R1's PR: `db/priv-3-r1-fresh-start-runbook` (after R0 and A2; about 380 lines with the runbook)

| Path                                                             | Change | What                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/queries/movement-ownership.ts`                  | EDIT   | The catalog-driven FK reader (D2)                                                                                                                                                                                                                                                                         |
| `packages/db/scripts/corrections/registry.ts`                    | EDIT   | `delete-legacy-movements-<date>` (D2); the report's counts (D3)                                                                                                                                                                                                                                           |
| `packages/db/scripts/corrections/movement-gates.ts` + `.test.ts` | NEW    | `legacyMovementDeletionIssue`                                                                                                                                                                                                                                                                             |
| `packages/db/scripts/verify/erasure.ts`                          | EDIT   | The reader equals the census plus the join tables; inside `rolledBack`, a scratch table with an FK into `movements` and one row refuses by name; a composite FK refuses; the counts equal the expected ones; catalog rows survive; a second run deletes nothing; the report's four counts on planted rows |
| `packages/db/scripts/mutations/NN-*`                             | NEW    | The reader reads a hand list; a composite FK is skipped; a hidden reference is filtered; the expected counts are ignored; a catalog row is deleted; count (4) reads a log instead of the table                                                                                                            |
| `packages/db/src/erasure/graph.ts`                               | EDIT   | The `REFERENCE_TABLES` docblock: the fresh start's one exception                                                                                                                                                                                                                                          |
| `docs/features/erasure.md`                                       | EDIT   | The global catalog survives every erasure except D2's legacy rows; never restore a pre-R2 extract                                                                                                                                                                                                         |
| `docs/runbooks.md`                                               | EDIT   | D4's two sections; the household delete's "cut a restore branch" points at the first                                                                                                                                                                                                                      |
| `docs/privacy/data-inventory.md`                                 | EDIT   | §5: D2's path                                                                                                                                                                                                                                                                                             |
| `packages/db/scripts/corrections/README.md`                      | EDIT   | The Applied row                                                                                                                                                                                                                                                                                           |

## Mutation numbers

This lane's block is 260–289, then 330–339, taken in PR order (`priv-3-guarded-deletion.md:478`). 260–278
are used. Before R2 come 2a (seven), R0 (five) and R1 (seven), which is 19 against the 21 left. 2b, 3 and
3b need about six more, so the board is asked for a further block now.

## Test plan

- **Unit (vitest):** each gate, every branch.
- **`db:verify`:** D1's and D2's cases above, hidden rows included, as in every erasure proof. Each case
  is paired with its mutation.
- **Production, before R2:** both dry runs, from the operator's terminal, printing counts only (R2). No
  copy of production is made.

## Risks / rollback

- **The wrong database:** refused on unset, local, preview, a missing name and a host override, then by
  `current_database()`. The step-2 branch passes all of that, so it never gets compute during the sitting.
- **An `--apply` nobody meant:** refused without this sitting's `EXPECT_ERASED_ROWS`.
- **Old seed code writes rows back:** R4's second run finds it; D1's entry and D2 are its remedy.
- **The catalog deleted:** D2 never selects a catalog row.
- **Rollback:**
  - before step 7: D4's restore procedure, then start again at step 3;
  - after step 7: never restore to a point before step 3; fix forward.

## Alternatives considered

- **Re-key first (`SEC-6`), then the ordinary erasure.** The R0 row offers it. Rejected: K7 deletes the
  household, so the re-key would only be deleted.
- **An override flag on `erase-household`.** Rejected: it would weaken the general refusal for good. A
  dated entry with no target cannot be pointed at anything else.
- **A `kind: 'erasure'` in the runner now** (the first draft). Rejected: RC's entry-level redaction
  already does the job. And an exit code decided in the runner is invisible to `db:verify`, so its
  mutation could never go red.
- **D2 deletes every global movement and refuses while a household exists** (the first draft).
  Rejected: that breaks R4's remedy after step 7, and a run between steps 6 and 7 would delete the
  fresh catalog.
- **A hand list of the tables that reference `movements`.** Rejected by R3.

## Out of scope

- 2b, 3 and 3b (after R2).
- `OPS-3`'s drill (before the first invite).
- `SEC-6`'s `rate-limit.ts` docblock.
- R2 itself, which the maintainer runs.

## Questions

### For the maintainer (through the board)

**Q7.** `OPS-3`'s drill now comes before the first invite (#628). An outside family's data is not
deleted before the drill. Does a deletion **of your own family's** data before then (an athlete, a
program) also wait for the drill? The options:

- **(a) No (recommended).** The restore branch is held 7 days, as always. The drill gates outside
  families only.
- **(b) Yes.** Requests wait until the drill.

### For the spec's owner (the roadmap thread)

- **D5:** the notice and inventory sentences move from R0 to R2's close-out.
- **D2:** step 5 deletes the old global rows only (`NOT movementIsCatalog()`), not "every global
  movement", and has no household refusal. R3's wording follows.
- **Step 0 and K15:** a fourth departure, "no export offered by the system", for K15's row.
- **F1:** it keeps R4's seed-namespace count working, or lands after R4's second run.
- **R5:** the go is recorded in the ledger, not the Applied entry, because of corrections rule 8.

## Review-response log (adversarial panel)

### Engineering panel (round 1, 2026-11-18)

> Models: high-stakes yes (destructive corrections run against production) · every lens opus. The
> Fable cap (until 2026-11-19) overrides the Fable default.

| #                           | Lens                  | Critique (short)                                                                                  | Verdict      | Resolution                                                                                              |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| P-B1                        | Privacy               | Athletes' history erased with no export step, and the skipped export is not named                 | **accepted** | Step 0; a fourth named departure; asked of the spec's owner                                             |
| X-B1                        | Security              | Nothing ties `--apply` to a dry run or the go                                                     | **accepted** | `EXPECT_ERASED_ROWS` (D1)                                                                               |
| A-B1                        | Architecture          | R0's table leaves out what it brings forward; the gate is a second resolver                       | **accepted** | `correctionTargetUrl({ kind })`, the export and the resolver in R0's table; gate takes the resolved URL |
| A-B2, S-S4, D-S5, R-8       | Several               | Mutation numbers collide with 2a                                                                  | **accepted** | `NN-*`; § Mutation numbers; a further block asked                                                       |
| C-B1                        | Correctness           | D2's household refusal breaks R4's remedy; a second run can delete the catalog                    | **accepted** | D2 deletes `NOT movementIsCatalog()` rows only, with no household refusal                               |
| D-S7                        | DB safety             | Keep the household check as a second guard                                                        | **rejected** | It is what breaks R4's remedy after step 7 (C-B1); the reference refusal guards                         |
| D-B1                        | DB safety             | No restore procedure exists                                                                       | **accepted** | D4's "Restore from a Neon branch", filling the stub                                                     |
| R-1, S-S3, C-S6             | Several               | 2b's table contradicts the deltas                                                                 | **accepted** | 2b's rows rewritten (this PR)                                                                           |
| X-S1, D-also                | Security, DB          | A no-path preview URL passes; no `current_database()` check                                       | **accepted** | Both in D1; RC's claim fixed by the same helper                                                         |
| X-S2                        | Security              | `hasHostOverride` is not exported                                                                 | **accepted** | R0 exports it                                                                                           |
| X-S3, A-S1, R-6             | Several               | The redacted catch turns the core's refusals into "unknown"                                       | **accepted** | Mapped to `CorrectionRefusal` from fixed fields in the entry                                            |
| X-S4, C-S1                  | Security, Correctness | No proof the found output has no account id; the applied text says delete Clerk users             | **accepted** | The output scan and its mutation; the applied line says not to                                          |
| X-S5                        | Security              | The production credential lands in shell history                                                  | **accepted** | `read -rs`, the operator's own terminal (D4)                                                            |
| X-S6, D-S3                  | Security, DB          | `pg_constraint` names built unsafely; composite FKs unaddressed; no timeouts; delete by predicate | **accepted** | All in D2                                                                                               |
| S-S1, C-S7                  | Scope, Correctness    | No `kind` needed; mutation on a runner exit code cannot go red                                    | **accepted** | No runner change; not-found under `--apply` throws in `run()`                                           |
| S-S2, C-S2, D-S4            | Several               | The verify cases cannot run as described; one proves something that does not exist yet            | **accepted** | `rolledBack`, a remote-looking target; the 2b case dropped                                              |
| S-S5, A-S6                  | Scope, Arch           | The `OPS-2` deltas have no PR; `OPS-2` PR 2 is pointless after R2                                 | **accepted** | R0's code PR applies them; PR 2 and D10 retired                                                         |
| S-S6                        | Scope                 | Questions point at nothing; Q7 overlaps #628                                                      | **accepted** | Committed here; Q7 narrowed; the removal runbook's questions go with #627                               |
| S-S7, A-S3, C-S5, R-4, D-S6 | Several               | R1 has no gate on A2; restated predicate; count (4) cannot see a missing row                      | **accepted** | R1 waits for A2; `movementIsCatalog()`; (4) read from the table                                         |
| A-S4, R-3                   | Arch, Reuse           | A second definition of "referenced"                                                               | **accepted** | The reader lives in `movement-ownership.ts`, with an equality assertion                                 |
| A-S5                        | Architecture          | The guide and the diagram go stale                                                                | **accepted** | Both tables                                                                                             |
| R-5, C-also                 | Reuse, Correctness    | The restore procedure gets a second home                                                          | **accepted** | It fills `runbooks.md:1223`                                                                             |
| R-7                         | Reuse                 | Env names as constants; share the verify harness                                                  | **accepted** | D1; `verify/harness.ts`                                                                                 |
| P-S1                        | Privacy               | D5 quotes text #592 rewrites, and covers 2 of about 8 passages; no plan for a stopped run         | **accepted** | D5 rewritten                                                                                            |
| P-S2                        | Privacy               | Three owners for one notice sentence; `ID-1`'s for-life item has none                             | **accepted** | D6 amended; the alignment line answers it                                                               |
| P-S3, X-N1                  | Privacy, Security     | The Applied row departs from rule 8 silently                                                      | **accepted** | The README states it; the go goes in the ledger                                                         |
| P-S4                        | Privacy               | The ledger entry is not specified; its deletion is missing; PITR not covered                      | **accepted** | D4's field table; the deletion step; the widened never-restore rule                                     |
| P-S5                        | Privacy               | R0's removal path reaches the inventory one PR late                                               | **accepted** | §5 in each PR                                                                                           |
| C-S3, D-S1, D-S2            | Correctness, DB       | Step 5 cannot be dry-run before R2; one expected count for three                                  | **accepted** | The dry run always prints counts; three expected values                                                 |
| C-S4                        | Correctness           | No way forward if another household exists                                                        | **accepted** | Printed by D1's dry run; a step-0 precondition; the fresh start stops                                   |
| P-N1                        | Privacy               | Where the dry-run output goes                                                                     | **accepted** | It stays on the terminal                                                                                |
| P-N2                        | Privacy               | The drafted movement-names sentence is loose                                                      | **accepted** | Redrafted                                                                                               |
| S-N1                        | Scope                 | Sizes; the `ERASE_*` refusal guards nothing yet; the one-time section needs a removal trigger     | **accepted** | Sizes given; refusal dropped; marked one-time                                                           |

NITs batched: D2's `kind` and strings (none: entry-level, as RC); step 4 is D2's dry run; the
`household_members` row is named, not numbered; RC's stale status in `plan.md`; `count()::int`.

### Engineering panel (round 2, light re-review, 2026-11-18)

Privacy, security, architecture and DB safety closed every round-1 finding of theirs and raised nothing
BLOCKING. (DB safety withdrew D-S7 against the rejection above.) Their new findings, all **accepted**:

| #           | Lens         | Critique (short)                                                                    | Resolution                                                                               |
| ----------- | ------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P2-1        | Privacy      | Step 0 offers only the partial in-app export                                        | The full copy is offered too; the ledger row says which                                  |
| P2-2        | Privacy      | Recording the go in the ledger changes spec R5                                      | Asked of the spec's owner                                                                |
| X2-1, D2-N2 | Security, DB | No mechanism for comparing the expected total inside the core's transaction         | The entry's `tx` is passed to the core; graph tables asserted unchanged after a mismatch |
| X2-2        | Security     | One local-or-preview helper with the missing name folded in fails open in the claim | A separate predicate, refused by each caller in its own direction; two test cases        |
| X2-N        | Security     | D2 has no database gate                                                             | Stated as deliberate                                                                     |
| D2-1        | DB safety    | D2 no longer re-counts references under the lock; a non-aborting FK would be silent | The re-count, the `confdeltype` refusal and two mutations                                |
| D2-2        | DB safety    | Step 4 names a tool that does not print households                                  | Step 4 re-runs D1's dry run                                                              |
| D2-N1       | DB safety    | The predicate must be NULL-safe                                                     | `IS NOT TRUE`; the case plants a NULL-`modality` row                                     |
| A2-1        | Architecture | D1's name check refuses PGlite's `postgres` database in the success cases           | A `/postgres` target for those; `/mat_plan` as the mismatch case, with its mutation      |
| A2-2        | Architecture | R0 edits `verify.ts` and `harness.ts`, which are PR 1's only                        | Helpers kept local to `verify/erasure.ts`; RC's cases move there                         |
| A2-N        | Architecture | Say that the other-households count never refuses                                   | Stated                                                                                   |

Correctness's re-review: N1, N4 and N6 were closed by the round above. **N2** (D1's not-found dry run
prints the households line), **N3** (the locked-ids delete is held by a source pin, since PGlite cannot
race), **N5** (`priv-3-guarded-deletion.md` D8 no longer says R0 adds a `kind`) and the hand-`UPDATE`
NIT (D2 also deletes a seed-namespace id) are **accepted**.
