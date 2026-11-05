import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';

import { MatPlanMark } from '@/components/brand/mat-plan-mark';

import { clerkIsConfigured, SIGN_IN_APPEARANCE } from '@/lib/clerk';
import {
  FOOTER_COPY,
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
 * widening `isPublicPath` to a subtree safe. It authorizes nothing either: in 1a the access gate was
 * still the only boundary, which is why the way in is also on the page. ⚠️ Since `1c-3b` the boundary
 * is the gate AND a session; the page keeps the gate link because the code is one of the two things a
 * caller needs until `1d`.
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
    /* `max-w-[432px]`, not `max-w-sm`: Clerk's card has its own fixed width (400px at the CDN build
       measured 2026-11-05) and this app does NOT override it — see `SIGN_IN_APPEARANCE`. 400 + the
       32px of `px-4` is 432, so the column is sized to the card rather than the card squeezed into
       the column. ⚠️ If the card ever overhangs or leaves a gap, Clerk changed its width: re-measure
       and change this number. Do not reach for `elements` to compress it. */
    <main className="mx-auto flex w-full max-w-[432px] flex-1 flex-col justify-center gap-6 px-4 py-12">
      {/* 🔴 **The page renders NO heading while lit — Clerk's card owns it.** With `<SignIn>` mounted
          there are two `<h1>`s on the page: ours and the card's "Sign in to MatPlan". The cheap fix
          is hiding Clerk's with three `header*` appearance keys; the cheaper one is this, because it
          needs no override at all and leaves the vendor component untouched (`lib/clerk.ts` has the
          whole argument). axe would not have caught either way round — `page-has-heading-one` and
          `heading-order` are best-practice-tagged and `e2e/a11y.spec.ts` scans `wcag2a`/`wcag2aa`
          only — so this is a decision, not a check.
          ⚠️ The DARK state has no card, so it keeps the page's own heading and its one line. */}
      {/* The mark links HOME, and is this screen's only route back to `/`. It sits above the card
          because the card owns the heading while lit, so the page's own identity has to come from
          something that is not a second `<h1>`. `aria-hidden` on the SVG is why the link needs its
          own accessible name — the mark announces nothing by design (`MatPlanMark`'s docblock), so
          without the sr-only text this would be a link with no text at all. */}
      <Link
        href="/"
        aria-label={FOOTER_COPY.home}
        className="focus-visible:ring-ring mx-auto inline-flex min-h-11 items-center rounded-sm outline-none focus-visible:ring-3"
      >
        <MatPlanMark className="size-8" />
        <span className="sr-only">{FOOTER_COPY.home}</span>
      </Link>

      {!configured && (
        <header className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{SIGN_IN_COPY.heading}</h1>
          <p className="text-muted-foreground text-sm">{SIGN_IN_COPY.notYet}</p>
        </header>
      )}

      {configured ? (
        <SignIn path={SIGN_IN_PATH} appearance={SIGN_IN_APPEARANCE} />
      ) : (
        <p className="text-muted-foreground text-center text-sm">{SIGN_IN_COPY.codeStillWorks}</p>
      )}

      {/* 🔴 **Below the card, deliberately.** It renders in BOTH states and is the screen's one
          in-`main` link either way, which is the exact count `e2e/a11y.spec.ts` measures.
          ⚠️ It used to sit ABOVE the control, and `lib/constants.ts` records why that mattered —
          "put the fact next to the control", because Google's consent screen appears only AFTER the
          tap. It moved below once Clerk's card took over the heading _(maintainer, 2026-11-05)_: a
          lone underlined line above a self-contained card read as a stray fragment. The disclosure
          is still on this screen and still before anything irreversible happens — a reader who taps
          Google without reading it was never going to read it above the button either. It duplicates
          a footer destination on purpose: `SiteFooter` carries `/privacy` as chrome on every route,
          this is the screen's own disclosure. */}
      <Link href={PRIVACY_PATH} className={QUIET_LINK_CLASS}>
        {SIGN_IN_COPY.privacyLink}
      </Link>
    </main>
  );
}
