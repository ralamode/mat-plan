# Production's seed writes the movement library; test databases read the test library

CAT-3 A2-ii, lane P ([plan](../plans/cat-3-a2-ii-seed-switch.md)). Production's seed now writes the
approved movement library (`CATALOG_MOVEMENTS`) and stops writing the 35 old built-ins, which stay in
production until the fresh start. A fixtures database (CI's e2e, the preview, the local harnesses)
gets the test library (`CATALOG_FIXTURE`) and the old built-ins, and the app reads the test library
exactly there, never in production (K29), logging one fixed line when it does.

- A fixtures seed checks it owns the database before writing anything, so a refused run leaves no
  global row behind.
- The `movements-ownership` report counts a library row as curated, by an exact test (a modality and a
  library slug), so the library never reaches the orphan-removal input.
- `db:verify`'s shared database is a fixtures database; its production seeds are rolled back, and the
  household-table digests count household rows only. Mutations `598`–`604`; `506` is retired.
