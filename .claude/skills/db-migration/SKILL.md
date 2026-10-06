---
name: db-migration
description: Make a mat-plan schema change safely — edit packages/db/src/schema.ts, drizzle-kit generate, hand-harden the generated SQL (timeouts, statement-breakpoints, nullable→backfill→NOT NULL, squawk-ignore placement, expand→contract), seed from packages/shared consts idempotently, add a db:verify proof, and pass the forward-only / Squawk / drift gates. Use for ANY change to the Drizzle schema, a migration, a reference table, or a seed — "add a column", "new table", "migration", "change the schema", "seed X".
---

# DB migration

Rules: [AGENTS.md](../../../AGENTS.md) → "Schema & migration conventions" and "Database / migration
PR rules". Traps: [docs/lessons.md](../../../docs/lessons.md) → "Database / migrations". A migration
**always** owes a plan with a DB-safety lens (`plan-with-panel`), and **one migration per PR**.

**Forward-only is permanent.** Once a migration is on `main` it cannot be edited, only fixed forward
(#139 → #147). Get it right on the branch.

## 1. Edit the schema

- There is one file, `packages/db/src/schema.ts`. Casing is `snake_case` via `drizzle.config.ts`.
- Conventions: `bigint` identity PK, `public_id` UUIDv7 for anything that leaves the server,
  `client_id` UUIDv7 with a **partial** unique index `WHERE deleted_at IS NULL`, `timestamptz`
  everywhere, `deleted_at` for soft delete, an FK plus a covering index on every ref, and
  `idx_<table>_<cols>` naming.
- Enums are **reference tables seeded from a `packages/shared` as-const array**, or text + CHECK for
  status. Never `pgEnum`.
- A composite FK's parent key must be `primaryKey()` or `unique()`, **not `uniqueIndex()`**. The index
  is created after the FK, so the migration aborts (lessons.md, 0011).

## 2. Generate, then harden by hand

```bash
pnpm db:generate --name <id>_<slug>   # → packages/db/migrations/NNNN_<id>_<slug>.sql + meta/ (e.g. 0011_gap3_quantities_expand)
```

- Always pass `--name`. Without it you get a random name (`0010_chemical_miss_america`) that says
  nothing in a review.
- **Add or drop in one change?** drizzle-kit prompts "rename?" and needs a TTY. Generate in two
  passes, merge them, and **fix the promoted snapshot's `prevId`**. CI checks the chain.

Then edit the generated SQL, the way 0009–0011 do:

```sql
-- <WHY, plan link, and the safety argument: prod row counts, lock impact, why each step is safe>
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint
ALTER TABLE "x" ADD COLUMN IF NOT EXISTS "y" text;--> statement-breakpoint
```

- **Every statement gets `--> statement-breakpoint`, the SETs included.** Without it you get
  "cannot insert multiple commands into a prepared statement".
- **`ADD COLUMN … NOT NULL` on a populated table fails.** Split it: add nullable → backfill `UPDATE`
  (bounded) → `SET NOT NULL`. A new constraint on existing data: `NOT VALID` now, `VALIDATE` in a
  **separate PR** (in one file they share a transaction, and NOT VALID buys nothing).
- **Destructive changes are expand→contract across deploys.** Add the new column, then ship code
  that writes both and reads the new one, backfill, and drop the old column in a later PR. Only
  collapse the steps with evidence (0011 had 0 prod rows) written in the header.
- **Indexes:** `CONCURRENTLY` can't run inside drizzle's per-file transaction, and the
  transaction-stripping runner AGENTS.md describes **doesn't exist** (tech-debt.md). A plain
  `CREATE INDEX` on a small or new table is accepted with a comment saying why. On a large hot table,
  stop and plan the runner first.
- **Squawk exceptions:** `-- squawk-ignore <rule>` on the line **directly** above the statement, with
  the justification above that. Any comment in between silently voids it.

## 3. Seed (if reference data changed)

- Add the value to the `packages/shared` const. `packages/db/src/seed.ts` reads it.
- `onConflictDoNothing` on the natural key is the default. `UNITS` deliberately uses
  `onConflictDoUpdate` so the table mirrors its source. Never switch a row that FKs depend on to
  DoUpdate if it could change the key.
- A conflict target on a partial index needs `targetWhere: isNull(t.deletedAt)`.

## 4. Prove it in `db:verify`

`packages/db/scripts/verify.ts` runs every migration on in-process PGlite, seeds **twice**
(idempotency), then runs sections marked `// ── <ROW-ID>: <title> ──`. Append one for this change,
before the final log:

- column shape (`columnsOf`), CHECK ↔ const parity (`assertCheckCoversConst`), reference table ↔
  const (`assertRefTableMatches`)
- each new constraint **rejects** bad data (`expectRejectedBy('<constraint_name>', fn)`)
- the happy path round-trips through the real writer or DAL query

`verify.ts` is typechecked since DX-7 (`packages/db/tsconfig.json`, wired into `pnpm typecheck`), so a
stale column reference is now a compile error. A **tautological** assertion still is not — only running
it proves anything. Run it.

## 5. Local gates

```bash
pnpm db:generate && git status --short packages/db/migrations   # must be clean: no drift
pnpm verify                                                       # includes db:verify
npx squawk-cli@2.66.0 -c .squawk.toml packages/db/migrations/NNNN_*.sql
```

CI adds: the **forward-only guard** (migrations may only be ADDED; `_journal.json` append-only; the
snapshot `prevId` chain), **Squawk** on added `.sql`, and the **drift guard**. There is **no
Neon-branch apply** yet (tech-debt.md), so don't cite one.

## 6. Ship and deploy order

- The PR description gets a **Mermaid ERD** (no backticks in labels) and the DB section of the
  template: lock/rewrite risk (paste the Squawk output), backfill plan, rollback, PII, new indexes.
- `migrate.yml` applies to prod **on merge to main** (GitHub Actions is the only migrator, never
  Vercel). Expand migrations therefore land **before** code that needs them. A contract (drop)
  lands only after no deployed code reads the column.
- Before a destructive or backfill step: cut a Neon restore branch ([runbooks.md](../../../docs/runbooks.md)).

## Red flags

- A modified file under `packages/db/migrations/` that already exists on `main`.
- Generated SQL committed unedited, with no header, timeouts or breakpoints.
- A `DROP`/`RENAME` in the same PR as the code that stops using it.
- A new constraint with no `db:verify` rejection proof.
- `drizzle-kit push` anywhere.
