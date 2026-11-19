# CAT-3 A2-i — the catalog seed's writer, not yet switched on

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), § "The seed (lane A)" E1 to E5, rules 2,
> 6 and 7, and the A2 row of "Chunks, in order". Branch: `db/cat-3-a2-i-catalog-seed`. No migration.
> Mutations `502`–`514` (lane A's block, `500`–`519`).

## Where this sits

- **Pillar:** the movement library, shared reference data with no pillar in roadmap.md's table.
- **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3`'s node in its step chart.
- **This PR:** chunk A2-i. The code that writes a list of library entries into `movements`,
  `movement_equipment` and `movement_muscles`, and its proofs. **Production's seed passes it no entry**,
  so production keeps its 35 old rows and gains nothing.
- **Before it:** A1 (#577, the tables) and `OPS-2` PR 1 (#592, `seedReference` is reference-only). Both
  are merged and applied.
- **After it:** lane P's P11-ii-a needs `movementIsCatalog()` from this PR, not the rows. A2-ii (the
  switch, E4) waits for this PR deployed, for P11-ii-a deployed, and for the maintainer's go.
- _Roadmap alignment (2026-11-19): advances `CAT-3` (chunk A2-i); unblocks P11-ii-a; `ID-1`'s six
  keep-open items are answered in the log below (none is touched: library rows stay global, E3);
  checked against the private roadmap, nothing to add here._

## Goal

One writer, `seedCatalog(exec, entries)`. It writes each entry as a global row with its `modality`, plus
the entry's equipment and muscle rows, in one transaction. It never touches a row that already holds the
slug, nor a row a household owns. A2-ii switches it on by choosing the lists in `seed()`.

⚠️ **`CATALOG_MOVEMENTS` is not empty**: on 2026-11-19 it holds 475 entries across nine batch files. The
step plan's "inert while the list is empty" no longer holds. This PR keeps production inert because
`seed()` passes `catalog: []`, and Proof A fails if it passes anything else (mutation `506`).

## Acceptance

From the spec, where it applies to A2-i:

- **E1.** The catalog seed shall take its list as an argument.
  - On a database with no global movements, run with `CATALOG_MOVEMENTS`, it shall leave exactly one
    catalog row per entry with its stored fields, plus its equipment and muscle rows.
  - It never stores an entry's aliases, supervision label, instructions or media, because no column
    holds them (rule 11).
  - It writes everything in one transaction: a forced failure mid-list leaves none.
  - Each join row is keyed to the id its insert returned, never to a slug lookup.
- **E2.** If a global row already holds an entry's slug, the seed shall leave that row and its join rows
  untouched, and count it.
- **E3.** The seed shall never delete a `movements` row, never write a row that has a `household_id`, and
  never write a join row for one.
- **E5.** The seed's report shall contain counts only for any row a household owns. The seed shall exit 0
  on a database whose households own rows that collide with catalog slugs.
- **Rule 2.** `movementIsCatalog()` (global **and** `modality IS NOT NULL`) sits beside
  `movementIsGlobal()`.
- **Inert in production.** `seed({ fixtures: false })` on a fresh database leaves:
  - the global movements equal to `MOVEMENT_SEED_ROWS`;
  - no row with a `modality`;
  - no row in either join table.
- **Owed from A1:** the `movements-ownership` report no longer counts a legal non-strength catalog row
  with no pattern as a blocker (D6).

E4 (the switch) belongs to A2-ii.

## Decisions (as reshaped by the panel)

### D1. A module of its own, called from `seedReference`

`seedCatalog` lives in a new file, `packages/db/src/catalog-seed.ts`. Lane A owns it, and it is listed in
`docs/features/movement-catalog.md`'s `owns:`.

- **Why not in `seed.ts`:** `seed.ts` is a board-ordered seam that the OPS-2, PRIV-3 and FAM-1 threads
  all edit, and A3 (E6) will grow this writer. The cost of the separate file is one line in the
  stay-dark allowlist.

`seedReference` takes a **required** option, `{ catalog, legacyMovements }`. It is required for the same
reason `SeedOptions.fixtures` has no default.

- It calls `seedCatalog(db, catalog)` **before** the legacy insert. That is the order A2-ii needs
  ("`CATALOG_FIXTURE` in its place, then the legacy fixtures"): on a shared slug the catalog row wins,
  and the legacy insert's `ON CONFLICT DO NOTHING` skips it.
- The TEN-2c shadow detection follows `legacyMovements`.
- In this PR `seed()` passes `{ catalog: [], legacyMovements: MOVEMENT_SEED_ROWS }`, with a comment
  naming A2-ii. A2-ii's change is then a selection inside `seed()`, with no edit to `seedReference`.

### D2. Three statements in one transaction, ids from `RETURNING`

```
seedCatalog(exec, entries):
  if entries is empty → return { inserted: 0, present: 0 }      (no transaction opened)
  exec.transaction(async (tx) => {
    inserted = insertGlobalMovementsIfAbsent(tx, rows)            -- RETURNING id, slug
    equipment rows = for each inserted, the entry's equipment      -- skip the insert if empty
    muscle rows    = primary (role primary), then secondaries      -- skip the insert if empty
  })
  return { inserted: inserted.length, present: entries.length - inserted.length }
```

- **The shared insert.** `insertGlobalMovementsIfAbsent(exec, rows)` is a new helper in
  `ownership.ts`, beside `insertMovementOwnedBy`. It runs
  `onConflictDoNothing({ target: slug, where: movementIsGlobal() })` and returns `{ id, slug }[]`.
  - The legacy insert in `seedReference` uses it too, so the conflict clause is written once.
  - It must use `where:` and never `targetWhere:`, which `onConflictDoNothing` silently drops
    (`docs/lessons.md`, 42P10).
- **Keyed to the returned id.** The join rows come from `inserted`, matched to entries by the `slug` that
  the same `RETURNING` gave back. `catalog.test.ts` holds slugs unique. The writer never runs a
  `SELECT … WHERE slug`. An entry whose slug is already held returns nothing, so it gets no join rows
  (E2).
- **E3 holds by construction.**
  - The conflict target is the global partial index (`schema.ts`, `uq_movements_slug_global`), so a
    household row on the same slug neither conflicts nor is touched.
  - No column sets `household_id`.
  - There is no delete and no update.
- **Empty inserts are skipped.** drizzle 0.45.4 throws on `values([])`. That happens on every re-seed,
  and it would happen on every push after A2-ii. 143 entries have no equipment and 85 have no primary
  muscle.
- **Batched.** 475 entries are about 3,800 movement parameters and about 2,800 join parameters, well
  inside Postgres's 65,535. Chunking is out of scope until a list nears 5,000 entries.
- **Rule 7 and the throw.** An FK miss on an equipment or muscle code is a defect in the code, not data
  that has drifted:
  - the codes come from the vocabularies that `seedReference` seeds earlier in the same call;
  - every entry passes `catalogMovementSchema` in CI (D2 of the data contract).

  So the seed throws, and the transaction leaves nothing behind. Parsing the list again at the seed's
  entry would repeat a check CI already holds (see the log).

### D3. The report: counts only, printed only when a household row collides

`seedReference` counts the household rows that sit on a catalog slug. It takes the count **before** the
insert, as TEN-2c does.

- **One shared count.** The count comes from one helper, `householdRowsOnSlugs(exec, slugs)`, which the
  legacy shadow detection also calls.
- **Where it prints.** When the count is above zero, `seedReference` prints it with `console.warn`:
  `seed: N household movement(s) share a library slug; the library rows were inserted beside them`.
  It names no slug.
- **Why it prints nothing at zero:** TEN-2c (c) holds that "with no shadow the seed warns about nothing"
  (`verify.ts:7196`), and production's public log gains no line of zeros.
- **The return value.** `seedReference` returns `{ shadowedSlugs, catalog: { inserted, present,
householdRows } }`.

**The legacy shadow report is not changed here.** It still prints each legacy slug that a household also
owns. The privacy lens rules that a rule-7 issue: in a database with one household, each printed slug is
a fact about that household. It also checked 393 of the 396 `migrate.yml` logs since 2026-10-10, and
none contains the warning. Fixing it touches TEN-2b's proof, B4, mutation `329`, the runbook and
`migrate.yml`'s header, which is a second concern, so it is **lane A's next PR, before A2-ii** (Out of
scope).

**What a count can still reveal.** With one production household, a count that rises by one right after
a small catalog PR narrows that household's own item down to that PR's slugs. The risk is low: the item
matches a library name, not free text. Rule 7 allows counts, and this residual is recorded so that no one
later assumes counts reveal nothing.

### D4. `movementIsCatalog()` in `ownership.ts`, usable in `where` and in `select`

```ts
/** A library row (spec rule 2): global AND has a modality. Never a slug test. Serves `where` and `select`. */
export function movementIsCatalog() {
  return sql<boolean>`(${movementIsGlobal()} and ${isNotNull(schema.movements.modality)})`;
}
```

It is shaped like `workoutIsLive()` (`ownership.ts:647`), the one ownership predicate that readers already
select (`day-plan.ts:391`). The merged P11-ii plan selects `isCatalog` through it. In this PR only the
proofs read it.

### D5. The proofs

Each assertion is named, and each seed call sits inside `assert.doesNotReject(…, '<name>')`, so that a
mutation's `.expect` names the assertion, not a raw Postgres error (`verify/seed.ts`'s header). Each
planted row's slug is **picked programmatically**:

- it is a `CATALOG_MOVEMENTS` slug that no `movements` row holds;
- that precondition is asserted first;
- this matters because ten catalog slugs, such as `back_squat`, are also legacy slugs.

**Early, right after `verifyCatalogMigrationFacts`, while no movement exists**
(`verifyCatalogSeedOnAFreshDatabase`):

1. **D5.1, the forced failure: on the top-level `db`, not inside `rolledBack`.**
   - **The list:** entries whose slugs are not legacy slugs, with the last entry's primary muscle cast to
     a code `muscles` does not hold.
   - **What it asserts:** `assert.rejects`, pinned to the `movement_muscles` muscle FK (the harness's
     constraint-name helper, so a writer that throws before any insert cannot pass it), then zero
     catalog rows and zero join rows.
   - **Why not inside `rolledBack`:** inside it, either the probe's savepoint does the rollback that the
     mutation removes, or the aborted transaction makes the next read fail with `25P02`.
   - **Afterwards:** on correct code nothing persists, so Proof A still sees no movement. The reference
     tables were seeded and committed, and they are idempotent.
2. **D5.2, E1, inside `rolledBack`:**
   - `seedReference(tx, { catalog: CATALOG_MOVEMENTS, legacyMovements: MOVEMENT_SEED_ROWS })`.
   - Two named assertions, in this order: **"every entry slug is a catalog row"** (`513` fails here),
     then **"no catalog row outside the list"** (`508` fails here).
   - Each row plus its join rows equals `catalogOptionOf(entry, row.publicId)`, restricted to the stored
     fields: name, tracking type, unit, bodyweight, modality, pattern, equipment and muscles. Equipment
     and secondaries are sorted first. The comparison is with the shared mapping, never with the
     writer's own.
   - The legacy rows on non-shared slugs are present; the ten shared slugs are catalog rows.
   - **A second call** inserts nothing, reports `present` equal to the entry count, and does not throw
     (the empty join inserts are skipped). **On that call's return**, `householdRows` is `0` and
     `shadowedSlugs` is empty: only now do global rows exist for a dropped `movementIsOwned()` to match
     (`512`).
   - **A third call** with a list of no-equipment, no-primary entries only resolves.

**Late, in `verifyCatalogTables`, each inside `rolledBack`:**

3. **D5.3, E2:**
   - Plant a global row on a free catalog slug, using `movementRow()`, a seed-namespace id from
     `seedPublicId(…)`, a tracking type the entry does not have, a pattern and no modality.
   - Seed with that entry.
   - The planted row's digest is unchanged (the md5 row-digest idiom from `verify/seed.ts`), it has no
     join row, and `present` is 1.
4. **D5.4, E3 and E5:**
   - Plant a household row on a free catalog slug with `insertMovementOwnedBy(…, ctx.A_SCOPE, …)`.
   - Run `captureWarnings(() => seedReference(…, { catalog: [entry], legacyMovements: [] }))` inside
     `doesNotReject`. The checks, in this order:
     - the household row has no join row (first);
     - the household row's digest is unchanged;
     - a global catalog row exists beside it, with its join rows;
     - `householdRows` is exactly 1;
     - the captured text does not contain the slug (first, so `507` names it however it is cut);
     - the captured text has the exact count line.
   - The join-row counts reuse one exported `joinRowsWhere(exec, where)`, generalised from
     `householdJoinRows` (`verify/catalog.ts:175`).
5. **D5.5, inert in production (Proof A, extended):**
   - after `seed({ fixtures: false })` twice, no `movements` row has a `modality`, and **both join tables
     are empty**;
   - these assertions sit **before** the existing "global movements (the legacy catalog)" comparison, so
     mutation `506` names them;
   - this is the "class the join tables with `movements`" that A1 owed.

### D6. The ownership report loses its dead TEN-2d line

- **Where:** `corrections/registry.ts:673,681` counts `global.filter((r) => r.pattern === null)` as "rows
  VALIDATE would reject".
- **Why it is dead:** `0018` VALIDATEd the CHECK, and `0032:67` re-adds it without `NOT VALID`, so every
  database enforces it and nothing reads the line.
- **The change:** delete the count and its line (scope lens).
- **What that settles:** A1's owed item is met by removal, and there is no proof or mutation to write.

### D7. The stay-dark scan

- **The allowlist:** `catalog-seed.ts` joins `ALLOWED` in the A1 `describe`.
- **The comment:** it says the catalog seed is the one writer of the join tables, and points to the
  guide. S4's "no writer makes a household join row" is now held by D5.4 and mutation `503`.
- **`ownership.ts`:** it needs no entry. It names the `modality` column, not a library table.

## File-by-file changes

| File                                               | Change                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/catalog-seed.ts` (NEW)            | `seedCatalog` (D2)                                                                                                                                                                                |
| `packages/db/src/writers/ownership.ts`             | `movementIsCatalog()` (D4); `insertGlobalMovementsIfAbsent` (D2)                                                                                                                                  |
| `packages/db/src/seed.ts`                          | `seedReference(db, { catalog, legacyMovements })`; the legacy insert through the helper; `householdRowsOnSlugs`; the catalog warning (D3); `seed()` passes `catalog: []`                          |
| `packages/db/scripts/verify/catalog.ts`            | `verifyCatalogSeedOnAFreshDatabase` (D5.1, D5.2); D5.3 and D5.4 in `verifyCatalogTables`; `joinRowsWhere`                                                                                         |
| `packages/db/scripts/verify/seed.ts`               | Proof A's inert assertions, first (D5.5)                                                                                                                                                          |
| `packages/db/scripts/verify.ts`                    | calls the new entry point after `verifyCatalogMigrationFacts` (no `seedReference` caller exists there)                                                                                            |
| `packages/db/scripts/corrections/registry.ts`      | the TEN-2d line deleted (D6)                                                                                                                                                                      |
| `packages/db/scripts/mutations/502`–`514` + README | below; each with a README row (`mutations-readme.test.ts`)                                                                                                                                        |
| existing patches on `seed.ts`                      | `git apply --check` on `03`, `10`, `45`, `321`, `326`–`329`, `500` and `501`; `328` (`return shadowedSlugs;`) and `329` are re-cut for the new return shape, with their `.expect` files unchanged |
| `apps/web/test/program-tables-stay-dark.test.ts`   | the allowlist entry and the comment (D7)                                                                                                                                                          |
| `docs/features/movement-catalog.md`                | `owns:` gains `catalog-seed.ts`; "What is here" gains the writer; invariant 6 cites rule 2, D5.4 and `503`; the traps' A2 items are marked done, and the ones left are renamed to A2-ii           |
| `docs/features/write-path.md`                      | the pointer row (line 136) covers `seedCatalog` and `movementIsCatalog` (it owns `seed.ts` and `writers/`)                                                                                        |
| `docs/privacy/data-inventory.md`                   | a re-read line for A2-i; the two stale lines (about 365 and 423): a writer now exists, it is insert-only, production passes it nothing, and S4 is held by D5.4 and `503`                          |
| `docs/runbooks.md`                                 | the never-re-run cut-off is **A2-ii's** merge commit (line 954); A2-i still writes `MOVEMENT_SEED_ROWS`                                                                                           |
| `docs/plan.md`                                     | the `CAT-3` row links this plan                                                                                                                                                                   |
| `docs/roadmap.md`, changelog fragment              | the A2-i note; the fragment                                                                                                                                                                       |

The cut-off sentence in the spec (line 566, "from before A2") is the spec owner's. It is sent to the
roadmap thread as "A2-ii's merge", and this PR does not edit it.

Estimated 300–380 lines of code and proofs. The mutation patches are extra and small.

## Test plan: mutations

Each mutation must turn `db:verify` red, and the first failure must be the assertion it names.

| #   | The patch                                                                                                                          | First failure                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 502 | `seedCatalog` without its transaction                                                                                              | D5.1: zero catalog rows             |
| 503 | join rows written for every row the slug matches (a `select … where slug in` over the slugs `RETURNING` gave back, no global term) | D5.4: household has no join         |
| 504 | join rows by a global slug lookup for every entry, `onConflictDoNothing`                                                           | D5.3: planted has no join row       |
| 505 | `onConflictDoUpdate({ targetWhere: global, set: …, setWhere: modality IS NULL })` (adopts)                                         | D5.3: planted digest                |
| 506 | `seed()` passes `CATALOG_MOVEMENTS`                                                                                                | D5.5: no modality                   |
| 507 | the catalog warning appends the slugs                                                                                              | D5.4: no slug in the log            |
| 508 | `movementIsCatalog()` drops the `modality` half                                                                                    | D5.2: no catalog row outside        |
| 509 | the insert's conflict clause drops `where` (`42P10`)                                                                               | D5.2: `doesNotReject`               |
| 510 | the primary muscle written with role `secondary`                                                                                   | D5.2: option equality               |
| 511 | `is_bodyweight` dropped from the insert                                                                                            | D5.2: option equality               |
| 512 | `householdRowsOnSlugs` loses `movementIsOwned()`                                                                                   | D5.2: second call's `householdRows` |
| 513 | the catalog seeded after the legacy insert                                                                                         | D5.2: every entry is a catalog row  |
| 514 | the seed throws when `householdRows > 0` (the old TEN-2b throw)                                                                    | D5.4: `doesNotReject`               |

`511` drops `is_bodyweight` rather than `modality`, because dropping `modality` fails on the global-row
CHECK for the 160 pattern-less entries before any assertion runs.

## Risks / rollback

- **Production behaviour: none.** D1 and D5.5 hold that. Production's log is unchanged unless a household
  row shares a catalog slug, and with `catalog: []` none can.
- **`seedReference`'s signature changes.** Its one caller is `seed()`, and a missed caller is a compile
  error.
- **Patch contexts:** ten existing patches touch `seed.ts`, so the sweep in the file table runs before
  the PR opens.
- **The cut-off:** A2-i's `migrate.yml` runs are **before** the never-re-run cut-off, because they still
  write the legacy rows. The runbook says so.
- **Rollback:** revert. There is no migration, and no row is written in production.

## Out of scope

- **E4, the switch,** and the shared mapping from a library name to its list. A2-ii's selection and
  P11-ii-a's "library in effect" (K29) should resolve through one exported mapping in
  `packages/shared/src/catalog/`, so the seed and the readers cannot pick different lists. A2-ii
  imports the mapping P11-ii-a builds.
- **The TEN-2 discriminators reading "legacy or catalog",** the 0022 proofs planting their own rows, the
  `.expect` of `318`/`319`, and the runbook's step-5 counts. These are A2-ii's: none can change until a
  catalog row exists in the shared verify database or in production.
- **The legacy shadow report going counts-only:** its own PR, lane A's next, before A2-ii (D3). The PR
  covers TEN-2b (b) at `verify.ts:7180`, B4, `329`, a new mutation for the slug list coming back, a
  capture of every console channel, the runbook's operator query (the slug and the household's
  `public_id`, never `name`, run in the Neon console), and `migrate.yml`'s header comment.
