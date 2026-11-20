- **2026-11-19** — **A burst of merges to `main` costs at most two CI runs** (`DX-18`). Pushes to
  `main` share one concurrency group, so GitHub keeps the run in progress and the newest one and drops
  the pending runs between them. Each push used to get its own run, and eleven queued `main` runs had
  held every pull request behind them. The newest run checks every commit before it, so a red run
  covers the commits since the last green one; `db:mutations --only <n>` narrows it, and the
  red-on-main issue says so. The maintainer's revision of DX-18's D6
  ([plan](../plans/dx-18-mutation-savings.md)).
