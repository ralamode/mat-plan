# CAT-3 A2-i — the catalog seed's writer, not yet switched on

> Backlog: [plan.md](../plan.md) row `CAT-3`. Spec:
> [cat-3-movement-library](../specs/cat-3-movement-library.md), § "The seed (lane A)" E1 to E5, rule 2,
> rule 6, rule 7, and the A2 row of "Chunks, in order". No migration. Mutations `502`–`514` (from
> lane A's block, `500`–`519`, which comes with the chunk). **Owner: lane P** _(maintainer,
> orchestrator's chat, 2026-11-19: "Lane P takes A2-i (Recommended)")_; lane A drafted this plan
> before the handoff.

## Where this sits

- **Pillar:** the movement library, shared reference data with no pillar in roadmap.md's table.
- **Milestone:** [Beta 0](../milestones/beta-1.md), `CAT-3`'s node in its step chart.
- **This PR:** chunk A2-i. It adds the code that writes a list of library entries into `movements`,
  `movement_equipment` and `movement_muscles`, with its proofs. **Production's seed does not call it with
  any entry yet**: `seed()` passes an empty list, so production keeps its 35 old rows and gains nothing.
- **Before it:** A1 (#577, the tables) and `OPS-2` PR 1 (#592, which made `seedReference`
  reference-only). Both are merged and applied.
- **After it:**
  - lane P's P11-ii-a needs `movementIsCatalog()` from this PR, not the rows;
  - A2-ii (the switch, E4) waits for this PR deployed, for P11-ii-a deployed, for the fixture-library
    PR (K29, lane P), and for the maintainer's go.
- _Roadmap alignment (2026-11-19): advances `CAT-3` (chunk A2-i); unblocks P11-ii-a; gates nothing
  else; touches none of `ID-1`'s six keep-open items (privacy lens, below); checked against the private
  roadmap, nothing to add here._

## Goal

Add one function, `seedCatalog(db, entries)`, that A2-ii can switch on by changing one argument. It
writes each entry as a global row with its `modality`, plus its equipment and muscle rows, in one
transaction. It never touches a row that already holds the slug, or a row a household owns.

⚠️ **`CATALOG_MOVEMENTS` is not empty**: it holds 475 entries on 2026-11-19, measured, with no
duplicate slugs. Twelve of them share a slug with `MOVEMENT_SEED_ROWS`: pallof_press, sled_push,
pull-up, dumbbell_bench_press, trap-bar_deadlift, romanian_deadlift, back_squat, front_squat,
bulgarian_split_squat, walking_lunge, box_jump and broad_jump. 85 entries have no primary muscle and
143 have no equipment. So this PR keeps production inert by passing `[]` from `seed()`, and a proof
(Proof A, extended) fails if `seed()` passes anything else.

## Acceptance

From the spec, verbatim where it applies to A2-i:

- **E1.** The catalog seed shall take its list as an argument. On a database with no global movements
  (a scratch instance in `db:verify`, run with `CATALOG_MOVEMENTS`), it shall leave exactly one catalog
  row per entry, with its stored fields, its equipment rows and its muscle rows. The rows are written in
  one transaction (a forced failure mid-list leaves none), and each join row is keyed to the id its
  insert returned, never to a slug lookup. "Never its aliases, supervision label, instructions or media"
  holds structurally, because no column holds them (rule 11); it is not a tested claim.
- **E2.** If a global row already holds an entry's slug, the seed shall leave that row and its join rows
  untouched, and count it.
- **E3.** The seed shall never delete a `movements` row, never write a row that has a `household_id`,
  and never write a join row for one.
- **E5.** The seed's report shall contain counts only for any row a household owns. The seed shall exit
  0 on a database whose households own rows that collide with catalog slugs.
- **Rule 2.** `movementIsCatalog()` (global **and** `modality IS NOT NULL`), beside `movementIsGlobal()`.
- **Rule 7.** The seed never throws on catalog data: an entry with no equipment, no primary muscle, or
  no muscles at all, and a list whose every entry is already present, all resolve.
- **Inert in production (this PR's own criterion).** `seed({ fixtures: false })` on a fresh database
  leaves the global movements equal to `MOVEMENT_SEED_ROWS`, no row with a `modality`, and no join row.
- **Owed from A1:** the `movements-ownership` report's TEN-2d blocker count reads the CHECK's own
  predicate, so a legal non-strength catalog row with no pattern is not a blocker.

E4 (the switch) belongs to A2-ii.

## Decisions

### D1. Where it lives: `seed.ts`, called from `seedReference`

`seedCatalog` is a function in `packages/db/src/seed.ts`, exported for `db:verify`.
`seedReference` takes a **required** `{ catalog }` option, the same no-default rule
`SeedOptions.fixtures` follows. It calls `seedCatalog(db, catalog)`:

- **after** the units, equipment and muscles inserts, which are its FK parents (`seed.ts:247-291`);
- **before** the legacy `MOVEMENT_SEED_ROWS` insert. That is the order A2-ii needs: `CATALOG_FIXTURE`
  goes "in its place, then the legacy fixtures", so a catalog row on a shared slug wins, and the legacy
  insert's `ON CONFLICT DO NOTHING` skips it.

`seed()` passes `{ catalog: [] }`, with a comment naming A2-ii. `seed()` is the only caller of
`seedReference` today; the new proofs are the others.

- **Why not a new module under `writers/`:** `seed.ts` is already on the stay-dark scan's allowlist for
  the reference tables, and the spec puts the writer inside `seedReference`.
- **Why an argument, not a const in `seed.ts`:** A2-ii's diff is then one line in `seed()`, and the
  proofs call the same function with `CATALOG_MOVEMENTS`, a failing list and planted rows.

### D2. Up to three statements, one transaction, each guarded

```
if entries is empty: return the zero counts (no transaction)
db.transaction(async (tx) => {
  inserted = INSERT INTO movements (public_id, slug, name, modality, pattern, tracking_type,
                                    unit_default, is_bodyweight)
             VALUES (… one row per entry, the first entry for a slug only, public_id = newId() …)
             ON CONFLICT (slug) WHERE household_id IS NULL DO NOTHING
             RETURNING id, slug
  equipmentRows = for each inserted row, its entry's equipment, in authored order
  if equipmentRows is not empty: INSERT INTO movement_equipment … (no ON CONFLICT)
  muscleRows = for each inserted row: its primary (only when primaryMuscle is not null), then its
               secondaries in authored order
  if muscleRows is not empty: INSERT INTO movement_muscles … (no ON CONFLICT)
})
```

- **Each insert has its own guard** (correctness P1-5, db-safety P1-3). Drizzle throws on an empty
  `values()` (`drizzle-orm/pg-core/query-builders/insert.js:31-33`). Three states reach that:
  - a list whose every entry is already present (every production push after A2-ii's first);
  - new entries that all have no equipment;
  - new entries that all have no muscles.

  Unguarded, any of these fails `migrate.yml` on every later push.

- **Keyed to the returned id.** The join rows come from `inserted`, matched to entries by the slug the
  same `RETURNING` gave back, never by a `SELECT … WHERE slug = …`. An entry whose slug was already
  held returns nothing, so it gets no join rows (E2).
- **A duplicated slug in the list** (db-safety P2-6): the first entry wins and the rest count as
  skipped. The function never throws on it (rule 7). V3 guards `CATALOG_MOVEMENTS` itself, not the
  argument.
- **E3 holds by construction.** The conflict target is the global partial index
  (`movementIsGlobal()` renders as a literal `IS NULL`, so the arbiter is `uq_movements_slug_global`,
  as the legacy insert at `seed.ts:359` already proves). A household row on the slug neither conflicts
  nor is touched. The new row is global because no column sets `household_id`. There is no delete and
  no update.
- **Order.** Equipment goes in authored order, and so do the secondaries after the primary, so the
  identity order of the join rows records the authored order. P11-ii-b's open order question (Q2)
  then has that as one of its options. The one-primary index does not depend on insert order: an entry
  holds at most one primary and never repeats a muscle (`entry.ts:154-166`).
- **Size.** 475 entries are about 3,800 movement parameters and about 3,700 join parameters, well
  inside Postgres's 65,535. If a list ever passes about 5,000 entries, it is chunked inside the same
  transaction (out of scope).
- **Timeouts.** `scripts/seed.ts:22-24` sets `lock_timeout` and `statement_timeout` on every pool
  connection, so the transaction's client has them.

### D3. The report: counts only, through one exported formatter

- `seedReference` **returns** a counts struct: `catalogInserted`, `catalogPresent`, `catalogSkipped`,
  `householdRowsOnCatalogSlugs`, and the legacy shadow count. Every value is an integer, and
  `seed.test.ts` pins that, so a slug cannot be printed without a type change.
- `reportSeed(counts)` is the one formatter. `seed()` calls it. The line that counts household rows on
  library slugs goes to `console.warn` when its count is above zero.
- **The legacy shadow report changes to counts too.** Today it prints each seeded slug a household also
  owns. Rule 7 says the public log names no row a household owns, and the slug of a household's row
  says what that household typed. A search of 400 `migrate.yml` logs, back to the oldest kept
  (2026-10-09), found no log that ever printed one, so there is nothing to delete.
- **The runbook** ("the seed's shadow guard fired") gets the query that lists the slugs, with its rules:
  - run it from the operator's own console, never in a workflow step;
  - select the slug and a count only, never `name` or a household `public_id`;
  - never paste its output into a PR, issue, plan, changelog fragment or commit;
  - a correction for recovery option 1 takes the slug from the environment, as
    `household-claim-2026-10-25` does.

  The section's "per named slug" and its ⚠️ paragraph are rewritten to match.

### D4. `movementIsCatalog()` in `ownership.ts`

```ts
/** `household_id IS NULL AND modality IS NOT NULL`: a library row (spec rule 2). Not a slug test. */
export function movementIsCatalog() {
  return and(movementIsGlobal(), isNotNull(schema.movements.modality));
}
```

In this PR the proofs use it, and so does the seed's count of present rows, which splits into catalog
and legacy in the counts struct. P11-ii-a is its first app reader.

### D5. Proofs

`db:verify` has one PGlite database, and on a fresh one the reference tables hold nothing until the
seed runs. The order is:

1. **The forced failure (E1's one transaction), at top level on `db`, after the reference tables are
   seeded** (the start of `verifyCatalogTables`), **outside any transaction** (correctness P1-1,
   db-safety P1-2).
   - The list uses fresh slugs (`cat3_a2_forced_*`) with valid equipment and secondaries. Its last
     entry's primary muscle is a code `muscles` does not hold.
   - Assert the rejection is `movement_muscles_muscle_code_muscles_code_fk`, read from `cause.constraint`
     in a plain `try/catch`. Then assert there are 0 rows for those slugs in all three tables.
   - 🔴 Never `expectRejectedBy(…, tx)` here. Its savepoint would roll the partial rows back itself, and
     mutation 502 could not fail.
2. **E1, inside `rolledBack`:** `seedReference(tx, { catalog: CATALOG_MOVEMENTS })`.
   - The `movementIsCatalog()` set equals the const's slugs **in both directions**
     (`assertRefTableMatches`), so the 23 legacy rows can never pass as catalog rows.
   - Each row's stored fields equal its entry's, and so do its equipment set and its muscles with
     their roles. The legacy rows that share no slug are still written.
   - **A second call resolves (`doesNotReject`), inserts nothing, and counts every entry as present.**
     This pins D2's guards.
   - **A one-entry list with no equipment and no muscles resolves** and writes the movement only.
3. **E2:** the realistic state already exists, so nothing is planted. The legacy `sled_push` is a
   `weight_reps` row with a seed `public_id` and no `modality`; the entry is `distance`. Seeding with
   that entry leaves every column of the row unchanged and gives it no join row, and the counts say one
   present.
4. **E3 / E5:** plant a household row (household A) on a catalog-only slug, never a legacy one, and seed
   with that entry.
   - The call resolves.
   - The household row is unchanged and has no join row.
   - A global catalog row exists beside it, with its join rows.
   - `captureOutput(() => reportSeed(counts))` holds the count and not the slug. The capture records
     `log`, `info`, `warn` and `error` together (privacy P1-2), not only `console.warn`.
5. **A duplicated slug:** a two-entry list with one slug writes the first entry, and its join rows only.
6. **Inert in production** (Proof A, extended): after `seed({ fixtures: false })` twice on the fresh
   database, no `movements` row has a `modality`, and neither join table holds a row of a global
   movement. These assertions come **before** Proof A's existing slug-set comparison, so mutation 506
   fails at them. This is the "class the join tables with `movements`" that A1 owed.
7. **The ownership report:**
   - a planted global `mobility` catalog row with no pattern gives a TEN-2d blocker count of 0;
   - a planted global row with neither a pattern nor a modality gives a count of 1. It is planted inside
     a transaction that drops the CHECK, as the V1-1b simulation does.

   The assertion matches the label's fixed prefix only, because its "pattern IS NULL" text changes with
   D6.

Every plant avoids the 12 shared legacy slugs. Every proof but the first rolls back, so no catalog row
reaches the shared verify database. That is why erasure P7 and patches 318/319 stay as they are until
A2-ii.

### D6. The ownership report reads the CHECK's predicate

`corrections/registry.ts`' blocker filter (`:673`, labelled at `:681`) is `pattern === null` over the
global rows. It becomes a count in SQL: `NOT (movementGlobalRowHasPattern(schema.movements))`, reusing
the schema's exported fragment, so the report and the CHECK cannot drift apart again. That expression
never evaluates to NULL for a global row. The "curated / residual" lines stay as they are: reading
"legacy or catalog" is A2-ii's job (the TEN-2 discriminators), when a catalog row can first exist in
production.

### D7. The stay-dark scan

`seed.ts` is already allowed. The A1 `describe`'s comment says "relaxed by A2 (the seed's catalog
writer …)"; it changes to say the seed is the one writer. S4's "no writer makes a household join row" is
now held by proof 4 and mutation `503`, not by the scan. `ownership.ts` names the `modality` column, not
a library table, so it needs no entry.

## File-by-file changes

| File                                                                                              | Change                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/writers/ownership.ts`                                                            | `movementIsCatalog()` (D4)                                                                                                                                                                        |
| `packages/db/src/seed.ts`                                                                         | `seedCatalog`; `seedReference(db, { catalog })` returning the counts struct; `reportSeed`; `seed()` passes `[]`; the shadow report as counts (D1–D3); the comment above `reportShadowedMovements` |
| `packages/db/src/seed.test.ts`                                                                    | the counts struct holds integers only; `seed()` passes an empty list (a source pin, as `fixtures` has)                                                                                            |
| `packages/db/scripts/verify/catalog.ts`                                                           | proofs 1–5 and 7 (D5)                                                                                                                                                                             |
| `packages/db/scripts/verify/seed.ts`                                                              | proof 6, before the slug comparison; B4 reversed (the count is printed, the slug is not)                                                                                                          |
| `packages/db/scripts/verify.ts`                                                                   | TEN-2b's assertion at `:7182-7185` reversed to "the slug is not printed", keeping `!includes(SHADOW_NAME)`                                                                                        |
| `packages/db/scripts/verify/harness.ts`                                                           | `captureOutput` (all four console methods); the `:197` docstring stops saying the guard "names the seed slug"                                                                                     |
| `packages/db/scripts/corrections/registry.ts`                                                     | the blocker count from `movementGlobalRowHasPattern` (D6)                                                                                                                                         |
| `packages/db/scripts/mutations/502`–`513`, plus `321`, `328`, `329` re-cut, `mutations/README.md` | below                                                                                                                                                                                             |
| `apps/web/test/program-tables-stay-dark.test.ts`                                                  | the comment (D7)                                                                                                                                                                                  |
| `.github/workflows/migrate.yml`                                                                   | the `:23-26` comment: the warning counts, it names nothing                                                                                                                                        |
| `docs/features/movement-catalog.md`                                                               | what is here (the writer); invariant 6 (the seed is the one writer); traps: the A2 items done, and what A2-ii still owes                                                                          |
| `docs/runbooks.md`                                                                                | "the seed's shadow guard fired": counts, the operator's query and its rules (D3)                                                                                                                  |
| `docs/plan.md`                                                                                    | `:2134`'s "seed slugs only" sentence; the CAT-3 row links this plan                                                                                                                               |
| `docs/privacy/data-inventory.md`                                                                  | a dated §7 re-read: the seed's public log carries counts only, with no new column, processor, reader, export or retention                                                                         |
| `docs/roadmap.md`, changelog                                                                      | a roadmap note; the fragment (the spec's A2 row is the spec owner's)                                                                                                                              |

Estimated at 450–550 lines with the proofs. The mutation patches come on top and are small.

## Test plan: mutations (each must turn `db:verify` RED at the named proof)

| #   | The patch                                                                                                                   | Fails at                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 502 | `seedCatalog` without the transaction                                                                                       | D5.1                                        |
| 503 | join rows written for **every** id a slug lookup without the global predicate returns (`flatMap`, never a last-write `Map`) | D5.4 (E3)                                   |
| 504 | join rows resolved by a global slug lookup, for every entry                                                                 | D5.2, the second call (the pair index)      |
| 505 | the insert becomes `onConflictDoUpdate` (it adopts the row)                                                                 | D5.2, the second call (counts 475 inserted) |
| 506 | `seed()` passes the 12 entries that reuse a legacy slug (the slug set still equals `MOVEMENT_SEED_ROWS`)                    | D5.6                                        |
| 507 | `reportSeed` prints the colliding slugs                                                                                     | D5.4 (E5)                                   |
| 514 | the same as 507, through `console.log`                                                                                      | D5.4 (E5)                                   |
| 508 | `movementIsCatalog()` drops the `modality` half                                                                             | D5.2 (both directions)                      |
| 509 | the registry's blocker count reverts to `pattern === null`                                                                  | D5.7                                        |
| 510 | the primary muscle is written with role `secondary`                                                                         | D5.2                                        |
| 511 | a stored field dropped from the insert (`modality`)                                                                         | D5.2                                        |
| 512 | the insert's conflict target loses its global predicate (42P10)                                                             | D5.2                                        |
| 513 | the per-table empty guard is dropped from the join inserts                                                                  | D5.2, the second call                       |

`321`, `328` and `329` are re-cut: `321`'s first failure moves to D5.2, which writes `neck` first; the
contexts of `328` and `329` change with D3, and `329`'s `.expect` follows B4's reversal. Each new or
re-cut patch runs alone with `pnpm --filter @mat-plan/db db:mutations --only <n>`, then in CI's
sharded gate. A mutation that cannot fail is not written.

## Risks / rollback

- **Production behaviour:** none, by D1 and proof 6. The one change production can see is the log line,
  which prints counts where it printed slugs.
- **A2-ii's first push and every one after it** run D2's guards, which proof 2's second call pins.
- **`seedReference`'s signature** changes. Its one caller is `seed()`, so a missed caller is a compile
  error.
- **Rollback:** revert. There is no migration and no row written in production.

## Out of scope

- E4, the switch, and `MOVEMENT_SEED_ROWS` under the flag (A2-ii).
- The TEN-2 discriminators reading "legacy or catalog", the 0022 proofs planting their own rows, the
  `.expect` of `318`/`319`, and the runbook's step-5 counts. All are A2-ii's: none can change until a
  catalog row exists in the shared verify database or in production.
- E6, updating catalog rows (A3, after the fresh start).

## Open questions

None for the maintainer.

## Review-response log (adversarial panel)

Panel, 2026-11-19: db-safety, privacy and correctness, on Opus 5.5 (the author on Opus 5.5 too). Lane
A's own six-lens panel on its draft was lost with its session, so this panel is the record. No P0.

| #            | Lens                   | Finding                                                                                                                   | Response                                                                                            |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| C1, DS2      | correctness, db-safety | The forced failure shares a `rolledBack` with E1, and a savepoint would hide mutation 502                                 | **accepted**: D5.1, top level on `db`, fresh slugs, the FK read from `cause.constraint`             |
| C2, DS1, PR1 | all three              | E5's log proof has no report to read (`seed()` passes `[]`), and the capture sees only `warn`                             | **accepted**: the counts struct, `reportSeed`, `captureOutput` over all four methods, 514           |
| C5, DS3      | correctness, db-safety | Empty join inserts throw, which would wedge every production push from A2-ii                                              | **accepted**: D2's per-table guards; D5.2's second call and the empty entry; mutation 513           |
| C3           | correctness            | 504 and 505 first fail at D5.2's second call; 503 survives as a last-write `Map`                                          | **accepted**: re-pointed; 503 specified as a `flatMap`; no `ON CONFLICT` on the join inserts        |
| C4, DS7, PR3 | all three              | 321, 328, 329, TEN-2b's assertion, harness and migrate.yml text, and three doc sentences are not owned                    | **accepted**: all in the file table                                                                 |
| DS4          | db-safety              | The spec's insert-predicate mutation is missing                                                                           | **accepted**: 512                                                                                   |
| DS6          | db-safety              | A duplicated slug in the argument mismatches fields and join rows                                                         | **accepted**: the first entry wins; proof 5                                                         |
| C6, DS8      | correctness, db-safety | 506 fails first at Proof A's slug comparison; 508 needs both directions                                                   | **accepted**: 506 passes the 12 shared-slug entries, and the new checks come first; both directions |
| C7           | correctness            | D5.3's plant needs a pattern and collides on shared slugs                                                                 | **accepted**: the existing legacy `sled_push` is the E2 state                                       |
| C8           | correctness            | D3/D4 disagree on the report's shape; equipment order unstated; the insert-predicate mutation                             | **accepted**: one struct; authored order; 512                                                       |
| PR4          | privacy                | The runbook query's output had no rules                                                                                   | **accepted**: D3's four rules                                                                       |
| PR5          | privacy                | An inventory re-read is owed                                                                                              | **accepted**                                                                                        |
| —            | correctness, db-safety | 475 entries, not 326; `verify.ts` has no `seedReference` caller; `registry.ts:673`, not `:666`; seed after the FK parents | **accepted**, all corrected                                                                         |
