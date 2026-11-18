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

| Object                                   | What it holds                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `equipment`, `muscles`                   | Codes only, seeded from `EQUIPMENT` and `MUSCLES`. Labels stay in shared code. |
| `movement_equipment`                     | A movement's required equipment set. Empty set means "no equipment".           |
| `movement_muscles`                       | One optional primary muscle and any secondaries (`MUSCLE_ROLES`).              |
| `movements.modality`                     | `MODALITIES`. Set only on a global catalog row; it is what marks one.          |
| `movementGlobalRowHasPattern` (`schema`) | The global-row CHECK's predicate, once; `verify.ts` re-adds it at runtime.     |
| `verify/catalog.ts`                      | A1's proofs: one entry point right after `migrate()`, one with the modules.    |

All four tables are empty of catalog rows until A2's seed, and nothing in `apps/` reads them until
P11-ii (`apps/web/test/program-tables-stay-dark.test.ts`).

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

## Traps

- **A proof of the global-row CHECK must run right after `migrate()`.** `verify.ts`'s V1-1b simulation
  drops and re-adds it; a later proof tests that copy, not the migration's
  (`verifyCatalogMigrationFacts`).
- **Owed by A2:** the `movements-ownership` report (`corrections/registry.ts`) restates the old
  predicate as `pattern === null`, so it would count a legal non-strength catalog row as a blocker
  once one exists. A2 also classes the join tables with `movements` in `OPS-2`'s Proof A.
- **Owed by A2, too:** once the seed writes join rows on global movements, erasure P7's "no row is
  matched by both households" sees them and becomes the first failure under mutations `318` and
  `319`, so their `.expect` moves to P7's message (or P7 keeps them out). The S4 claim that no writer
  makes a household row then rests on the stay-dark scan's catalog `describe`, which A2 relaxes for
  the seed: the PR that relaxes it carries the guarantee forward.
