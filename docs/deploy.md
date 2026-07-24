# mat-plan — Deployment & one-time setup

Hosted on **Vercel**, one project linked to the GitHub repo. Every PR gets a **preview deploy**;
`main` deploys to **production**. Postgres is **Neon**; **GitHub Actions** is the single migrator.
See [architecture.md](./architecture.md) §5 for the full CI/deploy topology.

## One-time setup checklist

Do these once to get a deployed app running against a real database:

1. **Neon** — create the project, grab the pooled + direct connection strings.
2. **Vercel** — set the root directory + environment variables.
3. **GitHub** — add the `DATABASE_URL_UNPOOLED` secret (the migrator uses it).
4. **First migration** — run the migrate workflow once.
5. **Local** (optional) — create `apps/web/.env.local` for `pnpm dev`.

> **What "running" means after V0-5/V0-6:** the app boots with a live DB wired, the access gate
> works, and the schema + seed exist in Neon. The first screen that _reads_ the DB is **V0-7**
> (Today view) — so until then you're verifying boot + migration, not a data-backed page.

## 1. Neon (database)

1. Sign up at [neon.tech](https://neon.tech) and **create a project** (pick a region close to your
   Vercel region). It provisions a Postgres 16/17 database with a default branch (`main`) + role.
2. In the project's **Connection Details**, copy **two** strings for the same database:
   - **Pooled** (host contains `-pooler`) → app runtime. This is `DATABASE_URL`.
   - **Direct / unpooled** (host without `-pooler`) → migrations. This is `DATABASE_URL_UNPOOLED`.
   - Keep `?sslmode=require` on both.
3. That's it — no manual table creation. The schema is applied by our migrations (step 4); do **not**
   run `drizzle-kit push` against Neon.

Why two strings: the app runs many short-lived serverless connections through **PgBouncer** (pooled),
but DDL/migrations need a **direct** session (PgBouncer's transaction pooling can't run migrations).

## 2. Vercel

**Project settings (one-time):** this is a **pnpm monorepo**, so the root directory matters:

- **Root Directory:** `apps/web` (with "Include files outside the root directory" **ON** so Vercel
  reads the workspace root — `pnpm-workspace.yaml`, `packages/*`).
- **Framework preset:** Next.js (auto-detected). **Install/Build:** defaults. **Node.js:** 22+.

**Environment variables** (Project → Settings → Environment Variables), set for **Production** and
**Preview**:

| Variable               | Value                              | Notes                    |
| ---------------------- | ---------------------------------- | ------------------------ |
| `ACCESS_GATE_PASSWORD` | a long random code (≥8 chars)      | V0-4 access-gate stopgap |
| `DATABASE_URL`         | Neon **pooled** string (`-pooler`) | app runtime only         |

- Validated at boot by `lib/env.ts` — **the app refuses to start if either is missing/invalid.**
- **No secret gets a `NEXT_PUBLIC_` prefix.** `DATABASE_URL_UNPOOLED` does **not** go in Vercel (only
  GitHub Actions migrates).

## 3. GitHub Actions secret

The migrator runs in GitHub Actions, so the **direct** string is a repo secret, not a Vercel var:

- Repo → **Settings → Secrets and variables → Actions → New repository secret**
- Name: `DATABASE_URL_UNPOOLED` · Value: Neon **direct/unpooled** string.

## 4. First migration

Migrations apply automatically on merge to `main` whenever `packages/db/migrations/**` changes
(`.github/workflows/migrate.yml`). To apply the existing schema the first time (nothing new to
trigger it), run it manually:

- Repo → **Actions → "Migrate (production)" → Run workflow** (on `main`).

It runs `db:migrate` then the idempotent `db:seed` (reference `units` + the v0 profile). Re-running is
safe. Until the secret exists the job **skips with a warning** rather than failing.

_Alternatively, apply once from your machine_ (same result):

```bash
DATABASE_URL_UNPOOLED="<neon-direct-url>" pnpm db:migrate
DATABASE_URL_UNPOOLED="<neon-direct-url>" pnpm db:seed
```

## 5. Local development (optional)

Create `apps/web/.env.local` (gitignored) from `apps/web/.env.example`:

```bash
ACCESS_GATE_PASSWORD="any-local-code-8+chars"
DATABASE_URL="<neon-pooled-url>"            # only used by `pnpm dev:prod` (the opt-in)
DATABASE_URL_UNPOOLED="<neon-direct-url>"   # only used by `pnpm dev:prod`
```

**`pnpm dev` (the safe default)** does NOT read those `DATABASE_URL`s — it boots a **persistent
local embedded Postgres** (fixed port `54329`, gitignored `apps/web/.local-db/`), migrates + seeds it,
and runs `next dev` against it, so playing with the app never writes to prod Neon. Your play-data
survives restarts; `ACCESS_GATE_PASSWORD` still comes from `.env.local` so the gate login works. Wipe
the sandbox with `pnpm db:local:reset`.

`pnpm dev:prod` is the **deliberate opt-in** that runs the old `next dev` against `.env.local`'s Neon
DB (it prints a warning that writes hit real data). Point it at a **Neon branch** (not production) if
you'll be writing test data. See the local-dev section in the [README](../README.md).

## Rules

- **Migrations do NOT run in the Vercel build.** GitHub Actions is the single migrator (direct/unpooled
  string) — see the DB rules in [../AGENTS.md](../AGENTS.md). Vercel only builds and serves.
- Additive/expand migrations run and race the Vercel deploy safely (backward-compatible by design);
  destructive **contract** steps ship in a separate, later deploy (expand → contract).
- **Preview databases** (later, V0-11): preview deploys point at a per-PR **Neon branch** (prod-shaped)
  via the Neon–Vercel integration.

## Verifying

- **App boots:** merged `main` renders at the production URL; the access gate loads. A missing/invalid
  env var fails the Vercel build (by design).
- **Migration applied:** the "Migrate (production)" run is green; in the Neon console the `units`,
  `profiles`, `entries`, `entry_sets` tables exist and `units`/`profiles` are seeded.
- **Preview:** open any PR → Vercel posts a preview URL; that URL renders the branch.
