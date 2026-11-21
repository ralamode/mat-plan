# CAT-3 after the fresh start — the test databases, the clean-up, the old list and the upsert

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), criteria **E6**, **P12** and **F1**,
> rules 4, 6 and 7, decisions **K22 to K24**, and the rows **A3**, **Post-R2 cleanup** and **F1** of
> "Chunks, in order". Branch for this plan: `docs/cat-3-after-the-fresh-start-plan`.
>
> **Draft 4, not yet approved.** Drafted by the plan owner on 2026-11-20 from the code on `main`
> (`b6ef8287`) and #770's branch. Two panel rounds (two lenses each) and the feasibility checks of lane B,
> lane P and the Native Scaling thread are applied; the log is at the end. The maintainer approves
> it before any of its PRs is built.

## Where this sits

- **Pillar:** the movement library. It is shared reference data, so it has no pillar in
  roadmap.md's table.
- **Milestone:** Beta 0, `CAT-3`. These are the steps that had only a row: everything after the
  fresh start (R2).
- **Before it:** A2-ii (the seed's switch, #770), R1 (the runbook, #710) and R2, the fresh start,
  which is a production run by the maintainer and not a code PR. R2's own close-out PR is planned in
  [priv-3-fresh-start-prep.md](./priv-3-fresh-start-prep.md) (D5) and is not repeated here.
- **What a family sees.** PR 1 and PR 3 change nothing a family sees. PR 2 changes one thing: a
  typed name that the server already has is added with its unit. PR 4 can change a movement's name,
  equipment or muscles on the day page and in exports, when its entry was corrected. So the week of
  real use does not wait for PR 1 to 3, and PR 4 waits for it (Q5).
- **Until PR 4, an edit to a library entry never reaches production.** The seed inserts and does
  nothing on a conflict.
- _Roadmap alignment (2026-11-20): advances `CAT-3`. It adds no column, scope or authority, and no
  feature. Checked against the private roadmap; nothing to add here._

## What changes from the spec's rows, and why

The spec's rows say the clean-up waits only for the fresh start, and that F1 comes last. Reading
the code on `main` gives a different order.

1. **The interim code cannot go while a test database still holds an old built-in.** After A2-ii a
   fixtures database is seeded with the test library and then with the 35 old built-ins
   (`seedLibraryOf('fixture')`, `legacyMovements`). `program-builder.spec.ts:139` picks "Box Jump"
   and "Pull-Up", six items of the fixture world resolve to old built-ins by name, and more than
   twenty `db:verify` proofs read one. So the picker's interim paths are exercised on every CI run
   after the fresh start. Deleting them first would break those, or leave old rows nothing lists.
2. **So F1 is split in two, and its first half goes first.** F1-i makes a test database hold what
   production holds: library rows and a household's own rows, with no old built-in. Then the
   clean-up deletes the interim code with nothing left to exercise it. F1-ii deletes the old list
   itself, and waits for more than the spec asked (PR 3's gates).
3. **P12 lands with the clean-up**, as the row allowed ("which may be this one").
4. **The clean-up is bigger than "four markers".** `main` has nine `TODO(CAT-3 chunk R…)` markers in
   seven code files, and 39 lines marked ⏳, twelve of which name the fresh start, chunk R or F1.
5. **F1's row asked for "after B3 and FAM-1's lanes, so no lane is churned mid-step".** Both are
   done. PR 1 still changes every lane's fixtures database, so the board announces it before merge.

## The PRs

| PR                                | What                                                                             | Waits for                                                                         | Built by                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **PR 1 · F1-i**                   | Test databases hold the library only                                             | The fresh start, and its first check (R4) clean                                   | Seed and proofs: lane P (Q2). Test library: the contract owner. Specs: their owners                        |
| **PR 2 · the clean-up, with P12** | The interim code and the legacy groups go                                        | PR 1                                                                              | One PR on the contract owner's branch, with lane B's and lane P's commits added from local branches off it |
| **PR 3 · F1-ii**                  | The old list, the fresh start's two one-shot corrections and its report lines go | The four gates in its section                                                     | The contract owner, with Native Scaling's commits for the corrections and the runbook                      |
| **PR 4 · A3**                     | The seed keeps a stored library row equal to its entry                           | The fresh start; the trial week's end, or the maintainer's go (Q5). Not PR 1 to 3 | Lane A when it restarts (Q2)                                                                               |

**Count: four PRs, none split.** A3 is one PR: a row-only half would leave names updated and
equipment stale in production. The earlier estimate was "about six". PR 1 and PR 4 both edit the
seed and `verify/catalog.ts`; whichever lands second rebases.

## PR 1 · F1-i: test databases hold the library only

**Why first.** It makes CI test the state production is in after the fresh start.

- **The fixtures seed.** `legacyMovements` is **deleted** from `SeedLibrary`, not set to false, and
  the fixtures-side insert of `MOVEMENT_SEED_ROWS` goes. The const itself stays until PR 3. Spec E4's
  "until F1" becomes "until F1-i".
- **The legacy program fixture, in the same commit** (`seedProgram` throws on an unknown slug).
  `PROGRAM_SEED` (`packages/shared/src/programming.ts:295`) is rebuilt as a generic block over
  test-library slugs and **renamed `LEGACY_PROGRAM_FIXTURE`**, so F1's "nothing imports
  `PROGRAM_SEED`" holds as written. It stays a fixture of the legacy block tables, which the export
  (`apps/web/lib/dal/export.ts:73`, through `programDayRows`) and the legacy strength writer still
  read; retiring those is `LEGACY-1`. No app code is typed on the old slugs.
- **The fixture world's items.** Its 26 items are the accepted prototype's and do not change. On a
  fixtures database today 4 resolve to test-library rows, 6 to old built-ins (Push-ups, Pull-up,
  Hollow-body hold, Inverted row, KB swings, Box jump) and 16 are the household's own. After PR 1 it
  is 4 and 22: those six become the household's items under the world's own names.
- **The specs.** `program-builder.spec.ts` (two items, at `:139`, `:168`, `:192`) uses test-library
  names; the comment at `day-page.spec.ts:218` is corrected. No old name is added to the test
  library for a spec's sake (Q3).
- **Proofs and tests re-cut here**, because each needs an old built-in on a fixtures database:
  - `verify.ts`: `:655-672` (the counts), `:3870-3922` (the old program's block), `:5959` (TEN-1
    1d), `:6703-6840` (TEN-2a, TEN-2c membership), `:6762-6766`, `:6872-6880` (TEN-2b), and the
    TEN-2c guard at `:7100-7120`, which says "the seed restores it" and no seed does any more.
  - `verify/schema.ts:170-290`, `:362`; `verify/seed.ts:170-175`, `:317`; `verify/catalog.ts:479`,
    and its "one legacy `sled_push` before the seed" pin (`:575-601` on `main`).
  - `verify/program.ts`: `(a2)` at `:1892-1920`, which becomes "a fixtures database holds no old
    built-in"; `(a3)` at `:2022`; `:2144`; FAM-1 6a-iii-a at `:2164-2210`, group, alias and
    `box_jump` asserts included; `:3703`, `:4156`, `:4233`. After this PR none of them reads
    `MOVEMENT_PICKER_ENTRIES`.
  - `apps/web/lib/programming/contract.test.ts:145-205`.
  - Mutations: 45, 326, 327 and 329, which patch the `PROGRAM_SEED` line of `seed()` and prove
    production's seed writes no program or household; 517 and 598, which need the legacy insert (598
    retires with `legacyMovements`); 602.
- **Acceptance.**
  1. After `seed({ fixtures: true })` on a fresh database, no global movement fails
     `movementIsCatalog()`.
  2. The whole e2e suite passes with no old built-in's name in any spec.
  3. `db:verify` and `db:mutations` pass, and each re-cut proof is shown to fail on its mutation.
  4. `seedLibraryOf('catalog')` and production's branch of `seedReference` are unchanged in what
     they write (the diff is shown in the PR), and #770's equality pins still pass.

## PR 2 · the clean-up, with P12

One PR, because removing `outsideWithoutData` from the contract breaks the picker and the read in
the same compile. It is opened on the contract owner's branch; lane B and lane P add their commits
from local branches off it, as FAM-1's contract changes C32 and C35 did.

**The check that it is complete:** in the files below and in `docs/features/`, neither
`TODO(CAT-3 chunk R` nor a `⏳` that names the fresh start, chunk R or F1 is left.
(`supersets.ts`'s `.group` is the superset's group, an unrelated field.)

**The contract owner's commits.**

- `packages/shared/src/movement-search.ts`: `outsideWithoutData` (`:501`, with `:504`, `:522`,
  `:583`, `:600`), and its tests in `catalog/filters.test.ts` and `catalog/search.test.ts`.
- `packages/shared/src/catalog/option.ts`: the ⏳ note. `program-contract.md:722`: its ⏳ line.
- **P12:** `packages/shared/src/movement-picker-catalog.ts` is deleted with its test, and its
  re-export at `packages/shared/src/index.ts:26`. `RECENT_MOVEMENTS_LIMIT` has no reader but its own
  test, so it is deleted and not moved. The tests that import `MOVEMENT_PICKER_ALIASES` lose those
  cases: `catalog/catalog.test.ts:8`, `:455`; `movement-search.test.ts:5-18`;
  `program/existing-item.test.ts:3`, `:145-152`.
- `apps/web/app/design/program/picker-options.ts`: `interimGroupOf` goes with `group`.
- **A shape change (Q6): `newItem`'s success answer gains `owner`, `unitDefault` and
  `isBodyweight`** (`packages/shared/src/program/actions.ts:113-120`, with `NewItemResult` at
  `packages/db/src/writers/program/new-item.ts:24-29`). Additive. `owner` is the two-word enum the
  option already uses (`'catalog' | 'household'`), never a household's or a movement's id. The answer
  comes only from rows `movementIsAvailableTo` the caller, and the tenancy mutation on that predicate
  covers the new fields. It is what lets the picker's fix below work without a new read. The
  preview's fake changes only its two returns (`fakes.ts:603`, `:619`). The exact-shape assertions
  that change: `actions.test.ts:95`, `:379`; `program-dal.test.ts:24`; `verify/program.ts:2277`,
  `:2327`, `:2366`; and mutations 308, 381 and 383, whose context lines move.

**Lane B's commits** (the picker; lane B's own files and guides).

