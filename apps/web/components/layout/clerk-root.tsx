import { ClerkProvider } from '@clerk/nextjs';
import { headers } from 'next/headers';

import { CLERK_CSS_LAYER, clerkIsConfigured } from '@/lib/clerk';
import { APP_HOME_PATH, NONCE_HEADER, SIGN_IN_PATH } from '@/lib/constants';

/**
 * Clerk's provider, for every page that is NOT public (plan: docs/plans/td-clerk-off-public-pages.md).
 *
 * It used to sit in the root layout, around every route, so `clerk.browser.js` loaded on `/` and
 * `/privacy` too: a stranger reading the privacy notice had their IP seen by Clerk. Now each
 * non-public top-level segment renders this from its own `layout.tsx` (`p`, `settings`, `sign-in`,
 * `design`), and the public pages render none. `app/pages-need-a-session.test.ts` enforces both
 * halves, and the next two rules.
 *
 * 🔴 **It takes no props.** A remount (crossing from one segment's layout to another's) finds
 * clerk-js already on the window and skips `clerk.load()`, so a second segment's props would be
 * silently ignored. One configuration, here.
 *
 * 🔴 **A link from a page with no provider into a segment with one must be a plain `<a>`**, never
 * `<Link>`. A client navigation renders this layout in an RSC request with a FRESH nonce; clerk-js
 * would load for the first time with it and stamp it on its `<style>` tags, which the page's CSP (the
 * first document's nonce) blocks: an unstyled sign-in card in production, while CI (no keys) and dev
 * (`'unsafe-inline'`) stay green. A full document load gives Clerk the page's own nonce.
 *
 * Why every non-public page keeps the provider, not only the two that call a Clerk hook: clerk-js
 * also refreshes the short-lived session token. Without it, an RSC navigation or Server Action after
 * expiry is treated as signed out (only a full page load can take the middleware's handshake).
 */
export async function ClerkRoot({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  // AUTH-1 1a — Clerk, INSIDE the nonce/theme providers and only when both keys are present.
  //
  // `clerkIsConfigured()` is the same predicate `proxy.ts` and `app/sign-in/[[...rest]]/page.tsx`
  // read, and all three must agree: a provider without a middleware is an `auth()` that throws, and a
  // sign-in card without a provider is a render that throws. With no keys there is no
  // `<ClerkProvider>` at all — which is 1a's whole shape, and not a cosmetic choice: in the
  // installed `@clerk/nextjs` the provider itself CALLS `throwMissingPublishableKeyError()` when the
  // keyless path is live with no key, so an unconditional one would 500 every route on `pnpm dev`.
  // See `lib/clerk.ts`.
  //
  // `nonce` + `dynamic` travel together because `@clerk/shared`'s own type for the prop says so
  // ("Requires the `dynamic` prop to also be set"): `dynamic` is what makes Clerk render its script
  // tag SERVER-side through `DynamicClerkScripts`, which reads this same `x-nonce` and stamps it on.
  // Without it the script is injected client-side and the production `script-src` nonce is the only
  // thing that would have let it load.
  //
  // The URLs come from `lib/constants.ts`, not from `NEXT_PUBLIC_CLERK_SIGN_IN_URL` /
  // `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`: Clerk reads those env vars when they are set, which is
  // exactly how the route would drift from the constant the proxy and `PUBLIC_PATH_TREES` use.
  return clerkIsConfigured() ? (
    <ClerkProvider
      dynamic
      nonce={nonce}
      signInUrl={SIGN_IN_PATH}
      // 🔴 **`signUpUrl` points at the SIGN-IN route on purpose (AUTH-1 1d), and there is no
      // `<SignUp/>` in this app.** Sign-up is invitation-only, so a refused address is refused at
      // Clerk's sign-UP step — and with this prop unset Clerk sends that caller to its own Account
      // Portal, on **another origin**: no footer, no `/privacy`, no way back to this app. `1d` makes
      // `/sign-in` the only door, so an off-origin dead end is the one outcome worth pre-empting.
      // ✅ **OBSERVED 2026-11-05 on production, under `Invite-only`: the refusal is ON-ORIGIN.** Clerk
      // rendered _"New sign-ups are currently restricted."_ inside our card, with the mark and both
      // disclosures still on screen — no Account Portal, no off-origin dead end. So this prop is belt
      // rather than braces on that path. ⚠️ **Keep it anyway:** the access mode is a dashboard setting
      // (now `Waitlist`), the observation is bound to the mode it was taken under, and clerk-js ships
      // from a CDN at a floating major — none of which this repo can pin.
      signUpUrl={SIGN_IN_PATH}
      signInFallbackRedirectUrl={APP_HOME_PATH}
      afterSignOutUrl={SIGN_IN_PATH}
      // `cssLayerName` is a GLOBAL appearance option, so it belongs here rather than on `<SignIn>`.
      // Tailwind v4 emits its utilities inside `@layer utilities`, and UNLAYERED styles beat any
      // layered rule regardless of specificity — so without a layer name, Clerk's own CSS would win
      // over the `min-h-11` the sign-in card sets for the 44px tap-target bar, with no test to say
      // so. ⚠️ `app/globals.css` names the layer BETWEEN Tailwind's `base` and `components` — this
      // comment said "FIRST, which puts it below Tailwind's layers", which is the arrangement #333
      // measured and replaced: below `base`, preflight strips Clerk's own spacing. See `lib/clerk.ts`.
      appearance={{ cssLayerName: CLERK_CSS_LAYER }}
    >
      {children}
    </ClerkProvider>
  ) : (
    children
  );
}
