import type { Metadata } from 'next';
import Link from 'next/link';

import { GitHubMark } from '@/components/landing/github-mark';
import { MatPlanMark } from '@/components/brand/mat-plan-mark';
import { Button } from '@/components/ui/button';
import { APP_NAME, CTA_CLASS, GITHUB_REPO_URL, LANDING_COPY, SIGN_IN_PATH } from '@/lib/constants';

export const metadata: Metadata = {
  description: LANDING_COPY.lead,
};

/**
 * The PUBLIC landing (OSS-2 §A) — one of the routes served without a session. ⚠️ Not "the one page":
 * the public set is `PUBLIC_PATHS` (`/`, `/privacy`) ∪ `PUBLIC_PATH_TREES` (the whole `/sign-in`
 * subtree). Reading `PUBLIC_PATHS` as the full set is exactly how a correction during `1c-3b` came
 * to assert that `/sign-in` was gated. (Before `1d` the set also included `/gate`, via an
 * `isUngatedPath` that no longer exists.)
 *
 * ⚠️ Keep it branchless and private-free: no cookie read, no DAL import, no `requireSession`, no
 * Server Action. It renders identically for every caller, so there is no condition that could serve
 * household content to the internet. ⚠️ **Every caller sees it, signed in or not** (AUTH-1 1c-3b):
 * the proxy used to forward a cookie-holder to the picker, which looped once the pages also required
 * a session. Branchless is what makes that safe — there is no state to leak by rendering it to
 * everyone.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 md:justify-center">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <MatPlanMark className="size-8" />
          <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        </div>
        <p className="max-w-prose text-xl font-semibold tracking-tight text-balance">
          {LANDING_COPY.lead}
        </p>
        <p className="text-muted-foreground max-w-prose">{LANDING_COPY.origin}</p>
      </header>
      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className={CTA_CLASS}>
          <a href={`${GITHUB_REPO_URL}${LANDING_COPY.sourceAnchor}`}>
            <GitHubMark />
            {LANDING_COPY.sourceCta}
          </a>
        </Button>
        <Button asChild size="lg" variant="outline" className={CTA_CLASS}>
          {/* No `?from=`: sign-in's own redirect config decides where login lands, so "where does
              login land" has one answer (and stays server-resolved if HH-1 makes home dynamic). */}
          <Link href={SIGN_IN_PATH}>{LANDING_COPY.signInCta}</Link>
        </Button>
      </div>
    </main>
  );
}
