-- V1-9b B2-0 — why a hidden entry was hidden: entries.hide_reason, written only by Clear this day.
-- Plan: docs/plans/v1-9b-delete-and-restore.md § "B2-0" and the Amendment (2026-11-15); ADR 0008
-- Amendments 1 and 2.
--
-- WHAT THIS ADDS (expand only)
--   1. entries.hide_reason text, nullable, no default (a catalog-only ADD COLUMN: no rewrite).
--   2. entries_hide_reason_check: only HIDE_REASONS values ('clear_day'; db:verify pins the literal).
--   3. entries_hide_reason_hidden_check: a LIVE row never carries a reason, so every un-hide clears it
--      in the same statement as deleted_at (UNHIDE, writers/hide.ts), or fails 23514.
--
-- WHY NOTHING CAN BE REFUSED, AT ANY SIZE: every existing row holds NULL in the new column, which
-- both CHECKs accept, so their validating scan reads rows that cannot fail. A NOT VALID → VALIDATE
-- split across two PRs would buy nothing (0024's argument, on the same table). The two constraints
-- are one ALTER TABLE, so the table is scanned once.
--
-- LOCKS AND DURATION: ADD COLUMN takes ACCESS EXCLUSIVE on entries first, held to commit; the hold is
-- the one validating scan, O(rows) (the production count is in the PR, not here: a dated fact does not
-- belong in a forward-only file). lock_timeout 5s; statement_timeout 8s per statement, so an app request
-- queued behind the lock waits at most 5s plus the hold, inside 0028's 15s role statement_timeout as
-- long as the hold is short, which the table's size, not this setting, is what guarantees. 5s and not
-- #496's 2s: a 55P03 here leaves the file pending, which opens the deploy window below, so failing is
-- costlier than for 0029's checks.
--
-- DEPLOY WINDOW (0024's): the OLD app works on either schema; the NEW app needs this applied first.
-- Until it applies, Drizzle's insert names every column, so every insert into entries fails 42703 (all
-- logging), as does every hide and restore; and a failed insert's parameters reach Vercel's runtime
-- logs. Merge outside logging hours, with migrate.yml green on main's HEAD and the previous migration
-- observed applied; watch the run. On failure: roll Vercel back, re-dispatch migrate.yml, re-promote
-- (docs/runbooks.md).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '8s';--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "hide_reason" text;--> statement-breakpoint
-- Every row holds NULL in the new column, which both CHECKs accept; one scan, under the column's lock.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "entries" ADD CONSTRAINT "entries_hide_reason_check" CHECK ("entries"."hide_reason" in ('clear_day')), ADD CONSTRAINT "entries_hide_reason_hidden_check" CHECK ("entries"."hide_reason" is null or "entries"."deleted_at" is not null);
