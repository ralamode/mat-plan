# Lessons log — recurring gotchas & their fixes

A terse, **scannable** record of failures that cost more than one attempt to diagnose, so the next
person (or agent) fixes them in one. Read this **before** debugging a CI / test / build failure —
grep for the symptom. Keep entries to 1–3 lines: **Symptom → Cause → Fix**. Newest on top within a
section. This is a debugging index, not prose — link out to a plan/ADR for depth.

## E2E / Playwright

- **An assertion on a form's own label is a FALSE POSITIVE — it goes green while nothing was
  written.** → `getByText('Rice bucket', { exact: true })` matched the check-in `<label>` inside the
  form, not only the logged-entry list. The write assertion "passed", the run then failed one line
  later on a different string, and the diagnosis went to the wrong place entirely. → **Scope
  post-write assertions to the entries region** (`getByRole('region', { name: 'Logged entries' })`),
  never the whole page, whenever the form and the list share vocabulary. (V1-5)
- **A post-submit `toBeVisible()` raced an in-flight Server Action** — the failure snapshot showed
  `button "Logging…" [disabled]` with the entries list not yet revalidated. → **Synchronize on the
  submit button returning from its pending label** (`await expect(submit).toBeEnabled({ timeout:
15_000 })`) before asserting on the list. Note this is a real **sync point**, not padding a timeout
  to hide a race — the V0-11 lesson below still stands. The cold path is already warmed in
  `global.setup`; this action is genuinely heavier (several catalog reads + a multi-row insert + a
  full RSC revalidation) than the single-row bodyweight write the default 5s was tuned for. (V1-5)
- **Read `error-context.md` in the Playwright artifact FIRST** (`gh run download <run-id>`) — the
  page snapshot names the true state in one look (a disabled "Logging…" button, which element was
  `readonly`), instead of inferring it from the assertion text. (V1-5)
- **A Playwright RETRY reuses the same ephemeral DB, so "already logged" UI breaks the rerun.** →
  Attempt 1 logged the row; the retry found the control `readonly`/`aria-disabled` **by design** and
  timed out in `fill()`, looking like a fresh bug rather than leftover state. → Make writing steps
  **retry-safe**: check `isEditable()` and, when the state is already there, skip the write and
  assert the end state. (V1-5)
- **Today's render is now WEEKDAY-DEPENDENT, so CI sees a different page on a Monday than on a
  Thursday.** → V1-10 slice 2 renders the "Today's program" card only when the local weekday maps to a
  `day_role` (Mon/Wed/Fri). Nothing in the current suite collides with it — every step locates by
  ROLE + ACCESSIBLE NAME (`getByRole('region', { name: 'Check-ins' })`), which is immune to a new
  sibling section appearing above the strength form. → Keep it that way: **never locate an e2e element
  by position, nth-match, or section ORDER on Today**, or the suite will pass Tue/Thu and fail Mon/Wed/Fri
  — a failure that reproduces only two days in three and looks like flake. If a test ever needs the card
  present or absent deterministically, pin the browser zone (`timezoneId`) so the local weekday is
  chosen, the same lever `screenshot --tz` uses. (V1-10)

- **`notFound()` route returns HTTP 200, not 404, so `expect(res.status()).toBe(404)` fails.** → The
  app is `force-dynamic` (nonce CSP), so Next **streams the 200 header before the RSC throws
  `notFound()`** — the not-found UI renders but the status is already 200. → Assert the rendered
  not-found **content** (`getByText(/this page could not be found/i)`), not the HTTP status. (V1-3)

