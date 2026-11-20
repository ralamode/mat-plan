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
| `seedCatalog` (`seed.ts`)                      | The library's one writer (A2-i), called by `seedReference` with the list it is given; production's `seed()` gives it `[]` until A2-ii.                                  |
| `movementIsCatalog()` (`writers/ownership.ts`) | Rule 2's predicate: global and `modality IS NOT NULL`. Never a slug test.                                                                                               |

All four tables are empty of catalog rows in production until A2-ii switches the seed on, and nothing
in `apps/` reads them until P11-ii (`apps/web/test/program-tables-stay-dark.test.ts`).

## Invariants

1. **A join row has no `household_id`.** It belongs to whoever owns its movement, and erasure finds it
   through `movement_id` (`erasure/graph.ts` → `movementsOf`). Never denormalise it.
2. **A join row is read only through a movement the scope may see** (`movementIsAvailableTo`), never
   selected by code alone. Otherwise a muscle or equipment filter crosses households once households
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

## Traps

- **A proof of the global-row CHECK must run right after `migrate()`.** `verify.ts`'s V1-1b simulation
  drops and re-adds it; a later proof tests that copy, not the migration's
  (`verifyCatalogMigrationFacts`).
- **Done in A2-i:** the `movements-ownership` report's blocker count reads the CHECK's own predicate
  (`movementGlobalRowHasPattern`); Proof A classes the join tables with `movements`; S4's guarantee
  moved from the stay-dark scan to invariant 6's proofs.
- **Still owed by A2-ii:** once a catalog row exists in the shared verify database, erasure P7's "no
  row is matched by both households" becomes the first failure under mutations `318` and `319`, so
  their `.expect` moves to P7's message (or P7 keeps them out). A2-i's proofs all roll back, so it
  does not happen yet.
- **Still owed by A2-ii, before the switch** (A2-i's db-safety review):
  - 🔴 **The `movements-ownership` report classes "curated" by `MOVEMENT_SEED_PUBLIC_IDS`**, so after
    the switch it would count every catalog row as "TEN-2b-2 input (global, non-curated,
    unreferenced)", the orphan-removal input. Its "legacy or catalog" discriminator lands with or
    before the switch, or a correction built on that report would delete the library.
  - Cut a Neon restore branch, run `db:seed` against it from the operator's console, and confirm the
    counts line (`CATALOG_MOVEMENTS.length − 12` inserted, 12 held by a legacy row). `db:verify` runs the real library only
    on PGlite inside a savepoint; this is its first real-Postgres run.
  - Run the runbook's shadow query on production first, so the household count is known in advance.
  - A runbook entry for a seed run that fails on catalog data (fix forward; nothing is left behind).
- **A proof that a catalog write fails as a whole runs on `db`, outside any transaction.**
  `expectRejectedBy(…, tx)` runs its probe in a savepoint, which rolls the partial rows back itself,
  so a writer with no transaction could not fail it (mutation `502`).
