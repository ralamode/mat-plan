- **2026-11-16** — **Four scale-readiness items are placed in Beta 0's sequence**
  ([roadmap → In flight](../roadmap.md#in-flight); [plan.md → SCALE](../plan.md#scale-1)). `SCALE-1`
  (one rule for every new action: the FAM-1 contract pattern, and the day and the time zone passed
  in), `SCALE-2` (pin the function region beside the database; record each vendor's region),
  `SCALE-3` (a statement timeout on the runtime pool) and `SCALE-4` (nine rules that are written down
  but not wired). Gate 1 was run against FAM-1's six lanes: three pass, and `SCALE-3` fails on
  `write-path.md`, so it goes last and takes a turn in that queue. Order: `SCALE-1` → `SCALE-4`, with
  `SCALE-2` beside them after its manual step, then `SCALE-3`. None is a FAM-1 step and none goes in
  a FAM-1 lane. Docs only; nothing is built here.
