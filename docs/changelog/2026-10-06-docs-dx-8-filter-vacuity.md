- **2026-10-06** — **Filed DX-8: every root `pnpm` script passes when its filter matches nothing.**
  `pnpm --filter <name> <script>` prints _"No projects matched the filters"_ and exits **0**, so a
  root script whose package is renamed, moved or mistyped reports success without running. Measured
  on the pinned pnpm (11.13.1): `pnpm --filter @mat-plan/nope typecheck` → exit 0. The blast radius
  is every gate that runs through the root scripts — `lint`, `typecheck`, `test`, `db:verify` and
  `build` — four of which are `pnpm verify` steps and `ci.yml` `quality` gates, so **`pnpm verify`
  would print a green run for a check that executed against nothing.** That is
  [tech-debt](../tech-debt.md)'s _"a green check that proves nothing, which is strictly worse than no
  check, because it is trusted"_, one level below where anyone had looked: the gates were audited,
  the script layer they run through was not. Surfaced while reviewing DX-7 (#244), which widened
  `typecheck` to a second `--filter` — so a rename of `@mat-plan/db` would now silently drop the DB
  half of the typecheck gate while the step stayed green. The fix is measured and one line —
  `failIfNoMatch: true` in `pnpm-workspace.yaml`, after which a missing filter exits 1 and a real
  filter still resolves — but it is repo-wide and gets its own PR rather than riding along on the
  change that found it. Row only; no behaviour change here.
