- **2026-11-26** — **PERF-3 step 2 is planned as a measurement first** ([plan](../plans/perf-3b-page-rerender.md)):
  before the ✓ stops returning the whole day page, measure how much of a ✓'s server time that
  re-render costs, then run the re-render's independent reads together. The "answer with the row
  only" design is deferred to v1.5, where the offline queue keeps a copy of the day on the phone; a
  seven-lens panel found it needs several PRs on the app's main screen. The backlog row in
  [plan.md](../plan.md) says so.
