# Security

## Threat model

**Rewritten for many households (PRIV-1, 2026-10-07).** It previously described a single adult
operator and one family, which stopped being what is being built the moment Beta 0 meant "invite
other people's children".

**Actors.** Several **adult operators**, each owning a household (Clerk, after AUTH-1). **No child
accounts** — but **children use an adult's session on a shared phone**, so a kid tapping a tile is a
real user of this system, and the in-app profile tiles are a **UX switch, never a security boundary**.
A **coach** is a future cross-household grant (`COACH-1`, captured, not scoped). Two actors this file
previously left unstated and should not: the **operator/maintainer**, who has direct database access,
runs SQL by hand and leaves no audit trail — the most privileged actor here, and not a hypothetical
one; and the **unauthenticated internet caller**, which is why the `/api` matcher hole
([tech-debt](../docs/tech-debt.md)) is a live concern and not a tidy-up.

**BOLA/IDOR is still the #1 risk**, and it is now **between families**, not only between profiles
inside one household. **Kid bodyweight is still the one privileged field.** The future MCP/REST API is
consumed by an LLM (a Claude skill) via a **scoped machine token** — that clause is load-bearing for
"Tokens / secrets" and for the 403 carve-out under "API shape", so it stays.

> ⛔ **The scoping control is now code; the remaining controls are still operational.** `TEN-1` has
> landed, so every read and write that touches household data carries a household scope and the
> isolation is proved against a real database in both directions. Two things that does **not** mean:
> it is not **authorization** (`AUTH-1` is, and until then the principal is a shared access code),
> and it does not cover **`movements`**, which has no `household_id` column to scope by — proved, not
> assumed, and `TEN-2`'s to fix (see "Authorization" below).
>
> So the sequencing constraint stands and gains a third row: **no second household may exist in
> production before `TEN-1`, `AUTH-1` and `TEN-2` have all landed**
> ([beta-1.md](../docs/milestones/beta-1.md): _"Accepted with one family; a breach with two"_, and
> [ADR 0006](../docs/decisions/0006-household-addressing.md) makes it a constraint rather than a
> hope). It is also enforced in code until `AUTH-1`: the scope resolver **throws** on a second live
> household rather than picking one. What is and is not enforced is recorded once, in
> [docs/privacy/data-inventory.md](../docs/privacy/data-inventory.md) §4 — so this file does not carry
> a status that goes false on the next merge.

## Authorization (the top priority)

**These rules are MANDATORY for all new code.** They are not aspirations, and a new query that skips
them is a defect today, not a thing `TEN-1` will tidy up.

✅ **`TEN-1` has landed, and both call sites this paragraph used to name are scoped** —
`listProfiles()` through the single-sourced picker query and the export route through its three month
reads, each proved in **both** directions against a real database. Separately the seeded public ids
are fixed and zero-entropy, which `SEC-6` owns — so no code may ever treat a seed id as proof of
anything. **The violation list lives in exactly one place**,
[data-inventory.md](../docs/privacy/data-inventory.md) §4, so this file does not carry a status that
goes false the day a scope lands. Do not read the named exceptions below as permission to add another.

