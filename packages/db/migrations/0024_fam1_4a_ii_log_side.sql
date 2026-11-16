-- FAM-1 step 4a-ii — the log side: a session names its workout, a row names its prescription set.
-- Plan: docs/plans/fam-1-family-program.md §1 D3, §3 (row "4a-ii"), §5 lane A; ADR 0007 Amendment 2 §6,
-- §8, §10 and Amendment 3.
--
-- WHAT THIS ADDS (expand only; nothing writes these columns until step 11b's row writer)
--   1. sessions.workout_id (FK ON DELETE SET NULL, covering index) + workout_name (frozen at log time,
--      bounded by WORKOUT_NAME_MAX) + the append arbiter uq_sessions_profile_day_workout (partial on
--      linked live rows), and a one-way CHECK: an id never outlives its name.
--   2. supersets.prescription_group (bounded by SLOT_LABEL_MAX) + its append arbiter, partial.
--   3. entries.prescription_id (FK ON DELETE SET NULL, partial covering index) + prescription_set
--      (1..MAX_SETS_PER_MOVEMENT) + the row arbiter uq_entries_session_prescription_set + two one-way
--      CHECKs (a linked row names its set and has a session), as Amendment 3 writes them.
--   4. uq_entries_superset_order RECREATED for rows with no prescription_set (D3): one entry per ✓
--      set means every set of one superset member holds the same place. Dropped and created inside
--      this one transaction, under the lock, so there is never a moment without it.
--
-- WHY NOTHING CAN BE REFUSED, AT ANY SIZE: every new column is NULL on every existing row when it is
-- added, so each CHECK's validating scan and each FK's scan read rows that cannot fail, the three new
-- unique indexes admit no row (their predicates need a non-NULL new column), and the recreated index
-- covers exactly the rows the dropped one did (prescription_set IS NULL is true of all of them).
-- DURATION is O(rows): about a dozen full scans and index builds of entries and sessions run under
-- the lock below, within the 60s statement_timeout. Production row counts were not measured from
-- here (nobody logs in the app yet); no gate rehearses this on populated tables (the Neon-branch
-- apply is not wired, docs/tech-debt.md).
--
-- LOCKS: workouts, prescriptions, sessions, supersets and entries are locked ACCESS EXCLUSIVE up
-- front, before any DDL: the two FKs would otherwise take SHARE ROW EXCLUSIVE on workouts and
-- prescriptions mid-file. The order puts the log tables in the strength writer's order (sessions →
-- supersets → entries, writers/strength-session.ts) after the two parents no writer locks in a
-- transaction; the export reads entries then sessions without a lock beyond its snapshot.
-- The CHECKs and FKs take the small-table route (0013's header): this is the repo's FIRST use of the
-- adding-foreign-key-constraint ignore. Indexes are built without CONCURRENTLY, which cannot run in
-- drizzle's per-file transaction.
--
-- DEPLOY WINDOW: until this file applies, Drizzle's insert names the new columns, so EVERY insert into
-- sessions, supersets or entries fails 42703: the strength writer, check-ins, bodyweight, practice —
-- all logging. Merge when nobody is logging (the plan's rule; it is also a privacy condition: a
-- failed insert's error carries its params into Vercel's runtime logs). Recovery: re-dispatch
-- migrate.yml; meanwhile roll Vercel back to the previous deployment, whose code works on either
-- schema (docs/runbooks.md).
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
LOCK TABLE "workouts", "prescriptions", "sessions", "supersets", "entries" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
-- Recreated below in the same transaction, under the lock taken above.
-- squawk-ignore require-concurrent-index-deletion
DROP INDEX "uq_entries_superset_order";--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "prescription_id" bigint;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "prescription_set" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "workout_id" bigint;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "workout_name" text;--> statement-breakpoint
ALTER TABLE "supersets" ADD COLUMN "prescription_group" text;--> statement-breakpoint
-- The column was added NULL just above, so the FK scan reads rows that cannot fail; tables locked
-- above. The repo's first adding-foreign-key-constraint ignore (the header says why).
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "entries" ADD CONSTRAINT "entries_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The column was added NULL just above, so the FK scan reads rows that cannot fail; tables locked
-- above. The repo's first adding-foreign-key-constraint ignore (the header says why).
-- squawk-ignore adding-foreign-key-constraint, constraint-missing-not-valid
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entries_prescription" ON "entries" USING btree ("prescription_id") WHERE "entries"."prescription_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_session_prescription_set" ON "entries" USING btree ("session_id","prescription_id","prescription_set") WHERE "entries"."prescription_id" is not null and "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_sessions_workout" ON "sessions" USING btree ("workout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_profile_day_workout" ON "sessions" USING btree ("profile_id","activity_date","workout_id") WHERE "sessions"."workout_id" is not null and "sessions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supersets_session_prescription_group" ON "supersets" USING btree ("session_id","prescription_group") WHERE "supersets"."prescription_group" is not null and "supersets"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entries_superset_order" ON "entries" USING btree ("superset_id","superset_order") WHERE "entries"."deleted_at" is null and "entries"."prescription_set" is null;--> statement-breakpoint
-- Every row holds NULL in the new column(s), which this CHECK accepts; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "entries" ADD CONSTRAINT "entries_prescription_set_check" CHECK ("entries"."prescription_set" is null or ("entries"."prescription_set" >= 1 and "entries"."prescription_set" <= 20));--> statement-breakpoint
-- Every row holds NULL in the new column(s), which this CHECK accepts; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "entries" ADD CONSTRAINT "entries_prescription_needs_set_check" CHECK ("entries"."prescription_id" is null or "entries"."prescription_set" is not null);--> statement-breakpoint
-- Every row holds NULL in the new column(s), which this CHECK accepts; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "entries" ADD CONSTRAINT "entries_prescription_needs_session_check" CHECK ("entries"."prescription_id" is null or "entries"."session_id" is not null);--> statement-breakpoint
-- Every row holds NULL in the new column(s), which this CHECK accepts; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workout_name_length_check" CHECK ("sessions"."workout_name" is null or (char_length(btrim("sessions"."workout_name")) >= 1 and char_length("sessions"."workout_name") <= 30));--> statement-breakpoint
-- Every row holds NULL in the new column(s), which this CHECK accepts; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workout_named_check" CHECK ("sessions"."workout_id" is null or "sessions"."workout_name" is not null);--> statement-breakpoint
-- Every row holds NULL in the new column(s), which this CHECK accepts; table locked above.
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "supersets" ADD CONSTRAINT "supersets_prescription_group_length_check" CHECK ("supersets"."prescription_group" is null or (char_length(btrim("supersets"."prescription_group")) >= 1 and char_length("supersets"."prescription_group") <= 30));