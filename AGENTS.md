# AGENTS.md — rules for AI coding agents (and humans) working in mat-plan

Read this before writing code. It encodes the project's decisions so agents don't guess. These rules
are enforced by CI and pre-commit hooks, **not** by a reviewer's memory. `CLAUDE.md` and
`.cursor/rules` are thin pointers to this file — keep the rules here (DRY).

See also: [docs/spec.md](./docs/spec.md) (architecture + data model), [docs/plan.md](./docs/plan.md)
(PR backlog), [.github/SECURITY.md](./.github/SECURITY.md), [docs/definition-of-done.md](./docs/definition-of-done.md).

## What this is
A portable, entity-based activity logger (kids' wrestling S&C + Ray's PPL), offline-capable, that
also exports byte-faithful CSVs for an existing Claude workflow. Built at ~4h/wk → **scope
discipline is a first-class constraint.** The one inviolable product rule: **the LLM never authors
loads/weights** (bad loads are an injury risk) — the model may draft *definitions* a human confirms,
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
adding a file, decide where it *belongs*; never dump it in the repo root or the nearest convenient
directory. If a directory starts collecting unrelated files, **propose a reorganization in the PR**
rather than adding to the mess. Moving files is cheap on a branch, expensive once they sprout imports.

- **Root** holds ONLY: `README.md`, `AGENTS.md`, `.gitignore`, and tool-mandated config that *must*
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
  its feature folder; only *genuinely shared* code is promoted to `packages/`.
- **Naming:** kebab-case files/dirs (`profile-tile.tsx`, `definition-of-done.md`); PascalCase React
  components; conventional UPPERCASE for the root/.github meta files.
- **When placement isn't obvious, ask or propose it in the PR description** — don't guess and move on.

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
- Every PR gets a Vercel preview + a Neon branch (prod-shaped DB) for migration testing; all required
  CI checks must be green. Reference the backlog id (V0-x / V1-x) in the PR.

## Local hooks vs CI merge-gates
- **pre-commit (husky + lint-staged):** ESLint + Prettier on **staged files only** — fast, blocks the
  commit. Never put whole-project checks here.
- **pre-push:** `tsc --noEmit` (whole project) + affected tests.
- **CI required checks (block merge):** typecheck · lint · `prettier --check` · full test suite ·
  `next build` · gitleaks · `pnpm audit` (fail high/critical) · CodeQL · (DB) drift check + Squawk +
  Neon-branch apply. CI re-runs everything regardless of hooks.
- **Commits:** Conventional Commits (commitlint hook); `BREAKING CHANGE:` footer for breaking
  API/DB changes.

## UI PR rules
- Tests pass locally (full suite runs in CI as a required check).
- Lint must pass to commit (pre-commit blocks a failing lint). Prettier runs on staged files +
  `prettier --check` in CI — no style debates.
- PRs include **screenshots for any UI change** (before/after where relevant).
- PR description follows the template.
- A11y: keyboard-usable, labeled, ≥44px tap targets, numeric `inputmode` on number fields.

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
