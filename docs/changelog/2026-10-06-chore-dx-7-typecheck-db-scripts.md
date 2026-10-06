- **2026-10-06** — **`packages/db` is typechecked, `verify.ts` included (DX-7).** `apps/web/tsconfig.json`
  was the repo's only tsconfig and its `include` is relative to `apps/web`, so `packages/db/scripts/` —
  `verify.ts` (4,132 lines of DB proofs), `migrate.ts`, `seed.ts`, `corrections/` — was reachable from no
  app import and typechecked by **nothing**, while `tsx` strips types without checking them. A type error
  there surfaced as a runtime failure against a real database. Now `packages/db/tsconfig.json` covers
  `src/**` plus `scripts/**` and `pnpm typecheck` runs both projects, so CI's single `pnpm typecheck` step
  and the `pre-push` hook both widened with it; the gate was proven by planting an error and watching it
  fail. It found **12** on its first run, not the 3 the backlog row predicted: the 3 missing `weight` keys
  (a set literal omitting the key the schema always emits, which reached Postgres as
  `numeric: "undefined"` — [lessons.md](../lessons.md)), plus **9** `insertBodyweightEntry(db, …)` calls
  handing PGlite's handle to a parameter typed `Executor`, i.e. a node-postgres one — every other call in
  the file already used the `asPg` cast declared at the top for exactly that. Both fixes are shape-only
  and `db:verify` passes unchanged, which is the point: the proofs were right, nothing was checking that
  they compiled. Seven places that told agents "`packages/**` is typechecked by nothing" are corrected in
  the same PR — [AGENTS.md](../../AGENTS.md), [lessons.md](../lessons.md), the two feature guides, the
  `db-migration` and `debug-ci-failure` skills, and the comment inside the strength writer that had turned
  the gap into a runtime workaround — each now naming what is **still** uncovered: `packages/shared` and
  `packages/engine` have no tsconfig and are checked only transitively through the app's imports, and
  nothing in `packages/` is linted at all, which is the other half of the 2026-09-30 baseline's seed #4.
