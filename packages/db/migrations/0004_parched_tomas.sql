-- V1-6b-1 — the `ramp_targets` table: per-profile, per-week calisthenics ramp TARGETs, so
-- weekly adherence (actual entries vs target) is computable in SQL (spec.md §4). NET-NEW, EMPTY
-- table — every statement here (FKs, indexes, the partial natural-key UNIQUE, the CHECK) is
-- CLEAN BY CONSTRUCTION on an empty table: no backfill, no NOT-NULL-on-existing-rows, no
-- destructive op. FKs are inline (no NOT VALID → VALIDATE dance needed — there are no rows to
-- validate); each ref column gets a covering index; idempotency is the partial UNIQUE, not a
-- client_id (config data). No app code ships with this migration (the read DAL + UI are V1-6b-2).
-- Bound lock acquisition + statement runtime before any DDL (AGENTS.md DB rules).
-- drizzle-kit migrate wraps each file in a transaction, so these apply to it.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TABLE "ramp_targets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ramp_targets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"profile_id" bigint NOT NULL,
	"metric_key" text NOT NULL,
	"week_start" date NOT NULL,
	"target_value" numeric(8, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ramp_targets_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "ramp_targets_target_value_check" CHECK ("ramp_targets"."target_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ramp_targets" ADD CONSTRAINT "ramp_targets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramp_targets" ADD CONSTRAINT "ramp_targets_metric_key_metric_definitions_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ramp_targets_profile" ON "ramp_targets" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_ramp_targets_metric_key" ON "ramp_targets" USING btree ("metric_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ramp_targets_profile_metric_week" ON "ramp_targets" USING btree ("profile_id","metric_key","week_start") WHERE "ramp_targets"."deleted_at" is null;