- **UNRESOLVED: the check-ins smoke (`log-bodyweight.spec.ts:23`) fails locally and flakes in CI.**
  Symptom: `getByRole('button', { name: 'Log check-ins' })` "element(s) not found", snapshot showing
  `button "Logging…" [disabled]` — a Server Action still in flight past 15s. The failure POINT MOVES
  within that one test (sometimes the check-ins submit, sometimes `Wake · logged today`), and only that
  test — the longest and most write-heavy — is affected; the other four pass consistently.
  **Ruled out so far** (V1-14a), so the next attempt doesn't repeat them:
  - _Not_ caused by the Sentry action wrapper: identical results with and without it (3 runs each).
  - _Not_ (only) per-action cold start: warming the check-ins path in `global.setup` made test 2 drop to
    ~1s but did **not** fix the smoke.
  - _Not_ worker contention alone: reproduces at `--workers=1` (CI's config) as well as `--workers=5`.
  - _Not_ the setup timeout — though that WAS a real latent bug found on the way (see next entry).
    A moving failure point in the longest sequential-write test points at write/revalidation latency
    rather than a single bad assertion. CI's `retries: 1` usually masks it as `flaky`; it has also failed
    outright with the retry. **Needs its own investigation — do not bolt another guess onto a feature PR.**

- **Playwright's default TEST timeout (30s) applies to `global.setup` too — and a warm-up step can blow
  it.** → `global.setup` did gate login + a cold bodyweight write with a 30s _assertion_ timeout inside
  a 30s _test_ timeout. Zero headroom: on a slow runner the setup itself times out, the warming silently
  never happens, and the cold cost lands in the coverage test — the exact thing the setup exists to
  prevent. Adding a second warm-up made it fail outright. → **`setup.setTimeout()` explicitly whenever
  the setup does real work**, well above the sum of its own assertion timeouts. (V1-14a)

- **Attribute a flake before "fixing" it — stash your branch and re-run without your changes.** → This
  surfaced during V1-14a (which wraps every action in Sentry), so the wrapper was the obvious suspect.
  Running the same spec with and without the branch's changes, 3 runs each, gave identical results and
  killed that theory in minutes. Also: read the numbers carefully — "1 failed, 4 passed" is one TEST of
  five, not one RUN in five. Misreading that turned into an overstated claim in a PR description. (V1-14a)

- **Test "flaky" (fails attempt 1, passes on retry) after a form submit.** → The _first_ Server Action
  after a cold `next start` pays JIT + first-DB-connection cost, exceeding the assertion timeout; the
  warm retry passes, masking the race. → **Warm the cold path once in `global.setup`** (submit one
  throwaway record) so the coverage test runs warm under the **default** timeout. Do NOT pad the
  timeout or lean on `retries` to hide it — a `flaky` annotation is a bug. (V0-11)
- **`strict mode violation: getByLabel(...) resolved to N elements`.** → `getByLabel`/`getByText` are
  **substring + case-insensitive** by default; "Weight" also matches "Log bodyweight" and "Set 1
  weight". → Add `{ exact: true }`, or scope by section: `getByRole('region', { name }).getBy…`. (V0-11)
- **`webServer` never starts: "Invalid project directory … /apps/web/-p".** → `pnpm --filter web start
-- -p 3100` forwards `-- -p 3100` literally to `next start`, which reads `-p` as a directory. → Use
  `pnpm --filter web exec next start -p <port>` (or the `PORT` env). (V0-11)
- **Can't run the e2e locally at all.** → No Docker on the dev machine; the app needs a **TCP**
  Postgres (PGlite is in-process only, used just for `db:verify`). → CI is the first real e2e run;
  front-load robustness. **Fix realized for the screenshot flow (`chore/screenshot-ephemeral-db`):**
  `pnpm --filter web screenshot:ephemeral` boots a throwaway **`embedded-postgres`** (real Postgres
  binary on an ephemeral TCP port, no Docker/creds), migrates+seeds it via the `packages/db` scripts,
  and runs `next start` against it — so a data-dependent capture never touches live Neon. The same
  approach is the future path for local e2e. See [docs/plans/v0-11-ci-postgres-playwright.md] and the
  `no-docker-local-e2e` memory.
- **Screenshot capture wrote real rows into the live kids' log.** → The old `screenshot` script boots
  a prod server that reads `apps/web/.env.local` → live Neon, so capturing an "already-logged"
  check-in **mutated prod**. → Default the flow to a throwaway embedded Postgres
  (`screenshot:ephemeral`); targeting a non-local DB now requires an explicit `--use-live-db` /
  `SCREENSHOT_ALLOW_LIVE_DB=1` opt-in, so "point at prod" is a deliberate exception, not the default.
  (chore/screenshot-ephemeral-db)
- **Next 16 env precedence — does `.env.local` override an injected `process.env`?** → NO. `@next/env`
  `processEnv` only applies a parsed `.env*` key when it is **undefined in the initial `process.env`
  snapshot** (`typeof l[t]==="undefined"`), so a value **already in `process.env` WINS**. → To point a
  `next start` at a different DB, inject `DATABASE_URL` into the server's environment — no
  `.env.screenshot`/temp-cwd trick needed. (chore/screenshot-ephemeral-db)

## embedded-postgres

- **A PERSISTENT `embedded-postgres` re-run fails if you re-`initialise()` / re-`createDatabase()`.**
  → For a throwaway DB the dir is always empty so both calls are fine; for a persistent dir (the
  `pnpm dev` local sandbox) the cluster already exists — `initialise()` repopulates and
  `createDatabase()` errors "already exists". → Detect a live cluster by the **`PG_VERSION` marker** in
  the data dir and, when present, skip both — just `start()`. Also: the superuser **password is baked
  into the cluster at initdb time**, so it MUST stay constant across runs (a changed password can't
  reconnect to an existing `.local-db` — `pnpm db:local:reset` to start over). Shared
  `startEmbeddedPostgres` helper (`apps/web/scripts/embedded-pg.ts`) does the detection for both the
  screenshot and dev flows. (chore/local-dev-db)
- **The Next env-precedence trick works for `next dev`, not just `next start`.** → Same `@next/env`
  `processEnv` path (a value already in `process.env` WINS over `.env.local`), so injecting
  `DATABASE_URL` into the `next dev` child env overrides `.env.local` — the basis for `pnpm dev`
  pointing the dev server at the local embedded DB while leaving `.env.local` (and its
  `ACCESS_GATE_PASSWORD`) otherwise intact. (chore/local-dev-db)

## React / forms

- **`aria-disabled` and `readOnly` do NOT stop a control from being submitted** — only real
  `disabled` (or omitting the `name`) does. A V1-5 check-in field rendered "already logged" as a
  still-`checked` checkbox with `aria-disabled` (chosen for keyboard/SR reachability); it kept
  submitting `"1"` on every later form submit, inserting a **duplicate row each time** (surfaced once
  V1-6a's accumulate flow made repeated submits normal). → For a display-only "already done" field,
  **drop its `name`** (`name={isLogged ? undefined : …}`) so it renders but doesn't submit — keeps it
  focusable + announced, unlike real `disabled`. A one-submit e2e won't catch this; test a **re-submit**. (V1-6a)

## Vitest / RTL (component tests)

- **Test "passes" but the run exits non-zero: `ReferenceError: window is not defined` (unhandled,
  after the tests).** → An RTL component test didn't **unmount** — clearing `document.body.innerHTML`
  isn't enough; React/`next/link` scheduler work stays pending and flushes _after_ jsdom is torn down.
  → `import { cleanup } from '@testing-library/react'; afterEach(cleanup)`. RTL's auto-cleanup only
  registers when vitest `globals` is on (ours is off — we import test APIs), so wire it explicitly.
  Also declare the DOM per-file: `// @vitest-environment jsdom` (the suite default is `node`). (V1-3)

## CI / secrets

- **A Dependabot MAJOR can be an ecosystem-readiness problem, not a code problem — pin the toolchain,
  don't chase npm.** → Dependabot proposed `typescript` 5.9 → **7.0** (the Go rewrite) two days after
  publication. `@typescript-eslint/typescript-estree@8` cannot parse it —
  `TypeError: Cannot read properties of undefined (reading 'Cjs')` — so `quality`, `e2e` **and** the
  Vercel build all failed with nothing fixable on our side, and Dependabot would have re-proposed it
  weekly, burning a full CI run each time for a guaranteed red. → **`ignore` semver-major for
  compiler/parser-coupled deps** (`typescript`) until the tooling that parses them catches up, with a
  comment naming the condition to remove it. Conversely, **GitHub Action majors are safe to group** —
  they're almost always runner-image/Node bumps, not semantics. (V1-14a follow-up)

- **A known-flaky e2e makes routine dependency bumps look broken.** → Three green Dependabot PRs
  (`checkout`, `cache`, `commitlint`) showed red purely from the check-ins flake. That is the failure
  mode that trains a reviewer to ignore red checks — the cost of an unfixed flake is not the flake, it
  is the signal it destroys elsewhere. → When triaging a red bump, check WHICH job failed before
  assuming the bump caused it. (V1-14a follow-up)

- **gitleaks red on a CI placeholder** (e.g. `ci-e2e-placeholder-1234`). → A high-entropy dummy value
  trips the generic-api-key rule. → Allowlist the **specific** string in `.gitleaks.toml` (tight regex,
  not a path exclusion, so real secrets in those files are still caught). Low-entropy placeholders
  (`ci-build-placeholder`) slip through by luck — don't rely on that. (V0-11)

## Next.js 16

- **`middleware.ts` silently ignored.** → Next 16 renamed it to **`proxy.ts`** (function `proxy`,
  `export const config = { matcher }`). → Read `node_modules/next/dist/docs/` before writing
  version-sensitive code (per `apps/web/AGENTS.md`). (V0-4)

## Git / commits

- **Squash merge landed an _intermediate_ commit — the last pushes are missing from `main`.** → A PR
  merged while newer commits were still landing (or merged at the SHA the page was showing) squashes a
  stale head, silently dropping later commits. → After any squash merge, `git checkout main && git
pull`, then spot-check `main` has your final work (`git show HEAD:<file> | grep <distinctive line>`).
  If missing, cherry-pick the dropped commits forward on a follow-up branch. (V0-11 → #24)
- **Commit rejected: "subject must not be sentence-case / start-case".** → commitlint wants a
  **lowercase** subject start. → `feat(x): add …`, not `feat(x): Add …` / `feat(x): CI …`.

## tsx / scripts

- **`tsx` script fails: "Top-level await is currently not supported with the cjs output format".** →
  The package has no `"type": "module"` (e.g. `apps/web`), so tsx transforms `.ts` to CJS. → Wrap the
  body in an `async function main() { … }` + `main().catch(…)`, or make the package/file ESM
  (`.mts` / `"type": "module"` — `packages/db` does the latter). (V0-11 screenshot script)
- **A plain `tsx` script doesn't see `.env.local`.** → Only Next auto-loads `.env.local`; a standalone
  tsx run doesn't. → Pass env explicitly (`ACCESS_GATE_PASSWORD=$(…) pnpm --filter web screenshot`).

## pnpm / build

- **Native/esbuild build script blocked on install.** → pnpm 11 blocks unlisted build scripts. → Add
  the package to `allowBuilds` in `pnpm-workspace.yaml`.

---

**Appending:** when a failure takes more than one attempt to diagnose, add an entry here in the same PR
as the fix (see AGENTS.md → "turn failures into prevention"). Keep it terse; the value is fast recall.
