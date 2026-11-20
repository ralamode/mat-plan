- **2026-11-19** — **A plan for running fewer mutation patches on pull requests.** A catalog batch
  would stop running all 470 patches on its PR, because no patch, proof or seed reads catalog data.
  A PR whose only trigger is a patch's target file outside the packages (in practice the runbook)
  would run just that patch. Every push to `main` still runs all of them. Skipping main's run after a
  PR proof is designed but deferred until a merge queue exists, pending the maintainer
  ([plan](../plans/dx-18-mutation-savings.md)).
