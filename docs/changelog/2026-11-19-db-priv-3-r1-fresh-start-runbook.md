- **2026-11-19** — **The runbook has the fresh start's steps, and the Neon restore stubs are filled**
  (`PRIV-3` · `CAT-3` R1, draft; [plan](../plans/priv-3-fresh-start-prep.md) D4). A one-time section,
  "The fresh start (`CAT-3` R2)", walks steps 0 to 9 with each command, its expected output, a
  "Second run" line and what to do when step 3's `--apply` refuses on a total mismatch, a deadlock
  (`40P01`) or a lock timeout (`55P03`). "Cut a Neon RESTORE branch" and "Restore from a Neon branch"
  are written, and the ledger gains the export outcome and the branch's name and expiry.
- **2026-11-20** — **The fresh start's step 5 is built: a correction that deletes the old global
  movements, and refuses while anything references one** (`PRIV-3` · `CAT-3` R1;
  [plan](../plans/priv-3-fresh-start-prep.md) D2, D3). `delete-legacy-movements-2026-11-20` deletes
  the global movements that are not catalog rows, or carry a legacy seed `public_id`, with their
  equipment and muscle rows; catalog rows and a household's own movements are never selected. It reads
  every foreign key into `movements` from the catalog and refuses a reference from any of them (hidden
  rows included), a key it cannot count, and a key that does not abort a delete. `--apply` locks the
  rows, re-reads the references under the lock, deletes by the locked ids only, and needs the dry run's
  three counts (`EXPECT_LEGACY_*`). The dry run always prints every count and exits 0. The
  movements-ownership report gains the fresh start's four counts (`R4 (1)` to `R4 (4)`), each read
  from the table. Not yet run: it runs at the fresh start's step 5.
