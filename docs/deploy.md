# mat-plan — Deployment

Hosted on **Vercel**, one project linked to the GitHub repo. Every PR gets a **preview deploy**;
`main` deploys to **production**. See [architecture.md](./architecture.md) §5 for the full CI/deploy
topology.

## Vercel project settings (one-time)

This is a **pnpm monorepo**, so the important setting is the root directory:

- **Root Directory:** `apps/web` (with "Include files outside the root directory" ON so Vercel can
  read the workspace root — `pnpm-workspace.yaml`, `packages/*`).
- **Framework preset:** Next.js (auto-detected).
- **Install command:** default (`pnpm install`, workspace-aware).
- **Build command:** default (`next build`).
- **Node.js version:** 22+ (matches `engines` and CI).

## Environments

- **Production** — pushes to `main`.
- **Preview** — every PR / non-`main` branch → a unique preview URL.
- Env vars are set per-environment in Vercel Project Settings; they're validated at boot by
  `lib/env.ts` (added in V0-4). **No secret gets a `NEXT_PUBLIC_` prefix.**

## Rules

- **Migrations do NOT run in the Vercel build.** The GitHub Actions migrator owns schema changes
  (against the direct/unpooled Neon string) — see the DB rules in [../AGENTS.md](../AGENTS.md). Vercel
  only builds and serves.
- **Preview databases** (later): preview deploys point at a per-PR **Neon branch** (prod-shaped),
  wired via the Neon–Vercel integration.
- The app's DB runtime uses the **pooled** Neon connection on the Node runtime (see `spec.md` §9).

## Verifying

- A merged `main` renders at the production URL.
- Open any PR → Vercel posts a **preview URL** as a check/comment; that URL renders the branch.
