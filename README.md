# mat-plan

A strength-and-conditioning logger for a **parent coaching their own kids' training.** It replaces
the trainer I was paying to write my kids' programming — logging weigh-ins, lifts, calisthenics,
habits and practice on a phone, and feeding the CSV workflow I already ran by hand.

It is also the project I use to work in the open. Real users (my family), real constraints, and a
design rule that makes the engineering interesting: **in this system a bad number doesn't degrade a
metric, it tells a child to lift something.**

🔗 **[mat-plan.dev](https://mat-plan.dev)** — a public landing page; the logger itself sits behind an access gate.

## What's interesting here

If you're reading this to see how I build, start with these:

|                                                                                                                                                                                                                                                                                                                                               | Where                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **An AI feature with a hard authority boundary — designed in full, not yet built.** Natural-language logging via Anthropic structured outputs → a chip the human corrects → the form, which the human submits. The model extracts what was _performed_; it can never emit a prescribed load: confirm fills the form with the load left blank. | [plans/ai-1-nl-logging.md](./docs/plans/ai-1-nl-logging.md)                                                     |
| **An eval design, also not yet run, where three cases test a safety property, not accuracy** — and therefore get their own 100% gate, separate from the accuracy gate. A threshold may only average over measurements that fail the same way.                                                                                                 | same doc, S4                                                                                                    |
| **Decisions argued, not asserted.** Every ADR states the rule, applies it, and names the alternative it rejects and why that alternative was tempting.                                                                                                                                                                                        | [docs/decisions/](./docs/decisions/)                                                                            |
| **A schema decision made from evidence.** Before designing typed measurement columns I censused two years of my own handwritten logs: 12 apparent shapes, 68% of which weren't numbers, a quarter of which turned out to need no column at all.                                                                                               | [ADR 0004](./docs/decisions/0004-typed-measurements.md) · [the census](./docs/plans/gap3-typed-measurements.md) |
| **Adversarial review before implementation.** UI and schema changes get multi-lens critique panels — written up, findings answered — before code exists.                                                                                                                                                                                      | [How I work with agents](./docs/working-with-agents.md) · [plans/](./docs/plans/)                               |
| **Migration discipline.** Expand → backfill → contract, never in one step. Drift guards and `db:verify` proofs run the real insert path in CI.                                                                                                                                                                                                | [docs/spec.md](./docs/spec.md)                                                                                  |

Accessibility is checked, not aspired to: a Playwright spec runs axe (WCAG 2.1 AA) plus a 44px
tap-target measurement on every PR that touches code, unless the `ci-skip-e2e` label is set. Tests are Playwright E2E + Vitest, and CodeQL scans every push to
`main` and runs weekly. No CI check is a _required_ status check yet; that is recorded in
[AGENTS.md](./AGENTS.md), not hidden.

## Status

**The MVP finish line was crossed on 2026-09-24, and the app is in daily use by the household it was
written for.** The data model, the logging surfaces, per-kid routines, supersets, timezone-correct day
boundaries, the strength write path and CSV export (the MVP's defining feature) are in. A few v1 rows
remain deferred or unbuilt.

Deliberately not in it yet: authentication, offline sync, the progression engine, and natural-language
logging. Each of those has a reviewed plan before it has code, which is the part worth reading.

**The roadmap moves; this file tries not to.** [docs/status.md](./docs/status.md) is the living
progress record, [docs/plan.md](./docs/plan.md) the per-PR backlog, and
[docs/decisions/](./docs/decisions/) the decisions that outlive both.

## Local development

| Command               | What it does                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | **Safe default.** Boots a **persistent local embedded Postgres** + `next dev` against it — prod Neon is never touched.     |
| `pnpm dev:prod`       | **Opt-in.** The old behavior — `next dev` against `.env.local`'s **live Neon** DB. Prints a warning; writes hit real data. |
| `pnpm db:local:reset` | Wipes the local sandbox DB so the next `pnpm dev` starts fresh + re-seeded.                                                |

`pnpm dev` is a **local sandbox**: it starts a real (Dockerless) Postgres on port `54329` with a
fixed, gitignored data dir at `apps/web/.local-db/`, runs `db:migrate` + `db:seed` (both idempotent),
then launches `next dev` with `DATABASE_URL` pointed at that local DB. Play with the product freely —
**your data survives restarts** and never reaches prod. `ACCESS_GATE_PASSWORD` still comes from your
`.env.local`, so the gate login works as before. Reach for `pnpm dev:prod` only when you deliberately
want to hit live data (prefer a Neon **branch**, not production). This mirrors the screenshot flow
(`screenshot:ephemeral`): local isolation is the default, prod is the deliberate exception. First run
downloads the Postgres binary; create `apps/web/.env.local` from `apps/web/.env.example` first (see
[docs/deploy.md](./docs/deploy.md) §5).

## Adding an athlete

**There is no way to add an athlete from inside the app yet.** The profile picker says so, and links
here. `packages/db/src/seed.ts` is still the only writer of the `profiles` table, so today an athlete
arrives by changing that file and re-seeding:

1. Edit the profile rows in `packages/db/src/seed.ts`. ⚠️ **The committed rows are the maintainer's own
   fixtures** — two kids, one of them carrying this household's routine. Replace them with your own
   athletes rather than seeding somebody else's family into your deployment.
2. Re-run the seed (it is idempotent and inserts on conflict do nothing — so an existing row keeps its
   name, and a renamed fixture only lands on a fresh database). See
   [Local development](#local-development) for the local sandbox, and [docs/deploy.md](./docs/deploy.md)
   for a deployed one.
3. A new profile's `routine_config` stays **NULL**, which is how it asks for the neutral first-run
   routine. Everything else is opt-in from that athlete's routine editor.

**`PROF-1`** ([backlog](./docs/plan.md)) replaces all of this with an "Add athlete" control on the
picker, and deletes this section with it.

## Docs

| File                                                         | What                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [AGENTS.md](./AGENTS.md)                                     | Rules for AI coding agents: stack, conventions, file hierarchy, PR/CI gates, git/branch workflow |
| [docs/working-with-agents.md](./docs/working-with-agents.md) | How the agent workflow is governed: who decides what, and five cases from the record             |
| [docs/product-spec.md](./docs/product-spec.md)               | **The product** — who it's for, why it exists, what it simplifies, target market, what's shipped |
| [docs/spec.md](./docs/spec.md)                               | Architecture, entity/data model, coexistence, offline, server & DB standards                     |
| [docs/architecture.md](./docs/architecture.md)               | System diagrams (containers, write path, offline sync, ERD, CI, roadmap)                         |
| [docs/design.md](./docs/design.md)                           | Design language + tokens (shadcn/ui + Tailwind, adult-first)                                     |
| [docs/deploy.md](./docs/deploy.md)                           | Deployment + one-time setup (Neon, Vercel env, GitHub secret, first migration, local dev)        |
| [docs/plan.md](./docs/plan.md)                               | Phased roadmap + per-PR backlog (v0 / v1 / AI-1 / v1.5 / v2 / v3)                                |
| [docs/status.md](./docs/status.md)                           | Living progress tracker toward the MVP                                                           |
| [docs/changelog/](./docs/changelog/README.md)                | One file per merged change (since DX-2)                                                          |
| [docs/definition-of-done.md](./docs/definition-of-done.md)   | Per-PR Definition of Done                                                                        |
| [docs/decisions/](./docs/decisions/)                         | Architecture Decision Records (ADRs) — e.g. observability & Core Web Vitals                      |
| [.github/SECURITY.md](./.github/SECURITY.md)                 | Security baseline + threat model                                                                 |

**Repo layout:** root holds only `README.md`, `AGENTS.md`, `.gitignore`; project docs live in
`docs/`; GitHub meta (security policy, PR template, workflows) in `.github/`; app code in `apps/web`
and `packages/*`. See the file-organization rules in [AGENTS.md](./AGENTS.md).

## Stack

Next.js (App Router / RSC) · TypeScript · Tailwind + shadcn/ui · Drizzle ORM · Postgres (Neon) ·
Vercel · GitHub Actions · Playwright. Clerk (household login) is planned for the first beta; until
then an access gate stands in.

## Workflow

Trunk-based: a short-lived feature branch → PR → green CI → squash-merge. That is a convention, not
an enforcement: `main`'s ruleset blocks only force-pushes and deletion. See [AGENTS.md](./AGENTS.md).
