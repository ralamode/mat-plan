- **2026-11-19** — **A burst of merges to `main` costs at most two CI runs** (`DX-18`). Pushes to
  `main` share one concurrency group, so GitHub keeps the run in progress and the newest one and drops
  the pending runs between them. Each push used to get its own run, and eleven queued `main` runs had
  held every pull request behind them. The surviving run checks the whole tree, so a red run covers
  the commits since the last green one; `db:mutations --only <n>` and `git bisect` narrow it, and
  the red-on-main issue says so. The secret scan on `main` moves to its own workflow,
  `secret-scan-main.yml`, one run per commit, because gitleaks scans only its push's own commits. The maintainer's revision of DX-18's D6
  ([plan](../plans/dx-18-mutation-savings.md)).
