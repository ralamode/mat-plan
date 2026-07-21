# Debugging lessons

A running log of concrete past failures → root cause → fix, so agents (and humans) can check here
**before** deep-diving a green-turns-red failure. This complements
[definition-of-done.md](./definition-of-done.md), which holds the general _rules_ — this file holds
the specific _incidents_. When you diagnose a non-obvious failure, append an entry (symptom → cause →
fix, ≤3 lines) under the right `##` area; link the authoritative rule, don't restate it.

## CI / Playwright E2E

- **Playwright `webServer` never boots** ("Invalid project directory … `/apps/web/-p`"):
  `pnpm --filter web start -- -p 3100` forwards `-- -p 3100` literally to `next start`, which reads
  `-p` as a project dir. Fix: `pnpm --filter web exec next start -p <port>` (flag forwarded intact) or
  the `PORT` env var.
- **`getByLabel`/`getByText` strict-mode violation** (matched 3 elements): they are substring +
  case-insensitive by default, so "Log **bodyweight**" / "**Weight**" / "Set 1 **weight**" all match.
  Fix: `{ exact: true }` and/or role-scoped queries (`getByRole('region', { name }).getBy…`).
- **E2E passes only on retry (`flaky`)**: the post-submit assert awaits a full round-trip (Server
  Action → DB → `revalidatePath` → RSC re-render), which on the cold first CI request exceeds
  Playwright's default 5s `expect` timeout; `retries: 1` masks it. Fix: generous timeouts (10s global +
  15s on the round-trip assert); treat a `flaky` annotation as a bug, not noise.

## Secret scanning (gitleaks)

- **gitleaks false-positive on a non-secret CI placeholder**: `ci-e2e-placeholder-1234`'s digits
  pushed entropy over the generic-api-key threshold (the older `ci-build-placeholder` slipped under).
  Fix: committed `.gitleaks.toml` with `[extend] useDefault = true` allowlisting the specific lines via
  `regexTarget = "line"` — a tight regex, **not** a path exclusion, so real secrets are still caught.

## Commits & hooks

- **commitlint rejects a non-lowercase subject**: `@commitlint/config-conventional` requires the
  Conventional Commit subject start lowercase — `add …`, not `Add …` / `CI …`. Fix: lowercase the
  first word. See `## Git & branch workflow` in [AGENTS.md](../AGENTS.md).
- **pnpm 11 hard-errors on blocked build scripts** (esbuild/sharp/unrs-resolver): pnpm blocks native
  install/build scripts by default and fails CI. Fix: allowlist them under `allowBuilds:` in
  `pnpm-workspace.yaml`.

## Next.js 16

- **`middleware.ts` no longer runs**: Next 16 renamed Middleware → **`proxy.ts`** (export
  `async function proxy(req)` + `export const config = { matcher }`). Nonce-based CSP additionally
  requires dynamic rendering (root layout `export const dynamic = 'force-dynamic'`). See
  `apps/web/proxy.ts`.
