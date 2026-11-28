---
feature: The movement library's tables (CAT-3 lane A)
owns:
  - packages/db/scripts/verify/catalog.ts
---

# The movement library's tables

**Read this before writing to `movement_equipment` or `movement_muscles`, before setting
`movements.modality`, and before changing `movements_global_row_has_pattern`.** The spec is
[cat-3-movement-library.md](../specs/cat-3-movement-library.md) (`CAT-3`, S1 to S6); A1's plan is
[cat-3-a1-catalog-tables.md](../plans/cat-3-a1-catalog-tables.md). The data that fills these tables is
lane N's ([catalog-data.md](./catalog-data.md)).

## What is here

| Object                                         | What it holds                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `equipment`, `muscles`                         | Codes only, seeded from `EQUIPMENT` and `MUSCLES`. Labels stay in shared code.                                                                                          |
| `movement_equipment`                           | A movement's required equipment set. Empty set means "no equipment".                                                                                                    |
| `movement_muscles`                             | One optional primary muscle and any secondaries (`MUSCLE_ROLES`).                                                                                                       |
| `movements.modality`                           | `MODALITIES`. Set only on a global catalog row; it is what marks one.                                                                                                   |
| `movementGlobalRowHasPattern` (`schema`)       | The global-row CHECK's predicate, once; `verify.ts` re-adds it at runtime.                                                                                              |
| `verify/catalog.ts`                            | A1's proofs: one entry point right after `migrate()`, one with the modules; A2-i's writer proofs (one on a fresh database, the rest first in the modules' entry point). |
| `seedCatalog` (`seed.ts`)                      | The library's one writer (A2-i), called by `seedReference` with the library `seedLibraryOf` names: `CATALOG_MOVEMENTS` in production, `CATALOG_FIXTURE` with fixtures.  |
| `movementIsCatalog()` (`writers/ownership.ts`) | Rule 2's predicate: global and `modality IS NOT NULL`. Never a slug test.                                                                                               |

Since A2-ii production's seed writes `CATALOG_MOVEMENTS` and no legacy rows; since F1-i a fixtures
database gets `CATALOG_FIXTURE` and no legacy row either ([plan](../plans/cat-3-after-the-fresh-start.md),
PR 1), so CI tests the state production is in after the fresh start. The app
reads the library that database holds (K29: `catalogLibraryNameFor`, `apps/web/lib/env.ts`).
Since CAT-3 P11-ii-b the picker's read reads the two join tables (`catalogTaxonomyRows` in
`queries/program/movement-options.ts`); the stays-dark scan that held them unread until then is retired,
and that read's proofs replace it: `verify/program.ts`'s (b1)–(b3) with mutations `605`–`609`, and (b4)'s parse throws in `catalog-arm-option.test.ts`.

## Invariants

1. **A join row has no `household_id`.** It belongs to whoever owns its movement, and erasure finds it
   through `movement_id` (`erasure/graph.ts` → `movementsOf`). Never denormalise it.
2. **A join row is read only through a movement the scope may see** (`movementIsAvailableTo`), never
   selected by code alone. The picker's read meets this by reading join rows for the ids its catalog
   arm listed (global, live, catalog rows) and nothing else, and its assembly throws on a row for any
   other id (P11-ii-b (b2)). Otherwise a muscle or equipment filter crosses households once households
   have taxonomy of their own.
3. **A household's own movement has no modality and no join rows in Beta 0.** The database refuses the
   modality (`movements_household_row_has_no_modality`); the join rows are held by `db:verify` (S4). A
   row with a modality cannot move into a household without clearing it first.
4. **One primary muscle per movement**, enforced by a partial unique index. It cannot be deferred, so
   **a role swap demotes first, then promotes, in one transaction**. This binds A3's by-difference
   write and any `CAT-4` editor.
5. **Adding a word reaches the database through the seed alone; removing or renaming one is a
   migration**, because join rows reference the code.
6. **`seedCatalog` is the one writer of catalog rows and of global join rows.** One transaction; it
   never touches a row that already holds the slug (E2) or a household's row (E3), never deletes, and
   keys join rows to its own `RETURNING` ids. **Each insert skips itself when it has nothing to write**
   (rule 7): drizzle throws on an empty `values()`, and every production push after A2-ii's first has
   every entry present. S4's "no writer makes a household join row" is held by its proofs and
   mutation `503`.
7. **The seed's report is counts only** (`SeedCounts`, all numbers; `reportSeed`). `migrate.yml`'s log
   is public, and a slug a household also holds says what that household typed. The proofs capture
   everything printed to stdout and stderr around
   the whole seed run.
8. **`db:verify`'s shared database is a fixtures database** (A2-ii, D3): the test library only since
   F1-i, as every e2e and preview database is. A proof that needs a legacy-shaped global row plants it
   in its own rolled-back transaction. Every production seed in `db:verify` runs inside
   `rolledBack` with `seed(asDb(tx), …)` and reads on `tx` (a read through `db` hangs on PGlite's one
   connection). A proof that needs the real library writes it in its own rolled-back transaction.
9. **"A library row" is an exact test where it feeds a decision** (A2-ii, D4): a modality AND a slug of
   the library in effect. `movementIsCatalog()` alone (a modality) is the read's arm, not a census:
   the `movements-ownership` report and `db:verify`'s TEN-2 discriminators use the exact one.

## Traps

- **A proof of the global-row CHECK must run right after `migrate()`.** `verify.ts`'s V1-1b simulation
  drops and re-adds it; a later proof tests that copy, not the migration's
  (`verifyCatalogMigrationFacts`).
- **Done in A2-i:** the `movements-ownership` report's blocker count reads the CHECK's own predicate
  (`movementGlobalRowHasPattern`); Proof A classes the join tables with `movements`; S4's guarantee
  moved from the stay-dark scan to invariant 6's proofs.
- **Done in A2-ii:** the ownership report's curated set includes library rows (invariant 9); the
  OPS-2 B digests count household rows only, and a separate check holds that production's seed adds
  only library rows; the runbook's entry for a seed that fails on catalog data. The rehearsal on a
  Neon branch is the maintainer's, before the merge (the plan's "Risks, the rehearsal, and rollback").
- **A fixtures seed checks it owns the database before writing** (`assertSeedOwnsDatabase`, A2-ii D2).
  The fixture library is global: written into a database the seed does not own and then refused, it
  would stay, and production's next seed would keep it on a shared slug (E2). Mutation `603`. ⚠️ It
  does not guard production before the fresh start: production's family household still carries the
  seed's `public_id` (erased at R2), so there the check passes, and the URL allowlist is the only guard.
- **A proof that a catalog write fails as a whole runs on `db`, outside any transaction.**
  `expectRejectedBy(…, tx)` runs its probe in a savepoint, which rolls the partial rows back itself,
  so a writer with no transaction could not fail it (mutation `502`).