- K24's "Not sorted yet" section: `movement-picker.tsx:1750-1770`, `browse-view.ts:53`, `:69`,
  `:109-118`, `:141`, `:188`; its copy, `movement-picker-copy.ts:88`.
- The option type `BuiltInWithoutLibrary` (`movement-option.ts:76-80`) and the DTO's `group`
  (`:61-65`); in `movement-picker.tsx`, `rowMeta`'s branch (`:268-270`), `:528-533`, the
  `tagNoLibraryData` branch (`:566`) and `statusAlreadyListedNoData` (`:681-683`); `outsideLine`'s
  `bare` parameter (`movement-picker-copy.ts:187-212`, `:226`, `:285`); `builder-text.ts:517`.
  `hasLibraryData` stays: it is true of a household's own item too.
- **A fix, not a deletion:** `item-picker.tsx:283-295`, `made()`. It builds an item the server
  answered as existing, with no unit. It now maps the answer's `owner`, `unitDefault` and
  `isBodyweight`. **Its own test:** Enter on a typed name that matches only a catalog row not in the
  list selects that row with its unit.
- The tests that only make sense before the fresh start, in `movement-picker.test.tsx`,
  `movement-picker-filters.test.tsx`, `browse-view.test.ts` and `movement-picker-copy.test.ts`; and
  `withoutLibraryData` in `test/movement-picker-fixtures.ts`.
