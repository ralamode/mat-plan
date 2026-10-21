import { env } from './env';

/**
 * Clerk wiring facts, in one module (AUTH-1 1a).
 *
 * Three call sites must agree on "is Clerk configured": `proxy.ts` (compose `clerkMiddleware()`,
 * widen the CSP), `app/layout.tsx` (render `<ClerkProvider>`) and `app/sign-in/[[...rest]]/page.tsx`
 * (render Clerk's prebuilt sign-in, or the dark fallback). Three copies of `!!env.X && !!env.Y` is
 * how one of them ends up disagreeing with the other two, and the one that disagrees is either a
 * throw on every route or a sign-in page with no provider above it.
 *
 * Imports `./env`, which is `import 'server-only'` — so this module is server-side by construction,
 * which is correct: every consumer is the proxy or a Server Component.
 */

/**
 * 🔴 **1a ships DARK, and this predicate is what makes that a property of OUR code rather than a
 * vendor behaviour we hope for.** Both keys are optional in `lib/env.ts` by design: local dev, CI's
 * `next build` and un-wired previews legitimately run without them, and that is the state in
 * production until the maintainer configures an instance.
 *
 * Verified against the pinned `@clerk/nextjs@7.9.15`, because the plan's "no keys ⇒ dark, not open"
 * could not be asserted without reading it — and one of its two failure modes is real:
 * `dist/esm/app-router/client/ClerkProvider.js:ClientClerkProvider` ends in
 * `errorThrower.throwMissingPublishableKeyError()`, and `dist/esm/app-router/server/ClerkProvider.js`
 * throws the same error when the keyless path is live with no publishable key. Keyless is live when
 * `isDevelopmentEnvironment() && !isAutomatedEnvironment() && !KEYLESS_DISABLED`
 * (`dist/esm/utils/feature-flags.js`), i.e. on `pnpm dev`. So an unconditional `<ClerkProvider>` with
 * no keys would 500 EVERY route in development, including the two unauthenticated ones.
 *
 * Two independent mitigations, both in our code:
 *  1. this predicate — nothing Clerk renders or runs unless both keys are present; and
 *  2. `next.config.ts` pins `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED`, so Clerk's keyless
 *     auto-provisioning (`dist/esm/server/keyless-node.js` → `createAccountlessApplication`, which
 *     would create a LIVE Clerk application — a new processor relationship — from a `pnpm dev`) can
 *     never arm itself, in any `NODE_ENV`.
 */
export function clerkIsConfigured(): boolean {
  return Boolean(env.CLERK_SECRET_KEY && env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/** The publishable key, or `undefined` when Clerk is not configured. */
export function clerkPublishableKey(): string | undefined {
  return clerkIsConfigured() ? env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY : undefined;
}

/**
 * The instance's Frontend API ORIGIN, derived from the publishable key — `https://<frontendApi>`, or
 * `null` for a missing/malformed key.
 *
 * This is what `proxy.ts:buildCsp` adds to `connect-src`, and it is derived rather than configured
 * for one reason: the origin is already inside the publishable key, so a second env var holding it
 * would be a copy that can drift from the key it describes. Deriving it also means the CSP is exact
 * for the development instance AND the production instance without a per-environment edit — and
 * exact is the whole point. **Never a wildcard here.**
 *
 * The key format is `pk_(test|live)_<unpadded base64 of "<frontendApi>$">`, mirroring
 * `@clerk/shared/keys.ts:parsePublishableKey` + `isPublishableKey` at the pinned
 * `@clerk/shared@4.40.0`. It is reimplemented rather than imported because `@clerk/shared` is a
 * TRANSITIVE dependency and `parsePublishableKey` is not re-exported by `@clerk/nextjs` or
 * `@clerk/nextjs/server` — reaching into a transitive's internals for six lines is the worse trade.
 * `clerk.test.ts` pins the decode against vendor-shaped keys, so a format change surfaces as a
 * failing test rather than a silently un-widened CSP.
 */
export function clerkFrontendApiOrigin(publishableKey: string | undefined): string | null {
  if (!publishableKey) return null;
  const parts = publishableKey.split('_');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'pk' || (parts[1] !== 'test' && parts[1] !== 'live')) return null;
  let decoded: string;
  try {
    decoded = atob(parts[2]!);
  } catch {
    return null;
  }
  // The vendor's own validity rule: exactly one trailing `$`, and a dot in what precedes it.
  if (!decoded.endsWith('$')) return null;
  const host = decoded.slice(0, -1);
  if (host.includes('$') || !host.includes('.')) return null;
  // A host, not a URL: anything that could carry a scheme, port, path, credentials or whitespace is
  // refused rather than interpolated into a security header.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) return null;
  return `https://${host}`;
}

/**
 * 🔴 **The CSP origins Clerk needs, by EXACT ORIGIN — never a wildcard.** Read off the pinned
 * `@clerk/nextjs@7.9.15`'s own `dist/esm/server/content-security-policy.js:DEFAULT_DIRECTIVES`, which
 * is the vendor's authoritative list at this version, then narrowed to what THIS app actually uses.
 * `proxy.ts:buildCsp` adds them only when `clerkIsConfigured()`, and `proxy.test.ts` pins each one.
 *
 * ⚠️ **We deliberately do NOT adopt Clerk's own policy or its `contentSecurityPolicy` middleware
 * option.** Clerk's defaults include `script-src … 'unsafe-inline' https: http:`,
 * `style-src 'unsafe-inline'` and the wildcards `https://*.protect.clerk.com(:*)` — i.e. they would
 * replace this app's nonce'd `strict-dynamic` policy with a far weaker one. The directives Clerk
 * ships for Stripe (`js.stripe.com`, `*.js.stripe.com`, `hooks.stripe.com`, `api.stripe.com`) and
 * Google Maps (`maps.googleapis.com`) are for Clerk Billing and address autocomplete, neither of
 * which this app uses; `clerk-telemetry.com` is excluded because `next.config.ts` turns telemetry off
 * rather than allowing it.
 */

/** Clerk's image host — OAuth provider logos on the sign-in card, and user avatars later. */
export const CLERK_IMG_ORIGIN = 'https://img.clerk.com';

/**
 * Clerk's bot/abuse protection renders a Cloudflare Turnstile widget in an iframe. This app's CSP
 * declares NO `frame-src`, so the iframe would fall through to `default-src 'self'` and be blocked —
 * which presents as a sign-in button that does nothing. Whether the widget appears depends on a
 * dashboard setting (§ Runbook), so the source is added whenever Clerk is configured rather than
 * guessed per-instance.
 */
export const CLERK_BOT_PROTECTION_ORIGIN = 'https://challenges.cloudflare.com';
