import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/layout/site-footer';
import { Button } from '@/components/ui/button';
import {
  ALL_ATHLETES_LINK,
  APP_HOME_PATH,
  CTA_CLASS,
  NOT_FOUND_COPY,
  PAGE_SHELL_CLASS,
} from '@/lib/constants';

/**
 * UI-6 — the app's own 404, for an unknown URL and for every `notFound()` (an athlete id this
 * household can't see renders the same page, so existence never leaks).
 *
 * 🔴 **It exists because Next's built-in fallback can't render under our CSP.** That page styles
 * itself with inline `style` attributes and an un-nonced `<style>`, and production's
 * `style-src 'self' 'nonce-…'` (`proxy.ts` → `buildCsp`) refuses both, so it rendered without its
 * layout and logged violations: the `sha256-Z5XT…` style seen on Today captures on 2026-11-14 was
 * this one. Tailwind classes only here, and no inline style, ever.
 *
 * The target is `/p`, not `/`: a signed-in kid lands on their athletes, and a signed-out visitor is
 * sent to sign-in from there, which links to `/`, as the footer does.
 */
export const metadata: Metadata = { title: NOT_FOUND_COPY.heading };

export default function NotFound() {
  return (
    <>
      <main className={`${PAGE_SHELL_CLASS} justify-center`}>
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">{NOT_FOUND_COPY.heading}</h1>
          <p className="text-muted-foreground max-w-prose">{NOT_FOUND_COPY.body}</p>
          <Button asChild size="lg" className={CTA_CLASS}>
            <Link href={APP_HOME_PATH}>{ALL_ATHLETES_LINK}</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
