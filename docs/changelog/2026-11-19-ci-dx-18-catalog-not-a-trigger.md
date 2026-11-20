- **2026-11-19** — **A pull request that only adds catalog data no longer runs the mutation proof.**
  A change under `packages/shared/src/catalog/data/` used to start all 470 mutation patches, though
  no patch, proof or seed reads those files. `changed-scopes.mjs` now leaves catalog data out of the
  mutation trigger while a walk of the imports shows that nothing in `packages/db`, and no other
  `@mat-plan/shared` export, reaches it; any doubt (an import it cannot resolve, a git error) runs
  the proof as before. Build and e2e still run for catalog data, and the push to `main` still runs
  every patch, so the proof moves to after the merge rather than being dropped (DX-18, savings (c);
  [plan](../plans/dx-18-mutation-savings.md)).
