- **2026-10-06** — **`entries.prescribed_snapshot` is live, shipping dark — and its proof was
  mutation-tested rather than argued.** Migration `0013` adds one nullable `text` column plus
  `entries_prescribed_snapshot_movement_check` (`prescribed_snapshot IS NULL OR movement_id IS NOT
NULL`), hand-added in the migration so the drizzle drift snapshot stays clean. Nothing reads or
  writes it yet: the renderer, the log-time writer and the export fallback are chunk 2. **Prod is 51
  rows (49 live)**, so the validating scan is the same triviality migration 0009 recorded for itself.
  The `db:verify` proof is **nine cases** over {NULL, `''`, a rendered string} × {movement, metric,
  **neither**} arm — nine because `entries_value_source_check` is **at-most-one, not XOR**, so a row on
  _neither_ arm is legal, is what a boolean check-in writes, and is the only case that distinguishes
  this CHECK from the adjacent-column typo `… OR metric_key IS NULL`. Then it was **actually
  mutation-tested**: three mutants applied and all three killed, including
  `coalesce(prescribed_snapshot,'') = ''` — the exact form the spec forbids by name. `''` and NULL are
  distinct stored values, asserted both ways, because `''` is a movement-only prescription's real
  rendering (11 of 13 live) while NULL is the only state that falls back to the live match.
  ⚠️ **Chunk 2 merges only after this is observed applied** — the `pg_constraint` catalog query now in
  [runbooks.md](../runbooks.md), not the green tick, because the migrate step `exit 0`s with a warning
  when the Neon secret is absent. Also recorded: `csv-recording-gaps` P1-2 gains the **third** answer
  these chunks actually chose, with the identity column it does _not_ close now owed by chunk 6.
