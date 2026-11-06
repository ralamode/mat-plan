-- PROF-1 a-0 — `profiles` gets a lifecycle: `client_id` (replay key) and `archived_at`.
--
-- SHIPS DARK. Nothing reads either column. `a-1`'s `createProfile` is `client_id`'s first reader and
-- `b`'s archive/restore is `archived_at`'s; both are later PRs, so this file is additive only and has
-- nothing to contract. Squawk's destructive rules do not engage: two nullable ADD COLUMNs with no
-- default (no table rewrite, no volatile default) and one index.
--
-- 🔴 `uq_profiles_client_id` IS NON-PARTIAL, AND THAT IS THE DECISION THIS FILE EXISTS TO CARRY.
-- Every other `client_id` arbiter in this database is `WHERE deleted_at IS NULL`. A soft-deleted row
-- therefore stops being an `ON CONFLICT` target, and a replay of the same client key inserts a TWIN
-- rather than resolving to the original — docs/decisions/0008-deletion.md:127 states it, and V1-9b's
-- B0 exists to re-predicate five of them. This column is born after that finding, so it is born
-- without the predicate: an archived or later-deleted athlete KEEPS its slot, and a retried "add"
-- resolves to the same athlete.
-- ⚠️ The price, so nobody "fixes" it later: a `client_id` can never be reused for a different
-- athlete, even once the first is gone.
--
-- `client_id` IS NULLABLE, unlike every other one. The seed and `db:correct` corrections create
-- profiles server-side, where there is no client to mint a key; NOT NULL would mean a backfill plus
-- the CHECK ... NOT VALID -> VALIDATE split (two further migrations) to store a fabricated UUID that
-- means nothing. NULLs are distinct in a unique index, so seeded rows coexist. The app's
-- `addAthleteSchema` requires the key for every row IT creates — the nullability is a
-- server-side-creator allowance, not a hole in the write path.
--
-- `archived_at` IS NOT A SECOND SOFT DELETE and NOT a security boundary. `deleted_at` is the soft
-- delete; this is "not currently training". An archived athlete keeps every row, still exports, and
-- is still reachable by anyone who opens their link — only the picker drops them. ⚠️ It must never
-- enter `isLiveProfile`'s predicate (packages/db/src/writers/ownership.ts): that is the ownership
-- seam, and folding a UX filter into it would turn "archived" into a 404 and make archive silently
-- irreversible from the athlete's own page. docs/features/write-path.md carries the invariant.
--
-- NO `IF NOT EXISTS` ON THE INDEX, and this one is not boilerplate either (0012's reason,
-- `0012_bodyweight_one_per_day.sql:23-24`): it "would silently skip a same-named index with a
-- different predicate" — i.e. exactly a `uq_profiles_client_id` that someone recreated WITH a
-- `WHERE deleted_at IS NULL`. The non-partial property is the whole point of this file, so a guard
-- that could skip past a partial namesake would defeat it. The two ADD COLUMNs keep their guards:
-- a column cannot differ by predicate, and the drift snapshot pins its type.
--
-- NOT CONCURRENTLY, deliberately and not by omission: drizzle's stock migrator wraps each file in a
-- transaction, CONCURRENTLY cannot run inside one, and the transaction-stripping runner AGENTS.md
-- describes does not exist — so `.squawk.toml` excludes `require-concurrent-index-creation` and
-- records the gap in docs/tech-debt.md. `profiles` holds a handful of rows, so the SHARE lock this
-- takes is held for microseconds, and `lock_timeout` below bounds the wait rather than the hold.
--
-- MIGRATION ORDER: this queued behind AUTH-1 1b's `0019_auth1b_household_members.sql`. V1-9b's B0 is
-- in the same queue; whichever of the two merges second REGENERATES from a fresh origin/main with
-- `drizzle-kit generate` rather than hand-renumbering, because meta/_journal.json is append-only and
-- CI enforces it (docs/plans/prof-1-athletes.md -> Migration order).
--
-- "APPLIED IN PROD" means the runbook's three checks, not a green migrate.yml:
-- information_schema.columns lists profiles.client_id and profiles.archived_at, and pg_indexes lists
-- uq_profiles_client_id WITH NO `WHERE` (docs/runbooks.md:116).

SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "client_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_profiles_client_id" ON "profiles" USING btree ("client_id");
