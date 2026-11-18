- **2026-11-17** — **A plan to move heavy test runs from the shared machine to GitHub CI**
  ([plan](../plans/dx-18-heavy-runs-to-ci.md); `DX-18`). Plan only, no code.

  It comes as four PRs:
  - **1a:** a pre-push that runs only the tests a change reaches, and one written rule for when to
    run locally, with filtered commands;
  - **1b:** a guard that blocks pattern kills, and a one-slot lock for heavy local runs;
  - **2:** the 240-patch mutation gate in CI, sharded and scoped by the files a PR touches, run in
    full on every push to main;
  - **3:** screenshots made by CI on request.

  A five-lens panel found five blocking problems, all resolved:
  - a window in which nothing would run the mutation proof;
  - a lexer that sees only git;
  - scope flags that skipped work when an output was missing;
  - a hash-pinned settings file;
  - a screenshot publish job that would have held a repo-wide write token next to a fork's files.

  Per-pillar test projects are deferred to `DX-18b`, with a trigger.
