import type { Metadata } from 'next';
import Link from 'next/link';

import { GitHubMark } from '@/components/landing/github-mark';
import { MatPlanMark } from '@/components/brand/mat-plan-mark';
import { Button } from '@/components/ui/button';
import { GATE_PATH } from '@/lib/access-gate';
import { APP_NAME, GITHUB_REPO_URL, LANDING_COPY } from '@/lib/constants';

export const metadata: Metadata = {
  description: LANDING_COPY.lead,
};

/** The CTAs may wrap: the button base is `whitespace-nowrap`, and at 200% text size the source label
 *  is wider than a 328px phone column. `h-auto` lets the wrapped label grow the button. */
const CTA_CLASS = 'h-auto w-full py-2.5 text-center text-base whitespace-normal';

/**
 * The PUBLIC landing (OSS-2 §A) — the one page served without the access gate (`PUBLIC_PATHS`).
 *
 * ⚠️ Keep it branchless and private-free: no cookie read, no DAL import, no `requireGatedPage`, no
 * Server Action. It renders identically for every caller, so there is no condition that could serve
 * household content to the internet. A caller who already has the gate cookie never sees it — the
 * proxy sends them to the picker (`APP_HOME_PATH`).
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
          {/* No `?from=`: the gate action defaults to the app home, so "where does login land" has one
              answer (and stays server-resolved if HH-1 makes home dynamic). */}
          <Link href={GATE_PATH}>{LANDING_COPY.gateCta}</Link>
        </Button>
      </div>
    </main>
  );
}
