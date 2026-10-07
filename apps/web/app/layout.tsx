import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';

import { ThemeProvider } from '@/components/theme/theme-provider';
import { APP_NAME } from '@/lib/constants';

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
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
