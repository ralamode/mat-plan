# V0-11 — CI Postgres (Docker service) + Playwright smoke

> Backlog: [plan.md](../plan.md) row V0-11. Branch: `feat/v0-11-ci-postgres-playwright`.

## Goal

Stand up the E2E tier the whole test pyramid has been promising ("Playwright for E2E (added V0-11)" —
`docs/definition-of-done.md`). This PR adds Playwright as a real workspace dev dependency, a
`playwright.config.ts` whose `webServer` boots the **production** build, a shared **gate-login** helper
(used to mint a `storageState` once), and one **smoke E2E**: log a bodyweight through the UI and assert
it renders in Today — run against an **ephemeral Postgres**. In CI it adds a second job with a Postgres
**service container** that is migrated + seeded (reusing the existing `packages/db` scripts) before
Playwright runs on every PR. Finally it **graduates** the `ui-screenshot` MCP procedure into a
committed `pnpm --filter web screenshot <route>` script built on the _same_ gate-login helper, and
repoints `SKILL.md` + `AGENTS.md` at it. This crosses "the CI-DB cliff" deliberately: the first time
real browser + real Postgres run together in CI.

## Acceptance

Verbatim from `plan.md` row V0-11:

> `playwright test` green in CI logging a weight vs ephemeral PG

Done when:

- `pnpm --filter web e2e` runs a Chromium smoke test that logs in through `/gate`, submits the
  bodyweight form on `/`, and asserts the new entry renders in the Today list — green locally against a
  local Postgres and green in the new CI `e2e` job.
- CI has an `e2e` job with a `postgres` **service container**, migrated + seeded via
  `pnpm --filter @mat-plan/db db:migrate` / `db:seed` (never prod), that runs on every PR.
- On failure, the job uploads the Playwright HTML report + traces/screenshots as artifacts.
- `@playwright/test` is a direct `apps/web` devDependency; browsers are cached between CI runs.
- The gate cookie name / token derivation are **imported** from `apps/web/lib/access-gate.ts` — no
  copy-pasted `'mp_gate'` literal and no re-derived token in the e2e code.
- `pnpm --filter web screenshot <route>` produces a PNG in `.screenshots/` using the shared gate-login
  helper, with **no MCP** required; `SKILL.md` + `AGENTS.md` point at it.
- Vitest (`pnpm test`) does **not** pick up Playwright specs and Playwright does **not** pick up Vitest
  `*.test.ts`.

## File-by-file changes

| Path                                         | Change | What & why                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/package.json`                      | EDIT   | Add devDeps `@playwright/test` (pin `^1.51.1` to match the version already in the lockfile tree) and `tsx` (`^4.23.1`, same as `packages/db`, to run the screenshot script). Add scripts: `"e2e": "playwright test"`, `"e2e:install": "playwright install --with-deps chromium"`, `"screenshot": "tsx scripts/screenshot.ts"`. |
| `apps/web/playwright.config.ts`              | NEW    | Playwright config: `testDir`, `webServer` (build+start prod), single Chromium project depending on a `setup` project that writes `storageState`, artifact dirs. Shape below.                                                                                                                                                   |
| `apps/web/e2e/gate-login.ts`                 | NEW    | The shared gate-login helper — the single source both the setup project and the screenshot script reuse. Imports `GATE_PATH` from the app via a **relative** path (`../lib/access-gate`) so both Playwright _and_ tsx resolve it without tsconfig-path tooling. Reads the password from `process.env.ACCESS_GATE_PASSWORD`.    |
| `apps/web/e2e/global.setup.ts`               | NEW    | The `setup` project spec: calls `gateLogin(page)`, then `page.context().storageState({ path: STORAGE_STATE })`. Runs once; the smoke test starts already authed.                                                                                                                                                               |
| `apps/web/e2e/log-bodyweight.spec.ts`        | NEW    | The one smoke E2E. Uses the stored auth state, navigates to `/`, logs a weight, asserts it renders in Today. Assertions below.                                                                                                                                                                                                 |
| `apps/web/scripts/screenshot.ts`             | NEW    | Standalone Playwright script (run via tsx) that reuses `gateLogin`, navigates to a route from `argv`, full-page-screenshots to repo-root `.screenshots/`. Assumes a running prod server (mirrors the current skill's build→`next start`→shoot flow). No MCP.                                                                   |
| `.github/workflows/ci.yml`                   | EDIT   | Add a second job `e2e` (alongside `quality`/`gitleaks`) with a `postgres` service, migrate+seed steps, Playwright browser install + cache, run the smoke test, upload artifacts on failure. Job YAML below.                                                                                                                    |
| `.gitignore`                                 | EDIT   | Add `apps/web/e2e/.auth/` (the `storageState` file — machine-local secret-bearing cookie, never committed). `playwright-report/`, `test-results/`, `.screenshots/` are already ignored.                                                                                                                                        |
| `apps/web/vitest.config.ts`                  | EDIT   | Add `exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**']` (defense-in-depth; naming already separates `.spec.ts` from `.test.ts`). Leave `include` as-is.                                                                                                                                                               |
| `.claude/skills/ui-screenshot/SKILL.md`      | EDIT   | Replace the MCP "Procedure" as the _primary_ path with the committed `pnpm --filter web screenshot <route>` script; keep the MCP flow as the **fallback / when-the-script-can't-run** pointer. Update the "Future" section to past tense ("graduated at V0-11").                                                               |
| `AGENTS.md`                                  | EDIT   | Change "it graduates to a committed `pnpm screenshot` script when Playwright lands as a dep at V0-11" → present tense pointing at the committed script + the skill as fallback.                                                                                                                                                |
| `docs/status.md`                             | EDIT   | Move V0-11 to "in review", bump the where-we-are pointer + changelog row (AGENTS.md: status rides with the work).                                                                                                                                                                                                              |
| `docs/plan.md`                               | EDIT   | Link the V0-11 row to `docs/plans/v0-11-ci-postgres-playwright.md` (done in the convention scaffold).                                                                                                                                                                                                                          |
| `docs/plans/v0-11-ci-postgres-playwright.md` | NEW    | This document.                                                                                                                                                                                                                                                                                                                 |

