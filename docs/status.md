# mat-plan — Status

Living progress tracker toward the **MVP = end of v1** (kids log a full day online + CSV export keeps
the Claude workflow alive). Updated as each PR merges. Roadmap detail in [plan.md](./plan.md).

**Last updated:** 2026-07-20

## Where we are right now

📍 **V0-8 — in review.** V0-7 (Today view) is **merged**; the app reads the DB in production. V0-8
adds the **first write**: log a bodyweight via a zod-validated Server Action → Neon → it appears in
Today (idempotent by client_id). Verified end-to-end against live Neon with Playwright. Next:
**V0-9** (log a strength entry — transactional `entry` + `entry_set`).

## Progress toward MVP (v1)

- **Code PRs merged:** 8 / 27 ▰▰▰▰▰▰▰▰▱▱ ~30% (+2 out-of-band: constants convention, Vitest harness)
- **Phase:** v0 🟡 in progress

## Phases

| Phase     | Goal                                                                     | Status         |
| --------- | ------------------------------------------------------------------------ | -------------- |
| Bootstrap | Repo + planning docs                                                     | ✅ done        |
| **v0**    | Thin vertical slice (one feature UI→ServerAction→Drizzle→Neon, CI-gated) | 🟡 in progress |
| **v1**    | Online kids logger (all data types, CSV export) — **MVP**                | ⚪ not started |
| AI-1      | NL logging via structured outputs + eval                                 | ⚪ not started |
| v1.5      | Offline PWA + sync + Clerk auth                                          | ⚪ not started |
| v2        | Ray's PPL + progression engine                                           | ⚪ not started |
| v3        | AI depth + MCP/REST API                                                  | ⚪ not started |

Legend: ⚪ not started · 🔵 in review · 🟡 in progress · ✅ done

## v0 backlog (13 PRs)

| PR    | Scope                                                       | Status       |
| ----- | ----------------------------------------------------------- | ------------ |
| V0-1  | pnpm workspace + Next.js scaffold + AGENTS pointers + hooks | ✅ done      |
| V0-1b | shadcn/ui + design tokens + DESIGN.md                       | ✅ done      |
| V0-2  | GH Actions CI + branch protection                           | ✅ done      |
| V0-3  | Vercel connect + preview deploys                            | ✅ done      |
| V0-4  | env validation + access-gate + security headers             | ✅ done      |
| V0-5  | Neon + Drizzle + first migration + DAL skeleton             | ✅ done      |
| V0-6  | migrate-on-deploy (GH Actions single migrator)              | ✅ done      |
| V0-7  | Today view (RSC via DAL)                                    | ✅ done      |
| V0-8  | log bodyweight (Server Action + zod)                        | 🔵 in review |
| V0-9  | log strength entry (transactional nested write)             | ⚪           |
| V0-10 | loading/empty/error primitives + boundary                   | ⚪           |
| V0-11 | CI Postgres + Playwright smoke                              | ⚪           |
| V0-12 | unit + integration test + DoD                               | ⚪           |

## v1 backlog (14 PRs) — completes the MVP

| PR    | Scope                                       | Status |
| ----- | ------------------------------------------- | ------ |
| V1-1  | generalize schema + forward-migrate         | ⚪     |
| V1-2  | seed catalogs + coverage test               | ⚪     |
| V1-3  | profile tiles                               | ⚪     |
| V1-4  | bodyweight/measurement on generalized model | ⚪     |
| V1-5  | checkins/habits dynamic form                | ⚪     |
| V1-6  | calisthenics totals + ramp targets          | ⚪     |
| V1-7  | life activities (wake/practice)             | ⚪     |
| V1-8  | kids' strength via session                  | ⚪     |
| V1-9  | fix-a-set / edit (LWW)                      | ⚪     |
| V1-10 | block-template prefill                      | ⚪     |
| V1-11 | copy-set-to-other-kid                       | ⚪     |
| V1-12 | a11y pass                                   | ⚪     |
| V1-13 | CSV export endpoint (golden-file)           | ⚪     |
| V1-14 | full-day E2E + rate-limit/Sentry/Dependabot | ⚪     |

## Changelog (merged PRs)

- **2026-07-20** — **V0-7**: Today view — RSC reads the DB via the DAL and renders the default
  profile's day with an empty state; `nodejs` runtime; pure date helpers (unit-tested). First
  DB-backed page, verified in production.
- **2026-07-20** — **V0-6**: migrate-on-deploy (GitHub Actions single migrator, direct/unpooled Neon
  string) + one-time setup guide (`deploy.md`); observability ADR + Core Web Vitals convention;
  documented `.local-secrets/` folder. App went **live** on Vercel + Neon.
- **2026-07-20** — **V0-5**: Neon + Drizzle schema (units/profiles/entries/entry_sets) + first
  migration + idempotent seed + server-only DAL skeleton; unit enum sourced from `@mat-plan/shared`;
  PGlite verify + schema-drift guard wired into CI.
- **2026-07-18** — **Vitest harness** (out-of-band): unit/integration runner pulled forward from
  V0-12; `server-only` stub + `@` alias; first suite covers the access-gate token helpers; wired
  into CI (required Test check) + `pre-push`.
- **2026-07-18** — **Constants convention** (out-of-band): AGENTS.md single-source-of-truth rule for
  constants/enums; applied to the gate (`GATE_PATH`, shared `safeInternalPath` open-redirect guard).
- **2026-07-18** — **V0-4**: env validation (`@t3-oss/env-nextjs`, refuse-boot), access-gate stopgap
  (`proxy.ts` + `/gate` Server Action), nonce-based CSP + hardening headers.
- **2026-07-18** — **V0-3**: Vercel connect + preview deploys + `docs/deploy.md`.
- **2026-07-17** — **V0-2**: GitHub Actions CI (quality: format/lint/typecheck/build + gitleaks) +
  branch protection (require checks, 0 approvals).
- **2026-07-17** — **V0-1b**: shadcn/ui + Radix, CSS-variable design tokens (light/dark),
  `docs/design.md`, Button/Card + themed sample page.
- **2026-07-16** — Architecture diagrams (`docs/architecture.md`): system containers, write path,
  offline sync, ERD, CI topology, roadmap.
- **2026-07-16** — **V0-1**: pnpm workspace + Next.js 16 app (TS · Tailwind v4 · ESLint 9) +
  `packages/{shared,engine,db}` stubs; Prettier + husky (lint-staged, commitlint, pre-push
  typecheck); agent-rule pointers.
- **2026-07-16** — Bootstrap: repo + planning docs (spec, plan, agent rules incl. file-hierarchy &
  semantic-HTML, security, status tracker), organized into `docs/` + `.github/`. Merged to `main`.
