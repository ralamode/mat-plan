-- GAP-1 P0-1 — persist WHICH PROGRAMMED DAY a logged session was (`sessions.day_role`).
--
-- Before this, `session_type` could only ever be the literal 'strength': DAY_ROLES (which carries
-- strength_a/b/c) was derived from the weekday at READ time and never stored, so nothing could answer
-- "which programmed day was this?" after the fact, and the legacy CSV's `session_type` column could
-- never be right.
--
-- PROVENANCE: the column is written only from an explicit human selection in the log form — never
-- auto-derived from the weekday. A derivation applied at EXPORT time re-corrects every historical row
-- when `DAY_ROLE_BY_WEEKDAY` (a documented stopgap) is replaced; a derivation PERSISTED here would be
-- frozen into rows indistinguishable from a human assertion.
--
-- Bound lock acquisition + statement runtime before the DDL (AGENTS.md DB rules). drizzle-kit migrate
-- wraps each file in a transaction, so these apply to it. IF NOT EXISTS makes the ADD COLUMN re-run-safe
-- (the 0006 idiom).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "day_role" text;--> statement-breakpoint
-- Plain (VALIDATING) ADD CONSTRAINT, deliberately not `NOT VALID` — and unlike 0007/0008 this is the
-- first constraint added to a POPULATED table, so the usual Squawk objection (ACCESS EXCLUSIVE + a full
-- validating scan) genuinely applies. It is safe here for a specific reason: the column was created in
-- the statement above, so EVERY existing row is NULL, and `NULL in (...)` evaluates to NULL, which a
-- CHECK passes (it fails only on FALSE). The scan therefore reads rows that cannot fail, on a table of
-- a few dozen. Splitting into `NOT VALID` → `VALIDATE` would have to happen inside this same file (one
-- migration per PR) and thus inside one transaction, which buys nothing.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_day_role_check" CHECK ("sessions"."day_role" in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core', 'strength_a', 'strength_b', 'strength_c'));
