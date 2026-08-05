# V1-14a — hardening: gate rate limit, Sentry (PII-scrubbed), dependency cooldown

> Backlog: [plan.md](../plan.md) row V1-14, **part A of a split**. Branch: `feat/v1-14a-hardening`
> (off `main`). **Pure app code — no migration.** Significant (touches every Server Action, CI, and
> env validation) → committed plan + panel before implementation.

## Why this is split

V1-14's row bundles **(a)** operational hardening and **(b)** a full-day Playwright E2E asserting "CSV
diffs clean". (b) cannot exist before **V1-13 CSV export**, which is blocked on the four legacy CSV
samples only Ray has. (a) has no such dependency. **V1-14b** lands with or after V1-13.

## Goal

Every Server Action is a **public POST**, nothing is rate-limited, and no error is reported anywhere —
an exception renders `error.tsx` and vanishes. AGENTS.md requires both; [ADR-0001](../decisions/0001-observability-and-web-vitals.md)
already schedules Sentry for **V1-14**. This PR executes that decision.

## What the panel changed (summary; full log at the end)

The first draft rate-limited **mutations, keyed by `profileId`**. Both halves were wrong:

- `profileId` is `formData.get('profileId')` — **caller-supplied, unauthenticated**. An attacker rotates
  a UUID per request for a fresh bucket. And because real ids are non-enumerable UUIDv7 (SECURITY.md's
  anti-IDOR design), an attacker _cannot_ land in a real bucket even by accident. The limit would have
  constrained only the three legitimate users.
- The one endpoint that genuinely needs a limit — **`submitGate`, an unauthenticated password oracle
  for the app's only shared secret** — has no `profileId`, so the draft gave it **no limit at all**.
  SECURITY.md lists "auth" first in its rate-limit line.

**Reshaped:** rate-limit the **gate only**, keyed by the **Vercel-set client IP**. Mutation limits defer
to **v1.5/Clerk**, where `getCurrentUser()` provides a real identifier and AGENTS.md's line becomes
implementable as written. Recorded in [tech-debt.md](../tech-debt.md).

## Design decisions

