-- AUTH-1 1b — `household_members`: which Clerk account belongs to which household.
--
-- SHIPS DARK. Nothing reads this table; 1c's `getHouseholdScope()` is the first reader, and the only
-- writer is the maintainer-run `household-claim-<date>` correction. Additive only — a new table, so
-- Squawk's destructive rules do not engage and expand->contract has nothing to contract.
--
-- THE 19th PER-HOUSEHOLD TABLE. The FK below is ON DELETE NO ACTION (drizzle's default), which is the
-- deletion runbook's stated safety property: "a table this procedure missed would have aborted the
-- transaction rather than silently orphaning rows." So a live membership makes
-- `DELETE FROM households` abort until runbooks.md step 4c names this table — which this PR adds,
-- between `profiles` and `households`, with a db:verify proof that the order commits and leaves zero
-- rows. NO ACTION rather than CASCADE is deliberate, for the reason the runbook already gives for
-- `entry_sets`: a cascade makes the count-based proof report nothing.
--
-- NO EMAIL COLUMN. The person's email and Google identifier live in Clerk; storing the opaque account
-- id and nothing else is the data-minimisation answer (docs/privacy/data-inventory.md § 7).
-- ⚠️ `clerk_user_id` is a NEW identifier class for this database, and a soft-deleted membership
-- retains it indefinitely (§ 5: nothing purges soft-deleted rows) — the household deletion is its
-- only purge. § 8 carries that retention row.
--
-- `household_members_role_check` INLINES its literals because a CHECK cannot import a const
-- (drizzle-kit renders an interpolated const as `$1` in DDL — see 0012's comment). db:verify binds
-- the accepted set back to HOUSEHOLD_ROLES via assertCheckCoversConst.
--
-- The partial unique is an INDEX, not a table constraint: Postgres has no partial UNIQUE constraint.
-- It is BOTH the one-live-household-per-Clerk-account rule AND the resolver's access path, so there
-- is deliberately no companion idx_ on the same column with the same predicate.

SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "household_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid NOT NULL,
	"household_id" bigint NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "household_members_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "household_members_role_check" CHECK ("household_members"."role" in ('owner','member'))
);
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_household_members_household" ON "household_members" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_household_members_clerk_user" ON "household_members" USING btree ("clerk_user_id") WHERE "household_members"."deleted_at" is null;