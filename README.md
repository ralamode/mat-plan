# mat-plan

A portable, entity-based **activity logger** for Liam, Scarlett, and Ray. Logs everything in a
training day — weigh-ins, S&C lifts, calisthenics, the brush-the-teeth routine, habits, wrestling
practice — on a phone/iPad, works **offline**, and coexists with (then upgrades) the existing
Claude + CSV workflow. Also logs Ray's own PPL+core lifting.

It doubles as a **learning / portfolio project**: Next.js App Router + TypeScript + Drizzle/Neon
Postgres + Clerk, deployed on Vercel with GitHub Actions CI and Playwright E2E.

## Status

Planning complete; app scaffolding not started. This is the docs bootstrap.

## Docs

| File | What |
|---|---|
| [SPEC.md](./SPEC.md) | Architecture, entity/data model, coexistence, offline, server & DB standards |
| [PLAN.md](./PLAN.md) | Phased roadmap + per-PR backlog (v0 / v1 / AI-1 / v1.5 / v2 / v3) |
| [AGENTS.md](./AGENTS.md) | Rules for AI coding agents: stack, conventions, PR/CI gates, git/branch workflow |
| [SECURITY.md](./SECURITY.md) | Security baseline + threat model |
| [DoD.md](./DoD.md) | Per-PR Definition of Done |

## Stack

Next.js (App Router / RSC) · TypeScript · Tailwind + shadcn/ui · Drizzle ORM · Postgres (Neon) ·
Clerk · Vercel · GitHub Actions · Playwright.

## Workflow

Trunk-based. `main` is protected; all work goes via a short-lived feature branch → PR → green CI →
squash-merge. See [AGENTS.md](./AGENTS.md).
