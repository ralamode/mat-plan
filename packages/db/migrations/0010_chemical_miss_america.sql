-- GAP-3 PR 2 — `units.dimension`, plus the five LENGTH codes.
--
-- WHY: the census (docs/plans/gap3-typed-measurements.md §§1-6) found a single free-text `load` column
-- encoding three different physical quantities — `20s` a duration, `30in` a height, `123 (50ft)` a mass
-- AND a distance. `UNIT_CODES` had **no length dimension at all**, which is a large part of why those
-- values had nowhere to live but a string.
--
-- `dimension` is what makes `lb` in a box-jump height UNREPRESENTABLE rather than merely discouraged:
-- the measurement columns arriving in PR 3 FK against `(code, dimension)` together, so the pair is
-- validated as a pair. NOT NULL deliberately — a nullable dimension re-opens the hole it exists to close.
--
-- NO BEHAVIOUR CHANGE. Nothing reads `dimension` yet and no measurement column exists yet; this is the
-- shared-const-first half of the arc, deliberately landed on its own so PR 3's expand carries no
-- units-table DDL.
--
-- HAND-EDITED from `drizzle-kit generate`, which emitted
-- `ADD COLUMN "dimension" text NOT NULL` in one statement — that FAILS on a populated table (the 7
-- pre-GAP-3 rows exist in every deployed DB). Split into add-nullable → backfill → SET NOT NULL below.

SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint

-- Nullable first: a metadata-only bump, no table rewrite, no blocking scan.
ALTER TABLE "units" ADD COLUMN "dimension" text;--> statement-breakpoint

-- Backfill the 7 pre-existing rows. Exhaustive over what `UNIT_CODES` held before this migration, so
-- the SET NOT NULL below cannot fail. The seed then keeps this reconciled on every run
-- (onConflictDoUpdate — DoNothing would have left these rows frozen at whatever this backfill wrote).
UPDATE "units" SET "dimension" = CASE "code"
  WHEN 'lb'     THEN 'mass'
  WHEN 'kg'     THEN 'mass'
  WHEN 'count'  THEN 'count'
  WHEN 'sec'    THEN 'time'
  WHEN 'min'    THEN 'time'
  WHEN 'bool'   THEN 'boolean'
  WHEN 'timing' THEN 'instant'
END
WHERE "dimension" IS NULL;--> statement-breakpoint

-- Safe now that every row is populated. Squawk's objection (SET NOT NULL blocks reads during the scan)
-- is real in general; `units` is a REFERENCE table of 7 rows, so the scan is instant. Its suggested
-- alternative — stay nullable and use a CHECK — is exactly what we do NOT want here: a nullable
-- dimension re-opens the hole the column exists to close.
-- squawk-ignore adding-not-nullable-field
ALTER TABLE "units" ALTER COLUMN "dimension" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_units_code_dimension" ON "units" USING btree ("code","dimension");--> statement-breakpoint

-- Deliberately a plain VALIDATING ADD CONSTRAINT rather than `NOT VALID` → `VALIDATE`. Squawk's
-- objection (ACCESS EXCLUSIVE + a full validating scan) is real in general and does not bite here:
-- `units` is a REFERENCE table with 12 rows after this migration, and every one was just written by the
-- backfill above, so the scan is over a dozen rows that cannot fail. Splitting into NOT VALID +
-- VALIDATE would also have to happen inside this same file and therefore inside one transaction, which
-- buys nothing — the same conclusion 0009 reached independently.
--
-- NOTE the ignore MUST be the line directly above the statement — a comment between them silently
-- voids it (verified; see docs/lessons.md).
-- squawk-ignore constraint-missing-not-valid
ALTER TABLE "units" ADD CONSTRAINT "units_dimension_check" CHECK ("units"."dimension" in ('mass', 'length', 'time', 'instant', 'count', 'boolean'));
