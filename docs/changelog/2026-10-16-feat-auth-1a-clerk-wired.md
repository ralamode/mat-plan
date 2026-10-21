- **2026-10-16** — **AUTH-1 1a: Clerk is wired, and dark** ([plan](../plans/auth-1-clerk-google.md)).
  `@clerk/nextjs@7.9.15` (pinned exactly; 10 transitive packages, no install scripts) ships to
  production with **both keys optional** in `lib/env.ts`, so the app behaves exactly as it did before
  — and "dark" is a branch in our own code, not a vendor behaviour we hoped for: `lib/clerk.ts`
  refuses to render `<ClerkProvider>` or compose `clerkMiddleware()` unless both keys are present. It
  had to be, because at this version Clerk's provider **throws** on a missing publishable key when its
  keyless path is live, which would have been a 500 on every route of `pnpm dev`. `next.config.ts`
  pins Clerk's **telemetry** off and its **keyless auto-provisioning** off in code — the latter would
  have provisioned a live Clerk application from a dev server. New public route `/sign-in`
  (`PUBLIC_PATH_TREES`, `noindex`), which says so on the page while dark and offers the access code as
  the way in; a three-lens UX panel ran before it was written. The CSP is widened for Clerk **by exact
  origin, derived from the publishable key, never a wildcard** — `connect-src`, `img-src`, `frame-src`,
  `worker-src`, nothing in `script-src` (`'strict-dynamic'` ignores hosts; Clerk's script rides this
  app's existing nonce) and **nothing in `style-src`**, which is the one CSP question an instance is
  needed to answer. Closes the **`/api` matcher hole** `SECURITY.md` and `tech-debt.md` carried, with
  the non-vacuity floor its "do both" prescription always wanted. `lib/access-gate.ts` split into
  `lib/safe-redirect.ts` + `lib/public-paths.ts`, so 1d is a pure delete. The gate bounce now keeps
  the caller's **query string** in `?from=`. Privacy rides along, because shipping the dependency makes
  Clerk a processor: six edits to the notice and `data-inventory.md` §7's rows, egress paragraph and
  dated re-read. Clerk's two `'use server'` modules are enumerated and pinned by a test, so a bump
  that adds a third turns CI red.
