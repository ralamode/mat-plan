- **2026-11-19** — **CI fails a PR that grows a page's JavaScript by more than 8 KiB.** A new
  "Bundle size" step in `ci.yml`'s `quality` job measures, after `next build`, how many bytes of
  client JavaScript each route loads on first visit, plus one row for every client chunk (which
  catches code only `dynamic()` loads). It compares each row with `.github/bundle-baseline.json` and
  fails a move of more than 8 KiB either way, printing route, before, after and delta in the step
  summary. A baseline a PR changes is warned per route and must equal that run's measurement, so a
  raise is deliberate and visible; the only way to update it is to paste the summary's measured
  block. Next 16 no longer prints First Load JS, so the guard reads Next's build diagnostics and sums
  the chunk files itself. `check-bundle-size.test.sh` runs in `pnpm guards:test` (PERF-1 (b)).
