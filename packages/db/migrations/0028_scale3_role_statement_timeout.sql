-- SCALE-3 — a 15 s statement timeout on the database role, so a runaway query cannot hold a pooled
-- connection. Plan: docs/plans/scale-3-statement-timeout.md.
--
-- WHY THE ROLE: the runtime reaches Postgres through Neon's PgBouncer (transaction mode). Probed on the
-- seed-only preview (2026-11-16): a `statement_timeout` startup parameter is dropped by the pooler
-- (SHOW = 0); `options=-c statement_timeout=…` is refused (08P01); node-postgres's `query_timeout`
-- abandons the query client-side and leaves it running on the server. A role default is applied by
-- Postgres itself to every new backend, which the pooler opens like any other client.
--
-- CURRENT_USER, not a role name: the app and the migrator are expected to connect as the same role
-- (read on the preview; confirmed for production by the maintainer, 2026-11-16), and the name is not
-- written into the repo. On Neon a role belongs to a branch, so a restore branch cut before this
-- migration does not carry the default.
--
-- WHAT IT DOES NOT TOUCH: a session `SET` beats a role default, so every migration's own
-- `SET statement_timeout = '60s'` below still wins, and corrections keep their `SET LOCAL '30s'`.
-- This session is unaffected (a role default is read at connection start).
--
-- TAKES EFFECT GRADUALLY: only backends opened after this commit read it. The pooler keeps its server
-- connections open, so pooled traffic is bounded as they recycle, not at merge. Check:
-- docs/runbooks.md → "The runtime statement timeout".
--
-- Rollback: `ALTER ROLE CURRENT_USER RESET statement_timeout` (forward, as a new migration). No table
-- is locked; ALTER ROLE writes one catalog row.

SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER ROLE CURRENT_USER SET statement_timeout = '15s';