- Guides: `movement-picker.md:6` drops the deleted file from `owns:` (`guides:check` fails on a
  path that does not exist), and its ⏳ lines at `:48`, `:148`, `:150`, `:282`, `:343`;
  `program-builder.md:437`.
- No UX panel beyond one reviewer: nothing new appears, and a section that is always empty goes.

**Lane P's commits** (the read).

- `movement-options.ts`: `PICKER_SLUGS` (`:36-38`), the first half of
  `or(inArray(slug, PICKER_SLUGS), movementIsCatalog())` (`:99`), and `pickerEntryOf(row.slug)`
  (`:156`). The catalog arm becomes `movementIsCatalog()` alone.
- `catalog-arm-option.ts`: cases 1 and 2 of the four-case table (an old built-in, with and without
  an entry), the `fromLibrary` fallback (`:178-188`), the `pickerEntry` parameter, `group` and its
  type (`:12-13`, `:43-44`, `:175`) and `joinAliases`' const half. `tables` becomes required, with a
  row that has no join rows handled, so `taxonomy` is never `null`. Case 4, a catalog row with no
  entry in the library given, stays.
- `newItem` returns the three fields: from the option on a match; on its same-slug and new-item
  branches the selected `columns` (`new-item.ts:113-117`) gain `householdId`, `unitDefault` and
  `isBodyweight`, and `owner` is `'catalog'` when `householdId` is null.
