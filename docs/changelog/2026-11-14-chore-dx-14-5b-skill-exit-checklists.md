- **2026-11-14** — **DX-14 item 5b: every skill ends with a checklist of what "done" looks like.**
  Each of the 14 skills gains a `## Done when` section drawn from its own steps: end states someone
  can check (the fragment is in, the second dry-run printed 0 changes, the change is on `main` by
  `git grep`), not a restatement of the procedure. `skills:check` now refuses a skill without one, so
  the next skill can't skip it. With this, DX-14 items 1–9 are done.