### `apps/web/playwright.config.ts` (shape)

```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
export const STORAGE_STATE = './e2e/.auth/state.json';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts', // never *.test.ts (that's Vitest's)
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  outputDir: './test-results', // already gitignored
  use: { baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure' },
  webServer: {
    // Build+start the PROD server: representative CSP/render, and NODE_ENV=production
    // means the gate cookie is Secure — Chromium honors Secure on localhost.
    command: `pnpm --filter web build && pnpm --filter web start -- -p ${PORT}`,
    url: `${baseURL}/gate`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000, // Next build inside the server boot
    // Inherit job/.env.local env (ACCESS_GATE_PASSWORD, DATABASE_URL); no secrets here.
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
});
```

Rationale for **`apps/web` (not root)**: the specs and the screenshot script import app modules
(`lib/access-gate`), rely on the web `tsconfig`, run via `pnpm --filter web`, and the graduated
`screenshot` command is a _web_ script — all point at colocating Playwright with the app it drives.
Root only ever needs a thin optional passthrough (not added here to keep the PR small).

### `apps/web/e2e/gate-login.ts` (approach)

```ts
import { expect, type Page } from '@playwright/test';
import { GATE_PATH } from '../lib/access-gate'; // relative → tsx-safe; SSoT for the route

export async function gateLogin(page: Page): Promise<void> {
  const password = process.env.ACCESS_GATE_PASSWORD;
  if (!password) throw new Error('ACCESS_GATE_PASSWORD must be set for e2e/screenshot.');
  await page.goto(GATE_PATH);
  await page.getByLabel('Access code').fill(password); // matches gate-form.tsx <label htmlFor>
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL('/'); // Server Action redirects home on success
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}
```

Single-source-of-truth: it drives the **real** gate form, so it never re-derives the token; the only
shared value it imports is `GATE_PATH`. (Alternative, if the setup is ever too slow: `context.addCookies`
using `GATE_COOKIE_NAME` + `gateTokenFor(password)` imported from `access-gate.ts` — still zero
copy-paste. The UI-driven form is preferred as the more honest smoke of the gate.)

### `apps/web/e2e/global.setup.ts`

```ts
import { test as setup } from '@playwright/test';
import { gateLogin } from './gate-login';
import { STORAGE_STATE } from '../playwright.config';

setup('authenticate through the gate', async ({ page }) => {
  await gateLogin(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
```

### `apps/web/scripts/screenshot.ts` (entrypoint)

```ts
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { gateLogin } from '../e2e/gate-login';

// Usage (mirrors the current skill): build → start prod → run this.
//   pnpm build && pnpm --filter web start -- -p 3996
//   pnpm --filter web screenshot /            # or /gate, other routes
const route = process.argv[2] ?? '/';
const base = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3996';
const name = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

await mkdir('.screenshots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newContext({ baseURL: base }).then((c) => c.newPage());
await gateLogin(page); // SAME helper as the test setup
await page.goto(route, { waitUntil: 'networkidle' });
await page.screenshot({ path: `.screenshots/${name}.png`, fullPage: true });
await browser.close();
```

