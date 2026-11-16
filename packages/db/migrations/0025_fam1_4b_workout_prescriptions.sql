-- FAM-1 step 4b — a prescription can belong to a workout, and a workout's items carry typed targets.
-- Plan: docs/plans/fam-1-family-program.md §1 D2, D14, D19, §3 (row "4b", Erasure), §5 lane A; ADR 0007
-- Amendment 2 §4, §4b, §8, §10 and Amendment 3.
--
-- WHAT THIS ADDS (expand only; nothing writes these columns or the new table until step 6a's
-- save-workout writer; no backfill, no contract step)
--   1. prescriptions.workout_id, FK'd with block_id as a PAIR to workouts (id, block_id), so a template
--      row's block is its workout's; MATCH SIMPLE skips legacy rows. day_role DROPS NOT NULL, replaced
--      by an XOR: a row names a day_role or a workout_id, exactly one.
--   2. prescriptions.client_id (A3, D19), set exactly on template rows, with UNIQUE (workout_id,
--      client_id) NON-partial (ADR 0008 3.4), which also covers the composite FK (leading column).
--   3. The template slot key uq_prescriptions_workout_idx, partial on live template rows.
--   4. notes, rest_after, superset_label, superset_order, each bounded by its shared constant;
--      superset_label's CHECK is EXACTLY supersets_prescription_group_length_check's form (11b copies
--      the label there). Pairing CHECKs: label <-> order; a rest note needs a group.
--   5. target_reps (TARGET_REPS_MAX) and sets (MAX_SETS_PER_MOVEMENT) bounded on TEMPLATE rows only.
--   6. prescription_quantities (D2), mirroring entry_set_quantities: composite FKs to quantity_slots
--      and units, one live row per (prescription, slot), value_min/value_max >= 0 and ordered.
--
-- WHY NOTHING CAN BE REFUSED, BY CONSTRUCTION (not by a claim about production's rows): every new
-- column is NULL on every existing row, and every existing row has a day_role (the column is NOT NULL
-- until this file), so the XOR, the client_id CHECK, the pairing CHECKs and every new-column bound
-- read rows that cannot fail, the FK scan reads all-NULL keys, and the new unique indexes admit no
-- row. ⚠️ The target_reps and sets bounds are scoped `workout_id is null or …` for exactly this reason:
-- production very likely still holds an archived block (the seed is insert-only; #151 replaced it
-- and nothing deleted it) whose target_reps run to 32 characters, which an all-rows CHECK would refuse
-- in its validating scan, wedging the queue. db:verify accepts that 32-character value on a legacy row.
--
-- LOCKS: workouts and prescriptions ACCESS EXCLUSIVE up front (0024's order). The new table's FKs take
-- SHARE ROW EXCLUSIVE on quantity_slots and units, taken up front too in that mode and NOT access
-- exclusive: every logging insert's FK check takes ROW SHARE on units, which ACCESS EXCLUSIVE would
-- queue behind this file; SHARE ROW EXCLUSIVE blocks only their writers (the seed, which runs after
-- migrate in the same job). PGlite (db:verify) cannot prove lock behaviour; nothing rehearses it on a
-- populated database (the Neon-branch apply is not wired, docs/tech-debt.md).
-- The CHECKs and the composite FK take the small-table route (0013's header; 0024 was the first
-- adding-foreign-key-constraint ignore). This is the repo's FIRST ban-drop-not-null ignore: the XOR
-- added below replaces the NOT NULL for every row it held. Indexes are built without CONCURRENTLY,
-- which cannot run in drizzle's per-file transaction; prescriptions is small and the new table empty.
--
-- DEPLOY WINDOW: no request-path statement fails 42703 before this applies. Drizzle names every column
-- on insert, and the only insert into prescriptions is the fixtures seed (never in production, never
-- in Vercel); every read selects a named list (queries/program-day.ts) or raw SQL naming old columns
-- (queries/movement-ownership.ts). apps/web/test/program-tables-stay-dark.test.ts pins that no app
-- code reaches either table. Recovery if the file fails: re-dispatch migrate.yml (docs/runbooks.md).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "workouts", "prescriptions" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
LOCK TABLE "quantity_slots", "units" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "prescription_quantities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prescription_quantities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"prescription_id" bigint NOT NULL,
	"slot" text NOT NULL,
	"dimension" text NOT NULL,
	"unit" text NOT NULL,
	"value_min" numeric(8, 3),
	"value_max" numeric(8, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "prescription_quantities_value_min_check" CHECK ("prescription_quantities"."value_min" is null or ("prescription_quantities"."value_min" >= 0 and "prescription_quantities"."value_min" <> 'NaN')),
	CONSTRAINT "prescription_quantities_value_max_check" CHECK ("prescription_quantities"."value_max" is null or ("prescription_quantities"."value_min" is not null and "prescription_quantities"."value_max" >= "prescription_quantities"."value_min" and "prescription_quantities"."value_max" <> 'NaN'))
);
--> statement-breakpoint
-- The repo's first ban-drop-not-null ignore: prescriptions_day_role_xor_workout_check below holds
-- every row this NOT NULL held (a row with no workout_id must have a day_role). Table locked above.
-- squawk-ignore ban-drop-not-null
ALTER TABLE "prescriptions" ALTER COLUMN "day_role" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "workout_id" bigint;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "rest_after" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "superset_label" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "superset_order" integer;--> statement-breakpoint
ALTER TABLE "prescription_quantities" ADD CONSTRAINT "prescription_quantities_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_quantities" ADD CONSTRAINT "prescription_quantities_slot_dimension_fkey" FOREIGN KEY ("slot","dimension") REFERENCES "public"."quantity_slots"("code","dimension") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_quantities" ADD CONSTRAINT "prescription_quantities_unit_dimension_fkey" FOREIGN KEY ("unit","dimension") REFERENCES "public"."units"("code","dimension") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prescription_quantities_prescription" ON "prescription_quantities" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "idx_prescription_quantities_slot" ON "prescription_quantities" USING btree ("slot","dimension");--> statement-breakpoint
CREATE INDEX "idx_prescription_quantities_unit" ON "prescription_quantities" USING btree ("unit","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prescription_quantities_prescription_slot" ON "prescription_quantities" USING btree ("prescription_id","slot") WHERE "prescription_quantities"."deleted_at" is null;--> statement-breakpoint
-- workout_id was added NULL just above, so the FK scan reads keys MATCH SIMPLE skips; tables locked
-- above (0024 was the repo's first adding-foreign-key-constraint ignore).
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_workout_block_fkey" FOREIGN KEY ("workout_id","block_id") REFERENCES "public"."workouts"("id","block_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prescriptions_workout_client_id" ON "prescriptions" USING btree ("workout_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prescriptions_workout_idx" ON "prescriptions" USING btree ("workout_id","idx") WHERE "prescriptions"."workout_id" is not null and "prescriptions"."deleted_at" is null;--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_day_role_xor_workout_check" CHECK (num_nonnulls("prescriptions"."day_role", "prescriptions"."workout_id") = 1);--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_template_client_id_check" CHECK (("prescriptions"."workout_id" is null) = ("prescriptions"."client_id" is null));--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_target_reps_length_check" CHECK ("prescriptions"."workout_id" is null or "prescriptions"."target_reps" is null or (char_length(btrim("prescriptions"."target_reps")) >= 1 and char_length("prescriptions"."target_reps") <= 20));--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_sets_max_check" CHECK ("prescriptions"."workout_id" is null or "prescriptions"."sets" is null or "prescriptions"."sets" <= 20);--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_notes_length_check" CHECK ("prescriptions"."notes" is null or (char_length(btrim("prescriptions"."notes")) >= 1 and char_length("prescriptions"."notes") <= 500));--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_rest_after_length_check" CHECK ("prescriptions"."rest_after" is null or (char_length(btrim("prescriptions"."rest_after")) >= 1 and char_length("prescriptions"."rest_after") <= 30));--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_superset_label_length_check" CHECK ("prescriptions"."superset_label" is null or (char_length(btrim("prescriptions"."superset_label")) >= 1 and char_length("prescriptions"."superset_label") <= 30));--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_superset_order_check" CHECK ("prescriptions"."superset_order" is null or ("prescriptions"."superset_order" >= 1 and "prescriptions"."superset_order" <= 30));--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_superset_pair_check" CHECK (("prescriptions"."superset_label" is null) = ("prescriptions"."superset_order" is null));--> statement-breakpoint
-- Valid by construction (the header): every existing row passes; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_rest_after_needs_superset_check" CHECK ("prescriptions"."rest_after" is null or "prescriptions"."superset_label" is not null);
