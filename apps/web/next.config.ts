import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {/* config options here */};

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
