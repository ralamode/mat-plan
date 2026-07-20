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

### 3. Structured-log dashboard → **Vercel Observability** now; **Axiom** (log drain) if we outgrow it

Vercel's built-in function logs + Observability cover immediate needs. If we need queryable log
dashboards/alerts beyond Sentry, add **Axiom** (or Better Stack) via a **Vercel Log Drain** — cheap,
strong Vercel integration. Deferred until the need is real.

### 4. DB health → **Neon console + `pg_stat_statements`**

- Neon dashboard (first-party, free): connections, compute/autoscaling, data size, query insights.
- Enable **`pg_stat_statements`** for slow-query analysis.
- App-side: Drizzle query logging in dev; pool-exhaustion / slow-query signals flow into Sentry.

## Phasing (tooling)

| Capability                                     | Tool                              | Lands                                                      |
| ---------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| Typed error envelopes + structured log _shape_ | (convention, no tool)             | now (AGENTS.md)                                            |
| Error monitoring + API tracing (FE+BE)         | Sentry                            | **V1-14** (pull earlier if errors bite)                    |
| Core Web Vitals RUM + analytics                | Vercel Speed Insights / Analytics | as soon as real UI exists (≥ V0-7; target V1-12 perf pass) |
| DB metrics                                     | Neon console                      | now (zero code)                                            |
| Slow-query insight                             | `pg_stat_statements`              | with real data (V1)                                        |
| Queryable log dashboards                       | Axiom via Vercel Log Drain        | only if needed                                             |

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
