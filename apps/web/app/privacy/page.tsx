import type { Metadata } from 'next';

import { NOTICE_TITLE } from '@/lib/privacy/notice-content';

import { NoticeArticle } from './notice-article';

/**
 * `robots: noindex` — until AUTH-1, same as the gate.
 *
 * `noindex` does NOT affect fetchability: the response is still a 200, and Google's OAuth console
 * (or any human following the link) fetches it unchanged. The two properties are unrelated, which is
 * why this is not in tension with the page existing for a consent screen.
 *
 * The reason to ship it: the notice is an honest inventory of the beta's weaknesses — one shared
 * access code, households not yet separated, "treat the app as if anyone who was invited could see
 * anyone's log", "delete" currently meaning "hidden" — while the gate's brute-force limiter fails
 * open when Upstash is unconfigured (`lib/rate-limit.ts`), and `runbooks.md`'s "the gate rate limit
 * is enforcing" procedure still opens with *set the two variables in Vercel and redeploy*. Making
 * that document a search result before the lock it describes has its limiter armed is a free gift to
 * a scanner for no benefit: the audience is the invited family and the consent screen, and both
 * arrive by link.
 *
 * ⚠️ **It comes off at AUTH-1 chunk 1d**, the chunk that retires the gate and makes the session the
 * boundary — named precisely, because "at AUTH-1" was ambiguous the moment AUTH-1 became six chunks.
 * 1a (Clerk wired and dark) is NOT it: the gate is still the only boundary and `lib/rate-limit.ts`
 * still fails open with Upstash unconfigured, so every reason above still holds.
 */
export const metadata: Metadata = {
  title: NOTICE_TITLE,
  robots: { index: false, follow: false },
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
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <NoticeArticle />
    </main>
  );
}