- `apps/web/lib/dal/program/picker.ts`: the `BuiltInWithoutLibrary` arm (`:24`, `:55-63`).
- Tests and proofs: `picker.test.ts:6`, `:333-335`; `catalog-arm-option.test.ts:5`, `:29` and its ⏳
  `describe` (`:102`); the import at `verify/program.ts:25`; mutations 592, 593, 595 and 397.

**One alias would be lost, and it needs an entry change first.** Deleting
`MOVEMENT_PICKER_ENTRIES` removes the aliases the old list gave the 12 slugs that are in both
lists. Recomputed twice on 2026-11-20 against the 587 entries: every one is answered by the library
entry's own name or aliases except **"BSS"** on `bulgarian_split_squat`. So before this PR an alias
is added to that entry, through the usual batch review with the maintainer's approval (Q4).

**Acceptance.**

1. The completeness check above passes, and nothing in `packages/` or `apps/` imports
   `movement-picker-catalog`.
2. The picker's browse, search and filters behave as on `main` for a database holding the library
   and a household's own items: the existing tests for those pass unchanged.
3. `item-picker`'s new test passes, and fails without the fix.
4. The route bundles move by less than the gate allows, or the PR states the numbers and why (#713).

## PR 3 · F1-ii: the old list goes

**Gates, all four.** The fresh start's two corrections are the only thing that can remove a
seeded household or an old built-in: `erase-household` refuses a seed id. So they are not retired
while anything could bring that data back.

1. PR 2 merged.
2. The fresh start's second check (R4, at the start of the trial week) clean.
3. Production's seed unable to write an old row, which holds by construction once PR 1 deletes
   `legacyMovements`.
4. **No branch of production cut before step 5's apply still exists**, the fresh start's restore
   branch and #770's rehearsal branch included, each with its deleted date in the ledger; and
   production's history retention, read from the Neon console's project settings on the day (6 hours
   when this was written), is shorter than the time since step 5's apply. Until then a restore can
   reach a point before the fresh start, and the spec says steps 3 to 8 are then run again.

It also merges after R2's close-out PR, which corrects the privacy notice's sentences about the
procedure this PR removes.

- **Deleted, the old list:** `MOVEMENT_SEED_ROWS` and `MOVEMENT_SEED_PUBLIC_IDS`
  (`packages/shared/src/catalog-movements.ts`), with every reader the import scan finds. On `main`
  those are `seed.ts`, `verify.ts`, `verify/{schema,program,catalog,seed}.ts`,
  `corrections/registry.ts:687-721`, `catalog/catalog.test.ts:443`, `movement-search.test.ts`,
  `test/movement-picker-fixtures.ts:47`, `movement-picker.test.tsx:57`,
  `lib/dal/program/picker.test.ts:321-359` and `lib/programming/contract.test.ts:183`. The comments
  that name the old list are corrected: `schema.ts:815`, `movement-ownership.ts:137`,
  `catalog/fixture.ts:31-33`, `seed-ids.ts:52`, `strength-session-schema.test.ts:234`.
- **Production's seed changes in one way:** the legacy-slug shadow count (`seed.ts:391-394`), which
  runs on every push, is retired with the list it reads, and the catalog count's legacy-slug filter
  (`:396-400`) goes with it, so a household's row on one of the 12 shared slugs is still counted.
  Proved in `db:verify`: OPS-2 A (`verify/seed.ts:130-198`), which already seeds a fresh database in
  production mode twice, asserts the report's lines less the shadow count; a household row on a
  shared slug is counted once, with the count-only privacy assertion re-pointed; and a mutation restores the filter. Mutation 518 retires with the filter, and A2-i's E5 pin (`verify/catalog.ts:685-706` on #770, "counted once, as legacy") becomes "counted once, as a library slug". `runbooks.md`'s "The seed's shadow guard fired" is updated to the new log
  line. The first deploy's seed log is read after merge.
- **Deleted, Native Scaling's commits.** The code of the two one-shot corrections
  (`erase-seeded-household-2026-11-19`, `delete-legacy-movements-2026-11-20`), on the rule change of
  Q7:
  - with R0: `seededHouseholdErasureIssue` and `EXPECT_ERASED_ROWS` (`erasure-gates.ts`) and their
    tests; R0's sections of `verify/erasure.ts`; mutations 336 to 339 and 540 to 544;
  - with R1: `movement-gates.ts` and its test; R1's additions to `queries/movement-ownership.ts`;
    R1's sections of `verify/erasure.ts`; mutations 545 to 561;
  - the report's fresh-start lines with their "0 only after step 7" header.
  - **Kept:** `parseExpectedRows` if anything still uses it; `correctionTargetUrl({ kind:
'erasure' })`, which `erase-household` will need; `correctionTargetDatabaseIsUnnamed`;
    `hasHostOverride`; the older erasure proofs; mutation 276, whose context is only re-checked.
  - `corrections/README.md`: the two **Applied rows stay, dated, as the record**, and rule 6 gains
    its one exception. Each row cites the PR that added the correction and the last commit that held
    its code, so a later reader can read exactly what ran. No row counts are added to it.
- **The alarms that stay:** the report's count of households and profiles whose id is a seed id
  (`SEED_PUBLIC_IDS`, which this PR does not delete), and its line that every global movement is a
  catalog row. The count of movements with a seed id reads the list this PR deletes (Q8).
- **The runbook.** The one-time "Fresh start" section goes. **Its standing rules move to "Restore
  from a Neon branch" and are not deleted:** never restore to a point before the fresh start's step
  3, never restore an extract taken before it, and hand-run a seed only from a fresh `origin/main`.
  If `erase-household` has shipped by then, the restore step's "stop and keep the app disabled"
  becomes "re-apply each ledger entry".
- **Privacy documents.** `data-inventory.md` §5 is rewritten where it says a seed id has no removal
  path and that the erasure "stays the remedy" (`:734-743`): after this PR no procedure removes a
  seed-id household or an old built-in, and one that came back would need a new dated correction,
  owned by `PRIV-3`'s owner.
- **Other docs:** `docs/spec.md:76-78` and its diagram (`:142-156`) gain the tracking type, the kind
  of training, equipment and muscles; `docs/architecture.md:605-626` stops saying the catalog is
  seeded from the old list; `movement-picker.md:380` loses "until F1".
- **Acceptance.** F1's import scan as the spec words it: nothing in `packages/` or `apps/` imports
  `PROGRAM_SEED`, `MOVEMENT_SEED_ROWS` or `MOVEMENT_SEED_PUBLIC_IDS`. `db:verify` and
  `db:mutations` pass.

## PR 4 · A3: the upsert

What E6 asks, with lane P's and the panel's points as the design.

1. **Read, compare, and update by id only the rows that differ.** New entries keep A2's insert, which
   does nothing on a conflict. For a stored catalog row whose entry differs, the seed runs
   `UPDATE movements … WHERE id = … AND household_id IS NULL AND modality IS NOT NULL`. A push with
   no entry change updates no row and takes no row lock. (The insert still advances the identity
   sequence, as `migrate.yml`'s header says.) **This is not E6's `onConflictDoUpdate`, and this PR
   amends E6's wording** (lane A's finding): E6's `targetWhere: modality IS NOT NULL` alone cannot name the arbiter, because the global slug index is partial on `household_id IS NULL` and Postgres does not use a CHECK constraint to infer it, so as worded it fails with "no unique or exclusion constraint matching". Naming the index with `movementIsGlobal()` and filtering in a `setWhere` would run, but a blanket upsert locks every conflicting row even where it writes nothing, all 587 on each push, and cannot report why a row was skipped. An update by id locks and reports only what it changes.
2. **Only live catalog rows.** `id` and `public_id` never change. Kept equal to the entry: name,
   kind of training, pattern, `unitDefault`, `isBodyweight`; the update sets `updated_at` itself,
   since no trigger does. It never writes `deleted_at`, `household_id` or `tracking_type`, and never
   clears `modality`. A row with `deleted_at` set is skipped and counted, on the insert path too:
   today a soft-deleted global row holds its slug and the insert passes over it silently. Aliases,
   the supervision label and the steps are not stored, so nothing here touches them.
3. **Join rows by difference**, in the same transaction. A muscle whose role changes is updated in
   place, never deleted and re-inserted, and a change of primary is two statements, the demotion
   and then the promotion: neither the pair index (one row per movement and muscle) nor the
   one-primary index can be deferred, so each row is checked as it is written. The stored rows end
   **equal as a set** to the entry's; their order is not kept, and no reader may rely on it (the
   read orders by the vocabulary, K31), so `seedCatalog`'s docblock stops promising the authored
   order. This is the first code that deletes a catalog join row, so it carries its own proof that
   it never touches a household's row.
