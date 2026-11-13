import { ClerkFailed, ClerkLoading, SignIn } from '@clerk/nextjs';
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
 * "mat-plan sign in" than the password prompt the deleted `app/gate/page.tsx` refused to be. Once lit, an
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
 * 🔴 **From `1d` this is the app's ONLY door.** Every other route needs a session with a
 * `household_members` row, and the access gate that used to be the fallback way in is deleted. So a
 * failure on this screen is not a degraded experience, it is a locked building — which is why the
 * CDN-timeout note below is a design constraint rather than a nicety.
 *
 * ⚠️ **Keep it household-data-free.** Like `/` and `/privacy`, this page reads no cookie, calls no
 * DAL, queries nothing and owns no Server Action. It is public, so that is the property that makes
 * widening `isPublicPath` to a subtree safe. It authorizes nothing either — `<SignIn>` is Clerk's,
 * and the boundary is enforced in the pages, actions and handlers that read data.
 *
 * **Two states, and only the dark one is reachable without keys.** `clerkIsConfigured()` is the same
 * predicate `app/layout.tsx` uses to decide whether to render `<ClerkProvider>` — they MUST agree,
 * because `<SignIn/>` without a provider above it throws. With no keys the page is a plain
 * server-rendered panel saying so.
 * 🔴 **The dark state is now a genuine dead end, and that is a deliberate narrowing.** Until `1d` it
 * offered the access code as a forward step; there is no such step any more, so its only exits are
 * the mark (to `/`) and the privacy link. ⚠️ **No `SiteFooter` reaches this subtree at all** — `UI-5` moved it out of the root
 * layout, so these two links are the page's own and nothing else supplies them. (It used to render
 * everywhere and suppress itself here; the suppression is gone because the render is.) Do not
 * delete them expecting a footer to cover it.
 *
 * ⚠️ **First paint is always our text, never the vendor's.** This is the only screen whose content
 * depends on two bundles fetched from a CDN, and `@clerk/shared`'s loader waits 15s before giving up
 * (`scriptLoadTimeout ?? 15e3`). On gym LTE that is 15 seconds of blank card, so the mark and the
 * disclosure render above the mount in BOTH states.
 *
 * 🔴 **ORDERING INVARIANT: the page's own disclosure renders above the Clerk mount, in both states.**
 * "Secured by Clerk" is a vendor assurance inside the card and must never be the first mention of
 * Clerk a reader meets — `SIGN_IN_COPY.invitation` and the privacy link are what disclose, and they
 * are ours. ⚠️ No `aria-describedby` can reach into vendor DOM to associate them with the button, so
 * placement and `text-foreground` ARE the compensation. Do not "fix" that with a client effect.
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
          something that is not a second `<h1>`. `aria-hidden` on the SVG is why the link needs an
          accessible name of its own — the mark announces nothing by design (`MatPlanMark`'s docblock),
          so without the sr-only text this would be a link with no text at all.
          ⚠️ **One name source, not two.** There was also an `aria-label` here; with both present
          accname step 2C makes the label win and the `sr-only` span contribute nothing — two sources
          for one string, where editing either leaves the other silently load-bearing. The span is the
          one kept: real text survives translation and find-in-page, and AGENTS.md wants native text
          before ARIA.
          🔴 **`min-w-11`, not just `min-h-11`.** With a `size-8` child and no width floor this was
          32×44 — under the 44px bar on the one control that gets a stranded reader off this screen,
          and invisible to `expectLinkTapTargets`, which measures height only. */}
      <Link
        href="/"
        className="focus-visible:ring-ring mx-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm outline-none focus-visible:ring-3"
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

      {/* 🔴 **The precondition, before the tap.** `text-foreground`, not muted: `lib/constants.ts`
          sets that rule for copy read once, cold, immediately before an act with no undo — and
          Google's consent screen is exactly that. It names the SEQUENCING (consent first, invitation
          checked after), so a stranger can stop before disclosing their address, name and picture.
          Lit state only: with no keys there is nothing to consent to. */}
      {configured && (
        <div className="flex flex-col gap-2 text-center">
          <p className="text-foreground text-sm">{SIGN_IN_COPY.invitation}</p>
          {/* 🔴 **This is the disclosure the ordering invariant above is ABOUT, and it was missing.**
              #333 removed it from this page while adding that invariant, so the first mention of
              Clerk a reader met was the vendor's own "Secured by Clerk" badge inside the card —
              exactly what the invariant forbids. `invitation` names the SEQUENCING (consent first,
              invitation checked after); this names WHAT is handed over, which is what a stranger
              deciding whether to stop actually needs. `lib/constants.ts` records why its wording is
              load-bearing: a standing prohibition forbids reintroducing "nothing but an email
              address", which is false at the token. */}
          <p className="text-foreground text-sm">{SIGN_IN_COPY.processor}</p>
          {/* ⚠️ **Describes a control inside Clerk's card, not one of ours.** The card's "Join
              waitlist" link leaves this origin for Clerk's hosted page, which asks for an email and
              shows no privacy link — so the disclosure has to be here, above it. `lib/constants.ts`
              records that this copy is coupled to the Clerk access mode and must change with it. */}
          <p className="text-foreground text-sm">{SIGN_IN_COPY.waitlist}</p>
        </div>
      )}

      {configured && (
        <>
          {/* 🔴 **The CDN-failure states, and they are not decoration (AUTH-1 1d).** This screen's
              content comes from two bundles on Clerk's CDN, and `@clerk/shared`'s loader waits 15s
              before giving up. Since `1d` there is no access code to fall back to, so a reader who
              gets nothing is locked out of the app entirely — the docblock above calls that a design
              constraint, and these two lines are what answers it.
              ⚠️ **Our text, not vendor DOM**, and rendered BEFORE the mount so first paint carries
              them. `ClerkLoading` / `ClerkFailed` are exported by `@clerk/nextjs@7.9.22` (verified
              against `dist/types/index.d.ts`) and swap themselves out once clerk-js settles. */}
          <ClerkLoading>
            <p className="text-muted-foreground text-center text-sm">{SIGN_IN_COPY.loading}</p>
          </ClerkLoading>
          <ClerkFailed>
            <p className="text-foreground text-center text-sm">{SIGN_IN_COPY.failed}</p>
          </ClerkFailed>
          <SignIn path={SIGN_IN_PATH} appearance={SIGN_IN_APPEARANCE} />
        </>
      )}

      {/* 🔴 **Below the card, deliberately.** It renders in BOTH states and is the screen's one
          in-`main` link either way, which is the exact count `e2e/a11y.spec.ts` measures.
          ⚠️ It used to sit ABOVE the control, and `lib/constants.ts` records why that mattered —
          "put the fact next to the control", because Google's consent screen appears only AFTER the
          tap. It moved below once Clerk's card took over the heading _(maintainer, 2026-11-05)_: a
          lone underlined line above a self-contained card read as a stray fragment. The disclosure
          is still on this screen and still before anything irreversible happens — a reader who taps
          Google without reading it was never going to read it above the button either. It duplicates
          a footer destination on purpose — on every OTHER route `SiteFooter` carries `/privacy` as
          chrome; this screen renders no footer (`UI-5`), so this is its own disclosure. */}
      {/* ⚠️ `mx-auto`: `QUIET_LINK_CLASS` is `inline-flex`, so in this centred column the link
          otherwise hugs the left edge under centred text — which reads as a mistake rather than a
          choice. Caught on the dark-state capture, not in review. */}
      <Link href={PRIVACY_PATH} className={`${QUIET_LINK_CLASS} mx-auto`}>
        {SIGN_IN_COPY.privacyLink}
      </Link>
    </main>
  );
}
