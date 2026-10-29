- **2026-10-29** — **The test session seam: `e2e:local`, `screenshot:ephemeral` and CI's smoke can
  now reach a page that calls `requireSession()`, with no Clerk keys and no egress to Clerk.** This
  lands before the call sites convert, because the evidence loop otherwise breaks in the same commit
  as the control it has to photograph: `scripts/capture.ts` would land on `/sign-in`, taking the
  three-width screenshots AGENTS.md requires and `e2e/a11y.spec.ts`'s four routes with it.
  **It is an authentication bypass in production code**, so the design is the point.
  🔴 **The gate is a POSITIVE proof of "local throwaway", keyed on DATABASE LOCALITY — not on
  `process.env.VERCEL`.** The first draft used `VERCEL` and was **default-OPEN**: those are Vercel
  _system_ variables gated on the project's "Enable access to System Environment Variables" toggle,
  so with it off the guard silently no-ops and every unauthenticated request gets a stand-in
  principal. `db-environment.ts` already records this, and OPS-1 re-keyed its own guard off locality
  for exactly that reason — the draft reintroduced the dependency OPS-1 removed, for a more dangerous
  control. Both review panels caught it independently.
  🔴 **It refuses at module IMPORT, not per request.** A request-time throw lets a mis-wired
  deployment build green and promote; the failure is then found by whoever hits a gated route rather
  than by the deploy that caused it. This joins `assertDatabaseEnvironment` at module scope, where a
  failure is a build-log failure.
  ⚠️ **The tests found the guard's real contribution, which is narrower than it looks.** On a remote
  database OPS-1 refuses first, so the bypass never gets a say. The case this guard uniquely closes
  is **`ALLOW_LIVE_DB=1` with a remote database** — `pnpm dev:prod`, which exists to point a local
  process at live Neon on purpose. A bypass keyed only on "not Vercel" would arm there and hand a
  stand-in principal real household data on a developer's laptop.
  **Containment:** one armer (`lib/env.ts`), one reader (`lib/dal/session.ts`), two injectors, pinned
  by `apps/web/test/bypass-is-contained.test.ts` on the helper 1b-bis extracted. `session.ts` never
  touches `process.env` for this, so it cannot skip the locality check. Two limits are named rather
  than papered over: the sweep is rooted at `apps/web` so `ci.yml` is outside it, and no source scan
  sees `process.env[dynamicKey]` — the boot refusal is what contains that.
  **The harnesses now BLANK the Clerk, Upstash and Sentry variables** instead of inheriting them.
  Both spread `...process.env` and `next start` reads `.env.local`, which `lib/env.ts` says will hold
  dev Clerk keys from 1c — so "no keys, no egress" was a property of the developer's machine, not of
  the harness, and `e2e/theme.spec.ts`'s zero-egress assertion would have gone red locally. That
  assertion is **one-way**: once a Clerk host is legitimately contacted it can never catch a
  regression again.
  ⚠️ **`sessionLogin()` is retracted, not implemented.** 1c-pre promised it; an env-level bypass
  authenticates every request in a run, so a per-page helper would do nothing — and a helper that
  does nothing is worse than none. The other half of that panel finding stands: no combined
  `login()`, and `@clerk/testing` stays out of `capture.ts`'s module graph.
