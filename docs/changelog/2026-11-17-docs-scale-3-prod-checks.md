- **2026-11-17** — **`SCALE-3`: production's 15 s statement timeout is confirmed**
  ([plan.md → SCALE-3](../plan.md#scale-3)).
  - On the pooled string the app's role is `neondb_owner`, the same role the migrator uses, and it
    carries `statement_timeout=15s`.
  - No live backend started before migration `0028` was applied (2026-11-16T22:59:40Z), so every
    connection is bounded.
  - Both checks are the maintainer's, run on 2026-11-17. The result is recorded under
    `docs/runbooks.md` → "The runtime statement timeout".
