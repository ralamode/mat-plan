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

/**
 * The CSS layer Clerk's own stylesheet is confined to, passed to `<ClerkProvider appearance>` in
 * `app/layout.tsx`. `app/globals.css` declares `@layer clerk` **first**, which is what puts it below
 * Tailwind's layers — layer priority is declaration order, so naming it anywhere later would make
 * Clerk's styles win over the `min-h-11` below. `lib/clerk.test.ts` pins that ordering, because
 * nothing else did.
 */
export const CLERK_CSS_LAYER = 'clerk';

/**
 * `<SignIn>`'s appearance, in one place because the three facts it encodes are each load-bearing and
 * none of them is visible from the JSX that consumes it.
 *
 * ⚠️ `elements` values are CLASS-NAME STRINGS, never a `CSSObject`. `UserDefinedStyle = string |
 * CSSObject`, and a `CSSObject` becomes a runtime-injected style — the production policy is
 * `style-src 'self' 'nonce-…'` with no `'unsafe-inline'` (`proxy.ts:buildCsp`), so it would be
 * dropped **silently**. A Tailwind class ships in our own `'self'` stylesheet and survives. A hard
 * constraint, not a preference, and `lib/clerk.test.ts` asserts every value is a string.
 *
 * - `socialButtonsBlockButton: 'min-h-11'` is `MIN_TAP_TARGET_PX` in Tailwind's spelling, and
 *   `elements` is the only lever for it: Clerk's `variables` expose colours, fonts, radius and
 *   spacing, but no control height. The 44px arithmetic itself lives in
 *   `app/design/tokens/token-sets.test.ts`, derived from the const — not duplicated here.
 *   ✅ Measured 44.0px on the lit card against the development instance, 2026-11-04.
 * - `headerTitle`/`headerSubtitle` hidden so the page's `<h1>` is the only one in the a11y tree.
 *   ✅ Verified 2026-11-04: Clerk's `<h1>` is in the DOM but `display:none`, so the tree has one.
 *   `header` is hidden too, and the three are NOT interchangeable — `header` removes the empty ~35px
 *   container that hiding only the children leaves behind, while the child keys survive a vendor
 *   restructure that moves the title out of `header`. Neither is removable alone.
 * - `rootBox`/`cardBox: 'w-full'` make the card follow the page's column. Without them Clerk renders
 *   a fixed `width: 400px` against this page's 352px column (`max-w-sm` + `px-4`), overhanging it by
 *   48px at every viewport where the column hits its max — measured at 1280px, 2026-11-04. Widening
 *   `main` instead would leave a 16px misalignment pointing the other way.
 * - **The card renders seamlessly, not as a floating box.** Clerk ships it as a drop-shadowed white
 *   card, which on this screen read as a second surface competing with the page's own heading and
 *   disclosure directly above it. `cardBox` drops the shadow and `card` drops the white fill and
 *   padding, so the button sits on the page. The Google button then takes the app's own outline
 *   treatment (`rounded-lg border-border bg-background`, the exact classes `buttonVariants`' outline
 *   variant resolves to) so it and the page's other control match rather
 *   than being two different kinds of button stacked on each other.
 *   ⚠️ **"Secured by Clerk" stays.** It is the vendor's attribution on a free plan, and removing it
 *   is a paid-tier feature — not a styling choice. Clerk's orange "Development mode" badge below it
 *   is **development-instance only** and never reaches production, which is why captures taken
 *   against the dev instance show a band that production does not have.
 *
 * 🔴 **This pins our INPUT, not the rendered outcome.** It cannot detect a CDN build that renames
 * `cl-headerTitle`, moves the title out of that class, or changes the button's box model — clerk-js
 * ships from a CDN at a floating major and is absent from the lockfile (`docs/tech-debt.md`). What it
 * does buy: a refactor that drops a key currently reds nothing, because no CI run loads the lit card.
 */
export const SIGN_IN_APPEARANCE = {
  elements: {
    headerTitle: 'hidden',
    headerSubtitle: 'hidden',
    header: 'hidden',
    socialButtonsBlockButton: 'min-h-11 rounded-lg border border-input bg-background shadow-none',
    rootBox: 'w-full',
    cardBox: 'w-full shadow-none',
    card: 'bg-transparent p-0 shadow-none',
    footer: 'bg-transparent',
  },
} as const;
