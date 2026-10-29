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

## Start here

- **Changing a large feature?** Read its guide in [docs/features/](./docs/features/) first, and update
  it in the **same PR** (CI-enforced; "Feature guides" below).
- **Wrong data in a live DB the app cannot fix?** Use a guarded, dry-run-by-default **correction**:
  `pnpm --filter @mat-plan/db db:correct` lists them; [runbooks.md](./docs/runbooks.md) has the
  procedure; [corrections/README.md](./packages/db/scripts/corrections/README.md) the rules. **A
  correction treats the data; the bug still needs its own PR.**
- **Debugging a CI / test / build failure?** Check [docs/lessons.md](./docs/lessons.md) first (symptom
  → cause → fix). A failure that takes more than one attempt to diagnose gets an entry there, in the
  same PR as the fix.

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

A clean, predictable hierarchy is a **primary design concern, not an afterthought.** Before adding a
file, decide where it _belongs_; never dump it in the root or the nearest convenient directory. If a
directory starts collecting unrelated files, **propose a reorganization in the PR** — moving files is
cheap on a branch, expensive once they sprout imports.

- **Root** holds ONLY `README.md`, `AGENTS.md`, `.gitignore`, and tool-mandated config that _must_ sit
  there (`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `.prettierrc`, `eslint`,
  `next.config`, `drizzle.config`). No stray docs, notes or scratch files.
- **`docs/`** — all project documentation: `spec.md`, `plan.md` (backlog), `status.md`, `changelog/`
  (one file per change), `milestones/`, `roadmap.md` (forward-looking, by pillar), `design.md`,
  `parallel-work.md`, `definition-of-done.md`, `runbooks.md`, `lessons.md`, `tech-debt.md`,
  `privacy/`, `plans/`, `decisions/` (ADRs).
- **`.github/`** — `SECURITY.md`, `PULL_REQUEST_TEMPLATE.md`, `workflows/`, `ISSUE_TEMPLATE/`.
- **`apps/web/`** — the Next.js app, grouped by responsibility, not by file type: `app/` (routes +
  `layout`/`loading`/`error`), `components/` (`ui/` primitives vs feature folders), `lib/` (`dal/`,
  `env.ts`, utils). Route files stay thin — domain logic goes in `packages/`.
- **`packages/`** — shared importable code: `shared/` (zod schemas + types + golden vectors),
  `engine/` (pure progression engine — no DB/IO), `db/` (drizzle schema + migrations + seed).
- **Colocation:** a unit's test (`*.test.ts`) lives next to the code it covers; only _genuinely
  shared_ code is promoted to `packages/`.
- **Naming:** kebab-case files/dirs; PascalCase React components; UPPERCASE for root/.github meta.
- **When placement isn't obvious, propose it in the PR description** — don't guess and move on.

## Constants, enums & shared values (single source of truth)

A named value is defined **once** and imported everywhere. Duplicating a magic string/number that must
stay in sync is a defect, not a style nit — it's how a cookie name, route, limit or enum member drifts
between two files. Enforced by review.

- **Name it, don't repeat it.** A literal that carries meaning and appears in ≥2 places, or _must_ stay
  in sync with something else (a DB value, a header, a route), becomes a `const` (or `as const` map).
  The second occurrence is the trigger to extract.
- **Where it lives — by blast radius:**
  - **Cross-boundary / domain values** (units, `activity_type` categories, statuses, every enum) →
    **`packages/shared`** as an `as const` array + a zod enum + a `z.infer` type. That one definition
    feeds runtime validation, compile-time types **and** the DB reference-table seed, so app, engine
    and DB can't drift. The canonical home for enums.
  - **App-only values** (cookie names, route paths, cache tags, form limits) → the feature's `lib`
    module, or `lib/constants.ts` when cross-feature. Never re-typed in a component.
  - **Engine values** → `packages/engine`. Never redefine a value in two packages — import across the
    workspace (`@mat-plan/shared`).
- **Enums are reference tables, sourced from `shared`.** No native `pgEnum`. The Drizzle reference
  table seeds from the `shared` const-array and the app validates against the same zod enum: one
  list, three consumers, zero drift.
- **Reuse small logic too:** a validation/derivation used in two places (a "safe internal redirect
  path" check) becomes one exported helper, not a copy-paste.
- **Tests use the same constant as the app** (`ENTRY_KIND.bodyweight`, not a re-typed `'bodyweight'`),
  and are updated when app code switches from a literal to a const. The one exception is a deliberate
  **contract test that pins the const's value** (`expect(GATE_COOKIE_NAME).toBe('mp_gate')`) — the
  literal belongs on the assertion side there, exactly once, or the test is tautological.
- **Don't over-abstract.** Universal or single-use literals (`'/'`, `0`/`1`, an obvious one-off
  default) need no named indirection. Centralize for _meaning and sync_, not ceremony.

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
can reach the data; privacy asks whether we should hold it at all, and whether its owner can get it
back or get rid of it. This app holds **minors' health data** in a **public repo**, so every PR that
touches the schema, the DAL, an export, logging, a new dependency or a third-party call gets the
`privacy-reviewer` lens ([review-pr](./.claude/skills/review-pr/SKILL.md), rubric dimension 10): what
personal data does this start holding, who can now read it, where does it leave to, can it still be
exported and deleted. A real value committed anywhere in the tree is a P0; deleting it from `HEAD` is
not removing it.

[notice.md](./docs/privacy/notice.md) is what people are told; [data-inventory.md](./docs/privacy/data-inventory.md)
is the evidence it derives from (PRIV-1, 2026-10-07). **A change to what is stored, who receives it,
or how long it is kept updates the inventory in the same PR**, or the published notice becomes false.
Deletion: [runbooks.md](./docs/runbooks.md) → "Delete a household and everyone in it".

## Git & branch workflow

- **Trunk-based.** `main` is always deployable; all work goes via PR, **by convention** — the "Protect
  Main" ruleset blocks only branch deletion and force-pushes (verified via the API, 2026-09-30). Don't
  push to `main`.
- One short-lived branch = one PR = one backlog item / one concern. Target <400 lines.
- **Every task runs in its own git worktree, cut from a freshly-fetched `main`** — the default, not
  only for parallel work:
  `git fetch origin && git worktree add .claude/worktrees/<slug> -b <type>/<id>-<slug> origin/main`,
  then `cd` there and `pnpm install`. A branch cut from a stale `main` silently omits a just-merged
  migration or schema.
  - **The main checkout stays on `main`, clean** — sync (`git pull --ff-only origin main`) and read
    only. Several sessions share it; a checkout or rebase there moves another session's files.
  - **Location:** `.claude/worktrees/<slug>` (default; gitignored, invisible in an editor) or
    `~/workspace/tmp<n>/mat-plan` (a lane you will open in an editor; one per `n`, removed once its PR
    ships — _maintainer, 2026-10-06_). **Never `/tmp`.** `git worktree list` must register it: that
    listing is the registry of work in flight.
  - One worktree = one branch = one PR. **Remove it after the PR merges** (`git worktree remove <path>
&& git branch -D <branch>`; `-D` because a squash leaves its commits off `main`), not when it
    opens. Never remove a worktree you didn't create.
  - `apps/web/.env.local` is not copied into a new worktree; **`pnpm dev` needs it**. `verify`,
    `e2e:local` and `screenshot:ephemeral` inject their own env.
  - **Guarded for Claude sessions** by a `PreToolUse` hook (`.claude/hooks/guard-main-checkout.mjs`):
    best-effort, not a security boundary; the allowlist is the hook's header. A `SessionStart` hook
    prints status, open PRs and stale or off-main worktrees. Both are inert under CI.
- **Before running two tracks at once, run the rubric** in
  [docs/parallel-work.md](./docs/parallel-work.md). Gate 1 — disjoint file globs, **feature guides
  included** — is the one that actually fails. When a gate fails, pick an order and write the reason
  into [roadmap.md](./docs/roadmap.md)'s "In flight".
- **Branch naming:** `<type>/<id>-<slug>`, type ∈ feat|fix|chore|docs|refactor|perf|test|db
  (`feat/v0-1-scaffold`, `db/v0-5-initial-schema`).
- **Keep the branch up to date with `main` before merge** — by convention only: branch protection is
  off, so GitHub neither blocks nor flags a behind PR (the `keep-mergeable` skill checks with git).
  Rebase **before the first push**; **once on the remote, merge `main` in and never rebase** (a
  rebase then needs a force-push; the squash keeps `main` linear either way).
- **Merge = squash.** PR title is a Conventional Commit → one commit per PR on `main`. Delete the
  branch on merge.
- **A stacked PR is retargeted to `main` BEFORE its parent merges** — a child merged after its
  parent squashed lands on a dead branch and reports `MERGED` with nothing on `main`. `gh pr edit
<child> --base main` first, then parent, then child, and **verify the content on `main`** (`git grep
origin/main -- <path>`), never the label. Race and recovery: [lessons.md](./docs/lessons.md) →
  GitHub / PRs.
- **The roadmap rides with the work too.** [docs/roadmap.md](./docs/roadmap.md) is the only
  forward-looking cross-program view (`status.md` looks backwards; `plan.md` is the backlog). Move the
  item between columns in the **same PR**, or say that none moved. It is a **pointer** document — ids
  only, never a second copy of a `plan.md` row — and a **pillar is a set of owned file globs, not a
  theme**; where a glob belongs to a [feature guide](./docs/features/), the guide's `owns:` wins.
- **Status rides with the work.** In the **same PR**, add a changelog fragment
  ([docs/changelog/](./docs/changelog/README.md), one file per change) and move `docs/status.md`'s
  "where we are" pointer and backlog row if the change moves them. No status-bump PRs. `pnpm
status:check` enforces the fragment.
- **Implementation plans for significant PRs.** A PR that touches CI, a DB migration, auth, a new
  subsystem/runner, or non-trivial multi-file logic gets a committed file-by-file plan at
  `docs/plans/<id>-<slug>.md`, **reviewed before** implementation code is committed, shipped in the
  **same PR**, linked from its [docs/plan.md](./docs/plan.md) row. **Exempt:** docs, copy, config
  one-liners, single-file mechanical changes. The plan is hardened by an **adversarial review panel**
  (≥3 independent lenses) first, each critique incorporated or pushed back in a committed
  **review-response log**: [docs/plans/README.md](./docs/plans/README.md) → "Adversarial plan review".
- **A PR that advances something larger says where it sits.** The description opens with a **Where
  this sits** block — pillar, milestone (linked), what this PR is within it, what comes next and what
  gates it. **The test:** can you name the milestone, spec or multi-PR track it advances? A
  standalone PR (dependency bump, one-off bug, typo, config one-liner) omits the section; `Milestone:
none` is not an answer. The PR template carries the lines and the reasoning.
- **Diagrams in the PR description.** A PR that changes a **pivotal flow, data model or schema**
  embeds a Mermaid diagram (ERD for a schema, flowchart/sequence for a flow) — the pivotal one or two.
  Reuse and update [docs/architecture.md](./docs/architecture.md), the diagram home; the two must
  agree. First in the description, revisions as PR comments.
- **Milestone PRs also embed a progress chart.** A PR in a cross-PR milestone
  ([docs/milestones/](./docs/milestones/)) copies the milestone's canonical Mermaid step chart, done
  steps ✅ and this PR's step given a `style` line. The milestone doc owns the chart; if the order
  changed, fix it in the same PR. Live example: [beta-1.md](./docs/milestones/beta-1.md). Not for a
  standalone PR.
- Every PR gets a Vercel preview; CI must be green; reference the backlog id. A preview points at a
  **separate, seed-only Neon project**, never a branch of production — there is no Neon branch per PR
  ([OPS-1](./docs/plans/ops-1-preview-isolation.md)).

## Feature guides (docs/features/)

A **large, atomic** feature — one you cannot change a part of without understanding the others — gets
a guide at `docs/features/<slug>.md`. Today: strength logging, the write path, programming.

- **Read it before you start:** the file map, the invariants that live BETWEEN files, and the traps.
- **Update it in the same PR as the code.** `pnpm guides:check` (CI's `quality` job) fails a PR that
  touches an owned file without its guide, or a guide that owns a file that no longer exists. Escape
  hatch: the `docs-skip-feature-map` label, then push.
- What earns a guide, the format, the `owns:` frontmatter: [docs/features/README.md](./docs/features/README.md).
  A guide is not a changelog; link to the plan/ADR for reasoning — duplicated prose goes stale first.

## Local hooks vs CI merge-gates

- **pre-commit (husky + lint-staged):** ESLint + Prettier on **staged files only**. Never put
  whole-project checks here.
- **pre-push:** `pnpm typecheck` + affected tests — **two** `tsc --noEmit` projects, `apps/web` and
  `packages/db` (`src/**` + `scripts/**`). ⚠️ **Not the whole repo:** `packages/shared` and
  `packages/engine` have no tsconfig and are checked only _transitively_, through the app's imports.
- **`pnpm verify` — run this before opening a PR.** Everything CI's `quality` job does, **~40s** warm:
  `format:check` → `lint` → `typecheck` → `test` → `db:verify` → `db:mutations` → `skills:check`
  (every path and `pnpm` script a skill cites exists) → `actions:check` (every action SHA-pinned) →
  `guards:test` (the guard self-tests) → `audit:check` (the production audit). `db:mutations` applies
  each patch in `packages/db/scripts/mutations/` and asserts `db:verify` goes **RED** — a boundary
  test that cannot fail is worse than none ([TEN-1](./docs/plans/ten-1-household-scope.md)); local-only.
  **This section is the one list of where each gate runs**; other docs point here rather than
  restating it. `skills:check`, `guards:test` (all nine guard self-tests) and `audit:check` run here
  **and** in CI's `quality`, from the same `package.json` definition; `status:check` runs locally and
  on every PR (DX-5(b), [plan](./docs/plans/dx-5b-local-gates-in-ci.md)). `actions:check` runs here
  as the script, and in CI as a direct `node` call before pnpm is set up (with `--resolve` when a
  workflow changes), the one gate whose CI form is not the `package.json` script. `db:verify` runs on
  **PGlite — no Docker, no Postgres install** — which is why the DB proofs are local-runnable at all.
  **Not covered by it:** `next build` (CI-only), the Playwright smoke (next bullet), gitleaks, and the
  forward-only guard (a diff-against-base check).
- **`pnpm e2e:local` — the Playwright smoke on a throwaway DB.** Not inside `verify` (minutes; it
  builds the prod app); run it before a PR that touches a flow the smoke covers. It boots an ephemeral
  `embedded-postgres`, migrates + seeds exactly as CI does, runs `playwright test` against it, and
  deletes the cluster on exit — never touching Neon or the `pnpm dev` sandbox. Extra args pass
  through. Bare `pnpm --filter web e2e` provisions no database — use `e2e:local`.
- **CI checks** (⚠️ **none is a required status check**, so a red PR can still be merged; the
  `review-pr` shipit bar, "CI green", holds the line): typecheck · lint · `prettier --check` · tests ·
  `next build` · gitleaks · (DB) drift check + `db:verify` · `audit:check` · `skills:check` ·
  `guards:test` · `status:check` · **forward-only** + **Squawk** on new migrations · **action pins**
  ([SECURITY.md](./.github/SECURITY.md) → Supply chain). CI re-runs everything regardless of hooks.
  **Skip labels are read from the PR event: after adding one, PUSH (an empty commit is fine) — a re-run
  replays the old event** ([lessons](./docs/lessons.md) → GitHub / PRs). The labels: `ci-skip-e2e`,
  `docs-skip-feature-map`, `docs-skip-changelog` ([the rule](./docs/changelog/README.md)).
  The audit never reports **could not check, not retryable** as a pass; the rule is in
  [SECURITY.md](./.github/SECURITY.md) → Supply chain ([plan](./docs/plans/sec-5-verify-in-ci.md)).
  **`@claude review` is NOT a gate** (one advisory comment; `.github/workflows/claude-review.yml`).
  **CodeQL is NOT a PR check** (push to `main`, weekly, on demand; findings in Security → Code
  scanning), so a green PR says nothing about it.
  ⚠️ **The Neon-branch apply — a prod-shaped migration rehearsal on PRs — is NOT wired**
  ([tech-debt](./docs/tech-debt.md) → "last unwired CI gate"). Never cite an unwired gate as a safety
  argument.
- **`e2e` (Playwright smoke):** runs on every PR, **not yet required** (soaks until PR 28). It
  **auto-skips the smoke, still reporting success, when every changed file is provably inert** (docs,
  root markdown, `.claude/`, GitHub templates, images; default-to-run). Override with the
  **`ci-skip-e2e` label, then push** — sparingly, a red `e2e` usually means a real bug — or an admin
  merge as last resort. The skip is step-level, never a job-level `if:`, so a required check never
  stalls "pending" ([plan](./docs/plans/ci-e2e-auto-skip.md)).
- **Commits:** Conventional Commits (commitlint hook); `BREAKING CHANGE:` footer for breaking API/DB
  changes.
- **No personal names in PRs, plans, ADRs, changelog fragments or commit messages.** Write the role —
  _the maintainer_, _the athlete_, _a reviewer_ — and attribute decisions by role and date
  (`_(maintainer, 2026-10-05)_`). The repo is public and a name is personal data. ⚠️ A going-forward
  rule, not a cleanup claim: the commit author is in every commit, and `git log -S` finds what a
  working-tree sweep removes (the limit `docs/plan.md` records for the seeded fixture names).

## UI PR rules

- **Every PR that touches the UI gets a UX / interaction-design panel — BEFORE implementation.**
  Non-negotiable and separate from the engineering panel: that one asks "is this correct and
  well-built?", this one "is this the right thing to put in front of a person, and can they use it?"
  - **Reviewers are prompted to find flaws, not to praise**, one lens each: **interaction design +
    first-run/cognitive load** (fastest path to value; where does this lose people; is this the right
    pattern — argue it against alternatives); **a11y + adaptive/responsive** (semantic HTML, keyboard,
    focus-visible, ≥44px targets, the layout at ~360px — do the width math, don't trust flex-wrap);
    and, whenever a screen asks a human to confirm, approve or enter something consequential, **trust
    - data-entry burden** (does the question demand expertise the user lacks; is the mitigation real
      or theatre; what is the recovery path).
  - **Scale the depth, never the existence.** A new screen or flow gets all three lenses; a small
    visual change gets one reviewer.
  - Same reconcile loop and committed review-response log as the engineering panel
    ([docs/plans/README.md](./docs/plans/README.md)); a plan-exempt change logs it in the PR
    description. Pushbacks stay in the log.
  - **Ground every critique in the code and the real constraint** — kids and parents on a **phone, on
    a gym floor**. A critique that ignores that, or speculates about code it hasn't opened, is noise.
- Tests pass locally (the full suite runs in CI).
- Lint must pass to commit; Prettier runs on staged files + `prettier --check` in CI. No style debates.
- **Screenshots for any UI change** (before/after where relevant), **captured with Playwright at three
  widths — mobile (~390px), tablet (~820px), desktop (~1280px)**; attach at least mobile + desktop.
  Save to the gitignored `.screenshots/`, then **publish with
  `pnpm --filter web screenshots:publish --pr <n> --comment`**; never commit them. The procedure is the
  `ui-screenshot` skill. **Placement:** the first set in the PR description (the baseline); later
  revisions in a PR comment, which **requires** `--note "<what changed>"`. Why the script exists
  (GitHub strips `data:` URIs; raw links 404 on a private repo): [lessons.md](./docs/lessons.md) →
  GitHub / PRs.
- PR description follows the template.
- **Semantic HTML is required.** The correct native element for the job — `button` (never a clickable
  `div`/`span`), `a` for navigation, `nav`/`main`/`header`/`footer`/`section` landmarks, `ul`/`ol`/`li`
  for lists, `label` + `htmlFor` for inputs, `<form>` for forms, a correct heading order (one `<h1>`
  per page, no skipped levels). No `div`-soup with click handlers. Radix/shadcn primitives are
  semantic + accessible by default — don't wrap them in ways that regress that.
- A11y: keyboard-usable, focus-visible, labeled controls, ≥44px tap targets, numeric `inputmode` on
  number fields. Semantic HTML is the foundation — get the elements right first.
- **Adaptive / responsive by default (first-class).** The app is used **primarily on phones and
  tablets** (the kids log on the gym floor); desktop is secondary. **Every screen must work from
  ~360px up through desktop** — fluid layouts (Tailwind breakpoints), no desktop-only fixed widths,
  content that wraps/stacks rather than overflowing or clipping. Design and review at the small width
  first. A layout that only looks right on a wide viewport is a defect, not a polish item.
- **Web performance / Core Web Vitals is a first-class concern.** RSC-first (minimal client JS),
  `next/image` + `next/font`, no render-blocking third-party scripts, lean/code-split bundles. Budget
  (p75, mobile): **LCP < 2.5s · INP < 200ms · CLS < 0.1**; regressing it is a review concern. Tooling +
  phasing: [ADR 0001](./docs/decisions/0001-observability-and-web-vitals.md).

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
CI gates: drizzle-kit check + `generate` leaves a clean tree (drift guard) + `db:verify` on PGlite +
  Squawk on new migrations + the e2e job's migrate+seed against an empty Postgres service. Where each
  gate runs, and which is NOT wired: "Local hooks vs CI merge-gates" above.
Safety (Squawk-enforced on NEW migrations since GAP-3 PR 1b; `.squawk.toml`): no DROP COLUMN/TABLE, TRUNCATE CASCADE, or column/table RENAME alongside
  app code — use expand→backfill→contract across separate deploys. Indexes CONCURRENTLY. New NOT NULL
  via CHECK ... NOT VALID → backfill → VALIDATE. New FK/UNIQUE as NOT VALID → VALIDATE; every new ref
  column gets a covering index. Every migration SETs lock_timeout + statement_timeout. Backfills in
  bounded batches; avoid volatile defaults. IF [NOT] EXISTS guards for re-run safety.
Squawk escape hatch: a JUSTIFIED exception uses `-- squawk-ignore <rule>` on the line DIRECTLY above the
  statement — any comment in between silently voids it (docs/lessons.md) — with the reasoning above
  that, so the justification lands next to the SQL it excuses.
Rollback: fix-forward by default (expand-contract is reversible-by-omission); cut a Neon RESTORE
  branch pre-migration before any destructive/backfill step.
GOTCHA: CREATE INDEX CONCURRENTLY cannot run in a transaction, but drizzle-kit migrate wraps each file
  in one → isolate concurrent-index statements in their own file + a runner that strips the transaction.
Deploy order: expand/additive migrations run BEFORE the new app deploys; destructive contract AFTER.
```

## Definition of Done

See [docs/definition-of-done.md](./docs/definition-of-done.md). A PR isn't done until every
applicable box is checked and CI is green.
