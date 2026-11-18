import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';

import { StyleNonce } from '@/components/layout/style-nonce';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { APP_NAME, NONCE_HEADER } from '@/lib/constants';

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
  const nonce = requestHeaders.get(NONCE_HEADER) ?? undefined;
  // ⚠️ **`x-pathname` is read nowhere now (AUTH-1 1d).** PRIV-2 forwarded it so the footer's
  // `aria-current` could be set from a SERVER component — but the root layout is not re-rendered on a
  // client-side navigation, so the value was stale after a soft nav, and `1d` made that visible by
  // hanging the footer's visibility on it. `SiteFooter` uses `usePathname()`, and `1d` deleted the
  // forwarding and its pins with it rather than leaving plumbing with no consumer.

  return (
    <html
      // The same constant `plural()` and `Intl.ListFormat` read, so the document's declared language
      // cannot drift from the one its numbers and lists are formatted for.
      lang={APP_LOCALE}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/*
          ⚠️ **The footer is NOT here any more (`UI-5`).** It is rendered by `AppShell` for every
          authenticated page and by the two public pages that show it. A layout cannot read the
          pathname in this Next version, so it could not render for public routes only — and
          keeping it here as well as in the shell would put two `contentinfo` landmarks on every
          authenticated page.
        */}
        {/* No `<ClerkProvider>` here (the Clerk-off-public-pages fix): every non-public segment renders
            `ClerkRoot` in its own layout, so `/` and `/privacy` load no Clerk code. The rule and its
            guard: `components/layout/clerk-root.tsx`, `app/pages-need-a-session.test.ts`. */}
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
        {/* The sheet scroll lock's `<style>` needs the page's nonce; it reads it from the DOM, not
            from `nonce` here, which is new on every refresh (`style-nonce.tsx`). */}
        <StyleNonce />
      </body>
    </html>
  );
}
