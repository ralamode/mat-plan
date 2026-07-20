# Definition of Done (per PR)

Every PR must satisfy:

- [ ] Significant PR (CI / migration / auth / new subsystem / non-trivial multi-file logic): file-by-file plan at `docs/plans/<id>-<slug>.md` exists, was reviewed before coding, and was followed
- [ ] Typecheck (`tsc --noEmit`) + lint (ESLint) + `prettier --check` pass
- [ ] Unit / integration test for new logic (see test pyramid below)
- [ ] Loading / empty / error states present for any new UI
- [ ] Playwright screenshot(s) of any changed screen/state attached to the PR (via the `ui-screenshot` skill; saved to `.screenshots/`, not committed)
- [ ] Semantic HTML: correct native elements (button/a/nav/main/ul-li/label), proper heading order — no div-soup
- [ ] A11y basics: keyboard-usable, focus-visible, labels, ≥44px tap targets, numeric `inputmode` on number fields
- [ ] Migration + idempotent seed updated if the schema changed (see DB rules in AGENTS.md)
- [ ] `client_id` stamped on writes
- [ ] Playwright updated if a critical flow changed
- [ ] Preview deploy manually verified
- [ ] Conventional Commit PR title; PR template filled
- [ ] All required CI checks green

## Backend / API additions

- [ ] Auth **and** ownership re-checked inside the action/handler
- [ ] Input zod-validated; DTO-only returns (never a raw row)
- [ ] DAL boundary respected (no `db` / `process.env` outside `lib/dal`)
- [ ] Boundary tests: unauth → reject, wrong-owner → forbid, bad body → zod-reject
- [ ] Idempotency handled for mutations; typed errors + structured logging + Sentry
- [ ] zod schema / types updated; breaking changes flagged + versioned

## Database additions

- [ ] Generated SQL committed and reviewed (never `drizzle-kit push` to prod)
- [ ] Forward-only (no edits to applied migrations); one migration per PR
- [ ] Squawk lint passes; migration applies on empty Docker PG + a Neon branch; drift check clean
- [ ] Expand → contract for breaking changes; `lock_timeout` set; concurrent index isolated
- [ ] Backfill plan + rollback plan documented in the PR

## Test pyramid

Runner: **Vitest** (`pnpm test`) for unit / integration / component; **Playwright** for E2E
(added V0-11). Tests colocate as `*.test.ts(x)` next to the code they cover. Vitest runs in CI
(required check) and on `pre-push`.

**Speed budget (enforced by review).** Unit / integration / component tests are **fast — sub-second,
usually milliseconds** (the whole Vitest suite runs in well under a second). **E2E is the _only_ tier
allowed to take multiple seconds**, so keep it **minimal and very selective — a handful of critical
wiring smokes, nothing more.** Never reach for an E2E to cover what a fast integration/unit test can:
push correctness (idempotency, zod, ownership, edge cases) down to the fast tiers and let E2E prove
only that the pieces are wired together. A test that _needs_ seconds outside E2E is a design smell —
rewrite the coverage, don't accept the slowness.

- **Unit:** zod schemas, CSV re-aggregation, progression engine, pure utils
- **Integration:** Server Actions / Route Handlers — call as plain async fns, mock the DAL; against
  ephemeral Docker Postgres once the DB lands (V0-5+)
- **Component:** React Testing Library (jsdom) for the log forms
- **E2E:** a few critical flows only (Playwright). Authoring rules (learned the hard way in V0-11):
  - **Locate by role/label with `exact: true`.** `getByLabel`/`getByText` are substring +
    case-insensitive by default — "Weight" also matches "Log bodyweight" and "Set 1 weight". Scope by
    section (`getByRole('region', { name }).getBy…`) when a page repeats a label.
  - **Fix cold-start races at the source, not with big timeouts.** A first Server Action after a cold
    server boot is slow (JIT + first DB connection) and can flake. **Warm that path once in the setup
    project** so the coverage test runs warm under the **default** timeout. Never pad a timeout or rely
    on `retries` to hide a race — a `flaky` annotation is a bug to fix.
  - **Robust `webServer` command.** Prefer `pnpm --filter web exec next start -p <port>` or the `PORT`
    env over `pnpm run … -- -p` (the `--` gets forwarded literally and mis-parsed).
  - **Run it locally before pushing.** The e2e needs a real Postgres; when Docker/DB isn't available
    locally, every bug otherwise surfaces one-CI-round-at-a-time. See the local-run recipe in
    `docs/plans/v0-11-ci-postgres-playwright.md`.
