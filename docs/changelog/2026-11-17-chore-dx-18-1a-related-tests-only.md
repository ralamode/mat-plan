- **2026-11-17** — **A push runs typecheck and only the tests the change reaches** (DX-18 PR 1a,
  [plan](../plans/dx-18-heavy-runs-to-ci.md)). The pre-push hook ran the whole vitest suite, about
  2,400 cases, on every push from every lane on one machine. It now runs
  `pnpm typecheck && pnpm test:changed`: `vitest --changed` against the PR base, plus the 27 tests
  that find their targets by reading the filesystem (which import tracing never selects), and the
  whole suite when a lockfile, manifest or tsconfig changed. A docs-only push runs no tests. CI still
  runs every test on every code PR. AGENTS.md gains one rule for what to run locally (one heavy run
  at a time; everything else heavy on CI), corrects its pre-push claim, adds `eval` to the verify
  list, names Squawk among what it does not cover, and drops the stale timings and guard count. The
  DoD no longer calls `quality` a required check (none is), and lessons gains "load timeouts that
  look like failures".
