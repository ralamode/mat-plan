-- V1-10 (PR 1) — the programming data model: `program_blocks` → `prescriptions` → `prescription_targets`
-- (spec.md §4). A household authors a training block (per-day movement prescriptions with prescribed
-- sets/target_reps), and each prescription carries per-kid SUGGESTED LOADS in `prescription_targets`
-- (human-authored — the LLM never authors loads). Three NET-NEW empty tables → clean by construction: FKs,
-- covering indexes, partial-unique natural keys, and CHECKs all apply instantly with nothing to lock or
-- backfill (no NOT VALID/VALIDATE, no CONCURRENTLY). Ships dark — no app code reads these yet (the prefill
-- is slice 2), so there is no deploy-order window. Seed ships EMPTY (mechanism only).
--
-- Bound lock acquisition + statement runtime before the DDL (AGENTS.md DB rules). drizzle-kit migrate
-- wraps each file in a transaction, so these apply to it (and make the non-concurrent index creation on
-- these empty tables safe).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TABLE "prescription_targets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prescription_targets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"prescription_id" bigint NOT NULL,
	"profile_id" bigint NOT NULL,
	"load" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "prescription_targets_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prescriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"block_id" bigint NOT NULL,
	"day_role" text NOT NULL,
	"movement_id" bigint NOT NULL,
	"idx" integer NOT NULL,
	"sets" integer,
	"target_reps" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "prescriptions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "prescriptions_day_role_check" CHECK ("prescriptions"."day_role" in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core', 'strength_a', 'strength_b')),
	CONSTRAINT "prescriptions_idx_check" CHECK ("prescriptions"."idx" >= 0),
	CONSTRAINT "prescriptions_sets_check" CHECK ("prescriptions"."sets" is null or "prescriptions"."sets" > 0)
);
--> statement-breakpoint
CREATE TABLE "program_blocks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "program_blocks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"household_id" bigint NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "program_blocks_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "prescription_targets" ADD CONSTRAINT "prescription_targets_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_targets" ADD CONSTRAINT "prescription_targets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_block_id_program_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_blocks" ADD CONSTRAINT "program_blocks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prescription_targets_prescription" ON "prescription_targets" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "idx_prescription_targets_profile" ON "prescription_targets" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prescription_targets_prescription_profile" ON "prescription_targets" USING btree ("prescription_id","profile_id") WHERE "prescription_targets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_prescriptions_block" ON "prescriptions" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "idx_prescriptions_movement" ON "prescriptions" USING btree ("movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prescriptions_block_day_role_idx" ON "prescriptions" USING btree ("block_id","day_role","idx") WHERE "prescriptions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_program_blocks_household" ON "program_blocks" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_program_blocks_household_slug" ON "program_blocks" USING btree ("household_id","slug") WHERE "program_blocks"."deleted_at" is null;