- All data access goes through the **server-only DAL** with ownership checks; every query that
  touches household data is scoped by `household_id`, through the **one named predicate**
  (`packages/db/src/writers/ownership.ts` → `isLiveProfile` / `inHousehold`) — never a copy. Never
  trust a `householdId` / `profileId` from the request body/params.
  - ⚠️ **That is `true` WITH ONE NAMED EXCEPTION, not `true`: `movements` has no `household_id`
    column at all**, so the strength form's free-text find-or-create (`findOrCreateMovementId`)
    cannot be scoped — there is nothing to scope by. TEN-1 chunk 1d **proved** the consequence in
    both directions rather than asserting it (`db:verify` → _"TEN-1 1d: the catalog verdict"_): one
    household is handed another's movement row; whoever types a name first pins that slug's
    `name` / `is_bodyweight` / `unit_default` for everyone, and the other household's own
    correctly-scoped Today card renders it; and a session write the household seam **refuses** has
    already committed its caller-supplied text to the shared catalog — a cross-tenant **write**
    primitive surviving its own refusal, which is categorically worse than a read leak. **That write
    primitive does not need a second household:** `logStrengthSession` runs `findOrCreateMovementId`
    _before_ the write core's in-transaction profile resolve (`apps/web/lib/dal/entries.ts`), so any
    gate-holder's session write, even one later refused for any reason, commits its catalog text;
    TEN-2 may move the find-or-create inside the transaction, after the profile resolves. **`TEN-2` is
    the fix** (a `household_id` column plus partial unique indexes; the leak closes when its third PR
    drops the global `slug` UNIQUE), and the recorded verdict is that it belongs in Beta 0, before a
    second household exists:
    [the plan](../docs/plans/ten-1-household-scope.md) → _"1d as built — the catalog verdict"_.
  - The one other deliberately unscoped read is `reportScopeMiss`'s **existence-only** probe (ADR
    0006 obligation 3): it returns `void` and is how the miss path tells `cross_household` from
    `unknown_resource`. Both exceptions are enforced as an allowlist with a reason per entry, not as
    prose — `apps/web/lib/dal/scoped.test.ts`.
  - ⚠️ **Scoping is not authorization.** Before `AUTH-1` the principal is a shared access code, so
    what holds today is _consistent scoping_: one household's data is unreachable from a request
    scoped to another. It does not prove the requester is who they claim. `AUTH-1` authorizes it,
    and this is the most likely thing on this page to over-read.
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

- `/v1` prefix; RFC 9457 Problem Details error shape; cursor pagination with a max limit.
- **Wrong household is a 404, not a 403 — and that is a rule about the id, not about the surface.**
  **403 only for an id inside the caller's own household that its scope does not permit; 404 for
  everything else**, on every surface. A least-privilege household-scoped token knows nothing about
  ids outside its household, so a 403 there is the same existence oracle as on a page — on the one
  surface whose output reaches an LLM. RFC 9457 wants a precise status, and that is the only case
  where precision leaks nothing. Human-facing surfaces (page, Route Handler, Server Action) must make
  "wrong household" and "no such id" the same answer, because an id an attacker holds came from a
  leak and 403 confirms the leak is live. Reasoning:
  [ADR 0006](../docs/decisions/0006-household-addressing.md) → "What a wrong-household request
  returns" — **Accepted: option A (session-only)** _(the maintainer, 2026-10-07; #252)_, and
  TEN-1's `db:verify` matrix is what proves the answer is the same for a wrong household as for an
  unknown id.
- **The 404 rule carries ONE explicit exception, and it is a different rule rather than a hole in
  this one** (ADR 0006 → "Forward compatibility", requirement 3). **An explicitly PUBLISHED resource
  answers `200` to a caller with no session.** Everything else 404s. Written here now, while nothing
  is published, because amending a security rule later — under pressure from the feature that needs
  it — is how the rule quietly becomes "whatever the feature does":
  - "Published" means a **deliberate projection a household chose to publish**, in its own
    unauthenticated namespace, with its own DTO. It is never a household-scoped resource reached
    without a scope, and never an existing route answering 200 because a scope failed to resolve.
  - The isolation rule is therefore **"no cross-household access except through an explicitly
    published projection"**, with the unpublished case proved exactly as strictly as before — which
    is the phrasing TEN-1's proofs already use, so a future `PUB-1` / `SHARE-1` / `SOCIAL-1` /
    `COACH-1` extends them instead of rewriting them.
  - **Nothing is published today.** No row above is in Beta 0, and this clause authorizes none of
    them.

## Transport / headers

