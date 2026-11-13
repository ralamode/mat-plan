import { SiteFooter } from '@/components/layout/site-footer';
import type { Metadata } from 'next';

import { NOTICE_TITLE } from '@/lib/privacy/notice-content';

import { NoticeArticle } from './notice-article';

/**
 * ✅ **INDEXABLE from AUTH-1 1d** _(maintainer, 2026-11-05)_. `robots: noindex` shipped with PRIV-2
 * and is now removed.
 *
 * 🔴 **The reason it shipped, and why `1d` is the right moment to lift it — which is NOT the reason
 * that was written here.** The committed argument was that the notice is an honest inventory of the
 * beta's weaknesses (one shared access code, households not separated, "delete" meaning "hidden")
 * *while the gate's brute-force limiter fails open when Upstash is unconfigured* — so publishing a
 * description of a lock before that lock's limiter was armed was a free gift to a scanner.
 *
 * ⚠️ **`1d` does not arm that limiter. It DELETES it, along with the lock it protected.** So the
 * stated premise is not satisfied, it is dissolved: there is no shared code to brute-force, and the
 * surviving limiter is keyed on an authenticated principal. The weaknesses the notice lists are now
 * about what a signed-in household member can see, which no amount of search-indexing helps an
 * outsider with.
 *
 * And the page has a job that indexing serves: it is the URL Google's and Clerk's consent screens
 * point at, and the only public description of what this app holds. A privacy notice that search
 * engines cannot see is of limited use to the people it is written for.
 *
 * ⚠️ `noindex` never affected fetchability — the response was always a 200, and a human or an OAuth
 * console following the link got it unchanged. Removing it changes discoverability only.
 */
export const metadata: Metadata = {
  title: NOTICE_TITLE,
};

/**
 * PRIV-2 — the privacy notice at `PRIVACY_PATH`, the URL the Clerk and Google consent screens point
 * at. The second route in `PUBLIC_PATHS`.
 *
 * ⚠️ Keep it branchless and input-free: **no `params`, no `searchParams`**, no `fs`, no cookie, no
 * DAL, no Server Action. The content is a module-level const compiled into the build, so "static or
 * generated — never a file read keyed on a request param" is a property of the code, not a promise:
 * there is no request value to key a read on, and `notice.md` is not on the function filesystem to
 * read. A caller WITH the gate cookie sees this same page — the proxy's authed-redirect arm is
 * `pathname === '/'` by design.
 *
 * **No `dynamic` and no `revalidate` of its own**, deliberately. It inherits the root layout's
 * `force-dynamic`, which the CSP nonce depends on: `layout.tsx` reads a per-request `x-nonce`, so a
 * cached or statically rendered page would bake ONE nonce into its HTML while the response header
 * carried a fresh one, and every nonce'd script on the page would be CSP-blocked silently — the
 * theme script first. `lib/privacy/notice-content.test.ts` asserts the absence.
 */
export default function PrivacyPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <NoticeArticle />
      </main>
      <SiteFooter />
    </>
  );
}