4. **It never throws on catalog data** (rule 7), for an update or for a new entry. `migrate.yml` has
   no rollback, and a throw after the migrations leaves every later push red. Each write is checked
   first: a unit, equipment or muscle code the reference tables lack, or a change that would break
   `movements_global_row_has_pattern` or the pattern and kind-of-training checks, is skipped and
   counted. That replaces A2's "a bad entry is fixed forward" throw on the insert path, since a new
   entry with a mistyped code would block deploys exactly as an edit would. The library transaction
   is the only unit. A mutation proves a would-fail row turns `db:verify` red if it is thrown and not skipped. **A skip must never hide a bad entry:** `db:verify` asserts that seeding the whole real library on a fresh database skips nothing, for every reason, and a mutation that plants an entry with a code the reference tables lack turns that assertion red. The entry schema's enums catch a bad code before merge, but they are the shared lists; this catches a reference table that lags them, and an entry that passes the schema and breaks a database-only check. In production the count stays in the seed's log, where a non-zero means a lagging reference seed or a hand edit.
5. **The tracking type is never updated.** If a stored type differs from the lockfile's, the row is
   skipped and counted, as E6 says; a real type change is a new movement.
6. **No slug is retired here.** The append-only check and the lockfile test (`lockfileIssues`) keep
   every shipped slug. If one ever must go, that is a correction with its own plan.
