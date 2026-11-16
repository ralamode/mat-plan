- **2026-11-15** — **FAM-1 step 11a: the strength writer's replay re-select and superset insert
  move to a shared module** ([plan](../plans/fam-1-family-program.md) §5, step 11a).
  `reselectLiveByClientId` and `insertSupersetRow` move verbatim from `writers/strength-session.ts` to
  a new `writers/session-rows.ts`, so the FAM-1 row writer (11b) can reuse them instead of copying
  them. No behaviour changes: the strength proofs in `db:verify` pass unchanged. The other two
  candidates stay where they are, because the row writer's session and entry inserts differ from
  them (a session keyed by profile, day and workout; an entry that names its prescription and can
  answer `own_hidden`).
