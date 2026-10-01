# Security

## Threat model

Single adult operator (Clerk) + in-app profiles for the adult + 2 kids (**no child accounts**).
**BOLA/IDOR is the #1 risk** given the multi-profile household. **Kid bodyweight is the one
sensitive field.** The future MCP/REST API is consumed by an LLM (a Claude skill) via a scoped
machine token.

## Authorization (the top priority)

- All data access goes through the **server-only DAL** with ownership checks; every query is scoped
  by `household_id`. Never trust a `householdId` / `profileId` from the request body/params.
- Public/URL/API IDs are **UUIDv7** (non-enumerable → anti-IDOR).
- **Middleware is NOT the auth boundary** (CVE-2025-29927) — the real checks live in the DAL, on
  every read and write. Keep Next.js patched.

## Sensitive data

- Kid **bodyweight** is privileged: never returned outside the household operator, never logged,
  never included in the LLM/MCP payload unless a scoped, explicit purpose requires it.

## Input

- zod at every trust boundary; whitelist mutable fields (`zod .pick` — no mass assignment).
- Drizzle parameterized queries only (no `sql.raw` / string interpolation). No `dangerouslySetInnerHTML`.

## Tokens / secrets

- The MCP/REST token is a **separate, org-scoped, least-privilege (reads + one narrow write),
  revocable Clerk API key — NEVER the human session.** Rotation = revoke + reissue. Idempotency-Key honored.
- Secrets live in Vercel env; only the DAL reads `process.env`; no secret gets a `NEXT_PUBLIC_` prefix.

## CI / Actions secrets

- **`CLAUDE_CODE_OAUTH_TOKEN`** (a Claude subscription token from `claude setup-token`) is held only by
  `.github/workflows/claude-review.yml`, which runs **only when a writer comments `@claude review`**
  on a PR. Rotation: [runbooks.md](../docs/runbooks.md) → "Rotate a secret".
- The job that holds it runs the model with a **read-only** GitHub token (the action writes that
  token where the model can read it). The model can read the workspace and edit one file: no shell,
  no network. Reads outside the working directory are refused by `blockReadsOutsideWorkingDirectories`
  (probed on the pinned CLI), which closes `/proc/*/environ`, where the OAuth token lives. Posting happens in a separate job with no model and no PR code.
- The PR head is **data**: SHA-pinned, symlinks off, PR-authored agent config renamed `*.pr-data`,
  never installed or run (`.github/scripts/review-prefetch.sh`). The prefetch **fails closed** if the
  base branch carries `.claude/settings.local.json`, `.mcp.json`, or a `.claude/settings.json` with
  anything but the **hash-pinned** copy whose hooks no-op under CI, because the model job would load
  them. The action re-fetches that config from `main` mid-run, so the job also withholds the review if
  what the CLI loaded differs from what was guarded, including a config file that is new on `main`.
- **Accepted residual:** the pinned action installs the Claude CLI with `curl … | bash` inside the
  step that holds the token, verified only against a checksum from the same host. The action SHA does
  not pin that download. It is the vendor that issued the token, so it is accepted, not mitigated. The
  mitigation, if ever needed, is a secret-free prior step that fetches the binary against a committed
  sha256 and passes `path_to_claude_code_executable`. A `claude-code-action` bump is its own PR and
  is re-verified by hand ([runbooks.md](../docs/runbooks.md) → `CLAUDE_CODE_OAUTH_TOKEN`, step 6).
- Threat model and both panel rounds: [DX-1 plan](../docs/plans/dx-1-claude-review.md).

## API shape

- `/v1` prefix; RFC 9457 Problem Details error shape; cursor pagination with a max limit; 403 on
  wrong household.

## Transport / headers

- HSTS, nonce-based CSP (middleware), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`. Secure / HttpOnly / SameSite cookies.
- **CORS closed** — the LLM calls server-to-server, so no browser origin needs opening.

## Privacy (minors)

- Data-minimization + a defined retention/delete path. **No child accounts, no third-party sharing**
  — this is what keeps COPPA deferred; changing either triggers a privacy review. (2025 FTC COPPA
  amendments: compliance by 2026-04-22.)

## Logging

- Never log tokens, secrets, PII, or bodyweight. Audit sensitive/mutating actions (actor, action,
  resource, timestamp), kept separate from the data.

## Rate limiting

- `@upstash/ratelimit` (sliding window) on auth, mutations, `/api/sync`, and the LLM-facing API.
  In-memory counters don't work on serverless.

## Supply chain

- Commit the lockfile; CI uses `--frozen-lockfile`; Dependabot with a cooldown / min-age
  (post-Shai-Hulud); `pnpm audit` gate; minimize dependencies.
- **Every GitHub Action is pinned to a full commit SHA with a bare `# vX.Y.Z` comment** (SEC-2,
  [plan](../docs/plans/sec-2-pin-actions.md)); this is the one statement of the rule. A tag can be
  moved by whoever controls it, and `migrate.yml` holds the prod DB credential. Nothing may follow the
  version, because Dependabot rewrites the comment only when it ends with it.
  - **Enforced** by `check-action-pins.mjs`: offline in `pnpm verify` (`actions:check`) and on every CI
    run, plus `--resolve` in CI's `quality` job when a workflow changes (the step says exactly when).
    `--resolve` requires each SHA to **equal** its version tag's commit in the canonical repo. A fork's
    commit is reachable through the parent's path, so a SHA that merely exists proves nothing.
  - **Residual risks:** a remote composite action can still pull its own actions by tag; pinning only
    freezes them at that commit. CI runs the PR's own copy of the guard, so it catches mistakes, not a
    hostile author (deliberately crafted YAML can also get past its line scanner): **a diff touching
    the guard, its step, or a workflow's YAML in an unusual shape is itself a review flag**.
- **Committed Claude Code settings** (`.claude/settings.json`): stricter than "only hooks that no-op
  under CI". The file is **hash-pinned**, so ANY change, even a CI-no-op hook, fails the review
  workflow until the pin is re-read and updated. See "CI / Actions secrets" above; it is the one
  statement of the rule.
