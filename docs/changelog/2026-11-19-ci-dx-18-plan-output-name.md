- **2026-11-19** — **The mutation plan's output is named for the scope it carries.** `mutations-plan`
  outputs `run_mutations`, not `run`, so the guard that refuses any comparison of a scope with `true`
  sees it, and the shard lists are written as literals. The DX-18 plan records the as-built
  `mutations-plan` job and the 8-on-main, 4-on-a-PR split (follow-up to #700's review).
