-- V1-10 (PR 1b) — fit the programming schema to Ray's real block: (1) add `prescription_targets.reps`, the
-- nullable per-kid REPS override (his kids differ on some pull/chin sets, not just load); (2) widen the
-- `day_role` CHECK to add `strength_c` (three strength days). Both are instant on the still-EMPTY V1-10
-- tables — the ADD COLUMN is a nullable/no-default metadata bump (no rewrite), and the DROP+ADD of the CHECK
-- validates zero rows (no NOT VALID needed). Ships alongside the now-non-empty PROGRAM_SEED (data, not DDL).
--
-- Bound lock acquisition + statement runtime before the DDL (AGENTS.md DB rules). drizzle-kit migrate wraps
-- each file in a transaction, so these apply to it. IF NOT EXISTS makes the ADD COLUMN re-run-safe (0006 idiom).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_day_role_check";--> statement-breakpoint
ALTER TABLE "prescription_targets" ADD COLUMN IF NOT EXISTS "reps" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_day_role_check" CHECK ("prescriptions"."day_role" in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core', 'strength_a', 'strength_b', 'strength_c'));