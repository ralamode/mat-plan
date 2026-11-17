- **2026-11-17** — **PRIV-3 is planned: the household and athlete deletions become dry-run-first
  corrections over one delete core and one committed list of per-household tables, which `db:verify`
  proves against the catalog** ([plan](../plans/priv-3-guarded-deletion.md)). Plan only, no code.

  The work is four PRs:
  1. `household-graph.ts`, with its 19 tables marked by grain. A proof fails when a table is
     unclassified, a child is listed after its parent, or the athlete-grain set differs from what is
     reachable from `profiles`. FAM-1 step 5's athlete list becomes a filter of this one, and `OPS-3`'s
     restore reads it too.
  2. A core typed `OwnerScope`. It locks the parent rows, re-runs the eight pre-flights inside the
     transaction and fails closed.
  3. `erase-household`. It requires the direct database URL, refuses the preview database and never
     prints its target. It refuses a household that still carries a committed seed id: `SEC-6` re-keys
     those first (`OPS-2` Q2). It turns runbook steps 2–5 into commands.
  4. `erase-athlete`, which scripts step 5's "Erase one athlete", including its rule on who may ask.

  The plan was first drafted on 2026-11-13. The refresh:
  - Brings in FAM-1's five program tables.
  - Makes a second `OR` predicate (`program_assignments`) an `AND`.
  - Notes that three of the pre-flights guard `ON DELETE SET NULL` edges, where no foreign-key abort
    backs them up.
  - Drops the draft's seed-id tombstones, which contradicted the notice.

  The purge window `N` stays a deferred section, with 30 days proposed. No roadmap item moved.
