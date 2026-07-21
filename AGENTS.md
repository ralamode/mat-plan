# AGENTS.md — rules for AI coding agents (and humans) working in mat-plan

Read this before writing code. It encodes the project's decisions so agents don't guess. These rules
are enforced by CI and pre-commit hooks, **not** by a reviewer's memory. `CLAUDE.md` and
`.cursor/rules` are thin pointers to this file — keep the rules here (DRY).

See also: [docs/spec.md](./docs/spec.md) (architecture + data model), [docs/plan.md](./docs/plan.md)
(PR backlog), [.github/SECURITY.md](./.github/SECURITY.md), [docs/definition-of-done.md](./docs/definition-of-done.md),
[docs/lessons.md](./docs/lessons.md) (recurring gotchas + fixes).

**Debugging a CI / test / build failure? Check [docs/lessons.md](./docs/lessons.md) first** — a terse,
grep-able log of past failures (symptom → cause → fix) so a known trap costs one attempt, not three.
When a failure takes more than one attempt to diagnose, add an entry there in the same PR as the fix.

## What this is

A portable, entity-based activity logger (kids' wrestling S&C + Ray's PPL), offline-capable, that
also exports byte-faithful CSVs for an existing Claude workflow. Built at ~4h/wk → **scope
discipline is a first-class constraint.** The one inviolable product rule: **the LLM never authors
loads/weights** (bad loads are an injury risk) — the model may draft _definitions_ a human confirms,
never live prescriptions.

## Stack (do not deviate without updating this file)

- **Frontend:** Next.js App Router (RSC) + TypeScript (strict) + Tailwind + **shadcn/ui** (Radix).
  TanStack Query is introduced at **v1.5** (offline), not before.
- **Design:** adult-first, clean — NOT a kid aesthetic. Kid ergonomics (≥44px tap targets,
  `inputmode="numeric"`, high contrast, clear labels) come from good general design. Tokens as CSS
  variables; see `DESIGN.md`. Charts via Recharts (shadcn charts).
- **Backend:** Next.js Route Handlers (reads) + Server Actions (mutations). All TypeScript through
  v2. The progression engine is **pure TS** (`packages/engine`, no DB/IO). Python/FastAPI only at v3.
- **DB:** Postgres on **Neon** + **Drizzle**. Runtime = pooled string + `pg`/node-postgres through
  PgBouncer, **Node runtime**, Fluid `attachDatabasePool`. Migrations = direct/unpooled string.
- **Auth:** Clerk (household login) from v1.5; access-gate stopgap before that. Profile tiles are a
  UX switch, **not** a security boundary.
- **Host / CI:** Vercel + GitHub Actions + Playwright.

## File organization & hierarchy (treat as first-class)

A clean, predictable hierarchy is a **primary design concern here — not an afterthought.** Before
adding a file, decide where it _belongs_; never dump it in the repo root or the nearest convenient
directory. If a directory starts collecting unrelated files, **propose a reorganization in the PR**
rather than adding to the mess. Moving files is cheap on a branch, expensive once they sprout imports.

