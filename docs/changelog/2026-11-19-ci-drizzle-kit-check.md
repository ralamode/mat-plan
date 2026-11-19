- **2026-11-19** — **CI checks the migration snapshot chain.** `drizzle-kit check` now runs first in
  CI's DB step and in `pnpm verify` (`pnpm db:check`). It exits 1 when two migration snapshots claim
  the same parent, the collision two lanes sharing the migration queue can produce, and it needs no
  database. The tech-debt entry "`drizzle-kit check` is not run anywhere" is closed.
