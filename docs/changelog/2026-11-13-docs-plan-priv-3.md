- **2026-11-13** — **PRIV-3 is planned: the household deletion becomes a dry-run-first correction
  over a delete core, using one committed list of per-household tables that `db:verify` proves
  against the catalog** ([plan](../plans/priv-3-guarded-deletion.md)). Plan only, no code.

  The work is four PRs:
  1. `household-graph.ts`, and a proof that fails when any table is unclassified, a child table is
     listed after its parent, or an athlete-reachable table is not marked athlete-grain. This is what
     catches the next `household_members`. `OPS-3`'s restore uses the same list.
  2. A core typed `OwnerScope`. It locks the household's parent rows, re-checks the pre-flight and
     fails closed.
  3. `erase-household`. It requires the direct database URL, refuses the preview database and never
     prints its target. It leaves a scrubbed tombstone for a committed seed id, so stale seed code
     fails closed instead of re-creating the household (agreed with `OPS-2`). It turns runbook steps
     2–5 into commands.
  4. `erase-athlete`, which the notice already promises and no runbook described.

  A four-lens panel raised eight blocking findings, all resolved. The most serious: the runbook's
  `prescription_targets` `OR` predicate could delete another family's row (it is now `AND`, so a stray
  row makes the delete abort instead), and the re-check was not atomic with the deletes.

  The panel also produced these changes:
  - Athlete erasures need a ledger entry, or a restore would bring them back.
  - Two typed confirmations were theatre and were cut.
  - The `OPS-3` gate would have blocked `OPS-3`'s own drill; the agreed order (graph → `OPS-3` → drill
    → erasure) replaces it.

  The purge window `N` is a deferred section of the same plan, with 30 days proposed. Taking the
  target from the environment through a hidden prompt, rather than the `--household` flag the row
  assumed, is the maintainer's call. The retention reasoning's "byte-faithful CSV export" support is
  re-stated, since ADR 0009 retired it; the conclusion stands. No roadmap item moved.
