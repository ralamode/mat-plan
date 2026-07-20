# mat-plan

A portable, entity-based **activity logger** for Liam, Scarlett, and Ray. Logs everything in a
training day — weigh-ins, S&C lifts, calisthenics, the brush-the-teeth routine, habits, wrestling
practice — on a phone/iPad, works **offline**, and coexists with (then upgrades) the existing
Claude + CSV workflow. Also logs Ray's own PPL+core lifting.

It doubles as a **learning / portfolio project**: Next.js App Router + TypeScript + Drizzle/Neon
Postgres + Clerk, deployed on Vercel with GitHub Actions CI and Playwright E2E.

## Status

**v0 in progress.** Scaffold (V0-1) + design system (V0-1b) landed; building the vertical slice.
See [docs/status.md](./docs/status.md).

## Docs

| File                                                       | What                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [AGENTS.md](./AGENTS.md)                                   | Rules for AI coding agents: stack, conventions, file hierarchy, PR/CI gates, git/branch workflow |
| [docs/spec.md](./docs/spec.md)                             | Architecture, entity/data model, coexistence, offline, server & DB standards                     |
| [docs/architecture.md](./docs/architecture.md)             | System diagrams (containers, write path, offline sync, ERD, CI, roadmap)                         |
| [docs/design.md](./docs/design.md)                         | Design language + tokens (shadcn/ui + Tailwind, adult-first)                                     |
| [docs/deploy.md](./docs/deploy.md)                         | Deployment + one-time setup (Neon, Vercel env, GitHub secret, first migration, local dev)        |
| [docs/plan.md](./docs/plan.md)                             | Phased roadmap + per-PR backlog (v0 / v1 / AI-1 / v1.5 / v2 / v3)                                |
| [docs/status.md](./docs/status.md)                         | Living progress tracker toward the MVP                                                           |
| [docs/definition-of-done.md](./docs/definition-of-done.md) | Per-PR Definition of Done                                                                        |
| [docs/decisions/](./docs/decisions/)                       | Architecture Decision Records (ADRs) — e.g. observability & Core Web Vitals                      |
| [.github/SECURITY.md](./.github/SECURITY.md)               | Security baseline + threat model                                                                 |

**Repo layout:** root holds only `README.md`, `AGENTS.md`, `.gitignore`; project docs live in
`docs/`; GitHub meta (security policy, PR template, workflows) in `.github/`; app code in `apps/web`
and `packages/*`. See the file-organization rules in [AGENTS.md](./AGENTS.md).

## Stack

Next.js (App Router / RSC) · TypeScript · Tailwind + shadcn/ui · Drizzle ORM · Postgres (Neon) ·
Clerk · Vercel · GitHub Actions · Playwright.

## Workflow

Trunk-based. `main` is protected; all work goes via a short-lived feature branch → PR → green CI →
squash-merge. See [AGENTS.md](./AGENTS.md).
