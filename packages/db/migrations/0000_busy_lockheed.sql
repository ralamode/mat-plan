-- Bound lock acquisition + statement runtime before any DDL (AGENTS.md DB rules).
-- drizzle-kit migrate wraps each file in a transaction, so these apply to it.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TABLE "entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"profile_id" bigint NOT NULL,
	"activity_date" date NOT NULL,
	"event_at" timestamp with time zone,
	"kind" text NOT NULL,
	"unit" text NOT NULL,
	"movement_name" text,
	"value_num" numeric(8, 3),
	"raw_load" text,
	"raw_reps" text,
	"status" text DEFAULT 'done' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entries_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "entries_kind_check" CHECK ("entries"."kind" in ('bodyweight', 'strength')),
	CONSTRAINT "entries_status_check" CHECK ("entries"."status" in ('done', 'skipped', 'sub_failure')),
	CONSTRAINT "entries_shape_check" CHECK (("entries"."kind" = 'bodyweight' and "entries"."value_num" is not null and "entries"."movement_name" is null)
          or ("entries"."kind" = 'strength' and "entries"."movement_name" is not null))
);
--> statement-breakpoint
CREATE TABLE "entry_sets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_sets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"entry_id" bigint NOT NULL,
	"idx" integer NOT NULL,
	"reps" integer,
	"seconds" integer,
	"weight_num" numeric(7, 3),
	"weight_label" text,
	"status" text DEFAULT 'done' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entry_sets_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "entry_sets_status_check" CHECK ("entry_sets"."status" in ('done', 'skipped', 'sub_failure'))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profiles_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "profiles_kind_check" CHECK ("profiles"."kind" in ('kid', 'adult'))
);
--> statement-breakpoint
CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_unit_units_code_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_sets" ADD CONSTRAINT "entry_sets_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entries_profile_date" ON "entries" USING btree ("profile_id","activity_date");--> statement-breakpoint
CREATE INDEX "idx_entries_unit" ON "entries" USING btree ("unit");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_client_id" ON "entries" USING btree ("client_id") WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_entry_sets_entry" ON "entry_sets" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entry_sets_entry_idx" ON "entry_sets" USING btree ("entry_id","idx") WHERE "entry_sets"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entry_sets_client_id" ON "entry_sets" USING btree ("client_id") WHERE "entry_sets"."deleted_at" is null;