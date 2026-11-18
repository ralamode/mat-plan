- **2026-11-17** — **Heavy local runs take a machine-wide slot** (`DX-18` 1b). `db:mutations`,
  `e2e:local`, `screenshot:ephemeral` and `pnpm verify` each take a lock at
  `~/.cache/mat-plan/heavy-slot.json` before they start. A second run exits 2, naming the lane and
  command that hold the slot and the load average. The default is one run at a time. Writing a
  number to `~/.cache/mat-plan/heavy-slots` allows more for every session on the machine, and
  `MAT_PLAN_HEAVY_SLOTS=<n>` for one shell, when the machine has the headroom (the maintainer,
  2026-11-17): `mkdir -p -m 700 ~/.cache/mat-plan && echo 3 > ~/.cache/mat-plan/heavy-slots`. Lowering
  it never fails a run already going. Under CI the slot does nothing, and `MAT_PLAN_HEAVY_SLOT=off`
  skips it; `heavy-slot.test.sh` runs in CI's `guards:test` on a temp lock.

  `pnpm verify` becomes a wrapper around `verify:run`, and records its child's process group, so
  killing the wrapper does not free the slot while the run continues. `.github/scripts/pid-lock.mjs` is
  the one lock helper: created with its content, a reused pid counts as dead, a stale lock is taken
  over by rename and checked. `db:mutations`' per-worktree lock moves onto it in PR 2. The roadmap
  row moves to "1b's slot in review".
