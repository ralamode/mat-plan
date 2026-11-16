-- FAM-1 step 4a-i — program blocks get a kind and an offline id; workouts and the week template.
-- Plan: docs/plans/fam-1-family-program.md §3 (row "4a-i"), §5 lane A; ADR 0007 Amendment 2 §1, §2,
-- §3, §5, §8, §10.
--
-- WHAT THIS ADDS (expand only; nothing reads or writes the new tables until lane P's writers)
--   1. program_blocks.kind text NOT NULL DEFAULT 'legacy' + program_blocks_kind_check, pinned to shared
--      PROGRAM_BLOCK_KINDS by db:verify. A constant default is metadata-only (PG 11+), so every existing
--      block becomes `legacy` with no backfill and no rewrite.
--   2. program_blocks.client_id uuid NULL + uq_program_blocks_household_client_id, NON-partial (ADR 0008
--      3.4) and household-scoped (A2 §2). NULL on the seeded/legacy blocks, which have no client;
--      program_blocks_template_client_id_check requires it on every template block.
--   3. workouts (A2 §2): UNIQUE (id, block_id) as a CONSTRAINT, because the week's composite FK targets
--      it and Postgres needs the key before the FK (docs/lessons.md, 0011); UNIQUE (block_id, client_id),
--      non-partial; the copy self-FK ON DELETE SET NULL; length CHECKs pinned to the shared consts.
--   4. block_day_workouts (A2 §3): a composite FK (workout_id, block_id) -> workouts (id, block_id), so a
--      week can never name another block's workout; partial slot and once-per-day keys; weekday written
--      as IN (0..6) so db:verify can pin it to WEEKDAYS as a set (a BETWEEN shows only its endpoints).
--
-- LOCKS: program_blocks is the only existing table touched, and it is tiny (production holds the one
-- seeded block). It is locked ACCESS EXCLUSIVE up front, before any DDL, so the whole file runs under
-- one lock taken once and fails fast on lock_timeout rather than part-way (0021's precedent); the
-- ADD COLUMNs, the two new tables' FKs to it and its CHECKs then need nothing more. The kind CHECK takes the small-table route: every row holds the default, which it
-- accepts, and a NOT VALID -> VALIDATE split in one file buys nothing (0013's header). The new indexes
-- are built without CONCURRENTLY: the new tables are empty, and every program_blocks.client_id is NULL
-- at creation, so the unique index has nothing to collide on and its build is one pass over one row.
--
-- DEPLOY WINDOW: until this file applies, new code fails 42703 on every INSERT into program_blocks
-- (only seedProgram, which runs after migrate and only on test databases since FAM-1 step 1) and on any
-- bare select of it; queries/program-day.ts names its columns. Nothing in apps/web writes these tables
-- (apps/web/test/program-tables-stay-dark.test.ts). Merge when nobody is logging; recovery is to
-- re-dispatch migrate.yml (docs/runbooks.md).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "program_blocks" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "block_day_workouts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "block_day_workouts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"block_id" bigint NOT NULL,
	"weekday" integer NOT NULL,
	"idx" integer NOT NULL,
	"workout_id" bigint NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "block_day_workouts_weekday_check" CHECK ("block_day_workouts"."weekday" in (0, 1, 2, 3, 4, 5, 6)),
	CONSTRAINT "block_day_workouts_idx_check" CHECK ("block_day_workouts"."idx" >= 0),
	CONSTRAINT "block_day_workouts_label_length_check" CHECK ("block_day_workouts"."label" is null or (char_length(btrim("block_day_workouts"."label")) >= 1 and char_length("block_day_workouts"."label") <= 30))
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workouts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"block_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"copied_from_workout_id" bigint,
	"copied_from_program_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workouts_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "workouts_id_block_id_unique" UNIQUE("id","block_id"),
	CONSTRAINT "workouts_name_length_check" CHECK (char_length(btrim("workouts"."name")) >= 1 and char_length("workouts"."name") <= 30),
	CONSTRAINT "workouts_description_length_check" CHECK ("workouts"."description" is null or (char_length(btrim("workouts"."description")) >= 1 and char_length("workouts"."description") <= 500)),
	CONSTRAINT "workouts_copied_from_program_name_length_check" CHECK ("workouts"."copied_from_program_name" is null or (char_length(btrim("workouts"."copied_from_program_name")) >= 1 and char_length("workouts"."copied_from_program_name") <= 60)),
	CONSTRAINT "workouts_copied_from_pairing_check" CHECK ("workouts"."copied_from_workout_id" is null or "workouts"."copied_from_program_name" is not null)
);
--> statement-breakpoint
ALTER TABLE "program_blocks" ADD COLUMN "kind" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "program_blocks" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "block_day_workouts" ADD CONSTRAINT "block_day_workouts_block_id_program_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_day_workouts" ADD CONSTRAINT "block_day_workouts_workout_block_fkey" FOREIGN KEY ("workout_id","block_id") REFERENCES "public"."workouts"("id","block_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_block_id_program_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_copied_from_workout_id_workouts_id_fk" FOREIGN KEY ("copied_from_workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_block_day_workouts_block_workout" ON "block_day_workouts" USING btree ("block_id","workout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_block_day_workouts_slot" ON "block_day_workouts" USING btree ("block_id","weekday","idx") WHERE "block_day_workouts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_block_day_workouts_once_per_day" ON "block_day_workouts" USING btree ("block_id","weekday","workout_id") WHERE "block_day_workouts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workouts_block_client_id" ON "workouts" USING btree ("block_id","client_id");--> statement-breakpoint
CREATE INDEX "idx_workouts_copied_from_workout" ON "workouts" USING btree ("copied_from_workout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_blocks_household_client_id" ON "program_blocks" USING btree ("household_id","client_id");--> statement-breakpoint
-- Small table, locked above; every row holds the default 'legacy', which the CHECK accepts.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "program_blocks" ADD CONSTRAINT "program_blocks_kind_check" CHECK ("program_blocks"."kind" in ('legacy', 'template'));--> statement-breakpoint
-- Small table, locked above; every row is legacy, which the CHECK accepts.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "program_blocks" ADD CONSTRAINT "program_blocks_template_client_id_check" CHECK ("program_blocks"."kind" <> 'template' or "program_blocks"."client_id" is not null);