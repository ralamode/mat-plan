- **2026-11-20** — **The bundle-size check no longer fails a pull request whose only change is how
  the bundler groups shared code** (`PERF-1`). Its `(all client chunks)` row became `(lazy client
chunks)`: the client chunks no route loads first, which is the code `dynamic()` loads and the row
  was for. The old row also summed first-load chunks, so when Turbopack regrouped the program
  builder's copy into one copy per route group (#798), it read +121.9 KiB though no page loaded more
  than about 1 KiB extra. Per-route rows are unchanged. [Plan](../plans/perf-1-bundle-size.md),
  "As built: the lazy row".