**H1 — Rate-limit the GATE, keyed by client IP.** `@upstash/ratelimit` sliding window, 10 attempts /
10 min. The identifier is `ipAddress({ headers })` from **`@vercel/functions`** (already a dependency),
which reads `x-real-ip` — **set by Vercel Proxy, not the client**, so it is not spoofable at the app
layer (this refutes the first draft's premise). Rejected alternatives: `profileId` (forgeable, above);
the `mp_gate` cookie (a deterministic SHA-256 of the shared code — every household member _and_ every
attacker who has the code share one bucket, and an attacker who lacks it sends no cookie at all, so the
brute-forcer we're limiting lands in a single `undefined` bucket).

**H2 — Fail-OPEN, fast.** A personal training log's availability outranks its limit. `@upstash/ratelimit`
already fails open on network trouble via `timeout` — but its **default is 5000 ms**, which is a
5-second hang on a phone, blowing ADR-0001's INP budget. Set `timeout: 800`, plus `analytics: false` and
a module-level `ephemeralCache`. A `try/catch → allow` covers non-timeout failures (bad token throws
rather than times out). The fail-open path emits a Sentry **breadcrumb**, so a permanently-dead limiter
is visible rather than silent.

**H3 — Unconfigured ⇒ no-op.** Local dev, CI, and pre-wiring previews legitimately have no Upstash
credentials. Absent env ⇒ `checkRateLimit` returns "allowed" and the app behaves exactly as today. The
absence path is the _tested_ path.

**H4 — Sentry PII scrubbing is the security-critical half of this PR.** Verified in the SDK source:
the documented wiring would ship **three** things to a third party.

1. `withServerActionInstrumentation(name, { headers }, cb)` copies **every** header into the isolation
   scope. With `sendDefaultPii: false`, `requestDataIntegration`'s non-PII default is
   `cookies: { deny: PII_HEADER_SNIPPETS }` — an object, **not** `false` — so cookies are **included**,
   and **`mp_gate` matches none** of the SDK's sensitive-name snippets. That cookie is the app's entire
   credential. → **Never pass `headers`.** Its only benefit is trace continuation from a browser SDK we
   do not ship.
2. `options.formData` does `setExtra('server_action_form_data.'+key, value)` — for
   `logBodyweightAction` that is **a kid's bodyweight and notes**; for `submitGate`, **the plaintext
   access code**. SECURITY.md: "Kid bodyweight is privileged… never logged." → **Never pass `formData`,
   never `recordResponse`.**
3. `onRequestError = Sentry.captureRequestError` independently does `headersToDict(request.headers)` →
   the same cookie leak, _even if_ (1) is avoided.

→ A `beforeSend`/`beforeSendTransaction` scrubber in `sentry.server.config.ts` deletes
`event.request.cookies`, the `cookie`/`authorization` headers, and any `server_action_form_data.*`
extras. Belt-and-braces, because neither `sendDefaultPii: false` nor Sentry's scrubber catches
`mp_gate`. **Unit-tested** — this is the assertion that matters most in the PR.

**H5 — Expected errors stay silent FOR FREE.** Every action `return`s its typed envelope rather than
throwing, so `handleCallbackErrors` never sees a throw and `captureException` never fires. No filtering
or error taxonomy is needed. (`submitGate`'s `redirect()` does throw, and the SDK's
`isRedirectNavigationError` branch already skips capture.) The draft called this "the most important
behavioural line"; it is actually a property inherited from the envelope convention — asserted by one
test rather than engineered.

**H6 — Wrap INSIDE each function body, not with a HOF.** `use-server-exports.test.ts` asserts every
export in a `'use server'` file matches `^export (default )?async function` — so
`export const x = withSentry(...)` **fails a committed test by design** (the Server Actions compiler
registers every export as an action reference). Each action becomes
`return await withServerActionInstrumentation(NAME, async () => { …existing body… })`. The `await` is
load-bearing: the SDK returns `Promise<ReturnType<A>>` = `Promise<Promise<ActionState>>`.

**H7 — Next 16 file layout.** The "three configs" of the draft is the pre-15.3 layout. For Next 16.2.10:
`apps/web/instrumentation.ts` (`register()` switching on `process.env.NEXT_RUNTIME`, plus
`export const onRequestError`), `sentry.server.config.ts`, `sentry.edge.config.ts`, and
`withSentryConfig` wrapping `next.config.ts`. All at the **`apps/web` root** — tool-mandated, which
AGENTS.md's hierarchy rule permits. **No `instrumentation-client.ts`**: the CSP is `connect-src 'self'`,
so a browser SDK's ingest POST would be silently blocked. Front-end capture is deferred (see below).

**H8 — `process.env` carve-outs, stated not smuggled.** The Sentry configs import `@/lib/env` (they load
server-side, so `server-only` doesn't trip). New optional server vars: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG`, `SENTRY_PROJECT`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. The **one**
exception is `process.env.NEXT_RUNTIME` inside `register()` — Next's own convention, before env
validation can run.

**H9 — Dependabot cooldown.** `.github/dependabot.yml` with explicit `cooldown` day counts, so a freshly
published (possibly compromised) version isn't auto-PR'd on day zero. Grouped minor/patch to keep PR
volume sane at 4h/wk. The one deliverable here needing no account and carrying zero runtime risk.

**H10 — Accept double-capture, deliberately.** `withServerActionInstrumentation` captures **and**
re-throws; Next then routes the same error to `onRequestError`, which captures again. Two issues per
thrown action error. Accepted: `onRequestError` is the only capture path for RSC/route-handler errors,
which the ADR wants, and the duplication is cosmetic at this volume.

## File-by-file changes

| File                                                             | Change                                                                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/rate-limit.ts`                                     | **new** — `checkRateLimit()` seam + limit constants (app-only per AGENTS.md's blast-radius rule; **not** `packages/shared`, which is for zod/DB-seed-feeding domain values) |
| `apps/web/lib/rate-limit.test.ts`                                | **new** — allows unconfigured; allows on error (fail-open); blocks past limit with a mocked limiter                                                                         |
| `apps/web/app/gate/actions.ts`                                   | IP-keyed limit → existing `GateState` envelope, never a throw                                                                                                               |
| `apps/web/app/p/[profileId]/actions.ts`                          | wrap all 6 actions in-body (H6)                                                                                                                                             |
| `apps/web/instrumentation.ts` · `sentry.{server,edge}.config.ts` | **new**, at `apps/web` root (H7)                                                                                                                                            |
| `apps/web/lib/sentry-scrub.ts` + `.test.ts`                      | **new** — the PII scrubber, unit-tested (H4)                                                                                                                                |
| `apps/web/next.config.ts`                                        | `withSentryConfig`, source maps only when `SENTRY_AUTH_TOKEN` is set                                                                                                        |
| `apps/web/lib/env.ts`                                            | six new **optional** server vars                                                                                                                                            |
| `apps/web/.env.example` · `docs/deploy.md`                       | document every var + where it is set                                                                                                                                        |
| `.github/dependabot.yml`                                         | **new** — cooldown + grouping                                                                                                                                               |
| `docs/tech-debt.md`                                              | mutation rate limits deferred to Clerk/v1.5                                                                                                                                 |
| `docs/plan.md` · `docs/status.md`                                | split the row into V1-14a / V1-14b, link this plan                                                                                                                          |

## Test plan

- **Unit:** the scrubber removes cookies/auth headers/`server_action_form_data.*` (the security
  assertion); `checkRateLimit` allows unconfigured, allows on thrown error, blocks past limit.
- **Boundary:** a rate-limited gate submit returns the typed envelope, never a throw — a 429 rendering
  `error.tsx` would be worse than no limit.
- **Regression:** `use-server-exports.test.ts` and all existing action tests stay green (the wrapper must
  be transparent).
- **Manual, post-credentials** (documented in `docs/runbooks.md`): trigger a deliberate error on preview
  → confirm it lands in Sentry **without** a cookie; hammer the gate → confirm the typed envelope.

## Risks / rollback

- **Cannot be fully verified without credentials.** The absence path and a mocked limiter are provable;
  a real Upstash round-trip and a real Sentry delivery are not. Stated plainly rather than implied.
- `withSentryConfig` adds build time and, on Turbopack, enables production source maps — watch CI
  `next build` wall time.
- Rollback: remove the env vars (everything no-ops) or revert one commit.

## Out of scope (→ later)

The full-day E2E + CSV diff (**V1-14b**, needs V1-13); **mutation rate limits** (v1.5/Clerk — no real
identifier exists before then); `/api/sync` and LLM limits (no endpoints yet); **front-end Sentry**
(ADR-0001 §1 wants it, but `connect-src 'self'` in `proxy.ts` blocks the ingest POST — needs a CSP entry
or `tunnelRoute` first; deferred explicitly rather than shipped broken); session replay, tracing, Speed
Insights, alerting rules.

---

## Panel review log — reconciled

Single-pass, three lenses (correctness/security · simplicity/scope · architecture). Every claim below was
**independently verified against the source before acceptance**.

- **BLOCKING — the `profileId` limit key is forgeable** (verified: `formData.get('profileId')` in every
  action). Rekeyed to the Vercel-set client IP; verified `@vercel/functions@3.7.5` is installed and its
  `IP_HEADER_NAME = "x-real-ip"` is documented as "Client IP as calculated by Vercel Proxy". My "spoofable
  at the app layer" premise was wrong for Vercel.
- **BLOCKING — the draft left `submitGate` unlimited**, i.e. it shipped a rate limiter covering
  everything _except_ the unauthenticated password oracle. Reshaped so the gate is the only limit.
- **BLOCKING — the documented Sentry wiring leaks the `mp_gate` cookie, kids' bodyweight, and the
  plaintext access code** (traced through the SDK: `requestDataIntegration`'s non-PII cookie default is
  a deny-_object_, not `false`, and `mp_gate` matches none of its sensitive-name snippets). → H4.
- **BLOCKING — the plan didn't follow `plans/README.md`** (no file-by-file table, test plan, or risks).
  Added.
- **VALUABLE — cut mutation rate limiting entirely.** Near-zero value against the real threat model
  (3-person household, shared cookie, unlisted URL), while costing a Redis round-trip on every gym-floor
  tap. Deferred to Clerk.
- **VALUABLE — "fail-open" was really "fail-hang":** Upstash's `timeout` default is 5000 ms. → H2.
- **VALUABLE — "the standard three configs" is the pre-15.3 layout**; corrected for Next 16.2.10. → H7.
- **VALUABLE — limit constants belong in `apps/web`, not `packages/shared`.** I misapplied the
  blast-radius rule: `shared` is for values feeding zod + types + the DB seed; a requests-per-window
  number is an app-only policy value like `COOKIE_MAX_AGE`.
- **VALUABLE — a HOF wrapper would fail a committed test** (verified in `use-server-exports.test.ts`,
  which asserts `^export (default )?async function`). → H6.
- **Corrected overstatement:** H4's "expected errors stay silent" is inherited from the envelope
  convention, not engineered. Reworded (H5).
- **MINOR accepted:** double-capture (H10); CSP blocks front-end Sentry (out of scope, recorded);
  `.env.example` lives at `apps/web/.env.example`; Dependabot needs explicit day counts, not "a window".
