import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { GATE_PATH } from '@/lib/access-gate';
import { clerkIsConfigured } from '@/lib/clerk';
import {
  CTA_CLASS,
  PRIVACY_PATH,
  QUIET_LINK_CLASS,
  SIGN_IN_COPY,
  SIGN_IN_PATH,
} from '@/lib/constants';

/**
 * `robots: noindex`, unconditionally and permanently.
 *
 * While dark, "signing in with Google isn't switched on yet" is a worse search result for
 * "mat-plan sign in" than the password prompt `app/gate/page.tsx` already refuses to be. Once lit, an
 * auth endpoint has no search value and its whole audience arrives by link — the consent screen, a
 * bookmark, the family. Unlike `/privacy`'s noindex, **this one never comes off**, and it is not
 * conditional on the keys either: a robots directive that depends on an environment variable is a
 * behaviour nobody remembers. As `app/privacy/page.tsx` records, noindex does not affect
 * fetchability — the response is a 200 for a human or a console following the link.
 */
export const metadata: Metadata = {
  title: SIGN_IN_COPY.heading,
  robots: { index: false, follow: false },
};

/**
 * Clerk's prebuilt sign-in, Google-only (AUTH-1 1a) — the app's new front door, and the first route
 * in `PUBLIC_PATH_TREES` because the handshake and the OAuth callback arrive on children of it.
 *
 * ⚠️ **Keep it household-data-free.** Like `/` and `/privacy`, this page reads no cookie, calls no
 * DAL, queries nothing and owns no Server Action. It is ungated, so that is the property that makes
 * widening `isPublicPath` to a subtree safe. It authorizes nothing either: in 1a the access gate is
 * still the only boundary, which is why the way in is also on the page.
 *
 * **Two states, and only the dark one reaches production at 1a.** `clerkIsConfigured()` is the same
 * predicate `app/layout.tsx` uses to decide whether to render `<ClerkProvider>` — they MUST agree,
 * because `<SignIn/>` without a provider above it throws. With no keys the page is a plain
 * server-rendered panel naming the live door; it is a dead end by design, so the one thing it owes is
 * an exit. The heading renders ABOVE the Clerk mount in both states, so first paint is always text:
 * `/sign-in` is the only screen in this app whose content depends on two bundles fetched from a CDN,
 * and `@clerk/shared`'s loader waits 15s before it gives up (`scriptLoadTimeout ?? 15e3`). The gate
 * link stays in the lit state for the same reason — until 1d it is the only way out when the script
 * never arrives on gym LTE.
 */
export default function SignInPage() {
  const configured = clerkIsConfigured();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <header className="flex flex-col gap-2 text-center">
        {/* The page owns the ONE `<h1>` in both states; `appearance` below suppresses Clerk's card
            title so there is never a second one. axe cannot catch that — `heading-order` and
            `page-has-heading-one` are best-practice-tagged and `e2e/a11y.spec.ts` scans
            `wcag2a`/`wcag2aa` only — so it is a decision, not a check. */}
        <h1 className="text-2xl font-semibold tracking-tight">{SIGN_IN_COPY.heading}</h1>
        <p className="text-muted-foreground text-sm">
          {configured ? SIGN_IN_COPY.processor : SIGN_IN_COPY.notYet}
        </p>
      </header>

      {configured ? (
        <>
          <Link href={PRIVACY_PATH} className={QUIET_LINK_CLASS}>
            {SIGN_IN_COPY.privacyLink}
          </Link>
          <SignIn
            path={SIGN_IN_PATH}
            appearance={{
              /**
               * ⚠️ `elements` values are CLASS-NAME STRINGS, never a `CSSObject`, and the reason is
               * this app's CSP: `UserDefinedStyle = string | CSSObject`, and a `CSSObject` becomes a
               * runtime-injected style — the production policy is `style-src 'self' 'nonce-…'` with no
               * `'unsafe-inline'` (`proxy.ts:buildCsp`), so it would be dropped silently. A Tailwind
               * class ships in our own `'self'` stylesheet and survives. This is a hard constraint
               * here, not a preference.
               *
               * `min-h-11` is `MIN_TAP_TARGET_PX` (44) in Tailwind's spelling, and `elements` is the
               * only lever for it: Clerk's `variables` expose colours, fonts, radius and spacing, but
               * no control height. The cascade half of the same problem is `cssLayerName`, set on
               * `<ClerkProvider>` in `app/layout.tsx` — see the comment there.
               *
               * `headerTitle`/`headerSubtitle` are hidden so the page's `<h1>` is the only heading.
               */
              elements: {
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
                socialButtonsBlockButton: 'min-h-11',
              },
            }}
          />
        </>
      ) : (
        <p className="text-muted-foreground text-center text-sm">{SIGN_IN_COPY.codeStillWorks}</p>
      )}

      {/* ONE forward control, styled like the landing's own second CTA so the single real action
          looks the same on both screens. It points at `GATE_PATH` rather than `/`: that serves both
          readers in one link, because `proxy.ts` sends a caller who already holds the cookie straight
          on to `APP_HOME_PATH`. `/` and `PRIVACY_PATH` are deliberately absent — `SiteFooter` renders
          both on every route, and two same-href links in one document read as a duplicate destination
          in a screen-reader link list. */}
      <Button asChild size="lg" variant="outline" className={CTA_CLASS}>
        <Link href={GATE_PATH}>{SIGN_IN_COPY.gateCta}</Link>
      </Button>
    </main>
  );
}
