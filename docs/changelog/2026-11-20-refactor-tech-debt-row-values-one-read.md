# The day page and the program row read logged sets through one query

Tech debt: "Two reads of a logged row's live sets and quantities".

- `readLiveSets` (`packages/db/src/queries/live-sets.ts`) is now the one two-query read of an entry's live
  `entry_sets` and their live quantities. `listEntriesForDay` (the day page's DAL read) and
  `readRowValues` (the row writer's replay and re-tick, the day plan, the previous values) both read
  through it, so the load-bearing parent filter (quantities of live set ids only) lives once.
- Mutation 172 is re-cut onto it, and an emitted-SQL test pins that `listEntriesForDay` reads its
  sets through it, so a filter-less copy in the DAL would now fail a test; before, the DAL's copy was
  guarded by nothing. A second test pins its one app importer, since it takes internal ids.
- The same rows. Sets keep their order (`(idx, id)`, which the live `(entry_id, idx)` index makes
  the DAL's old `idx` order). Quantities now come back in `id` order, where the DAL's read had no
  `ORDER BY`: new, deterministic, and nothing downstream depends on it.
  The tech-debt row is closed.