- **E6, updating catalog rows:** A3, after the fresh start.

## Open questions

None for the maintainer.

## Review-response log (adversarial panel)

### Engineering panel (round 1)

> Lenses: correctness, scope, architecture, reuse, DB safety, privacy (the seed's public log). All on
> the agents' default model. Nothing was run; every lens read the code.

| #   | Lens                              | Critique (short)                                                                                                                                      | Verdict                  | Resolution                                                                                                                                                                                                                   |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | DB, reuse, arch, correctness      | The forced-failure proof inside `rolledBack` cannot fail: a savepoint masks mutation `502`, or `25P02` fails the wrong assertion                      | **accepted**             | D5.1 runs on the top-level `db` before Proof A                                                                                                                                                                               |
| B2  | Arch, correctness, reuse, privacy | The catalog report is printed by `seed()`, which passes `[]`. `captureWarnings` reads `warn` only. E5 and `507` cannot fail                           | **accepted**             | `seedReference` prints with `console.warn`, only when a household row collides (D3). D5.4 captures it                                                                                                                        |
| B3  | Correctness                       | `504` and `505` fail first at the second call (pair-index `23505`), not at E2                                                                         | **accepted**             | Both reshaped (the table), so D5.2 passes and D5.3 is the first failure                                                                                                                                                      |
| B4  | Reuse, DB, privacy, scope         | D3's legacy change breaks TEN-2b (b), TEN-2c (c), `329`, the runbook and `migrate.yml`'s header, and none is listed                                   | **accepted, by removal** | The legacy report stays as it is. Its own PR follows, before A2-ii (Out of scope). The privacy lens's finding stands: it is a rule-7 issue, and it never fired in 393 logs                                                   |
| S1  | Scope                             | D6 rewrites a count that can no longer be non-zero                                                                                                    | **accepted**             | The line is deleted. D5.6 and the old `509` are dropped (`0018`, `0032:67` checked)                                                                                                                                          |
| S2  | DB, correctness                   | `values([])` throws on every re-seed, and would throw on every push after A2-ii                                                                       | **accepted**             | D2 skips each empty insert. D5.2's second and third calls hold it                                                                                                                                                            |
| S3  | DB                                | The never-re-run cut-off is ambiguous between A2-i and A2-ii                                                                                          | **accepted**             | The runbook names A2-ii. The spec sentence goes to the spec owner                                                                                                                                                            |
| S4  | Arch                              | "A2-ii is one line" is false while the legacy insert is unconditional                                                                                 | **accepted**             | `{ catalog, legacyMovements }` (D1). The K29 shared mapping is recorded for A2-ii                                                                                                                                            |
| S5  | Arch                              | `and()` returns `SQL \| undefined`, which P11-ii-a cannot select                                                                                      | **accepted**             | `sql<boolean>`, shaped like `workoutIsLive()` (D4)                                                                                                                                                                           |
| S6  | Arch                              | The writer in `seed.ts` puts lane A's growing code in a board-ordered seam                                                                            | **accepted**             | `catalog-seed.ts` (D1)                                                                                                                                                                                                       |
| S7  | Arch                              | Rule 7 versus a throwing transaction                                                                                                                  | **accepted (text)**      | D2 says why an FK miss is a code defect. **Rejected:** parsing the list again at the seed's entry repeats CI's `catalogMovementSchema` check on every push for no new catch                                                  |
| S8  | Arch                              | `ID-1`'s six keep-open items are unanswered                                                                                                           | **accepted**             | The table below                                                                                                                                                                                                              |
| S9  | Reuse                             | A second hand-written copy of the global conflict clause                                                                                              | **accepted**             | `insertGlobalMovementsIfAbsent` (D2), used by both inserts                                                                                                                                                                   |
| S10 | Reuse                             | The stored-field list exists nowhere, so the writer and the proof can drift                                                                           | **accepted**             | D5.2 compares with `catalogOptionOf`, restricted to the stored fields                                                                                                                                                        |
| S11 | Reuse                             | The proofs would hand-write plants and counts the harness already has                                                                                 | **accepted**             | `joinRowsWhere`, the md5 digest, `movementRow`, `seedPublicId`, `insertMovementOwnedBy`                                                                                                                                      |
| S12 | Reuse, scope, privacy             | The file table missed `write-path.md`, the data inventory, the `plan.md` link and the patch sweep, and named a `verify.ts` caller that does not exist | **accepted**             | The file table                                                                                                                                                                                                               |
| S13 | Correctness                       | `503`'s form is unpinned (a `Map` lets the global row win), and the spec's insert-predicate mutation is missing                                       | **accepted**             | `503` writes for every match, and D5.4's first assertion is the household's join rows. `509` drops the `where`                                                                                                               |
| S14 | Correctness, DB                   | The proofs plant on a slug that legacy rows may hold (ten are shared)                                                                                 | **accepted**             | The slugs are picked programmatically, and the precondition is asserted (D5)                                                                                                                                                 |
| S15 | Correctness, DB                   | Assertion order: `506` trips the existing Proof A comparison first; `511` trips the CHECK first; `508` needs set equality                             | **accepted**             | D5.5 puts its assertions first; `511` drops `is_bodyweight`; D5.2 uses set equality in both directions                                                                                                                       |
| S16 | Correctness                       | No mutation covers the exit-0 path, the household count's predicate, or the catalog-before-legacy order                                               | **accepted**             | `514`, `512`, `513`                                                                                                                                                                                                          |
| S17 | Scope                             | P11-ii-a waits on the whole PR for a three-line predicate                                                                                             | **rejected**             | With the legacy report and D6's proof removed, the PR is under 400 lines. Shipping the predicate alone costs a review cycle and touches the board seam twice                                                                 |
| N   | Scope, reuse, arch, privacy       | The source pin restates Proof A plus `506`; D3 and D4 disagreed; "skipped" versus "present"; a count can still narrow                                 | **accepted**             | Pin dropped. One report shape: the return value carries `present`, the log carries only the household count. The spec's R4/step-6 word "skipped" applies to A2-ii's run, and A2-ii aligns it. The residual is recorded in D3 |

### Re-review (correctness, after the reshape)

B1 to B3 confirmed resolved. One surviving blocker, now fixed: two named first failures were wrong.
`513` failed at the set equality, which is now split into "every entry is a catalog row" (`513`) and
"no catalog row outside the list" (`508`). `512` could not fail on the first call, where the count is
taken before any movement exists, so it is now asserted on the second call's return. Also pinned:
`503` ranges over the `RETURNING` slugs (over every entry slug it would fail at D5.2 with `23505`);
D5.4 checks "no slug" before the exact line, so `507` names it either way; and D5.1's rejection is
pinned to the muscle FK. All accepted.

### `ID-1`'s six keep-open items (architecture lens)

1. **The principal is a login:** not touched; no profile or login column.
2. **Every access goes through `getHouseholdScope()`:** the seed serves no request and holds no scope.
   It writes global rows only; its household count is deliberately unscoped, as
   `movementsOwnershipReport` is, and prints no row.
3. **Nothing relies on one household per person:** nothing new depends on it.
4. **Nothing pins an athlete to a household:** no key or cache key is added; this is movement data.
5. **No age logic:** `MUSCLES` is unchanged; the writer stores only codes the vocabulary already holds.
6. **Roles stay a const plus a CHECK:** not touched.

Library rows stay global (E3), so a history that names library movements stays portable; a household's
own items remain `ID-1`'s question.
