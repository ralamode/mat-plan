import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

/**
 * AUTH-1 1a — Clerk's two opt-outs, pinned HERE rather than left to an environment variable.
 *
 * `next.config.ts`'s `env` is inlined at build time into both bundles, so these hold for every build,
 * every `next dev`, CI, and every preview — the runbook's requirement was *disable it in code, not
 * only by env*, and an env var that has to be remembered in five places is the thing that gets
 * forgotten in the sixth. Both names are read off the pinned `@clerk/nextjs@7.9.15`
 * (`dist/esm/server/constants.js:24-26`), and both are `NEXT_PUBLIC_` because Clerk reads them in the
 * browser as well as on the server — neither carries a secret.
 *
 * - **Telemetry.** `@clerk/nextjs` ships an anonymous collector that POSTs to
 *   `clerk-telemetry.com`. This app holds minors' health data in a public repo; an SDK deciding on
 *   its own what to send to a vendor endpoint is not a trade this project makes, and keeping it off
 *   is also what keeps `clerk-telemetry.com` out of the CSP's `connect-src`
 *   (`proxy.ts:buildCsp`) and out of `docs/privacy/data-inventory.md` § 7.
 * - **Keyless.** With no publishable key in development, Clerk's keyless path
 *   (`dist/esm/server/keyless-node.js` → `createAccountlessApplication`) would PROVISION A LIVE CLERK
 *   APPLICATION from a developer's machine — a new processor relationship created by a `pnpm dev`,
 *   writing keys to disk. 1a ships dark on purpose; "dark" must not mean "quietly signed up".
 *   `lib/clerk.ts` independently refuses to render `<ClerkProvider>` without both keys, so this is
 *   the second of two locks rather than the only one.
 */
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: '1',
  },
};

/**
 * Sentry build-time wiring (V1-14a).
 *
 * SOURCE MAPS ARE DELIBERATELY DISABLED. Uploading them needs `@sentry/cli`, whose postinstall pulls a
 * ~20MB binary into EVERY install — including CI, which never uploads anything. That is the exact
 * complaint already logged against `@embedded-postgres` in docs/tech-debt.md, and it would also make a
 * production build depend on a downloaded binary and an auth token.
 *
 * The trade-off, stated plainly: Sentry stack frames will be minified. For a three-user app that is a
 * legibility cost, not a correctness one. To reverse it, flip BOTH `@sentry/cli` in
 * `pnpm-workspace.yaml` and `sourcemaps.disable` here, and add SENTRY_AUTH_TOKEN/ORG/PROJECT.
 *
 * Consequence worth knowing: with upload disabled, the DSN is the ONLY credential Sentry needs.
 */
export default withSentryConfig(nextConfig, {
  sourcemaps: { disable: true },
  // Nothing to authenticate against without an upload, so these stay unset on purpose.
  silent: true,
  // No `tunnelRoute`: the front-end SDK isn't shipped (the CSP's `connect-src 'self'` would block its
  // ingest POST outright — see the plan's Out of scope), so there is nothing to tunnel.
  //
  // No `disableLogger` either: it is deprecated in favour of `webpack.treeshake.removeDebugLogging`,
  // which this project cannot use — it builds with TURBOPACK. Setting it only emits a deprecation
  // warning on every build for no effect.
});
