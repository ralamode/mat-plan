- **2026-11-16** — **`SCALE-3`: a database query that runs longer than 15 seconds is cancelled**
  ([plan](../plans/scale-3-statement-timeout.md), which has the probe that chose the mechanism).
  - **A migration** sets `statement_timeout = '15s'` as a default on the database role. Before it,
    nothing bounded a statement, so one slow query could hold a pooled connection for as long as it ran.
  - **Takes effect as the pooler replaces its backends**, not at merge. It also bounds console sessions
    as that role, and a query waiting on a lock now fails at 15 s. Migrations (60 s) and two of the
    corrections (30 s) set their own limits, which win.
  - **`docs/runbooks.md`** → "The runtime statement timeout": the post-merge check, a long manual query,
    and an emergency lever.
