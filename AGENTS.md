# AGENTS.md — rules for AI coding agents (and humans) working in mat-plan

Read this before writing code. It encodes the project's decisions so agents don't guess. These rules
are enforced by CI and pre-commit hooks, **not** by a reviewer's memory. `CLAUDE.md` and
`.cursor/rules` are thin pointers to this file — keep the rules here (DRY).

See also: [docs/spec.md](./docs/spec.md) (architecture + data model), [docs/plan.md](./docs/plan.md)
(PR backlog), [.github/SECURITY.md](./.github/SECURITY.md), [docs/definition-of-done.md](./docs/definition-of-done.md),
[docs/lessons.md](./docs/lessons.md) (recurring gotchas + fixes),
[docs/features/](./docs/features/) (per-feature guides — **read before changing a feature**),
[.claude/skills/](./.claude/skills/README.md) (agent skills — the task lifecycle as procedures:
`write-spec` for work spanning several PRs, then `start-task` → `plan-with-panel` → `ship-pr` → `review-pr`
per PR, plus task skills for migrations, Server Actions, data corrections and CI failures; each
skill's `description` is its index entry).

**About to change a large feature? Read its guide in [docs/features/](./docs/features/) FIRST** — the
file map, the cross-file invariants and the known traps, so the change costs one read instead of an
afternoon of tracing. **The guide is updated in the SAME PR as the code**, enforced by CI (see
"Feature guides" below).

**Wrong data in a live DB that the app cannot fix?** There is no delete action in the app and several
shapes are deliberately uneditable, so a mis-tap can be unrecoverable through the UI. Use a guarded,
idempotent, dry-run-by-default **correction**: `pnpm --filter @mat-plan/db db:correct` lists them,
[runbooks.md](./docs/runbooks.md) has the procedure, and
[packages/db/scripts/corrections/](./packages/db/scripts/corrections/README.md) has the rules for
adding one. **A correction treats the data; the bug still needs its own PR.**

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
  variables; see [docs/design.md](./docs/design.md). Charts via Recharts (shadcn charts).
- **Backend:** Next.js Route Handlers (reads) + Server Actions (mutations). All TypeScript through
  v2. The progression engine is **pure TS** (`packages/engine`, no DB/IO). Python/FastAPI only at v3.
- **DB:** Postgres on **Neon** + **Drizzle**. Runtime = pooled string + `pg`/node-postgres through
  PgBouncer, **Node runtime**, Fluid `attachDatabasePool`. Migrations = direct/unpooled string.
- **Auth:** Clerk (household login, Google) from Beta 0 (AUTH-1, pulled forward from v1.5 —
  [milestone](./docs/milestones/beta-1.md)); access-gate stopgap before that. Profile tiles are a
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
- **`docs/`** — all project documentation (`spec.md`, `plan.md`, `status.md`, `changelog/` (one file per change), `milestones/` (cross-PR milestones: order + exit criteria), `design.md`,
  `roadmap.md` (the forward-looking cross-program view, by pillar),
  `parallel-work.md` (the rubric for when two tracks may run at once),
  `definition-of-done.md`, `runbooks.md` (manual ops), `lessons.md` (gotchas), `tech-debt.md`
  (accepted shortcuts + payoff plan), `plans/`, future `decisions/` ADRs).
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
        files (CI-enforced since GAP-3 PR 1a — the guard also proves _journal.json is append-only); expand–contract; SET lock_timeout before DDL; NOT NULL via NOT VALID→VALIDATE;
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

**Privacy is reviewed as its own lens, not folded into security.** Security asks whether an attacker
can reach the data; privacy asks whether we should hold it at all, and whether the person it belongs
to can get it back or get rid of it. This app holds **minors' health data** in a **public repo**, which
is the least forgiving combination there is, so every PR that touches the schema, the DAL, an export,
logging, a new dependency or a third-party call gets the `privacy-reviewer` lens
([review-pr](./.claude/skills/review-pr/SKILL.md), rubric dimension 10). The standing questions: what
personal data does this start holding, who can now read it, where does it leave to, and can it still be
exported and deleted. A real value committed anywhere in the tree is a P0, and deleting it from `HEAD`
is not removing it.

## Git & branch workflow

- **Trunk-based.** `main` is always deployable. All work goes via PR, **by convention**: the "Protect
  Main" ruleset blocks only branch deletion and force-pushes (verified via the API, 2026-09-30), so a
  direct push to `main` is technically possible. Don't.
- One short-lived branch = one PR = one backlog item / one concern. Keep small (target <400 lines).
- **Every task runs in its own git worktree, cut from a freshly-fetched `main`. This is the default,
  not only for parallel work.**
  `git fetch origin && git worktree add .claude/worktrees/<slug> -b <type>/<id>-<slug> origin/main`,
  then `cd` there and `pnpm install` (node_modules aren't shared). Starting from `origin/main` puts the
  new work on top of every merged PR; missing that is how a branch silently omits a just-merged
  migration/schema and drifts.
  - **The main checkout stays on `main`, clean.** It is used only to sync
    (`git pull --ff-only origin main`) and to read. Never switch it to a feature branch. Several
    agent sessions run here concurrently, and a checkout or rebase in a shared directory moves another
    session's files out from under it.
  - **Location — two sanctioned forms, and the requirement is that `git worktree list` registers it**,
    because that listing is the registry of work in flight and what
    [parallel-work.md](./docs/parallel-work.md) gate 1 is run against.
    - **`.claude/worktrees/<slug>`** — the default. Gitignored, nested, invisible in an editor.
    - **`~/workspace/tmp<n>/mat-plan`** — for a **parallel lane you will open in an editor**, which the
      nested gitignored path makes awkward (a guide in one is invisible from another checkout's
      window). Numbered, one lane per `n`, and **removed once its PR has shipped**, which frees the
      number for the next lane. _(Maintainer, 2026-10-06.)_
    - **Never `/tmp`** — wiped on reboot, and invisible to other sessions.
  - One worktree = one branch = one PR. **Remove it after the PR merges** (`git worktree remove
.claude/worktrees/<slug> && git branch -D <branch>`; `-D` because a squash merge leaves the branch's
    commits off `main`, so `-d` refuses), not when the PR opens, because review fixes land there.
  - `apps/web/.env.local` is not copied into a new worktree. **`pnpm dev` needs it** (it reads
    `ACCESS_GATE_PASSWORD` from there), so copy it in before running the dev server. `verify`,
    `e2e:local` and `screenshot:ephemeral` inject their own env and run without it.
  - Never remove a worktree you didn't create. It may be another session's live work.
  - **Guarded for Claude sessions** by a `PreToolUse` hook (`.claude/settings.json` →
    `.claude/hooks/guard-main-checkout.mjs`), a **best-effort guard against the common forms**, not a
    security boundary. In the main checkout it allows only read-only git, `worktree`
    list/add/remove/prune/repair, the post-merge `git branch -D <branch>` (never `main`),
    `pull --ff-only origin main` and `merge --ff-only origin/main` while on `main`, `checkout main` with
    a clean tree, and an unstaging `reset [HEAD] [-- <paths>]`; anything else is denied with the
    worktree command to run instead. A `SessionStart` hook prints the status headline, open PRs, and
    worktrees flagged stale or off-main. Both hooks do nothing under CI. The rule held for less than a
    day as prose.
- **Before running two tracks at once, run the rubric** in
  [docs/parallel-work.md](./docs/parallel-work.md). Six gates, each earned by a failure that happened
  here. **Gate 1 is disjoint file globs, feature guides included** — and it is the one that actually
  fails, because a shared roadmap, an agreed data contract, landed infra and an approved prototype all
  pass while two tracks edit the same file. `guides:check` also makes two tracks under **one guide**
  collide even when their code files differ. When a gate fails, don't parallelize: pick an order and
  write the reason into [roadmap.md](./docs/roadmap.md)'s "In flight".
- **Branch naming:** `<type>/<id>-<slug>`, type ∈ feat|fix|chore|docs|refactor|perf|test|db.
  e.g. `feat/v0-1-scaffold`, `db/v0-5-initial-schema`.
- Keep the branch up to date with `main` before merge. ⚠️ **By convention only:** branch protection is
  off (verified via the API, 2026-09-30), so GitHub neither blocks nor flags a behind PR. The
  `keep-mergeable` skill checks behind-ness with git for approved PRs. Rebase
  preferred **before the branch is first pushed**. **Once it is on the remote, merge `main` in and never
  rebase**, whether you're the author or someone keeping it mergeable (the `keep-mergeable` skill): a
  rebase then needs a force-push, and the squash merge keeps `main` linear either way.
- **Merge = squash.** PR title is a Conventional Commit → one clean commit per PR on `main`. Delete
  the branch on merge.
- **The roadmap rides with the work too.** [docs/roadmap.md](./docs/roadmap.md) is the only
  **forward-looking** cross-program view — pillars, what's in flight, what's next, what each thing
  waits on. `status.md` looks backwards; `plan.md` is the backlog. Move the item between columns in the
  **same PR**, and if a PR doesn't move one, say so in the description. It is a **pointer** document:
  ids only, never a second copy of a `plan.md` row. A **pillar is a set of owned file globs, not a
  theme**, because "can this run in parallel" is a file question — where a glob already belongs to a
  [feature guide](./docs/features/), the guide's `owns:` is the authority and the pillar points at it.
- **Status rides with the work.** In the **same PR** as the change it tracks, add a changelog
  fragment ([docs/changelog/](./docs/changelog/README.md), one file per change, so PRs never conflict
  on it) and update `docs/status.md`'s "where we are" pointer and backlog row if the change moves
  them. No separate status-bump PRs. `pnpm status:check` checks the fragment.
- **Implementation plans for significant PRs.** A **significant** PR gets a committed file-by-file
  plan at `docs/plans/<id>-<slug>.md`, written and **reviewed before** implementation code is
  committed (the Plan agent drafts it; a human reviews it). "Significant" = the change touches CI, a
  DB migration, auth, a new subsystem/runner, or non-trivial multi-file logic. **Exempt:** docs, copy,
  config one-liners, single-file mechanical changes. The plan is committed on the feature branch in
  the **same PR** as the code it plans, and the [docs/plan.md](./docs/plan.md) backlog row links to
  it. Template + rules: [docs/plans/README.md](./docs/plans/README.md). A significant plan is authored
  at **Staff-SWE level** and **hardened by an adversarial review panel** (≥3 independent skeptical
  lenses — correctness/data-integrity, simplicity/scope, architecture/consistency) **before**
  implementation: the author agent reconciles each critique (incorporate or push back with
  justification), records a **review-response log** in the plan, and re-reviews until blocking concerns
  are resolved. See [docs/plans/README.md](./docs/plans/README.md) → "Adversarial plan review".
- **A PR that advances something larger says where it sits.** A reviewer should not have to
  reconstruct the plan from the diff: with chunks running across lanes, the diff cannot say whether a
  PR is _the gate_ or _the payoff_. So the description opens with a **Where this sits** block —
  **pillar** ([roadmap.md](./docs/roadmap.md)), **milestone** (linked, so the overall plan is one click
  away), **what this PR is** within it, and **what comes next**, including anything that next step is
  gated on. Four lines; the PR template carries them.
  **The test:** can you name the milestone, spec or multi-PR track this advances? A plan or spec PR
  counts, even though its type is `docs`. **Exempt — omit the section entirely:** a dependency bump, a
  one-off bug, a typo or copy change, a config one-liner, a standalone chore. `Milestone: none` is
  **not** the answer; a field that is empty half the time trains reviewers to skip it, which costs the
  signal on the half that matters.
- **Diagrams in the PR description.** A PR that introduces or changes a **pivotal flow, data model, or
  schema** embeds a **Mermaid diagram in the PR description** (GitHub renders it) so the reviewer sees
  the _shape_ of the change without reading every file — an ERD for a schema/migration, a
  flowchart/sequence for a new flow or subsystem. Keep it to the pivotal one or two, not every trivial
  change. Reuse and update [docs/architecture.md](./docs/architecture.md) (the diagram home) and embed
  the relevant view; the description diagram and the committed one should agree. Same placement rule as
  screenshots: the first goes in the description, later revisions as PR comments.
- **Milestone PRs also embed a progress chart.** A PR that is part of a cross-PR milestone
  ([docs/milestones/](./docs/milestones/)) embeds that milestone's **Mermaid step chart with this PR's
  step marked**, so a reviewer sees where the work sits and **what is still between here and the
  finish** without opening the milestone file. The milestone doc owns the canonical chart; a PR copies
  it and marks its own position — the two must agree, so if the ordering has changed, fix the
  milestone in the same PR. Mark done steps with ✅ and the current one with a `style` line:

  ```mermaid
  flowchart LR
    N[0 · now ✅] --> AU
    O[1 · ops] --> AU
    C[ADR 0006 ✅] --> T[2 · TEN-1]
    T --> AU[3 · AUTH-1]
    AU --> S[4 · self-serve]
    S --> I[invite family #1]
    style T fill:#2563eb,color:#fff
  ```

  Not for a standalone PR (a dependency bump, a one-off bug) — those belong to no milestone and the
  "Where this sits" section is deleted for them too.

- Every PR gets a Vercel preview + a Neon branch (prod-shaped DB) for migration testing; all required
  CI checks must be green. Reference the backlog id (V0-x / V1-x) in the PR.

## Feature guides (docs/features/)

A **large, atomic** feature — one where you cannot change a part without understanding the others —
gets a guide at `docs/features/<slug>.md`. The test: if a competent change needs four or more files
across two or more packages, it earns one. Today: strength logging, the write path, programming.

- **Read it before you start.** That is the entire point — the file map, the invariants that live
  BETWEEN files, and the traps that have actually bitten someone, with line references.
- **Update it in the same PR as the code.** Not a follow-up, not a TODO. `docs/features/README.md`
  has the format; frontmatter declares which files the guide owns.
- **CI enforces it** in the `quality` job: touching an owned file without touching its guide fails the
  build, as does a guide claiming to own a file that no longer exists (so a rename cannot silently
  drop coverage). Run it yourself with `pnpm guides:check`.
- **Escape hatch:** the `docs-skip-feature-map` PR label, mirroring `ci-skip-e2e`, for a change that
  genuinely does not affect the guide. Visible on the PR by design; use it sparingly.
- **A guide is not a changelog or an API dump.** It holds what you would want to have been told.
  Link to the plan/ADR for reasoning rather than restating it — duplicated prose goes stale first.

## Local hooks vs CI merge-gates

- **pre-commit (husky + lint-staged):** ESLint + Prettier on **staged files only** — fast, blocks the
  commit. Never put whole-project checks here.
- **pre-push:** `pnpm typecheck` + affected tests. Since DX-7 that is **two** `tsc --noEmit` projects —
  `apps/web` and `packages/db` (`src/**` + `scripts/**`, so the `db:verify` proofs and the corrections
  are covered). ⚠️ **Not the whole repo:** `packages/shared` and `packages/engine` have no tsconfig of
  their own and are checked only _transitively_, through the app's imports.
- **`pnpm verify` — run this before opening a PR.** One command for everything CI's `quality` job
  does: `format:check` → `lint` → `typecheck` → `test` → `db:verify` →
  `skills:check` (every path and `pnpm` script a skill cites exists) → `actions:check` (every action
  SHA-pinned) → `guards:test` (the hook and
  guard self-tests) → `audit:check` (the production audit). **~35s** on a warm cache, so there is no
  excuse to skip it.
  `skills:check` and `guards:test` run **only here, not in CI** (`ci.yml` doesn't run them; wiring them
  in is a CI change that needs its own plan — SEC-5 did the audit third of it). `actions:check`
  (offline) and `audit:check` run in both, from the same single definition. `db:verify` runs on
  **PGlite — no Docker, no Postgres install** — which is why the DB proofs are local-runnable at all.
  **Not covered by it:** `next build` (slower, CI-only), the Playwright smoke (its own command —
  see the next bullet), gitleaks, and the forward-only guard (inherently a diff-against-base check).
- **`pnpm e2e:local` — the Playwright smoke, locally, on a throwaway DB.** Deliberately NOT inside
  `verify` (minutes, not seconds — it builds the prod app), but run it before a PR that touches a
  flow the smoke covers. It boots an **ephemeral `embedded-postgres`** (no Docker, no creds),
  migrates + seeds it via the `packages/db` scripts exactly as CI does, injects that DB plus a local
  gate code and a free port into `playwright test`, and **deletes the cluster on exit** — so it never
  touches Neon and never pollutes the `pnpm dev` sandbox. Extra args pass through
  (`pnpm e2e:local --project=chromium`, or a single spec). Bare `pnpm --filter web e2e` provisions no
  database and inherits `.env.local` — use `e2e:local`.
- **CI checks** (⚠️ **none is a required status check**, so a red PR can still be merged; the
  `review-pr` shipit bar, "CI green", is what holds the line; verified via the API, 2026-09-30):
  typecheck · lint · `prettier --check` · full test suite ·
  `next build` · gitleaks · (DB) drift check + `db:verify` · **the production audit** (`audit:check`,
  plus its own self-test before the install). CI re-runs everything regardless of hooks.
  Plus **forward-only** + **Squawk** on new migrations, and **action pins** (offline on every run,
  `--resolve` when a workflow changes; the rule is in [SECURITY.md](./.github/SECURITY.md) → Supply
  chain). The audit's rule lives in the same place — scope, threshold and trigger — and the guard
  points at it ([plan](./docs/plans/sec-5-verify-in-ci.md)). It separates **could not check,
  retryable** (the registry was unreachable; advisory only on a PR that changes no dependency input,
  never on `main`) from **could not check, not retryable** (an unparseable or incoherent report, a
  committed setting that disarmed the audit), which is never downgraded: collapsing the two is how a
  gate looks wired and checks nothing.
  **`@claude review` is NOT a gate either:** a writer's comment runs the `review-pr` skill in CI
  (`.github/workflows/claude-review.yml`, which defines the trigger) and posts one advisory comment.
  **CodeQL is wired, but deliberately NOT as one of these.** It runs on **push to `main`, weekly, and on
  demand** (`.github/workflows/codeql.yml`) — a minutes-long scan on every PR is the wrong trade at ~4h/wk,
  and every merged PR is one squashed commit on `main`, so the push trigger still sees all of it. Findings
  land in **Security → Code scanning**, never on the PR, so a green PR says nothing about CodeQL.
  ⚠️ **The Neon-branch apply is still NOT wired** — this list claimed it for months and
  `.github/workflows/` never had it ([tech-debt](./docs/tech-debt.md), audited 2026-09-23). Do not cite
  an unwired gate as a safety argument.
- **`e2e` (Playwright smoke):** runs on every PR but is **not yet a required check** — it **soaks as
  non-blocking until PR 28**, then becomes required (a repo-admin branch-protection change). The job
  always runs but **auto-skips the smoke (still reporting success) when every changed file is provably
  inert** — docs, root markdown, `.claude/`, GitHub templates, images (conservative allowlist,
  default-to-run: any app/package/workflow/config/lockfile file forces the smoke). **Manually override
  a required `e2e`** two ways: add the **`ci-skip-e2e` label** to the PR (skips the smoke but still
  reports success — for a known-flaky or e2e-irrelevant change that _does_ touch code), or an **admin
  merge** (branch-protection bypass) as the last-resort escalation. Prefer the label so the intent is
  visible on the PR; use it sparingly — a red `e2e` usually means a real bug. The skip is always
  step-level (never a job-level `if:`/`paths-ignore`), so a required check never stalls "pending".
- **Commits:** Conventional Commits (commitlint hook); `BREAKING CHANGE:` footer for breaking
  API/DB changes.
- **No personal names in PRs, plans, ADRs, changelog fragments or commit messages.** Write the role —
  _the maintainer_, _the household operator_, _the athlete_, _a reviewer_. A decision still gets
  attribution, by role and date (`_(maintainer, 2026-10-05)_`), so provenance survives without the
  name. The repo is public and a name is personal data like any other. ⚠️ **This is a
  going-forward rule, not a cleanup claim:** the commit author and email are in every commit, and
  `git log -S` finds anything a working-tree sweep removes — the same limit `docs/plan.md` already
  records for the seeded fixture names.

## UI PR rules

- **Every PR that touches the UI gets a UX / interaction-design panel — BEFORE implementation.**
  Non-negotiable, and separate from the engineering panel in
  [docs/plans/README.md](./docs/plans/README.md): that one asks "is this correct and well-built?", this
  one asks "is this the right thing to put in front of a person, and can they use it?" An engineering
  reviewer will not catch a flow that loses the user on screen two, a control that reads as broken when
  it works, or copy that quietly asks a parent for coaching judgment they don't have.
  - **Reviewers are prompted to find flaws, not to praise**, each holding a distinct lens. Standing
    lenses for UI work: **interaction design + first-run/cognitive load** (what's the fastest path to
    value; where does this lose people; is this the right pattern at all — argue it against alternatives),
    **a11y + adaptive/responsive** (semantic HTML, keyboard, focus-visible, ≥44px targets, the layout at
    ~360px — do the width math, don't trust flex-wrap), and, whenever the screen asks a human to confirm,
    approve or enter something consequential, **trust + data-entry burden** (does the confirm question
    demand expertise the user came here lacking; is the mitigation real or theatre; what's the recovery
    path when it goes wrong).
  - **Scale the depth, never the existence.** A new screen or flow gets the full multi-lens panel; a
    small visual change gets a single reviewer. Both get one.
  - The author **reconciles each critique** — incorporate, or push back with justification — and records
    a **review-response log** in the plan (or the PR description when the change is plan-exempt), the
    same loop the engineering panel uses. The log stays committed, pushbacks included.
  - **Ground every critique in the code and the real constraint.** This app is used by kids and parents
    on a **phone, on a gym floor** — a critique that ignores that, or that speculates about code it
    hasn't opened, is noise. Panels have earned their keep here repeatedly: they caught a 44px tap-target
    CI gate an `aria-label`-only checkbox would have failed, a 360px row that only fit by wrap luck, and
    an onboarding flow whose safety argument silently collapsed on a phone.
- Tests pass locally (full suite runs in CI as a required check).
- Lint must pass to commit (pre-commit blocks a failing lint). Prettier runs on staged files +
  `prettier --check` in CI — no style debates.
- PRs include **screenshots for any UI change** (before/after where relevant), **captured with
  Playwright** driving the running app (boot the prod build → log through the access gate → navigate →
  screenshot each changed screen/state). **Each capture is taken at THREE widths — mobile (~390px),
  tablet (~820px), and desktop (~1280px)** — so the reviewer sees the primary phone/tablet experience,
  not just desktop; the `screenshot` scripts emit `<name>-mobile.png` / `-tablet.png` / `-desktop.png`
  automatically (attach at least mobile + desktop). Save to the gitignored `.screenshots/` folder, then
  **publish with `pnpm --filter web screenshots:publish --pr <n> --comment`** — never commit them to a
  source branch. The repeatable procedure is the `ui-screenshot` skill, which runs the committed
  `pnpm --filter web screenshot:ephemeral <route>` script (since V0-11, on the shared
  `e2e/gate-login.ts` helper); the Playwright-MCP path is the fallback.
  - **Screenshots go in a COMMENT, not the description.** A **second** round on the same PR **requires**
    `--note "<what changed>"` — the script refuses without it, because a reviewer should not have to
    diff two images by eye to work out what moved.
  - **Why the tooling exists** (all three tested in a real browser, reading `naturalWidth`): GitHub
    **strips base64 `data:` URIs**, leaving an `<img>` with an empty `src` — and a comment caps at
    65,536 chars anyway, so one screenshot (~235KB base64) is 3.6x over. On a **private** repo
    `raw.githubusercontent.com` links **404 in the browser** (they need an `Authorization` header a
    browser never sends), while `github.com/<owner>/<repo>/raw/<branch>/<path>` uses the viewer's
    session and works. GitHub does **not** camo-proxy either, so the markdown looks right until the
    image is broken. **On a PUBLIC repo all forms work** — which is why this is easy to get wrong.
    Images are pruned automatically when the PR closes (`.github/workflows/prune-screenshots.yml`).
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
- **Adaptive / responsive by default (first-class).** The app is used **primarily on phones and
  tablets** (the kids log on the gym floor); desktop is the secondary case. **Every screen must work
  from ~360px up through desktop** — fluid, responsive layouts (Tailwind breakpoints), no desktop-only
  fixed widths, content that wraps/stacks gracefully rather than overflowing or clipping. Design and
  review at the small width first, then confirm it scales up. A layout that only looks right on a wide
  viewport is a defect, not a polish item.
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
  already on main (CI-enforced since PR 1a). One migration/PR — EXCEPT `NOT VALID` + `VALIDATE`,
  which Squawk requires be SPLIT across PRs (in one file they share a transaction and the NOT VALID
  buys nothing — 0009's own comment reaches the same conclusion).
Where it runs: GitHub Actions is the SINGLE migrator, on merge to main, against the DIRECT/unpooled
  Neon string. NEVER in the Vercel build (concurrent preview builds would race / DDL the wrong DB).
CI gates (ACTUAL, 2026-09-23): drizzle-kit check + `generate` leaves a clean tree (drift guard) + `db:verify`
        on PGlite, plus Squawk on new migrations (since GAP-3 PR 1b, #135). NOT WIRED despite being
  claimed below: migration applies on (a) empty Docker PG AND (b) a Neon branch cut from main (prod-shaped); seeds
  run twice → idempotent.
Safety (Squawk-enforced on NEW migrations since GAP-3 PR 1b; `.squawk.toml`): no DROP COLUMN/TABLE, TRUNCATE CASCADE, or column/table RENAME alongside
  app code — use expand→backfill→contract across separate deploys. Indexes CONCURRENTLY. New NOT NULL
  via CHECK ... NOT VALID → backfill → VALIDATE. New FK/UNIQUE as NOT VALID → VALIDATE; every new ref
  column gets a covering index. Every migration SETs lock_timeout + statement_timeout. Backfills in
  bounded batches; avoid volatile defaults. IF [NOT] EXISTS guards for re-run safety.
Squawk escape hatch: a JUSTIFIED exception uses `-- squawk-ignore <rule>` on the line DIRECTLY above the
  statement — any comment in between silently voids it (docs/lessons.md) — with the reasoning above that. Verified working. This is deliberately better than a config
  exclusion: the justification lands next to the SQL it excuses, and the gate forces it to be written.
Rollback: fix-forward by default (expand-contract is reversible-by-omission); cut a Neon RESTORE
  branch pre-migration before any destructive/backfill step.
GOTCHA: CREATE INDEX CONCURRENTLY cannot run in a transaction, but drizzle-kit migrate wraps each file
  in one → isolate concurrent-index statements in their own file + a runner that strips the transaction.
Deploy order: expand/additive migrations run BEFORE the new app deploys; destructive contract AFTER.
```

## Definition of Done

See [docs/definition-of-done.md](./docs/definition-of-done.md). A PR isn't done until every
applicable box is checked and CI is green.