It requires a running prod server (exactly like today's SKILL step 1) and reuses `gateLogin` — the
"same gate-login fixture" the smoke test uses. Writes to the already-gitignored `.screenshots/`.

### CI job (`.github/workflows/ci.yml`, new `e2e` job)

Mirrors the existing `quality` job's pnpm/Node-22/`cache: pnpm`/frozen-lockfile setup:

```yaml
e2e:
  name: e2e
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:17
      env:
        POSTGRES_USER: mat
        POSTGRES_PASSWORD: mat
        POSTGRES_DB: mat_plan_test
      ports: ['5432:5432']
      options: >-
        --health-cmd "pg_isready -U mat -d mat_plan_test"
        --health-interval 5s --health-timeout 5s --health-retries 10
  env:
    # Ephemeral CI PG — pooled and unpooled point at the SAME instance (no PgBouncer in CI).
    DATABASE_URL: postgres://mat:mat@localhost:5432/mat_plan_test
    DATABASE_URL_UNPOOLED: postgres://mat:mat@localhost:5432/mat_plan_test
    ACCESS_GATE_PASSWORD: ci-e2e-placeholder-1234 # non-secret, ≥8 chars
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile

    - name: Cache Playwright browsers
      uses: actions/cache@v4
      with:
        path: ~/.cache/ms-playwright
        key: playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
    - name: Install Chromium
      run: pnpm --filter web exec playwright install --with-deps chromium

    - name: Migrate + seed ephemeral PG (reuse packages/db scripts; never prod)
      run: |
        pnpm --filter @mat-plan/db db:migrate
        pnpm --filter @mat-plan/db db:seed

    - name: Playwright smoke
      run: pnpm --filter web e2e # webServer builds+starts the prod app

    - name: Upload report + traces on failure
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: playwright-report
        path: |
          apps/web/playwright-report
          apps/web/test-results
        retention-days: 7
```

Notes: both DB URLs are set (the migrate/seed scripts and `drizzle.config.ts` prefer
`DATABASE_URL_UNPOOLED`; the app runtime reads `DATABASE_URL`). The job-level `env` is inherited by the
`webServer` command, so `next build` (env.ts validates at build) and `next start` both see valid
values. This is a separate job/runner from `quality`, so the duplicate `pnpm build` inside `webServer`
is acceptable (optimizing via artifact hand-off is deferred).

## Test plan

**What the smoke asserts (`log-bodyweight.spec.ts`), step by step:**

1. Precondition (setup project): authenticated via `gateLogin` → `storageState` saved; `chromium`
   project loads it, so the test lands on `/` already past the gate (the proxy at `apps/web/proxy.ts`
   would otherwise bounce to `/gate`).
2. `page.goto('/')`; assert the `Today` `<h1>` and the "Log bodyweight" section (`bodyweight-form.tsx`)
   are visible.
3. Fill the **Weight** field (`getByLabel('Weight')`) with a fixed, distinctive value (e.g. `72.5`);
   leave Unit at its default `lb` (`DEFAULT_BODYWEIGHT_UNIT`).
4. Click **Log weight** (`getByRole('button', { name: /log weight/i })`).
5. Assert the entry renders in the Today list:
   `await expect(page.getByText('Bodyweight — 72.5 lb')).toBeVisible()` — the exact label string
   produced by `entryLabel` in `app/page.tsx`. `revalidatePath('/')` in `logBodyweightAction` refreshes
   the RSC so the item appears without a manual reload.

**Isolation / seeding:** the service container is a fresh Postgres per job run; `db:migrate` builds the
schema and `db:seed` inserts exactly one profile ("Athlete One", fixed UUIDv7 — `packages/db/src/seed.ts`).
Zero entries exist at start, and Today is scoped to the current UTC day (`todayIso`), so the logged row
is the only bodyweight entry and the assertion is deterministic. No teardown needed. The smoke logs one
row; idempotency/replay is covered by the existing Vitest integration tests, not re-tested here.

**Local run:**

```bash
# one-time: pnpm --filter web e2e:install
docker run -d --name mp-e2e -e POSTGRES_USER=mat -e POSTGRES_PASSWORD=mat \
  -e POSTGRES_DB=mat_plan_test -p 5432:5432 postgres:17
export DATABASE_URL=postgres://mat:mat@localhost:5432/mat_plan_test
export DATABASE_URL_UNPOOLED=$DATABASE_URL ACCESS_GATE_PASSWORD=local-e2e-1234
pnpm --filter @mat-plan/db db:migrate && pnpm --filter @mat-plan/db db:seed
pnpm --filter web e2e        # webServer builds+starts the prod app on :3100
```

(A developer with a real `.env.local` can also point at a throwaway Neon branch; the smoke just needs a
migrated+seeded PG and the three env vars.)

**CI run:** the `e2e` job above, on every PR (and `push` to `main`).

## Risks / rollback

- **The CI-DB cliff (first real browser + real PG together).** Mitigation: reuse the _battle-tested_
  `packages/db` migrate/seed scripts unchanged (already exercised by `db:verify` on PGlite); keep both
  DB URLs pointed at the one service container; health-check gate before migrate.
- **Secure cookie on `localhost`.** `next start` runs `NODE_ENV=production`, so the gate cookie is
  `Secure` (`app/gate/actions.ts`). Mitigation: drive over `http://localhost` — Chromium treats
  `localhost` as a secure context and stores `Secure` cookies there. (This is exactly what the existing
  MCP flow already relies on.) If a future browser tightens this, fall back to the
  `addCookies`+`gateTokenFor` variant noted above.
- **Flakiness.** Mitigations: assert on stable roles/labels (`getByRole`/`getByLabel`) and the exact
  `entryLabel` string, not CSS; `retries: 1` in CI; `trace: 'on-first-retry'` + report artifact for
  triage; deterministic seed so the item is unique.
- **Playwright browser download cost/instability.** Cache `~/.cache/ms-playwright` keyed on
  `pnpm-lock.yaml`; install only `chromium --with-deps`.
- **Build-vs-dev server.** Deliberately prod (`build && start`) for representative CSP/render and the
  Secure-cookie behavior; cost is a ~2-min build inside `webServer` (timeout 180s). If build time bites,
  a follow-up can hand the `quality` job's build to the `e2e` job via an artifact (deferred).
- **Vitest ↔ Playwright collision.** `*.spec.ts` (Playwright) vs `*.test.ts` (Vitest) plus
  `testDir: './e2e'` + Vitest `exclude: ['**/e2e/**']` keep them fully disjoint.
- **Rollback.** Additive and self-contained: delete the `e2e` job + `apps/web/e2e/`,
  `playwright.config.ts`, `scripts/screenshot.ts`, revert the `package.json`/doc edits. No schema,
  runtime, or migration changes, so nothing to unwind in prod or Neon.

## Out-of-scope / deferred

- **Visual-regression / screenshot diffing** (`toHaveScreenshot`, baselines). The `screenshot` script is
  capture-only for PR attachments.
- **Multi-browser / mobile projects** — single Chromium only (kid-iPad viewport tuning is a v1.12
  concern).
- **Auth beyond the access gate** — Clerk login arrives at v1.5; only the stopgap gate is exercised.
- **Strength-entry E2E** (V0-9 flow), replay/idempotency E2E, a11y/axe E2E — one smoke only, per plan
  ("a few critical flows only").
- **Wiring the screenshot script as a CI artifact / a CI screenshot step** — the script is committed and
  human/CI-runnable, but automatically producing screenshots in CI is explicitly optional and not done
  here.
- **Making `e2e` a _required_ status check** — that's a branch-protection (repo-admin) change, not a
  repo file; call it out for the maintainer (see Open questions).
- **Neon-branch E2E** — CI uses Docker PG per the resolved decision; Neon-branch apply stays the
  migration-workflow gate.
- **A root-level `pnpm e2e`/`pnpm screenshot` passthrough** — left to a later convenience PR.

## Open questions

1. **Postgres image pin:** `postgres:17` (latest GA) vs pinning to whatever major Neon runs for closer
   prod parity. Recommend `postgres:17`; confirm the Neon major if parity matters.
2. **`E2E_PORT` / screenshot base port:** config defaults to `3100` for tests; the screenshot script
   keeps the skill's `3996`. Fine to keep them distinct (tests auto-boot; screenshots reuse a
   hand-booted server), or unify.
3. **Required check:** should the maintainer add `e2e` to branch protection's required checks now, or
   let it soak as non-blocking for a PR or two first?
4. **Relative imports in `e2e/`:** the helper imports `../lib/access-gate` (relative) rather than the
   `@/` alias, purely so the tsx-run screenshot script resolves without `tsconfig-paths`. Acceptable
   deviation from the `@/` convention for test tooling, or add `tsconfig-paths` and keep `@/` everywhere?