7. **The first production run is not a no-op.** It applies every entry correction merged since the
   seed's switch, to rows the family logs against. So **before merge the maintainer runs the seed
   from the PR's head on a child branch of production**: it prints rows updated, join rows added
   and removed, and rows skipped; a second run prints 0 for each. Only the counts go in the PR. The
   merge needs the maintainer's go. The child branch is deleted in the same sitting. The counts are
   of library rows only, never of a household's rows, and nothing else from the branch is pasted.
8. **Proofs.** Its own mutation range, a block lane A asks the board for (about six: 505 re-cut; thrown, not skipped; a join-row delete reaching a household's row; a second run that writes; a write to the tracking type; an old row adopted). It re-cuts A2-ii's "a second run inserts nothing" into
   "updates nothing when no entry changed, and exactly the changed rows when one did", and
   `assertOnlyLibraryRowsAdded` into "an existing global row changes only where its entry changed".
   It re-cuts mutation 505 so that the update would adopt an old or a household's row, keeps the pins at `verify/catalog.ts:500-512`, and re-cuts the pins on the join rows' authored order (`verify/catalog.ts:350`, `:392-404`, `:469`, and mutation 510's expected text) to set equality.
9. **The lines that stop being true:** `AGENTS.md:150`; `migrate.yml`'s header; the docstrings in
   `seed.ts:433-452`, `scripts/seed.ts:10`, `catalog-movements.ts:34-38` and `schema.ts:127`;
   `movement-catalog.md` invariants 4 and 6; `catalog-data.md:78-80`; `lessons.md:76`;
   `runbooks.md:532`. `runbooks.md`'s "Correct wrong data in prod" gains: a catalog row is corrected
   only by editing its entry through batch review, whose approval hash is what stops a wrong name
   reaching every household; a hand `UPDATE` is reverted by the next push. A change to
   `migrate.yml` is a CI workflow change and goes to the maintainer.
10. **Privacy.** It stores nothing new. A renamed movement changes the name shown on past logs and
    in exports, so the PR records that the inventory's §1a and the notice's words on movement names
    were re-read and that neither changes.

**Acceptance.** E6 as amended, plus: a seed run after an entry's name, equipment and primary muscle
change leaves that row and its join rows equal to the entry and every other row's `updated_at`
unchanged; a household's row of the same name is untouched; a changed type, a soft-deleted row and
a would-fail change are each skipped and counted.

## Risks

- **After PR 3 no procedure removes a seed-id household or an old built-in.** The four gates are
  what make that safe. If one ever came back (an old checkout's hand-run seed, an extract from
  before the fresh start), the remedy is a new dated correction, owned by `PRIV-3`'s owner.
- **`OPS-3`'s restore drill** cannot replay the fresh-start erasure once PR 3 has merged. Its plan
  must say so; its owner is told when this plan is approved.
- **A test database that looks like production.** The tech-debt item "a fixtures seed cannot tell
  production from a fixtures database" closes at the fresh start only because the fresh start
  erases the household with the seed's id.
- **The bundle gate** (#713) applies to PR 2; deletions should shrink the routes.
- **Copies of production hold the family's data.** PR 4's rehearsal branch, and any branch counted
  in PR 3's gate 4, is deleted in the same sitting or on its expiry date, with the date in the ledger.

## Not planned here

- `LEGACY-1`, the legacy strength write path and its tables.
- Retiring a library slug, and any in-app editing of the library (`CAT-4`).

## Open questions for the maintainer

- **Q1. The order.** F1's first half before the clean-up, and P12 inside the clean-up.
  Recommended. The spec's order would delete code that CI still exercises.
- **Q2. Who builds.** PR 1's seed and proofs: lane P, which built the seed's two PRs and wrote the
  proofs it re-cuts (recommended). A3: lane A when it restarts, as the board reports is intended.
- **Q3. The specs' names.** Change the two specs to test-library names (recommended), or add the old
  names to the test library. The first keeps the test library generic.
- **Q4. "BSS".** Add it as an alias of Bulgarian split squat (recommended), through the usual batch
  review, so typing it still finds the movement after the old list goes.
- **Q5. Timing.** PR 1 to 3 run during the trial week. PR 4 merges after the week, or sooner on the
  maintainer's go after its rehearsal (recommended: after the week).
- **Q6. A shape change.** `newItem`'s success answer gains `owner`, `unitDefault` and `isBodyweight`
  (recommended; lane B's finding). The alternative is a new action that re-reads one option.
- **Q7. A rule change.** `corrections/README.md` rule 6 says a correction is kept after it runs.
  Recommended (Native Scaling's): the two fresh-start corrections' code is deleted once their
  Applied rows are dated, the rows stay as the record, and rule 6 names that one exception. The
  alternative keeps both, with a frozen copy of the 35 old ids inside one of them.
- **Q8. One alarm.** The report's count of movements with a seed id reads the list PR 3 deletes. It
  is the only check that sees an old built-in on a shared slug that was hand-given a kind of
  training. Recommended: keep it as a count of `movements` rows whose id has the seed's prefix
  (`SEED_PUBLIC_ID_PREFIX`, which every seeded movement's id carries), so it no longer needs the list. It is an alarm that must read 0, and is never used to select rows for a write or a delete. That is why the prefix is sound here, while `catalog-movements.ts:391-396` and `registry.ts:674-677` forbid it as a selector; PR 3 rewrites those comments to say so. Gate 4 removes the restore path; a hand `UPDATE` remains, and the corrections rules are its
  control.

## Review-response log

**Round 1, 2026-11-20.** Two panel lenses (correctness against the code and spec; production data
safety, operations and privacy) and three feasibility checks. Every finding is accepted.

| #   | From                | Finding                                                                                          | Response                                                      |
| --- | ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1   | safety, P0          | PR 3 deletes the only remedy while a restore can still bring the data back                       | Gate 4; the Risks entry                                       |
| 2   | safety, P0          | PR 3 would delete standing rules with the runbook's one-time section                             | They move to the restore procedure                            |
| 3   | correctness, P0     | PR 2 fails `guides:check`: a guide's `owns:` names the deleted file; ⏳ lines in guides go false | Lane B's guide edits; the check covers `docs/features/`       |
| 4   | lane P, blocking    | PR 1 could not be green alone: more than twenty proofs read an old built-in                      | The full list is in PR 1                                      |
| 5   | correctness, P1     | "The other 22 are the household's own" was false: six resolve to old built-ins today             | Corrected, with what PR 1 changes                             |
| 6   | correctness, P1     | Keeping `PROGRAM_SEED` contradicted F1                                                           | Renamed in PR 1; F1's scan holds as written                   |
| 7   | correctness, lane P | PR 2's importer list was incomplete                                                              | Completed, each with an owner                                 |
| 8   | correctness, P1     | The design departed from E6's wording without saying so                                          | Point 1 now satisfies both; `updated_at` is set by the update |
| 9   | correctness, lane P | A3's mutation list was A2-ii's; the legacy pins belong to PR 1                                   | Moved; A3 gets its own range                                  |
| 10  | correctness, P1     | F1's "no lane is churned" gate was dropped silently                                              | Item 5 of "What changes"                                      |
| 11  | safety, P1          | The alarm left after PR 3 missed two cases                                                       | The seed-id household count stays; Q8                         |
| 12  | safety, P1          | A3's first production run is not a no-op and had no rehearsal or go                              | Point 7                                                       |
| 13  | safety, lane P      | A3 added throw paths; `migrate.yml` has no rollback                                              | Point 4, with its mutation                                    |
| 14  | safety, P1          | A soft-deleted catalog row was not covered                                                       | Point 2                                                       |
| 15  | safety, P2          | "Nothing a family sees" was overstated                                                           | "What a family sees"; Q5                                      |
| 16  | safety, P2          | PR 1 missed the mutations that prove production's seed writes no program                         | Listed; acceptance 4                                          |
| 17  | safety, lane P      | PR 3 changes production's seed (the shadow count) without saying so                              | Said, with its proof                                          |
| 18  | safety, P2          | Inventory §5, the notice's dependency, the hand-correction rule, `OPS-3`                         | PR 3 and PR 4's docs; Risks                                   |
| 19  | lane B              | `made()` cannot take an owner and unit the answer does not carry                                 | Q6                                                            |
| 20  | Native Scaling      | Deleting the corrections breaks README rule 6; which helpers stay                                | Q7; the keep and delete lists                                 |
| 21  | lane P, correctness | Wrong names and line numbers                                                                     | Corrected                                                     |

**Round 2, 2026-11-20.** The same two lenses, on draft 2. Both confirmed every round-1 fix. Every new
finding is accepted.

| #   | From            | Finding                                                                               | Response                                                                           |
| --- | --------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 22  | safety, P1      | Gate 4 named one restore branch; the rehearsal for the seed's switch cuts another     | Gate 4 covers every branch cut before step 5, and says where the retention is read |
| 23  | safety, P1      | Retiring the shadow count would also stop counting a household's row on a shared slug | The filter goes with it; proved in `db:verify`, with a mutation                    |
| 24  | correctness, P1 | A muscle changing role would break the pair index on join rows                        | A3 point 3: updated in place                                                       |
| 25  | correctness, P1 | `newItem` does not have the three values on two of its branches                       | Lane P's commit selects them; the assertions that change are listed                |
| 26  | correctness, P2 | Q8 can be answered now: seed ids share a prefix                                       | Q8's recommendation                                                                |
| 27  | safety, P2      | An Applied row records too little once the code is gone                               | Each row cites its PR and last commit                                              |
| 28  | safety, P2      | The rehearsal's copy of production, and what may be pasted from it                    | A3 point 7; a Risks entry                                                          |
| 29  | both, P2        | Wording: "unchanged", the gates cell, mutation 505, Q8's "no path"                    | Corrected                                                                          |

**Round 3, 2026-11-20.** A final check by both lenses on draft 3: the safety lens said SHIP, and the
correctness lens found one non-blocking gap. Both of their last points are applied: the two pins on
the shadow count's filter (mutation 518 and A2-i's E5 pin), and why a prefix count is sound as an
alarm where the code forbids it as a selector.

**Lane A's feasibility check of PR 4, 2026-11-20** (lane A had restarted; it is A3's builder). One blocking point: E6's `onConflictDoUpdate`, as worded, cannot name its arbiter, and a blanket upsert that could would lock every row on each push; so the design updates by id and E6's wording is amended in this PR. The correctness lens checked the claim and narrowed its wording, and added the order pins and the zero-skip proof, which lane A asked for too. Also applied: the primary change as two statements; join rows equal as
a set, not in order; the pre-check and the soft-deleted count extended to the insert path; A3's
mutation block.
