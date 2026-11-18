- **2026-11-17** — **Heavy local runs take a machine-wide slot** (`DX-18` 1b). `db:mutations`,
  `e2e:local`, `screenshot:ephemeral` and `pnpm verify` each take a lock at
  `~/.cache/mat-plan/heavy-slot.json` before they start. A second run exits 2, naming the lane and
  command that hold the slot and the load average. The default is one run at a time;
  `MAT_PLAN_HEAVY_SLOTS=<n>` allows more when the machine has the headroom (the maintainer,
  2026-11-17). Under CI the slot does nothing, and `MAT_PLAN_HEAVY_SLOT=off` skips it.

  `pnpm verify` becomes a wrapper around `verify:run`, and records its child's process group, so
  killing the wrapper does not free the slot while the run continues. `.github/scripts/pid-lock.mjs` is
  the one lock helper: created with its content, a reused pid counts as dead, a stale lock is taken
  over by rename and checked. `db:mutations`' per-worktree lock moves onto it in PR 2. The roadmap
  row moves to "1b's slot in review".
