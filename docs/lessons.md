# Lessons log — recurring gotchas & their fixes

A terse, **scannable** record of failures that cost more than one attempt to diagnose, so the next
person (or agent) fixes them in one. Read this **before** debugging a CI / test / build failure —
grep for the symptom. Keep entries to 1–3 lines: **Symptom → Cause → Fix**. Newest on top within a
section. This is a debugging index, not prose — link out to a plan/ADR for depth.

## E2E / Playwright

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
  front-load robustness. Future fix: embedded-postgres / throwaway Neon branch. See
  [docs/plans/v0-11-ci-postgres-playwright.md] and the `no-docker-local-e2e` memory.

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
