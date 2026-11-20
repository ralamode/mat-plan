# The day page and the program row read logged sets through one query

Tech debt: "Two reads of a logged row's live sets and quantities".

- `readLiveSets` (`packages/db/src/queries/live-sets.ts`) is now the one read of an entry's live
  `entry_sets` and their live quantities. `listEntriesForDay` (the day page's DAL read) and
  `readRowValues` (the row writer's replay and re-tick, the day plan, the previous values) both read
  through it, so the load-bearing parent filter (quantities of live set ids only) lives once.
- Mutation 172 is re-cut onto it, so it now guards both readers; before, the DAL's copy was not
  guarded by any mutation.
- No behaviour change: the same rows, in `(idx, id)` order for sets and `id` order for quantities.
  The tech-debt row is closed.