- HSTS, nonce-based CSP (middleware), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`. Secure / HttpOnly / SameSite cookies.
- **CORS closed** — the LLM calls server-to-server, so no browser origin needs opening.

## Privacy (minors)

**The review this section used to defer has been done: [docs/privacy/](../docs/privacy/) (PRIV-1,
2026-10-07).** This section states the rule; it does not restate the findings.

- **The deferral's own trigger fired.** This section previously read "**No child accounts, no
  third-party sharing** — this is what keeps COPPA deferred; changing either triggers a privacy
  review." Child accounts are still out. **"No third-party sharing" was never true of the running
  system** — Neon, Vercel, GitHub Actions, Sentry and Upstash each receive a slice today, and Clerk
  and Google join at AUTH-1. So the trigger had fired, and the review is what discharges it rather
  than the sentence. (2025 FTC COPPA amendments: compliance by 2026-04-22.)
- **Data minimisation and a defined retention/delete path remain the rule.** The path now exists:
  [runbooks.md](../docs/runbooks.md) → "Delete a household and everyone in it".
- **Pointers, not copies** — one owner each, because this list had already drifted:
  - what is stored, every processor, retention, residuals →
    [data-inventory.md](../docs/privacy/data-inventory.md)
  - what we tell people → [notice.md](../docs/privacy/notice.md)
  - **"not legal advice"** → `notice.md` → About this notice. **One copy, there.** Bodily
    measurements of minors may be treated as health data under some laws; that question needs a
    lawyer and is not settled anywhere in this repository.
- **Re-review when** a new processor appears, a retention window changes, a new kind of personal data
  is stored, sign-in goes live, or anything becomes publicly visible. The standing engineering trigger
  is `AGENTS.md`'s privacy lens + `review-pr` rubric dimension 10; the deltas specific to this app are
  in `data-inventory.md`'s header.
- 🔴 **Personal data is committed to this public repository** — two minors' given names across ~50
  files, and log-row identifiers with weigh-in timestamps. Inventoried in `data-inventory.md` §9;
  the fix is `OSS-1`, a **Beta 0 blocker**. A rename is not a removal: `git log -S` still finds it.

## Logging

- Never log tokens, secrets, PII, or bodyweight. Audit sensitive/mutating actions (actor, action,
  resource, timestamp), kept separate from the data.

## Rate limiting

- `@upstash/ratelimit` (sliding window) on auth, mutations, `/api/sync`, and the LLM-facing API.
  In-memory counters don't work on serverless.

## Supply chain

- Commit the lockfile; CI uses `--frozen-lockfile`; Dependabot with a cooldown / min-age
  (post-Shai-Hulud); minimize dependencies.
- **A `high` or `critical` advisory in the PRODUCTION dependency tree fails the build** (SEC-5,
  [plan](../docs/plans/sec-5-verify-in-ci.md)); this is the one statement of the rule. **Scope** is
  the `--prod` tree only, the **threshold** is `high`, and the **trigger** is every pull request and
  every push to `main` — `pnpm audit:check` in `ci.yml`'s `quality` job, the same command local
  `pnpm verify` runs, so there is one definition and not two. The dev tree is deliberately **not**
  gated: it holds a `high` whose patched version was never published, so gating it would wedge `main`
  with no edit that unwedges it ([tech-debt](../docs/tech-debt.md)).
  - **Enforced** by `check-audit.mjs`, which also fails when it **could not check** — an unparseable
    or incoherent report, or a committed setting that disarmed the audit. The only lenient case is an
    unreachable registry on a PR that changes no dependency input, which warns: a registry outage must
    not be a merge outage. It is never lenient on `main`. The guard's header has the mechanics.
  - **There is no suppression mechanism** (deferred to SEC-5c). Until one exists, the escape from a
    production advisory is to fix it, re-classify the dependency as dev if that is honest, or merge
    red. And an advisory's `patched_versions` is never evidence that a fix exists — pnpm infers that
    field, and this repo's own `braces` high names a version that was never released.
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
