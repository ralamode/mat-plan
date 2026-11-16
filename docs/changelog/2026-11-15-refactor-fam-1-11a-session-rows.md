- **2026-11-15** — **FAM-1 step 11a: the strength writer's set and quantity rows move to a shared
  module** ([plan](../plans/fam-1-family-program.md) §5, step 11a). The `entry_sets` and
  `entry_set_quantities` insert moves out of `writeSessionStrengthEntry` into
  `insertEntrySetRows` in a new `writers/session-rows.ts`, for the FAM-1 row writer (11b), which
  writes one set row and its quantities per ✓ (D3). No behaviour change: `db:verify` and the
  mutation gate pass unchanged. The plan named `reselectLiveByClientId` and `insertSupersetRow`
  instead. They stay where they were because 11b cannot call them: its superset rows are keyed by
  `(session_id, prescription_group)` (ADR 0007 A2 §6), and its entries answer `own_hidden` instead
  of throwing.
