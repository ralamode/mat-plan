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
- **`notFound()` route returns HTTP 200, not 404, so `expect(res.status()).toBe(404)` fails.** → The
  app is `force-dynamic` (nonce CSP), so Next **streams the 200 header before the RSC throws
  `notFound()`** — the not-found UI renders but the status is already 200. → Assert the rendered
  not-found **content** (`getByText(/this page could not be found/i)`), not the HTTP status. (V1-3)

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

## Vitest / RTL (component tests)

- **Test "passes" but the run exits non-zero: `ReferenceError: window is not defined` (unhandled,
  after the tests).** → An RTL component test didn't **unmount** — clearing `document.body.innerHTML`
  isn't enough; React/`next/link` scheduler work stays pending and flushes _after_ jsdom is torn down.
  → `import { cleanup } from '@testing-library/react'; afterEach(cleanup)`. RTL's auto-cleanup only
  registers when vitest `globals` is on (ours is off — we import test APIs), so wire it explicitly.
  Also declare the DOM per-file: `// @vitest-environment jsdom` (the suite default is `node`). (V1-3)

## CI / secrets

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
