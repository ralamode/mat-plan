- **2026-11-17** — **PRIV-3: the tables a household deletion must remove are one list in code, checked against the database**
  ([guide](../features/erasure.md); [plan](../plans/priv-3-guarded-deletion.md), PR 1). The 19
  tables that hold a household's data, in the order a delete must walk them, are now
  `HOUSEHOLD_GRAPH` in `packages/db/src/erasure/graph.ts`, and the athlete erasure's list moved
  beside it. `db:verify` now proves that every table in the database is either in that list or is
  reference data, that every foreign key runs child before parent, that the keys which do not abort
  a delete are the ones named, that no row is selected for two households, and that a row
  straddling two households is selected for neither. The runbook's household table now scopes
  targets and assignments by athlete AND program, and no longer claims a proof of its whole order
  that did not exist. Nothing deletes through the list yet: the guarded scripts are PRIV-3 PR 2a,
  2b and 3.
