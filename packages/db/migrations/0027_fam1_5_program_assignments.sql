-- FAM-1 step 5 — which athlete is on which program, from and through which day, on which weekdays.
-- Plan: docs/plans/fam-1-family-program.md §3 (row "5", Erasure), §5 lane A, D8, D15; ADR 0007
-- decision 1 and Amendment 2 §1, §7, §8, §10; docs/plans/sched-1-scheduling-model.md chunk 1c, as revised.
--
-- WHAT THIS ADDS (two NEW tables, dark: nothing reads or writes them until lane P's put-on, step 6c)
--   1. program_assignments: block_id and profile_id (FKs, NO ACTION, each with a non-partial covering
--      index), idx (the athlete's program order, >= 0), active_from (NOT NULL), active_to (NULL while
--      open; the INCLUSIVE last day), and three partial keys: one live row per (profile, block,
--      active_from); one OPEN row per (profile, block); one OPEN row per (profile, idx).
--   2. program_assignment_weekdays: assignment_id (an explicitly named FK: drizzle's generated name is
--      67 bytes and Postgres truncates at 63) and weekday 0..6 (0 = Sunday, WEEKDAYS), one live row per
--      (assignment, weekday).
--
-- WHY NOTHING CAN BE REFUSED: both tables are created empty in this file, so every FK, CHECK and unique
-- index is validated against zero rows, and the partial unique indexes are built on empty tables
-- without CONCURRENTLY (which cannot run in drizzle's per-file transaction). No production numbers are
-- written here: a migration is forward-only, so a fact in it is permanent.
--
-- LOCKS: the two FKs to existing tables take SHARE ROW EXCLUSIVE on profiles and program_blocks; both are
-- taken up front in that mode so the file fails in its first 5s rather than mid-DDL. Not ACCESS
-- EXCLUSIVE: every page reads profiles (ACCESS SHARE) and every log insert's FK check takes ROW SHARE,
-- neither of which this mode blocks; it queues only writers of the two tables (adding, renaming or
-- archiving an athlete; lane P's program writers), for the milliseconds this file runs. PGlite (db:verify)
-- cannot prove lock behaviour; nothing rehearses it on a populated database (docs/tech-debt.md).
--
-- DEPLOY WINDOW: none. No app code names either table (apps/web/test/program-tables-stay-dark.test.ts),
-- so a deploy that races migrate.yml fails nothing. Merge only when migrate.yml is green for main's HEAD:
-- drizzle applies every pending file in ONE transaction, so a still-pending earlier migration would share
-- this file's locks and its failure. Recovery if this fails: re-dispatch migrate.yml (docs/runbooks.md).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "profiles", "program_blocks" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "program_assignment_weekdays" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "program_assignment_weekdays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"assignment_id" bigint NOT NULL,
	"weekday" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "program_assignment_weekdays_weekday_check" CHECK ("program_assignment_weekdays"."weekday" in (0, 1, 2, 3, 4, 5, 6))
);
--> statement-breakpoint
CREATE TABLE "program_assignments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "program_assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"block_id" bigint NOT NULL,
	"profile_id" bigint NOT NULL,
	"idx" integer NOT NULL,
	"active_from" date NOT NULL,
	"active_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "program_assignments_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "program_assignments_idx_check" CHECK ("program_assignments"."idx" >= 0),
	CONSTRAINT "program_assignments_active_range_check" CHECK ("program_assignments"."active_to" is null or "program_assignments"."active_to" >= "program_assignments"."active_from")
);
--> statement-breakpoint
ALTER TABLE "program_assignment_weekdays" ADD CONSTRAINT "program_assignment_weekdays_assignment_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."program_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_assignments" ADD CONSTRAINT "program_assignments_block_id_program_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_assignments" ADD CONSTRAINT "program_assignments_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_program_assignment_weekdays_assignment" ON "program_assignment_weekdays" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_assignment_weekdays_assignment_weekday" ON "program_assignment_weekdays" USING btree ("assignment_id","weekday") WHERE "program_assignment_weekdays"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_program_assignments_block" ON "program_assignments" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "idx_program_assignments_profile" ON "program_assignments" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_assignments_profile_block_from" ON "program_assignments" USING btree ("profile_id","block_id","active_from") WHERE "program_assignments"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_assignments_profile_block_open" ON "program_assignments" USING btree ("profile_id","block_id") WHERE "program_assignments"."active_to" is null and "program_assignments"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_assignments_profile_idx" ON "program_assignments" USING btree ("profile_id","idx") WHERE "program_assignments"."active_to" is null and "program_assignments"."deleted_at" is null;
