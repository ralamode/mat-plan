-- GAP-3 PR 3 — `entry_set_quantities`, and the end of the free-text load.
--
-- WHY: the census (docs/plans/gap3-typed-measurements.md §§1-6) found ONE free-text `load` column
-- encoding three different physical quantities — `20s` a duration, `30in` a height, `123 (50ft)` a
-- mass AND a distance. Fixed columns per dimension had already overflowed on the second real program
-- (three worn loads on one YDP movement), so the quantities move to a typed child table keyed by a
-- controlled vocabulary of ROLES. Plan: docs/plans/gap3-pr3-entry-set-quantities.md
--
-- THE GUARD: `entry_set_quantities.dimension` is the SHARED column of two composite foreign keys —
-- (slot, dimension) → quantity_slots and (unit, dimension) → units. The slot pins which dimensions it
-- accepts; the unit must agree with the one stored. So a mass unit in a length quantity fails one FK
-- or the other, and there is no third spelling. A CHECK cannot read another table; this replaces the
-- convention with a constraint.
--
-- EXPAND **AND** CONTRACT IN ONE MIGRATION, deliberately. AGENTS.md requires expand→contract across
-- separate deploys to protect live data across the window where old and new code coexist. Verified
-- before writing this: `SELECT count(*) FROM entry_sets WHERE deleted_at IS NULL` = **0** (sets 0,
-- labeled 0, numeric_loads 0). There is no data to protect and no intervening deploy, so the split
-- would buy nothing and cost three PRs. If that count had been non-zero this file would be two
-- migrations and two deploys — see the plan's "Scope, resized".
--
-- ORDERING NOTE (docs/lessons.md): `quantity_slots`' composite key is a PRIMARY KEY, not a
-- `uniqueIndex`. drizzle emits CREATE TABLE → ADD CONSTRAINT … FOREIGN KEY → CREATE INDEX, so a
-- uniqueIndex FK target is created AFTER the FK referencing it and the whole file aborts inside its
-- transaction. A PK is inlined into CREATE TABLE, which is why this applies cleanly.

SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint

CREATE TABLE "entry_set_quantities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_set_quantities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" uuid NOT NULL,
	"entry_set_id" bigint NOT NULL,
	"slot" text NOT NULL,
	"dimension" text NOT NULL,
	"unit" text NOT NULL,
	"value_num" numeric(8, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entry_set_quantities_value_num_check" CHECK ("entry_set_quantities"."value_num" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quantity_slots" (
	"code" text NOT NULL,
	"dimension" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quantity_slots_code_dimension_pk" PRIMARY KEY("code","dimension"),
	CONSTRAINT "quantity_slots_dimension_check" CHECK ("quantity_slots"."dimension" in ('mass', 'length', 'time', 'instant', 'count', 'boolean'))
);
--> statement-breakpoint
ALTER TABLE "entry_sets" ADD COLUMN "is_bodyweight" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_sets" ADD COLUMN "is_band" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_set_quantities" ADD CONSTRAINT "entry_set_quantities_entry_set_id_entry_sets_id_fk" FOREIGN KEY ("entry_set_id") REFERENCES "public"."entry_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_set_quantities" ADD CONSTRAINT "entry_set_quantities_slot_dimension_fkey" FOREIGN KEY ("slot","dimension") REFERENCES "public"."quantity_slots"("code","dimension") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_set_quantities" ADD CONSTRAINT "entry_set_quantities_unit_dimension_fkey" FOREIGN KEY ("unit","dimension") REFERENCES "public"."units"("code","dimension") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_entry_set_quantities_set" ON "entry_set_quantities" USING btree ("entry_set_id");--> statement-breakpoint
CREATE INDEX "idx_entry_set_quantities_slot" ON "entry_set_quantities" USING btree ("slot","dimension");--> statement-breakpoint
CREATE INDEX "idx_entry_set_quantities_unit" ON "entry_set_quantities" USING btree ("unit","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entry_set_quantities_set_slot" ON "entry_set_quantities" USING btree ("entry_set_id","slot") WHERE "entry_set_quantities"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entry_set_quantities_client_id" ON "entry_set_quantities" USING btree ("client_id") WHERE "entry_set_quantities"."deleted_at" is null;--> statement-breakpoint

-- The contract half. `weight_label` is the free-text load the whole of GAP-3 exists to kill;
-- `weight_num` is superseded by a ('primary','mass') quantity row; `seconds` by ('primary','time').
--
-- ban-drop-column is Squawk doing its job, and this is the escape hatch AGENTS.md describes rather
-- than a config exclusion — the justification has to be written next to the SQL it excuses. It holds
-- for THESE three columns only, on two independent grounds:
--
--   1. There are no rows. `SELECT count(*) FROM entry_sets WHERE deleted_at IS NULL` = 0 (sets 0,
--      labeled 0, numeric_loads 0), checked against prod immediately before this migration was
--      written. The rule protects data and clients across a deploy window; there is no data.
--   2. There is no coexistence window. The rule's real hazard is a DROP landing beside app code that
--      still reads the column. Every reader and writer of these three moves to the child table in
--      THIS SAME PR — writers/strength-session.ts, lib/dal/entries.ts, set-display.ts — so no
--      deployed revision ever sees the column missing while expecting it.
--
-- `seconds` additionally never had a reader or a writer at all (docblock mentions only).
--
-- NOTE the ignore MUST be the line DIRECTLY above its statement — a comment in between silently
-- voids it (verified; docs/lessons.md). That is why the reasoning is up here and not interleaved.
-- squawk-ignore ban-drop-column
ALTER TABLE "entry_sets" DROP COLUMN "seconds";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "entry_sets" DROP COLUMN "weight_num";--> statement-breakpoint
-- squawk-ignore ban-drop-column
ALTER TABLE "entry_sets" DROP COLUMN "weight_label";
