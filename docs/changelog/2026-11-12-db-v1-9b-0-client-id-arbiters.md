- **2026-11-12** — **V1-9b B0: a hide no longer frees a `client_id`** — five partial unique indexes
  become plain uniques ([plan](../plans/v1-9b-delete-and-restore.md),
  [ADR 0008](../decisions/0008-deletion.md)). CRUD-1 step 3, and the prerequisite for delete and
  restore. Every `client_id` arbiter on `sessions`, `supersets`, `entries`, `entry_sets` and
  `entry_set_quantities` was `WHERE deleted_at IS NULL`, so a soft-deleted row left the index,
  stopped being an `ON CONFLICT` target, and a replay of the **same** write inserted a twin. Latent
  until now, because nothing could hide a row; V1-9b is what makes hiding reachable, so a phone that
  logged a set, went offline and replayed after the row was hidden would have created a second set
  rather than being recognised as the write it already made. `uq_profiles_client_id` was built
  non-partial at `PROF-1` a-0 for exactly this reason — this generalises that precedent, and the
  asymmetry is the decision: a hide should free a **slot** (an ordinal, a day, a position) and never
  an **offline identity**. Nine slot arbiters stay partial, and `db:verify` asserts both halves on
  the live schema so the structural case cannot be passed by dropping every predicate. The proof is
  behavioural and runs first: log a set, hide the entry, replay the graph, and the write is now
  **refused** rather than duplicated — which `V1-9b` B1-2 turns into a typed envelope. The migration
  takes `ACCESS EXCLUSIVE` on all five tables up front rather than upgrading mid-file, and refuses
  with a named table and a runbook pointer if any `client_id` is already shared, counting hidden rows
  too: a non-partial index collides on a hidden/live pair where the old one did not.
