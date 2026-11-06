'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { FOOTER_COPY, PRIVACY_PATH, QUIET_LINK_CLASS, SIGN_IN_PATH } from '@/lib/constants';
import { matchesPathTree } from '@/lib/public-paths';

/**
 * PRIV-2 — the one `<footer>`, in the root layout, so the privacy notice is reachable from every
 * screen rather than only by typing the URL, and so a family inside the app can find it too.
 *
 * Two items, because `/privacy` is the SECOND room a stranger can walk into: someone arriving from a
 * consent screen with no idea what this app is needs a way to the landing. ⚠️ The precedent cited
 * here was the gate page's own way-back link (`GATE_COPY.back` — "the one room a stranger can walk
 * into needs an exit"), which `1d` deletes; the rule outlives it, and the sign-in screen now applies
 * it directly by carrying its own mark and privacy link while this footer hides itself there.
 *
 * A `<ul>` of two `<li>`s and **no `<nav>`**: one `contentinfo` landmark is enough, and a second
 * unlabeled landmark is what axe's `landmark-unique` complains about. Preflight's `list-style: none`
 * is CORRECT here — this is a chrome link row, not prose. (That it must be undone for the notice's
 * lists and kept for this one is why `notice-article.tsx` sets classes per block.)
 *
 * 🔴 **A CLIENT component, and it had to become one — `AUTH-1` 1d, found by a failing e2e test.**
 * It was a server component reading `x-pathname`, a header the proxy forwarded, with a docblock
 * arguing that `usePathname()` would mean "a client component on every route for one attribute".
 * ⚠️ **That argument was wrong about the cost and silent about a bug.** This is ONE leaf in the root
 * layout with no data dependencies — making it client re-renders nothing else — and **Next does not
 * re-render the root layout on a client-side navigation**, so the forwarded header is STALE after a
 * soft nav. `aria-current` was quietly wrong that way all along (the old comment considered a
 * SPOOFED header, never a stale one). `1d` made the staleness load-bearing by hanging the footer's
 * VISIBILITY on it: clicking the landing's sign-in link left the footer rendered on `/sign-in`, so
 * that screen showed two links to `/` and two to `/privacy` — exactly what the suppression exists to
 * prevent. It only passed before because every test reached `/sign-in` by `page.goto` (a hard
 * navigation, which does re-render the layout).
 * ⚠️ `x-pathname` had no other consumer, so `1d` deleted `proxy.ts`'s forwarding and its pins in the
 * same change rather than leaving them behind.
 *
 * 360px, with the arithmetic rather than a trust in flex-wrap: `px-4` leaves a 328px content box;
 * `mat-plan` (~62px at 14px) + `gap-x-4` (16px) + `Privacy notice` (~95px) ≈ 173px, one line with
 * room to spare. `flex-wrap` + `gap-y-1` is for 200% zoom (≈164px effective), where the row stacks
 * instead of overflowing. `min-h-11` on each link is the gate's pattern, and the footer sits OUTSIDE
 * `<main>`, so the a11y spec's `expectLinkTapTargets` counts are untouched.
 */
export function SiteFooter() {
  const pathname = usePathname();
  // 🔴 **Not on the sign-in subtree** _(maintainer, 2026-11-05)_. That screen carries the mark as its
  // own home link above the card and one `/privacy` link below it, so both of this footer's
  // destinations are already present — rendering it there would be two links to `/` and two to
  // `/privacy` on one page, the duplicate-destination problem this file's own docblock argues
  // against. ⚠️ `matchesPathTree`, not equality: `/sign-in` is a catch-all (`[[...rest]]`) and OAuth
  // lands on its CHILDREN, so an exact check would put the footer back mid-handshake.
  if (pathname !== null && matchesPathTree(SIGN_IN_PATH, pathname)) return null;

  const items = [
    { href: '/', label: FOOTER_COPY.home },
    { href: PRIVACY_PATH, label: FOOTER_COPY.privacy },
  ] as const;

  return (
    <footer className="mx-auto w-full max-w-2xl px-4 pt-8 pb-6">
      {/* Left-aligned on phones, centred from `sm` up _(maintainer, 2026-11-05)_. The footer's own
          column is `max-w-2xl`, so left-aligned links sit at the left edge of a centred 672px box —
          which on a wide screen reads as "off-centre" rather than "left-aligned", especially under a
          centred card. On a phone the box IS the viewport, so left is simply left, and it keeps the
          links on the thumb side with the rest of the app's text. */}
      <ul className="flex flex-wrap justify-start gap-x-4 gap-y-1 sm:justify-center">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={QUIET_LINK_CLASS}
              // `usePathname()`, so this is correct after a client-side navigation too — which the
              // forwarded header was not. See the docblock.
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </footer>
  );
}
