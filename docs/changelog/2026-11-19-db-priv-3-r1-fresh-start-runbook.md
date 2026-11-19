- **2026-11-19** — **The runbook has the fresh start's steps, and the Neon restore stubs are filled**
  (`PRIV-3` · `CAT-3` R1, draft; [plan](../plans/priv-3-fresh-start-prep.md) D4). A one-time section,
  "The fresh start (`CAT-3` R2)", walks steps 0 to 9 with each command, its expected output, a
  "Second run" line and what to do when step 3's `--apply` refuses on a total mismatch, a deadlock
  (`40P01`) or a lock timeout (`55P03`). "Cut a Neon RESTORE branch" and "Restore from a Neon branch"
  are written, and the ledger gains the export outcome and the branch's name and expiry. Step 5's
  correction and R4's counts follow in this PR once `CAT-3` A2-ii is on `main`.
