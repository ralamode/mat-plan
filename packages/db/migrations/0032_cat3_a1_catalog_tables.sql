-- CAT-3 A1 — the movement library's tables: equipment and muscles as reference data, a movement's
-- equipment set and muscles as join tables, and movements.modality. Plan:
-- docs/plans/cat-3-a1-catalog-tables.md; spec: docs/specs/cat-3-movement-library.md S1–S6.
--
-- WHAT THIS ADDS
--   1. equipment, muscles: codes only (labels stay in shared), seeded from EQUIPMENT and MUSCLES by
--      seed.ts after migrate. Reference data, never erased (erasure/graph.ts → REFERENCE_TABLES).
--   2. movements.modality text NULL + movements_modality_check (pinned to shared MODALITIES by
--      db:verify) + movements_household_row_has_no_modality. No default: NULL on every existing row;
--      only the catalog seed (A2) will write it, and only on global rows.
--   3. movements_global_row_has_pattern re-created with a third arm: a global row with no pattern is
--      legal only when it has a modality other than strength. The modality IS NOT NULL is
--      load-bearing (without it NULL <> 'strength' is NULL, and a CHECK passes on NULL).
--   4. movement_equipment, movement_muscles: one row per (movement, code), NO ACTION FKs, a covering
--      index on every FK, and at most one primary muscle per movement (a partial unique index). In
--      HOUSEHOLD_GRAPH by their movement; no household_id column on purpose (schema.ts docblock).
--      Empty until A2. No IF NOT EXISTS: the file is one transaction, and _journal.json is what
--      guarantees one application (0021's header).
--
-- ORDER ON A FRESH DATABASE: every table here is empty when it is created, and the seed (after
-- migrate, in migrate.yml and db:verify) fills equipment and muscles. On production the same holds:
-- the new tables are empty, and the modality CHECKs meet a column that is NULL on every row.
--
-- LOCKS: movements is small (35 global items plus each household's own; production counts were NOT
-- measured for this PR). It is locked ACCESS EXCLUSIVE up front, the level ADD COLUMN, DROP CONSTRAINT
-- and ADD CONSTRAINT CHECK each take, so nothing below upgrades a lock. For the transaction's life it
-- blocks every read of movements and every entries FK check into it, i.e. all strength logging; while
-- the LOCK waits (up to 5s) a queue builds behind it (0018's caveat). PGlite cannot prove lock
-- behaviour, and nothing rehearses it (0027's caveat). The new indexes are on new, empty tables
-- inside drizzle's one transaction, so no CONCURRENTLY (0027's header). The CHECKs are validated in
-- place: every row is NULL in modality, and the re-created CHECK is strictly weaker than the one 0018
-- validated, so every row that passed it passes this.
--
-- DEPLOY WINDOW: until this file applies, new code fails 42703 on every insert into movements
-- (insertMovementOwnedBy; the seed), because Drizzle names every schema column on an insert. Reads
-- name their columns and are unaffected; nothing in apps/ reads the new tables (the stay-dark scan).
-- Old code runs on either schema, so rolling Vercel back is safe.
--
-- MERGE CONDITION: the latest migrate.yml run's head SHA contains every earlier migration (one
-- unapplied migration on main at a time), and nobody is logging (not 18:30–21:00 ET).
--
-- IF IT FAILS (55P03 on the lock, or any error): the whole file rolls back, and every new item name
-- fails 42703 until it applies. Re-dispatch migrate.yml at once: merges are frozen while it is
-- pending, so do not wait for a later push to retry it (docs/runbooks.md → "A pending migration
-- wedges prod", 0032).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "movements" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "equipment" (
	"code" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "muscles" (
	"code" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN "modality" text;--> statement-breakpoint
-- Small table, locked above; modality is NULL on every row, which the CHECK accepts.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "movements" ADD CONSTRAINT "movements_modality_check" CHECK ("movements"."modality" in ('strength', 'conditioning', 'mobility', 'skill'));--> statement-breakpoint
-- Small table, locked above; modality is NULL on every row, so every row passes.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "movements" ADD CONSTRAINT "movements_household_row_has_no_modality" CHECK ("movements"."household_id" is null or "movements"."modality" is null);--> statement-breakpoint
ALTER TABLE "movements" DROP CONSTRAINT "movements_global_row_has_pattern";--> statement-breakpoint
-- Small table, locked above; strictly weaker than the CHECK 0018 validated, so every row passes.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "movements" ADD CONSTRAINT "movements_global_row_has_pattern" CHECK ("movements"."household_id" is not null or "movements"."pattern" is not null or ("movements"."modality" is not null and "movements"."modality" <> 'strength'));--> statement-breakpoint
CREATE TABLE "movement_equipment" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "movement_equipment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"movement_id" bigint NOT NULL,
	"equipment_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "movement_muscles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "movement_muscles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"movement_id" bigint NOT NULL,
	"muscle_code" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_muscles_role_check" CHECK ("movement_muscles"."role" in ('primary', 'secondary'))
);--> statement-breakpoint
ALTER TABLE "movement_equipment" ADD CONSTRAINT "movement_equipment_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_equipment" ADD CONSTRAINT "movement_equipment_equipment_code_equipment_code_fk" FOREIGN KEY ("equipment_code") REFERENCES "public"."equipment"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_muscles" ADD CONSTRAINT "movement_muscles_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_muscles" ADD CONSTRAINT "movement_muscles_muscle_code_muscles_code_fk" FOREIGN KEY ("muscle_code") REFERENCES "public"."muscles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_movement_equipment_pair" ON "movement_equipment" USING btree ("movement_id","equipment_code");--> statement-breakpoint
CREATE INDEX "idx_movement_equipment_equipment_code" ON "movement_equipment" USING btree ("equipment_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_movement_muscles_pair" ON "movement_muscles" USING btree ("movement_id","muscle_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_movement_muscles_one_primary" ON "movement_muscles" USING btree ("movement_id") WHERE "movement_muscles"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "idx_movement_muscles_muscle_code" ON "movement_muscles" USING btree ("muscle_code");
