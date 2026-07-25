-- V1-8-1 — the `supersets` table + `entries.superset_id`/`superset_order`: group 2+ movements
-- performed ALTERNATING within a session (spec.md §4 `superset`), each member still logging its own
-- entry → entry_set, tagged by superset_id + order. Built to carry ARBITRARY N-movement adult PPL
-- pairings (v2 reuses it — no arity cap). Expand-only: `supersets` is NET-NEW/empty (clean by
-- construction); the two `entries` columns are additive + all-NULL, so the FK + CHECKs validate
-- instantly and no backfill/rewrite occurs. No app code ships here (DAL + UI are V1-8-2/8-3).
--
-- DELIBERATE DEVIATION (same as 0002's idx_entries_session, deferred CI/Squawk+Neon infra): the two
-- new `entries` indexes (idx_entries_superset, uq_entries_superset_order) are NON-CONCURRENT. drizzle
-- wraps each migration file in one transaction, so CONCURRENTLY is unavailable without the deferred
-- transaction-stripping runner; on the current single-household `entries` (only v0/dev rows, no
-- offline writers yet) the build is sub-second. Revisit before the table grows (v1.5 offline). Squawk
-- is deferred repo-wide, so its static require-concurrent-index rule is not a gate now.
--
-- Bound lock acquisition + statement runtime before any DDL (AGENTS.md DB rules).
-- drizzle-kit migrate wraps each file in a transaction, so these apply to it.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TABLE "supersets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supersets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"session_id" bigint NOT NULL,
	"label" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "supersets_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "superset_id" bigint;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "superset_order" integer;--> statement-breakpoint
ALTER TABLE "supersets" ADD CONSTRAINT "supersets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_supersets_session" ON "supersets" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supersets_client_id" ON "supersets" USING btree ("client_id") WHERE "supersets"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_superset_id_supersets_id_fk" FOREIGN KEY ("superset_id") REFERENCES "public"."supersets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entries_superset" ON "entries" USING btree ("superset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_superset_order" ON "entries" USING btree ("superset_id","superset_order") WHERE "entries"."deleted_at" is null;--> statement-breakpoint
-- Hand-added CHECKs (deliberately NOT declared in schema.ts → the drizzle drift snapshot stays clean,
-- same pattern as entries_value_source_check / entries_activity_type_id_not_null). Both NOT VALID →
-- VALIDATE: the all-NULL superset_id column has no existing rows to scan, so VALIDATE is instant.
--  (1) pair superset_id ↔ superset_order — no member without an order, no order without a superset.
--  (2) a superset member must be a MOVEMENT (movement_id set) — forbids a "superset of check-ins".
ALTER TABLE "entries" ADD CONSTRAINT "entries_superset_order_check" CHECK (("superset_id" is null and "superset_order" is null) or ("superset_id" is not null and "superset_order" is not null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "entries" VALIDATE CONSTRAINT "entries_superset_order_check";--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_superset_movement_check" CHECK ("superset_id" is null or "movement_id" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "entries" VALIDATE CONSTRAINT "entries_superset_movement_check";
