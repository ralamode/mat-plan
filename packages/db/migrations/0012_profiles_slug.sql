-- V1-13 — `profiles.slug`: the athlete's stable identity, and the `<athlete>` PATH SEGMENT of the CSV
-- export (`data/<type>/<athlete>/<YYYY-MM>.csv`).
--
-- WHY A COLUMN AND NOT A DERIVED STRING: the export path must be stable. Deriving it from
-- `profiles.name` would make a filesystem path a function of a MUTABLE display string — renaming
-- "Liam" to "Liam B" relocates the entire exported tree, and the downstream Claude workflow sees a new
-- athlete with no history. This schema already states the rule for `program_blocks.slug`: "`slug` (not
-- raw `name`) is the identity"; `movements.slug` is the other instance. This is the third, and the one
-- where the stakes are highest because it is a path.
--
-- HAND-EDITED from `drizzle-kit generate`, which emitted `ADD COLUMN "slug" text NOT NULL` as ONE
-- statement — that FAILS on a populated table (every deployed DB has the two seeded profiles). Split
-- into add-nullable → backfill → SET NOT NULL, the `units.dimension` idiom from 0010. See
-- docs/lessons.md.

SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint

-- Nullable first: a metadata-only bump, no table rewrite, no blocking scan.
ALTER TABLE "profiles" ADD COLUMN "slug" text;--> statement-breakpoint

-- One-time bootstrap for rows that already exist. Deliberately MIRRORS `profileSlug()` in
-- @mat-plan/shared (lowercase → any run of non-alphanumerics to a single hyphen → trim hyphens) rather
-- than hardcoding 'liam'/'scarlett', so a deployment whose profiles are named something else still
-- lands a correct value.
--
-- ⚠️ UNLIKE `units.dimension` (0010), the seed does NOT reconcile this afterwards — it is
-- `onConflictDoNothing`, deliberately. A unit's dimension is a FACT the shared const owns, so a
-- mismatch there is drift. A profile's slug is an IDENTITY: once a directory exists in the exported
-- tree, renaming the athlete must not move it. So this bootstrap writes the value once and nothing
-- overwrites it — changing a slug later is a deliberate act, not a side effect of editing a name.
UPDATE "profiles"
SET "slug" = trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g')))
WHERE "slug" IS NULL;--> statement-breakpoint

-- Safe now that every row is populated. Squawk's objection (SET NOT NULL blocks reads during the
-- scan) is real in general and does not bite here: `profiles` holds one row per athlete in a single
-- household — two today — so the scan is over a handful of rows that were just written above. The
-- suggested alternative (stay nullable behind a CHECK) is what we do NOT want: a nullable slug means
-- an export with no directory to write into, discovered at export time rather than at write time.
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "profiles" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- Unique PER HOUSEHOLD, not globally: two households may each have a "liam", and the export path is
-- already household-scoped. Partial on the soft-delete (the ramp_targets / day_readiness idiom), so a
-- deleted profile never blocks reusing its slug.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_profiles_household_slug" ON "profiles" USING btree ("household_id","slug") WHERE "profiles"."deleted_at" is null;
