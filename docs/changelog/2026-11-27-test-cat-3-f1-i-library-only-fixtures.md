# Test databases hold the movement library only (CAT-3 F1-i)

CAT-3 PR 1, lane P ([plan](../plans/cat-3-after-the-fresh-start.md), § PR 1). Since the fresh start
production holds the approved library and no old built-in. A fresh test database (CI, `e2e:local`,
`db:verify`'s shared one) now matches it: the fixtures seed writes the test library
(`CATALOG_FIXTURE`) and no longer the 35 old built-ins, so CI tests the state production is in.

**After merge, the preview needs a reset** (the maintainer's operation, `docs/runbooks.md` → "Standing:
reset the preview database"). The preview is a persistent database that is re-seeded, never
recreated, and a seed deletes nothing: until reset it keeps the old built-ins and the old program.
Check afterwards: `SELECT count(*) FROM movements WHERE household_id IS NULL AND modality IS NULL` is 0.
This reset is a gate before CAT-3 PR 2 merges.

- `SeedLibrary` loses `legacyMovements`; production's branch of the seed is unchanged.
- `PROGRAM_SEED` is rebuilt over test-library slugs and renamed `LEGACY_PROGRAM_FIXTURE`, with the
  same shape (a legacy block the export still reads, until `LEGACY-1`).
- The fixture world's six items that resolved to old built-ins are now the household's own items
  under the world's names.
- `program-builder.spec.ts` picks two test-library items and asserts the picker narrows to the
  intended one; `day-page.spec.ts`' comment is corrected (guest edits, cleared by the board).
- The proofs that read an old built-in on the shared database are re-cut, and their mutation patches
  kept, re-aimed or retired.