- **Root** holds ONLY: `README.md`, `AGENTS.md`, `.gitignore`, and tool-mandated config that _must_
  sit at root (`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `.prettierrc`, `eslint`,
  `next.config`, `drizzle.config`, etc.). No stray docs, notes, or scratch files.
- **`docs/`** — all project documentation (`spec.md`, `plan.md`, `status.md`, `design.md`,
  `definition-of-done.md`, future `decisions/` ADRs).
- **`.github/`** — GitHub meta: `SECURITY.md`, `PULL_REQUEST_TEMPLATE.md`, `workflows/`, `ISSUE_TEMPLATE/`.
- **`apps/web/`** — the Next.js app, grouped by responsibility (not a flat dump by file type):
  `app/` (routes + `layout`/`loading`/`error`), `components/` (`ui/` primitives vs feature folders),
  `lib/` (`dal/`, `env.ts`, utils). Route files stay thin — domain logic goes in `packages/`.
- **`packages/`** — shared importable code: `shared/` (zod schemas + types + golden vectors),
  `engine/` (pure progression engine — no DB/IO), `db/` (drizzle schema + migrations + seed).
- **Colocation:** a unit's test (`*.test.ts`) lives next to the code it covers. Feature code stays in
  its feature folder; only _genuinely shared_ code is promoted to `packages/`.
- **Naming:** kebab-case files/dirs (`profile-tile.tsx`, `definition-of-done.md`); PascalCase React
  components; conventional UPPERCASE for the root/.github meta files.
- **When placement isn't obvious, ask or propose it in the PR description** — don't guess and move on.

## Constants, enums & shared values (single source of truth)

A named value is defined **once** and imported everywhere it's used. Duplicating a magic
string/number that must stay in sync is a defect, not a style nit — it's how a cookie name, route,
limit, or enum member silently drifts between two files. Enforced by review.

- **Name it, don't repeat it.** If a literal carries meaning and appears in ≥2 places, or _must_ stay
  in sync with something else (a DB value, a header, a route), hoist it to a `const` (or `as const`
  map) and import it. The second occurrence of a literal is the trigger to extract.
- **Where it lives — by blast radius:**
  - **Cross-boundary / domain values** (units, `activity_type` categories, statuses, and every
    enum) → **`packages/shared`** as an `as const` array + a zod enum + a `z.infer` type. That _one_
    definition feeds runtime validation (zod), compile-time types, **and** the DB reference-table
    seed — so app, engine, and DB can't drift. This is the canonical home for enums.
  - **App-only values** (cookie names, route paths, cache tags, form limits) → the feature's `lib`
    module, or a small `lib/constants.ts` when they're cross-feature. Never re-typed in a component.
  - **Engine values** → `packages/engine`. Never redefine the same value in two packages — import
    across the workspace (`@mat-plan/shared`).
- **Enums are reference tables, sourced from `shared`.** No native `pgEnum` (see the "don't" list).
  The canonical enum is the `shared` const-array; the Drizzle **reference table seeds from it** and
  the app validates against the same zod enum. One list, three consumers, zero drift.
- **Reuse small logic too**, not just values: a validation/derivation used in two places (e.g. a
  "safe internal redirect path" check) becomes one exported helper, not a copy-paste.
- **Tests use the same constant as the app.** When app code switched from a literal to a shared
  const, update the tests too — assert/exercise via the const (`ENTRY_KIND.bodyweight`), not a
  re-typed `'bodyweight'`. The one exception is a deliberate **contract test that pins the const's
  value** (`expect(GATE_COOKIE_NAME).toBe('mp_gate')`) — the literal belongs on the assertion side
  there, exactly once, or the test is tautological.
- **Don't over-abstract.** Truly universal or single-use literals (`'/'` root, `0`/`1`, an obvious
  one-off default) don't need a named indirection. Centralize for _meaning and sync_, not ceremony.

## Architecture rules

- **RSC-first.** Minimize `'use client'`. Fetch data in Server Components / Route Handlers.
- **Data Access Layer (DAL):** all Drizzle/Neon access and all `process.env` reads live in
  `lib/dal/*`, marked `import 'server-only'`. Each DAL function: (1) `getCurrentUser()` (Clerk
  `auth()`, React-`cache()`d), (2) authorize **ownership** (scope every query by `household_id`),
  (3) return a minimal **DTO**, never a raw row. Actions/handlers/MCP stay thin and call the DAL.
- **Server Actions for mutations; Route Handlers for reads / external / batch.** `/api/sync` is a
  Route Handler (Server Actions dispatch sequentially — wrong for a batch flush).
- **Engine stays pure:** `(state, inputs) => decision`, no DB/IO, covered by language-agnostic golden
  vectors, so a later Python port is a reference port, not an entanglement.

## The "don't" list

- No Pages Router, no `getServerSideProps`/`getStaticProps`.
- No client-side fetching where an RSC/Server Action works.
- No runtime CSS-in-JS libraries (MUI/emotion/styled) — Tailwind + shadcn only.
- No `sql.raw` / string-interpolated SQL. No `dangerouslySetInnerHTML`.
- No `db` import or `process.env` read outside the DAL.
- No `NEXT_PUBLIC_` prefix on any secret.
- No `drizzle-kit push` against prod. No editing an already-applied migration.
- No native `pgEnum` (use reference tables / text+CHECK).

## Schema & migration conventions

```
Keys:   internal PK = bigint GENERATED ALWAYS AS IDENTITY (never serial/UUIDv4 PK).
        Public/URL/API IDs = UUIDv7 (non-enumerable → anti-IDOR).
        client_id = UUIDv7, NOT NULL, UNIQUE (partial: WHERE deleted_at IS NULL).
Time:   all timestamptz, UTC, created_at DEFAULT now(). deleted_at NULL for soft delete.
        LWW: compare CLIENT-supplied updated_at/version (not server clock); upsert
        setWhere incoming >= stored. (offline clock-skew correctness)
Naming: snake_case; tables plural; FK <singular>_id; idx_<table>_<cols>. Drizzle casing:'snake_case'.
Constraints: NOT NULL default; FK+index on every ref.
        Tagged union: CHECK ((movement_id IS NOT NULL) <> (metric_key IS NOT NULL)).
Enums:  unit + activity_type.category → reference tables (FK); status → text+CHECK. No native pgEnum.
Index:  FKs + hot path (profile_id, date) equality-first/range-last; partial for skew; ~5–10/table max.
JSONB:  values stay in fixed typed columns (no EAV). JSONB only for opaque sync/device metadata.
Migrate: drizzle-kit generate+migrate ONLY (never push in prod); forward-only; never edit applied
        files; expand–contract; SET lock_timeout before DDL; NOT NULL via NOT VALID→VALIDATE;
        seed reference data ON CONFLICT DO NOTHING. Run against DATABASE_URL_UNPOOLED.
```

## Server conventions

```
Trust: every Server Action + Route Handler is a PUBLIC endpoint. Re-auth + re-authorize (ownership)
       + zod-validate inside each. Never trust FormData/JSON/searchParams/params/headers.
DAL:   all DB access via lib/dal/* (server-only). Thin actions/handlers → validate → DAL → revalidate.
Split: mutations → Server Actions. Reads/external/batch → Route Handlers. /api/sync is a Route Handler.
Errors: expected → typed envelope { ok:false, error, fieldErrors? } + useActionState (don't throw).
        unexpected → throw → error.tsx. Never leak internals; return only what the UI needs.
Idempotency: client UUIDv7 per item + DB UNIQUE + ON CONFLICT; per-item results; NOT an app-level check.
Cache:  per-user data dynamic (never cache across users). revalidatePath/Tag after every mutation.
Secrets: import 'server-only' on secret modules; validate env with @t3-oss/env-nextjs+zod.
Rate limit: @upstash/ratelimit (sliding window) on auth + mutations + /api/sync + the LLM API.
Observability: Sentry — WRAP Server Actions in withServerActionInstrumentation (NOT auto-instrumented);
        enableLogs + structured context (userId, householdId, batchId).
```

Security baseline lives in [.github/SECURITY.md](./.github/SECURITY.md) (BOLA-first,
bodyweight-privileged, scoped MCP token, headers, supply-chain). Follow it.

## Git & branch workflow

- **Trunk-based.** `main` is always deployable and **protected** — no direct pushes (except the one
  bootstrap commit). All work goes via PR.
- One short-lived branch = one PR = one backlog item / one concern. Branch from latest `main`. Keep
  small (target <400 lines).
- **Branch naming:** `<type>/<id>-<slug>`, type ∈ feat|fix|chore|docs|refactor|perf|test|db.
  e.g. `feat/v0-1-scaffold`, `db/v0-5-initial-schema`.
- Keep the branch up to date with `main` before merge ("require branches up to date" is ON); rebase
  preferred for linear history.
- **Merge = squash.** PR title is a Conventional Commit → one clean commit per PR on `main`. Delete
  the branch on merge.
- **Status rides with the work.** Update `docs/status.md` (the "where we are" pointer, backlog row,
  and changelog) **in the same PR** as the change it tracks — no separate status-bump PRs.
- **Implementation plans for significant PRs.** A **significant** PR gets a committed file-by-file
  plan at `docs/plans/<id>-<slug>.md`, written and **reviewed before** implementation code is
  committed (the Plan agent drafts it; a human reviews it). "Significant" = the change touches CI, a
  DB migration, auth, a new subsystem/runner, or non-trivial multi-file logic. **Exempt:** docs, copy,
  config one-liners, single-file mechanical changes. The plan is committed on the feature branch in
  the **same PR** as the code it plans, and the [docs/plan.md](./docs/plan.md) backlog row links to
  it. Template + rules: [docs/plans/README.md](./docs/plans/README.md).
- Every PR gets a Vercel preview + a Neon branch (prod-shaped DB) for migration testing; all required
  CI checks must be green. Reference the backlog id (V0-x / V1-x) in the PR.

## Local hooks vs CI merge-gates

- **pre-commit (husky + lint-staged):** ESLint + Prettier on **staged files only** — fast, blocks the
  commit. Never put whole-project checks here.
- **pre-push:** `tsc --noEmit` (whole project) + affected tests.
- **CI required checks (block merge):** typecheck · lint · `prettier --check` · full test suite ·
  `next build` · gitleaks · `pnpm audit` (fail high/critical) · CodeQL · (DB) drift check + Squawk +
  Neon-branch apply. CI re-runs everything regardless of hooks.
- **`e2e` (Playwright smoke):** runs on every PR but is **not yet a required check** — it **soaks as
  non-blocking until PR 28**, then becomes required (a repo-admin branch-protection change). **Override
  a required `e2e`** two ways: add the **`ci-skip-e2e` label** to the PR (the job skips the smoke but
  still reports success, so the required check stays green — for a known-flaky or e2e-irrelevant
  change), or an **admin merge** (branch-protection bypass) as the last-resort escalation. Prefer the
  label so the intent is visible on the PR; use it sparingly — a red `e2e` usually means a real bug.
- **Before debugging a CI/test failure**, check [docs/lessons.md](./docs/lessons.md) (concrete past
  failures → root cause → fix); append an entry there whenever you diagnose a non-obvious one.
- **Commits:** Conventional Commits (commitlint hook); `BREAKING CHANGE:` footer for breaking
  API/DB changes.

## UI PR rules

- Tests pass locally (full suite runs in CI as a required check).
- Lint must pass to commit (pre-commit blocks a failing lint). Prettier runs on staged files +
  `prettier --check` in CI — no style debates.
- PRs include **screenshots for any UI change** (before/after where relevant), **captured with
  Playwright** driving the running app (boot the prod build → log through the access gate → navigate →
  screenshot each changed screen/state). Save to the gitignored `.screenshots/` folder and attach to
  the PR — never commit them. The repeatable procedure is the `ui-screenshot` skill, which runs the
  committed `pnpm --filter web screenshot <route>` script (since V0-11, on the shared
  `e2e/gate-login.ts` helper); the Playwright-MCP path is the fallback.
  - **Placement:** the **first** screenshots for a PR go **in the PR description** — the reviewer's
    baseline. When a later push changes the visuals, add the **latest** screenshot(s) as a **PR
    comment** rather than editing the description, so the description stays the original baseline and
    the comment thread shows the progression.
- PR description follows the template.
- **Semantic HTML is required.** Use the correct native element for the job — `button` (never a
  clickable `div`/`span`), `a` for navigation, `nav`/`main`/`header`/`footer`/`section` landmarks,
  `ul`/`ol`/`li` for lists, `label` + `htmlFor` for inputs, `<form>` for forms, and a correct heading
  order (one `<h1>` per page, no skipped levels). No `div`-soup with click handlers. Radix/shadcn
  primitives are semantic + accessible by default — don't wrap them in ways that regress that.
- A11y: keyboard-usable, focus-visible, labeled controls, ≥44px tap targets, numeric `inputmode` on
  number fields. Semantic HTML is the foundation of this — get the elements right first.
- **Web performance / Core Web Vitals is a first-class concern**, not a later cleanup. Follow web best
  practices where they don't fight scope: RSC-first (minimal client JS), `next/image` + `next/font`
  (no layout shift / font FOUT), no render-blocking third-party scripts, lean/code-split bundles.
  Budget (p75, mobile): **LCP < 2.5s · INP < 200ms · CLS < 0.1**. Regressing it is a review concern.
  Tooling + phasing (Sentry, Vercel Speed Insights, Neon health) live in
  [docs/decisions/0001-observability-and-web-vitals.md](./docs/decisions/0001-observability-and-web-vitals.md).

## Backend / API PR rules

```
Every mutating endpoint / Server Action (verified by TESTS, not review):
  1 re-verify authN inside it (page/middleware auth does NOT protect an action — it's a public POST).
  2 re-verify authZ / resource ownership (IDOR guard).  3 zod-validate ALL input first.
  4 return a minimal DTO, never a raw row.  5 db+auth via the server-only DAL; keep 'use server' thin.
  6 mutations: Idempotency-Key → persist first result → replay on retry.
  7 typed error envelope + structured logs (correlation id) + Sentry; rate-limit expensive ops.
Tests ship in the SAME PR: unit (logic) + integration (endpoint/DAL) against an ephemeral PG
  (Actions service container, migrated). MANDATORY boundary tests: unauth→reject, wrong-owner→forbid,
  bad body→zod-reject; /api/sync replay→one effect+identical response. No coverage drop on changed files.
Contract: request/response change ⇒ update shared zod schema (types via z.infer) same PR. Additive by
  default; breaking ⇒ BREAKING CHANGE footer + /api/vN + Deprecation/Sunset headers.
Testing gotchas: Server Actions aren't HTTP routes — test as plain async fns (mock Clerk auth() +
  Drizzle); async Server Components → Playwright, not Vitest; push logic into the (sync, testable) DAL.
```

## Database / migration PR rules

```
Workflow: edit schema → drizzle-kit generate → COMMIT the generated .sql (the reviewed artifact) → PR.
  NEVER drizzle-kit push to prod. Prod only runs `migrate`. Forward-only: never modify a migration
  already on main (CI blocks 'M' on the migrations dir; only 'A'). One migration/PR.
Where it runs: GitHub Actions is the SINGLE migrator, on merge to main, against the DIRECT/unpooled
  Neon string. NEVER in the Vercel build (concurrent preview builds would race / DDL the wrong DB).
CI gates (required): drizzle-kit check + `generate` leaves a clean tree (drift guard); Squawk lint;
  migration applies on (a) empty Docker PG AND (b) a Neon branch cut from main (prod-shaped); seeds
  run twice → idempotent.
Safety (Squawk hard-fail): no DROP COLUMN/TABLE, TRUNCATE CASCADE, or column/table RENAME alongside
  app code — use expand→backfill→contract across separate deploys. Indexes CONCURRENTLY. New NOT NULL
  via CHECK ... NOT VALID → backfill → VALIDATE. New FK/UNIQUE as NOT VALID → VALIDATE; every new ref
  column gets a covering index. Every migration SETs lock_timeout + statement_timeout. Backfills in
  bounded batches; avoid volatile defaults. IF [NOT] EXISTS guards for re-run safety.
Rollback: fix-forward by default (expand-contract is reversible-by-omission); cut a Neon RESTORE
  branch pre-migration before any destructive/backfill step.
GOTCHA: CREATE INDEX CONCURRENTLY cannot run in a transaction, but drizzle-kit migrate wraps each file
  in one → isolate concurrent-index statements in their own file + a runner that strips the transaction.
Deploy order: expand/additive migrations run BEFORE the new app deploys; destructive contract AFTER.
```

## Definition of Done

See [docs/definition-of-done.md](./docs/definition-of-done.md). A PR isn't done until every
applicable box is checked and CI is green.
