import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';

import { SiteFooter } from '@/components/layout/site-footer';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { clerkIsConfigured } from '@/lib/clerk';
import { APP_HOME_PATH, APP_NAME, SIGN_IN_PATH } from '@/lib/constants';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Activity logger for wrestling S&C — kids and adult training.',
};

// Nonce-based CSP (see proxy.ts) is applied during SSR, so every route must be
// dynamically rendered. This is an inherently per-user app — nothing is
// statically cacheable — so opting the whole tree in here is the right default.
//
// ⚠️ SINCE TEN-1, TENANCY DEPENDS ON THIS LINE. ADR 0006 chose session-only household addressing, so
// `/p` and `/p/<profileId>` are byte-identical URLs for every household — NOTHING in any cache key
// distinguishes tenants. Static rendering, a CDN rule on `/p`, `unstable_cache` or `'use cache'` on
// a household-scoped read would serve one family's athletes to another. `app/tenancy-is-not-cached.test.ts`
// pins this directive and that rule; a Route Handler does NOT inherit it (the export handler is
// dynamic because it calls `cookies()`), which is why that gets its own assertion.
export const dynamic = 'force-dynamic';

/**
 * UI-4: `suppressHydrationWarning` on `<html>` is REQUIRED, not cosmetic. The provider's pre-paint
 * script adds `class="dark"` to this element before React hydrates, so the server HTML and the live
 * DOM legitimately differ on exactly that attribute. The suppression is scoped to this one element's
 * own attributes (it does not extend to the tree below), which is why it is safe here.
 *
 * The nonce comes from the proxy via the `x-nonce` request header (`proxy.ts`), because the
 * production CSP is `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `unsafe-inline` — an
 * un-nonced inline script would be blocked silently and the theme would apply only after hydration,
 * i.e. a flash of the wrong theme on every load. Reading headers costs nothing here: this layout is
 * already `force-dynamic`.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get('x-nonce') ?? undefined;
  // PRIV-2: the footer's `aria-current` needs the current route. The proxy forwards it the same way
  // it forwards the nonce, which keeps `SiteFooter` a server component on every route.
  const pathname = requestHeaders.get('x-pathname');

  // AUTH-1 1a — Clerk, INSIDE the nonce/theme providers and only when both keys are present.
  //
  // `clerkIsConfigured()` is the same predicate `proxy.ts` and `app/sign-in/[[...rest]]/page.tsx`
  // read, and all three must agree: a provider without a middleware is an `auth()` that throws, and a
  // sign-in card without a provider is a render that throws. With no keys there is no
  // `<ClerkProvider>` at all — which is 1a's whole shape, and not a cosmetic choice: at the pinned
  // 7.9.15 the provider itself CALLS `throwMissingPublishableKeyError()` when the keyless path is live
  // with no key, so an unconditional one would 500 every route on `pnpm dev`. See `lib/clerk.ts`.
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
  const body = clerkIsConfigured() ? (
    <ClerkProvider
      dynamic
      nonce={nonce}
      signInUrl={SIGN_IN_PATH}
      signInFallbackRedirectUrl={APP_HOME_PATH}
      afterSignOutUrl={SIGN_IN_PATH}
      // `cssLayerName` is a GLOBAL appearance option, so it belongs here rather than on `<SignIn>`.
      // Tailwind v4 emits its utilities inside `@layer utilities`, and UNLAYERED styles beat any
      // layered rule regardless of specificity — so without a layer name, Clerk's own CSS would win
      // over the `min-h-11` the sign-in card sets for the 44px tap-target bar, with no test to say
      // so. `app/globals.css` declares `@layer clerk` FIRST, which is what puts it below Tailwind's
      // layers: layer priority is declaration order, so naming it anywhere later would make Clerk's
      // styles win instead.
      appearance={{ cssLayerName: 'clerk' }}
    >
      {children}
    </ClerkProvider>
  ) : (
    children
  );

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider nonce={nonce}>
          {body}
          <SiteFooter pathname={pathname} />
        </ThemeProvider>
      </body>
    </html>
  );
}
