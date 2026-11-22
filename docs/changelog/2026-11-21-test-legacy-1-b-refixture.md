- **2026-11-21** — **The proofs over older strength rows no longer need the old strength writer**
  (`LEGACY-1` PR B, [plan](../plans/legacy-1-retire-strength-path.md)): the export, tenancy and
  hide/restore proofs read rows from a `db:verify` fixture that writes the shapes production already
  holds, checked against the household with the live ownership predicates. Nothing changes for a
  person. Mutations 02 and 39 are re-aimed at assertions that outlive the writer; 36 waits for the
  PR that deletes its current target.
