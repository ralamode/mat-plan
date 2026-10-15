import Link from 'next/link';

import { FOOTER_COPY, PRIVACY_PATH, QUIET_LINK_CLASS } from '@/lib/constants';

/**
 * PRIV-2 — the one `<footer>`, in the root layout, so the privacy notice is reachable from every
 * screen rather than only by typing the URL, and so a family inside the app can find it too.
 *
 * Two items, because `/privacy` is the SECOND room a stranger can walk into: someone arriving from a
 * consent screen with no idea what this app is needs a way to the landing, exactly as the gate's own
 * way-back link does (`GATE_COPY.back` — "the one room a stranger can walk into needs an exit").
 *
 * A `<ul>` of two `<li>`s and **no `<nav>`**: one `contentinfo` landmark is enough, and a second
 * unlabeled landmark is what axe's `landmark-unique` complains about. Preflight's `list-style: none`
 * is CORRECT here — this is a chrome link row, not prose. (That it must be undone for the notice's
 * lists and kept for this one is why `notice-article.tsx` sets classes per block.)
 *
 * 360px, with the arithmetic rather than a trust in flex-wrap: `px-4` leaves a 328px content box;
 * `mat-plan` (~62px at 14px) + `gap-x-4` (16px) + `Privacy notice` (~95px) ≈ 173px, one line with
 * room to spare. `flex-wrap` + `gap-y-1` is for 200% zoom (≈164px effective), where the row stacks
 * instead of overflowing. `min-h-11` on each link is the gate's pattern, and the footer sits OUTSIDE
 * `<main>`, so the a11y spec's `expectLinkTapTargets` counts are untouched.
 */
export function SiteFooter({ pathname }: { pathname: string | null }) {
  const items = [
    { href: '/', label: FOOTER_COPY.home },
    { href: PRIVACY_PATH, label: FOOTER_COPY.privacy },
  ] as const;

  return (
    <footer className="mx-auto w-full max-w-2xl px-4 pt-8 pb-6">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={QUIET_LINK_CLASS}
              // The pathname comes from the header the proxy forwards, so this stays a SERVER
              // component. The worst case of a spoofed `x-pathname` is a wrong `aria-current`.
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
