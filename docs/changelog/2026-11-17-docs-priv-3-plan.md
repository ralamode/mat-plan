- **2026-11-17** — **PRIV-3 is planned: the household and athlete deletions become dry-run-first
  corrections over one delete core and one committed list of per-household tables, which `db:verify`
  proves against the catalog** ([plan](../plans/priv-3-guarded-deletion.md)). Plan only, no code.

  The plan's PRs:
  - **1:** the 19-table graph in `packages/db/src/erasure/`, with its own feature guide. A proof fails
    on:
    - an unclassified table;
    - a child listed after its parent;
    - a foreign key into the graph that does not abort and is not on an allowlist.

    FAM-1 step 5's athlete list becomes a filter of the graph.

  - **2a:** a core typed `OwnerScope`. It locks every parent row, re-runs the eight pre-flights inside
    the transaction and fails closed.
  - **2b:** `erase-household`. It never prints its target id, including inside drizzle's error
    messages. It refuses the live seed household until `SEC-6` re-keys it. It marks any sign-in that
    is still live in another household.
  - **3:** `erase-athlete`, which scripts step 5's runbook without restating its rule on who may ask.
  - **3b** (a maintainer question): removing a program only that athlete was on.

  A six-lens panel raised six blocking findings, all resolved:
  - The refusal counted hidden profiles, which no re-key reaches, so the maintainer's own household
    could never have been erased.
  - A shared sign-in could have been deleted from another household.
  - One proof was red on a clean tree, and four mutations named the wrong proof.
  - The plan named none of FAM-1's queues for the files it shares.

  The refresh also tightens a second `OR` predicate to `AND`. It records that three pre-flights guard
  `ON DELETE SET NULL` edges, which no foreign-key abort backs up. It drops the first draft's seed-id
  tombstones, which contradicted the notice.

  `beta-1.md` row 8 is re-sized: 4–5 PRs, now also waiting on the `OPS-3` drill, and on `SEC-6` for
  the seed household. The purge window `N` stays a deferred section, with 30 days proposed. No roadmap
  item moved.
