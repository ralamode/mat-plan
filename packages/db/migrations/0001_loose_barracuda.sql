-- V1-1a — additive (expand-only) generalization toward the full activity model
-- (spec.md §4). New catalog/log tables + additive `profiles` columns; NO changes to
-- `entries`/`entry_sets` (that is V1-1b) and no destructive contract (that is V1-1c).
-- Bound lock acquisition + statement runtime before any DDL (AGENTS.md DB rules).
-- drizzle-kit migrate wraps each file in a transaction, so these apply to it.
-- DELIBERATE DEVIATION (decision 3, deferred CI/Squawk+Neon infra): the covering
-- indexes below are created inline / NON-concurrently — safe here because every
-- indexed table is brand-new or near-empty. The CONCURRENTLY + transaction-stripping
-- runner infra is intentionally out of scope for V1-1a.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TABLE "activity_type_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"input_shape" text NOT NULL,
	"default_unit" text,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "activity_types_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "activity_types_key_unique" UNIQUE("key"),
	CONSTRAINT "activity_types_input_shape_check" CHECK ("activity_types"."input_shape" in ('set_list', 'single_metric', 'boolean', 'timing'))
);
--> statement-breakpoint
CREATE TABLE "day_readiness" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "day_readiness_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"profile_id" bigint NOT NULL,
	"readiness_date" date NOT NULL,
	"gate_color" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "day_readiness_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "day_readiness_gate_color_check" CHECK ("day_readiness"."gate_color" in ('green', 'yellow', 'red'))
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "households_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "households_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "metric_definitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"value_type" text NOT NULL,
	"aggregation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "metric_definitions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "metric_definitions_key_unique" UNIQUE("key"),
	CONSTRAINT "metric_definitions_value_type_check" CHECK ("metric_definitions"."value_type" in ('number', 'count', 'scale_10', 'bool', 'duration', 'text')),
	CONSTRAINT "metric_definitions_aggregation_check" CHECK ("metric_definitions"."aggregation" in ('sum', 'last', 'max', 'avg'))
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"pattern" text,
	"unit_default" text,
	"is_bodyweight" boolean DEFAULT false NOT NULL,
	"video_url" text,
	"cues" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "movements_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "movements_slug_unique" UNIQUE("slug"),
	CONSTRAINT "movements_pattern_check" CHECK ("movements"."pattern" in ('squat', 'hinge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'lunge', 'jump', 'core', 'carry', 'isolation'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"profile_id" bigint NOT NULL,
	"activity_date" date NOT NULL,
	"logged_at" timestamp with time zone,
	"session_type" text,
	"status" text DEFAULT 'done' NOT NULL,
	"source" text,
	"feel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sessions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "sessions_session_type_check" CHECK ("sessions"."session_type" in ('strength', 'conditioning', 'skill', 'push', 'pull', 'legs', 'core')),
	CONSTRAINT "sessions_status_check" CHECK ("sessions"."status" in ('done', 'skipped', 'sub_failure'))
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "household_id" bigint;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "birthdate" date;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "activity_types" ADD CONSTRAINT "activity_types_category_activity_type_categories_code_fk" FOREIGN KEY ("category") REFERENCES "public"."activity_type_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_types" ADD CONSTRAINT "activity_types_default_unit_units_code_fk" FOREIGN KEY ("default_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_readiness" ADD CONSTRAINT "day_readiness_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_unit_units_code_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_unit_default_units_code_fk" FOREIGN KEY ("unit_default") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_types_category" ON "activity_types" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_activity_types_default_unit" ON "activity_types" USING btree ("default_unit");--> statement-breakpoint
CREATE INDEX "idx_day_readiness_profile" ON "day_readiness" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_day_readiness_profile_date" ON "day_readiness" USING btree ("profile_id","readiness_date") WHERE "day_readiness"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_metric_definitions_unit" ON "metric_definitions" USING btree ("unit");--> statement-breakpoint
CREATE INDEX "idx_movements_unit_default" ON "movements" USING btree ("unit_default");--> statement-breakpoint
CREATE INDEX "idx_sessions_profile_date" ON "sessions" USING btree ("profile_id","activity_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_client_id" ON "sessions" USING btree ("client_id") WHERE "sessions"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_profiles_household" ON "profiles" USING btree ("household_id");--> statement-breakpoint
-- ── Hand-added reference-data seed + household_id backfill (idempotent) ──────────
-- Runs AFTER the generated DDL so it doesn't perturb the drizzle snapshot (meta/).
-- Seed the activity_type_categories reference table (mirrors @mat-plan/shared
-- ACTIVITY_CATEGORY_ROWS) — ON CONFLICT DO NOTHING for re-run safety.
INSERT INTO "activity_type_categories" ("code", "label") VALUES
	('strength', 'Strength'),
	('conditioning', 'Conditioning'),
	('skill', 'Skill'),
	('habit', 'Habit'),
	('measurement', 'Measurement'),
	('routine', 'Routine'),
	('life', 'Life')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Seed the root household (fixed UUIDv7 = SEED_HOUSEHOLD_PUBLIC_ID) so existing
-- profiles have a backfill target. Membership UI lands with Clerk at v1.5.
INSERT INTO "households" ("public_id", "name") VALUES
	('019826b4-0000-7000-8000-000000000010', 'Home')
ON CONFLICT ("public_id") DO NOTHING;--> statement-breakpoint
-- Backfill: attach every not-yet-scoped profile to the root household (idempotent).
UPDATE "profiles"
SET "household_id" = (SELECT "id" FROM "households" WHERE "public_id" = '019826b4-0000-7000-8000-000000000010')
WHERE "household_id" IS NULL;--> statement-breakpoint
-- Enforce household_id NOT NULL the expand-safe way (AGENTS.md): CHECK ... NOT VALID
-- (no full-table lock), then VALIDATE after the backfill. The FK was emitted inline
-- above (NULLs are RI-exempt, so it validated cleanly pre-backfill).
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_household_id_not_null" CHECK ("household_id" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "profiles" VALIDATE CONSTRAINT "profiles_household_id_not_null";