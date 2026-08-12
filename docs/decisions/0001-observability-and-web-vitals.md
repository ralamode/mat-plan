# ADR 0001 — Observability & front-end quality

**Status:** Accepted · **Date:** 2026-07-20 · **Scope:** later phases (tooling deferred; conventions apply now)

## Context

We want to understand and dashboard three things: **API request/error behaviour**, **DB health**, and
**front-end errors + performance** — plus a standing commitment to **front-end best practices (Core Web
Vitals)**. Built at ~4h/wk, so: minimize tool sprawl, prefer first-party / low-config tools with
generous free tiers, one tool per job. Error-handling _shape_ is already decided in
[../../AGENTS.md](../../AGENTS.md) (typed envelopes, `withServerActionInstrumentation`, RFC 9457 for the
public API); this ADR is the **tooling / dashboard layer** on top.

## Decision

### 1. Errors + tracing (front-end **and** back-end) → **Sentry**

One tool across the stack, already named in the AGENTS server conventions:

- **Front-end:** browser SDK — unhandled JS errors, React error-boundary capture, (optional) session
  replay on errors.
- **Back-end:** Server Actions wrapped in `withServerActionInstrumentation`; Route Handlers; **performance
  tracing** (per-request transactions/spans → latency, error rate, slowest endpoints) — this _is_ the API
  request/error dashboard. DB queries show up as spans, so slow queries surface in traces.
- `enableLogs` + structured context (`userId`, `householdId`, `batchId`). **Never** send tokens, PII, or
  bodyweight (see SECURITY.md).

### 2. Front-end performance / Core Web Vitals → **Vercel Speed Insights + Web Analytics**

First-party, near-zero-config real-user monitoring: route-level **LCP / INP / CLS / TTFB** + traffic.
This is the Core Web Vitals dashboard. (Sentry also captures Web Vitals; we keep Vercel as the primary
CWV RUM and Sentry for error/trace correlation, to avoid two CWV dashboards.)

#### Amendment (Ray, 2026-08-11): deferred to the production cutover, and **production-ONLY when it lands**

Still not installed, and deliberately so — it now waits for production rather than the V1-12 perf pass.
"Near-zero-config" is **not** true in this repo. None of the points below is a blocker, but each one
fails **silently** if missed — no build error, no crash, just an empty dashboard or noise in a console
nobody trusts any more.

**1. It must not mount outside production.** Not a preference — outside prod it is pure noise:

- the script is **blocked by our CSP** (below), so every dev/preview page load logs a console CSP
  violation. Console errors that are expected are console errors that get ignored, including the real
  ones. That is the whole reason for this constraint.
- preview and local traffic would pollute the very p75 the budget above is measured against.

So gate the mount, and gate it **through `lib/env.ts`** — AGENTS.md forbids reading `process.env`
outside the DAL / that module, so a bare `process.env.VERCEL_ENV` check in `layout.tsx` is not the way.
Add a validated, **optional** var (absent ⇒ feature off), matching the V1-14a precedent where every
hardening var is optional so `pnpm dev` and CI behave exactly as before. Render `<SpeedInsights/>` only
when it is on. Note `@vercel/speed-insights` injects a _debug_ script in dev rather than no script, so
"it disables itself in development" is **not** something to rely on.

**2. Our CSP will block it unless the nonce is threaded.** `proxy.ts` sets
`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`. **`'strict-dynamic'` makes browsers ignore
`'self'` entirely** — only a script carrying the nonce, or injected by one that does, executes. There is
no precedent to copy: Sentry here is server-side only, so this would be the app's **first** third-party
client script, and `layout.tsx` has no nonce plumbing today. `connect-src 'self'` is already fine, since
the beacon posts to same-origin `/_vercel/speed-insights/vitals`.

**3. Confirm what it reports for `/p/[profileId]` before enabling.** Routes carry a profile UUID, and
`profileId` is currently the only thing gating who can read a kid's data (the BOLA gap
[SECURITY.md](../../.github/SECURITY.md) documents until Clerk). Verify it sends the **route pattern**,
not the resolved URL — this ADR's own "never send PII" line makes that a check, not an assumption. If it
sends resolved URLs, that is a decision to bring back to Ray, not to absorb.

**Verification when it ships:** load a production page, confirm the beacon fires with **no** CSP
violation in the console, then confirm a preview deploy renders **no** Speed Insights script at all.

### 3. Structured-log dashboard → **Vercel Observability** now; **Axiom** (log drain) if we outgrow it

Vercel's built-in function logs + Observability cover immediate needs. If we need queryable log
dashboards/alerts beyond Sentry, add **Axiom** (or Better Stack) via a **Vercel Log Drain** — cheap,
strong Vercel integration. Deferred until the need is real.

### 4. DB health → **Neon console + `pg_stat_statements`**

- Neon dashboard (first-party, free): connections, compute/autoscaling, data size, query insights.
- Enable **`pg_stat_statements`** for slow-query analysis.
- App-side: Drizzle query logging in dev; pool-exhaustion / slow-query signals flow into Sentry.

## Phasing (tooling)

| Capability                                     | Tool                              | Lands                                                                        |
| ---------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Typed error envelopes + structured log _shape_ | (convention, no tool)             | now (AGENTS.md)                                                              |
| Error monitoring + API tracing (FE+BE)         | Sentry                            | **V1-14** (pull earlier if errors bite)                                      |
| Core Web Vitals RUM + analytics                | Vercel Speed Insights / Analytics | **production cutover** (Ray, 2026-08-11) — prod-ONLY mount; see §2 amendment |
| DB metrics                                     | Neon console                      | now (zero code)                                                              |
| Slow-query insight                             | `pg_stat_statements`              | with real data (V1)                                                          |
| Queryable log dashboards                       | Axiom via Vercel Log Drain        | only if needed                                                               |

## Front-end best practices (standing commitment)

Follow web best practices wherever they don't fight scope discipline:

- **Core Web Vitals budget** (p75, mobile): **LCP < 2.5 s · INP < 200 ms · CLS < 0.1**. Measured via
  Speed Insights.
- **RSC-first** (minimize client JS), stream where useful, `next/image` + `next/font` (already used) to
  prevent layout shift / font FOUT, prefetch links, no render-blocking third-party scripts (CSP is
  already strict). Keep bundles lean; code-split heavy client islands.
- **Lighthouse + axe** checks at the a11y/perf pass (**V1-12**); regressions on the budget are a review
  concern, not an afterthought.

## Consequences

- Three core tools (Sentry, Vercel Speed Insights, Neon console) cover FE+BE errors, tracing, Web Vitals,
  and DB health with almost no bespoke code; Axiom stays gated behind a real need.
- The Core Web Vitals budget becomes a durable convention (mirrored in AGENTS.md UI PR rules), so
  performance is designed in, not bolted on.
