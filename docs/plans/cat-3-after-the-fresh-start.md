# CAT-3 after the fresh start — the test databases, the clean-up, the old list and the upsert

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), criteria **E6**, **P12** and **F1**,
> rules 4 and 6, decisions **K22 to K24**, and the rows **A3**, **Post-R2 cleanup** and **F1** of
> "Chunks, in order". Branch for this plan: `docs/cat-3-after-the-fresh-start-plan`.
>
> **Draft, not yet approved.** Drafted by the plan owner on 2026-11-20 from the code on `main`
> (`b6ef8287`) and from notes sent by lane B, lane P and the Native Scaling thread. Not yet
> panelled. The maintainer approves it before any of its PRs is built.

## Where this sits

- **Pillar:** the movement library. It is shared reference data, so it has no pillar in
  roadmap.md's table.
- **Milestone:** Beta 0, `CAT-3`. These are the steps that had only a row: everything after the
  fresh start (R2).
- **Before it:** A2-ii (the seed's switch, #770), R1 (the runbook, #710) and R2, the fresh start,
  which is a production run by the maintainer and not a code PR. R2's own close-out PR is planned in
  [priv-3-fresh-start-prep.md](./priv-3-fresh-start-prep.md) (D5) and is not repeated here.
- **Nothing here is on the trial week's path.** After the fresh start production holds no old
  built-in, so none of the interim code can run there, and a family sees no difference before or
  after any PR below. The week of real use starts when the fresh start's checks are clean; these PRs
  run beside it.
- _Roadmap alignment (2026-11-20): advances `CAT-3`. It adds no column, scope or authority, and no
  feature. Checked against the private roadmap; nothing to add here._

## What changes from the spec's rows, and why

The spec's rows say the clean-up waits only for the fresh start, and that F1 comes last. Reading
the code on `main` gives a different order.

1. **The interim code cannot go while a test database still holds an old built-in.** After A2-ii a
   fixtures database is seeded with the test library and then with the 35 old built-ins
   (`seedLibraryOf('fixture')`, `legacyMovements`). The e2e specs lean on them:
   `program-builder.spec.ts:139` picks "Box Jump" and "Pull-Up", and `day-page.spec.ts:218` reads
   "Inverted Rows". So the picker's interim paths are still exercised on every CI run after the fresh
   start, and deleting them first would break the specs or leave old rows that nothing lists.
2. **So F1 is split in two, and its first half goes first.** F1-i makes a test database hold what
   production holds: library rows and a household's own rows, with no old built-in. Then the
   clean-up can delete the interim code with nothing left to exercise it. F1-ii deletes the old list
   itself, and still waits for the fresh start's second check, as the spec says.
3. **P12 lands with the clean-up**, as the row allowed ("which may be this one"). The old groups'
   last runtime reader is the option read, which the clean-up rewrites anyway.
4. **The clean-up is bigger than "four markers".** `main` has nine `TODO(CAT-3 chunk R…)` markers in
   seven files, and about twenty more interim lines marked only with ⏳. The lists are in PR 2.

## The PRs

| PR                                | What                                                                                                                                                                                                                                                   | Waits for                                                                                | Built by                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **PR 1 · F1-i**                   | Test databases hold the library only: the fixtures seed stops writing the 35 old built-ins, the legacy program fixture is rebuilt on test-library movements, and the specs use test-library names                                                      | The fresh start, and its first check (R4) clean                                          | Seed and proofs: assigned by the maintainer (Q2). Test library: the contract owner. Specs: their owners    |
| **PR 2 · the clean-up, with P12** | The interim code goes: the picker's handling of an old built-in, the option read's old-built-in half, `outsideWithoutData`, and the legacy groups                                                                                                      | PR 1                                                                                     | One PR on the contract owner's branch, with lane B's and lane P's commits added from local branches off it |
| **PR 3 · F1-ii**                  | The old list goes: `MOVEMENT_SEED_ROWS`, `MOVEMENT_SEED_PUBLIC_IDS`, the fresh start's two one-shot corrections, the report's fresh-start lines and the runbook's one-time section. `docs/spec.md` §4 and the architecture page are brought up to date | PR 2; the fresh start's second check clean; production's seed unable to write an old row | The contract owner, with Native Scaling's commits for the corrections and the runbook                      |
| **PR 4 · A3**                     | The seed keeps a stored library row equal to its entry, writing only what differs                                                                                                                                                                      | PR 3 is not required; the fresh start and FAM-1 12f (done) are                           | Assigned by the maintainer (Q2)                                                                            |

**Count: four PRs.** A3 may split in two (the row update, then the join rows) if it passes about
600 lines; the plan allows that split and no other. The earlier estimate was "about six".

## PR 1 · F1-i: test databases hold the library only

**Why first.** It makes CI test the state production is in after the fresh start.

- **The fixtures seed.** `seedLibraryOf('fixture')` loses `legacyMovements`, and the fixtures-side
  insert of `MOVEMENT_SEED_ROWS` goes (`packages/db/src/seed.ts`, as #770 leaves it). The const
  itself stays until PR 3: the fresh start's second check and step 5 still read
  `MOVEMENT_SEED_PUBLIC_IDS`.
- **The legacy program fixture.** `PROGRAM_SEED` (`packages/shared/src/programming.ts:295`) names
  old built-ins by slug, and `seedProgram` throws on an unknown slug. It is rebuilt as a generic
  block over test-library slugs, which is F1's "a generic program built from `CATALOG_FIXTURE`". It
  stays a fixture of the legacy tables, which the export (`apps/web/lib/dal/export.ts:73`) and the
  legacy strength writer still read; retiring those is `LEGACY-1`, not this plan.
- **The specs.** The two that name an old built-in change to names the test library has:
  `program-builder.spec.ts` (two items, three places) and the comment in `day-page.spec.ts:218`. No
  old name is added to the test library for a spec's sake (Q3).
- **The fixture world.** Its 26 items are the accepted prototype's and do not change. Today the
  seed resolves each by name; the four that the test library also names become library rows on a
  fixtures database, and the other 22 are the household's own. That already holds after #763.
- **Proofs to re-cut** (lane P's list): the A2 count `{legacy: 35}`; `verify.ts`'s TEN-2
  discriminators (`isFixtureLibraryRow`); `(a2)` in `verify/program.ts:1892-1920`, "every old
  built-in is still listed", which becomes "a fixtures database holds no old built-in". The TEN-2c
  legacy-slug shadow count, B4 and mutation 329 stay until PR 3.
- **Acceptance.**
  1. After `seed({ fixtures: true })` on a fresh database, no global movement fails
     `movementIsCatalog()`.
  2. The whole e2e suite passes with no old built-in's name in any spec.
  3. `db:verify` and `db:mutate` pass, with the re-cut proofs each shown to fail on its mutation.

## PR 2 · the clean-up, with P12

One PR, because removing `outsideWithoutData` from the contract breaks the picker and the read in
the same compile. It is opened on the contract owner's branch; lane B and lane P add their commits
from local branches off it, as FAM-1's contract changes C32 and C35 did.

**The check that it is complete:** in the files below, neither `TODO(CAT-3 chunk R` nor `⏳` is left,
except a ⏳ that names another step. No re-tagging PR is needed first.

**The contract owner's commits.**

- `packages/shared/src/movement-search.ts`: `outsideWithoutData` (`:501`, with `:504`, `:522`,
  `:583`, `:600`), and its tests in `catalog/filters.test.ts` and `catalog/search.test.ts`.
- `packages/shared/src/catalog/option.ts`: the ⏳ note.
- P12: `packages/shared/src/movement-picker-catalog.ts` is deleted with its test:
  `MOVEMENT_PICKER_ENTRIES`, `MOVEMENT_PICKER_GROUPS` and its type, schema and labels,
  `MOVEMENT_PICKER_ALIASES`, `movementPickerSlugsByGroup`, `pickerEntryOf`. `RECENT_MOVEMENTS_LIMIT`
  has no reader but its own test, so it is deleted and not moved (the spec said "moves to
  `movement-search.ts`").
- `apps/web/app/design/program/picker-options.ts`: `interimGroupOf` goes with `group`.

**Lane B's commits** (the picker; lane B's own files).

- K24's "Not sorted yet" section: `movement-picker.tsx:1750-1770`, `browse-view.ts:53`, `:69`,
  `:109-118`, `:141`, `:188`; its copy, `movement-picker-copy.ts:88`.
- The option type `BuiltInWithoutLibrary` (`movement-option.ts:76-80`) and the DTO's `group`
  (`:63`); `rowMeta`'s branch (`movement-picker.tsx:268-270`); `statusAlreadyListedNoData`
  (`:681-683`); `outsideLine`'s `bare` parameter (`movement-picker-copy.ts:187-212`, `:226`,
  `:285`); the built-in copy in `builder-text.ts:517`.
- **A fix, not a deletion:** `item-picker.tsx:283-295`, `made()`. It builds an item the server
  answered as existing with no unit. After this PR that case is a library row the list did not hold
  (another phone's seed, or a stale list), so `made()` takes the answer's owner and unit, or
  re-reads. **Its own test:** Enter on a typed name that matches only a catalog row not in the
  list selects that row with its unit.
- The tests that only make sense before the fresh start (lane B's list): in
  `movement-picker.test.tsx`, `movement-picker-filters.test.tsx`, `browse-view.test.ts` and
  `movement-picker-copy.test.ts`; and `withoutLibraryData` in `test/movement-picker-fixtures.ts`.
- No UX panel beyond one reviewer: nothing new appears, and a section that is always empty goes.

**Lane P's commits** (the read).

- `movement-options.ts`: `PICKER_SLUGS` (`:36-38`), the first half of
  `or(inArray(slug, PICKER_SLUGS), movementIsCatalog())` (`:95`), and `pickerEntryOf(row.slug)`
  (`:156`). The catalog arm becomes `movementIsCatalog()` alone.
- `catalog-arm-option.ts`: cases 1 and 2 of the four-case table (an old built-in, with and without
  an entry), the `fromLibrary` taxonomy fallback (`:178-188`), `taxonomy: … | null`, the
  `pickerEntry` parameter and `joinAliases`' const half. Case 4, a catalog row with no entry in the
  library given, stays.
- `apps/web/lib/dal/program/picker.ts`: the `BuiltInWithoutLibrary` arm (`:24`, `:55-63`).
- Proofs: FAM-1 6a-iii-a's count assertion becomes library rows only; mutations 592, 593, 595 and
  397 are re-pointed; `(a2)` is already re-cut by PR 1.

**One alias would be lost, and it needs an entry change first.** Deleting
`MOVEMENT_PICKER_ENTRIES` removes the aliases the old list gave the 12 slugs that are in both
lists. Checked on 2026-11-20 against the 587 entries: every one is answered by the library entry's
own name or aliases except **"BSS"** on `bulgarian_split_squat`. So before this PR an alias is added
to that entry, through the usual batch review with the maintainer's approval (Q4).

**Acceptance.**

1. Neither marker is left in the listed files, and nothing in `packages/` or `apps/` imports
   `movement-picker-catalog`.
2. The picker's browse, search and filters behave as on `main` for a database holding the library
   and a household's own items: the existing tests for those pass unchanged.
3. `item-picker`'s new test passes, and fails without the fix.
4. The route bundles move by less than the gate allows, or the PR states the numbers and why (#713).

## PR 3 · F1-ii: the old list goes

**Gates, all three:** PR 2 merged; the fresh start's second check (R4, at the start of the trial
week) clean; and production's seed unable to write an old row, which A2-ii makes true
(`library.legacyMovements` false in production). The second matters because step 5 is also the
remedy if old seed code ever writes the rows back.

- **Deleted:** `MOVEMENT_SEED_ROWS` and `MOVEMENT_SEED_PUBLIC_IDS`
  (`packages/shared/src/catalog-movements.ts`), with every reader the import scan finds. On `main`
  those are `seed.ts`, `verify.ts`, `verify/{schema,program,catalog,seed}.ts`,
  `corrections/registry.ts:687-721`, `catalog/catalog.test.ts:443`, `movement-search.test.ts`,
  `test/movement-picker-fixtures.ts:47`, `movement-picker.test.tsx:57`,
  `lib/dal/program/picker.test.ts:321-359` and `lib/programming/contract.test.ts:183`. The spec's
  list names one file that no longer exists and leaves six of these out.
- **Deleted, Native Scaling's:** the two one-shot corrections
  (`erase-seeded-household-2026-11-19`, `delete-legacy-movements-2026-11-20`) with their mutation
  rows (336 to 339, 540 to 544, 545 to 561, and 276's context); the fresh-start lines of
  `movementsOwnershipReport` with their header; the runbook's one-time "Fresh start" section; and
  the data inventory's "kept until the fresh start's step 5" wording.
- **Kept:** the ownership report's standing line that every global movement is a catalog row. It is
  the alarm for the tech-debt item below.
- **Docs:** `docs/spec.md:76-78` and its diagram (`:142-156`) gain the tracking type, the kind of
  training, equipment and muscles; `docs/architecture.md:605-626` stops saying the catalog is seeded
  from the old list; `movement-picker.md:380` and `program-contract.md:657` lose "until F1".
- **Acceptance.** F1's import scan: nothing in `packages/` or `apps/` imports `PROGRAM_SEED`'s old
  block, `MOVEMENT_SEED_ROWS` or `MOVEMENT_SEED_PUBLIC_IDS`; `db:verify` and `db:mutate` pass.

## PR 4 · A3: the upsert

What E6 asks, with lane P's four points as the design.

1. **Read, compare, write only what differs**, the way `units` is upserted (`seed.ts:279-312`).
   `migrate.yml` seeds production on every push; a blanket `ON CONFLICT DO UPDATE` would row-lock
   every library row on each push and rewrite rows that did not change. A push with no entry change
   writes nothing, and `updated_at` does not move.
2. **Only catalog rows** (`modality IS NOT NULL`), on the global slug index. `id` and `public_id`
   never change. Columns kept equal to the entry: name, kind of training, pattern, `unitDefault`,
   `isBodyweight`.
3. **Join rows by difference**, in the same transaction, under the one-primary index: a change of
   primary muscle demotes first, then promotes. This is the first code that deletes a catalog join
   row, so it carries its own proof that it never touches a household's row.
4. **The tracking type is never updated.** Logged sets and prescriptions are read by it. If a stored
   type differs from the lockfile's, the row is skipped and counted, as E6 says; a real type change
   is a new movement.
5. **No slug is retired here.** The append-only check keeps every shipped slug, so A3 has no path
   that removes a movement. If one is ever needed it is a correction with its own plan.
6. **Proofs it re-cuts** (lane P's list): A2-ii's "a second run inserts nothing", which becomes
   "writes nothing when no entry changed, and exactly the changed rows when one did";
   `assertOnlyLibraryRowsAdded`, narrowed to "an existing global row changes only where its entry
   changed"; mutations 598 to 604; and the insert-only pins in `verify/catalog.ts:500-512` and
   `:575-601` with mutations 502 to 505, 510, 512, 513, 516 and 517.
7. **The lines that stop being true:** `AGENTS.md:150`; `migrate.yml`'s header; the docstrings in
   `seed.ts:433-452`, `scripts/seed.ts:10`, `catalog-movements.ts:34-38` and `schema.ts:127`;
   `movement-catalog.md` invariants 4 and 6; `catalog-data.md:78-80`; `lessons.md:76`;
   `runbooks.md:532`. A change to `migrate.yml` is a CI workflow change and goes to the maintainer.

**Acceptance.** E6 as written, plus: a seed run after an entry's name, equipment and primary muscle
change leaves that row and its join rows equal to the entry and every other row's `updated_at`
unchanged; a household's row on the same name is untouched; a changed type is skipped and counted.

## Risks

- **A restore after the fresh start.** The runbook's restore says to replay the deletion ledger,
  and a fresh-start erasure cannot be re-applied until `erase-household` exists (`PRIV-3`). Nothing
  in this plan leans on a restore; PR 3 deletes the one-shot corrections only after the second check.
- **A test database that looks like production.** The tech-debt item "a fixtures seed cannot tell
  production from a fixtures database" closes at the fresh start only because the fresh start
  erases the household with the seed's id. If that household were ever kept, the gap stays.
- **The bundle gate** (#713) applies to PR 2; deletions should shrink the routes.

## Not planned here

- `LEGACY-1`, the legacy strength write path and its tables.
- Retiring a library slug, and any in-app editing of the library (`CAT-4`).

## Open questions for the maintainer

- **Q1. The order.** F1's first half before the clean-up, and P12 inside the clean-up, as above.
  Recommended. The alternative, the spec's order, would delete code that CI still exercises.
- **Q2. Who builds.** A3 and PR 1's seed work were lane A's, and lane A is retired. Recommended:
  lane P, which built the seed's two PRs and wrote the proofs these re-cut.
- **Q3. The specs' names.** Change the two specs to test-library names (recommended), or add the old
  names to the test library. The first keeps the test library generic; nothing a family sees differs.
- **Q4. "BSS".** Add it as an alias of Bulgarian split squat (recommended), through the usual batch
  review, so typing it still finds the movement after the old list goes.
- **Q5. Timing.** These PRs run during the trial week, not before it (recommended): none changes what
  a family sees, and the week should not wait for clean-up.

## Review-response log

_Not yet panelled._
