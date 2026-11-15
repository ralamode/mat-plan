- **2026-11-15** — **FAM-1 step 0c: `db:verify` has a harness and one proof module per data lane**
  ([plan](../plans/fam-1-family-program.md) §4, §5 and §6). `packages/db/scripts/verify.ts` was the
  one ~10,000-line file every FAM-1 data lane would have appended proofs to. The database handle and
  the helpers a proof needs (`db`, `asPg`, `asTx`, `expectRejectedBy`, `assertCheckCoversConst`,
  `assertRefTableMatches`, `columnsOf`, `columnCatalogShape`) moved, bodies unchanged, to
  `scripts/verify/harness.ts`, and `verify.ts` imports them by the same names. Four proof modules sit
  beside it, `schema.ts` (lane A), `program.ts` (lane P), `day.ts` (lane E) and `single-values.ts`
  (lane S); each holds no proofs yet and is called once, last, from `verify.ts`. `db:verify` prints
  the same 89 proofs plus one line per module, and all 41 mutation patches still go red on the
  assertion they name. Also new: `scripts/verify/normalize-fixture.ts`, a pure function that rewrites
  public ids to stable labels and named timestamp fields to a placeholder, so a lane can assert its
  query deep-equals a contract fixture; and a no-op `seedProgramFixtures(db, scope)` in
  `src/writers/program/seed-fixtures.ts`, which lane P's step 6c fills in and lane A's step 1 makes
  the test seed call. `src/scope.test.ts` now fails a scope minted at a call site in a proof module,
  as it does in `verify.ts`. No schema change, no migration, no change to production behaviour.
