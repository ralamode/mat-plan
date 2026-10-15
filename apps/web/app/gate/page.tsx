import type { Metadata } from 'next';
import Link from 'next/link';

import { safeInternalPath } from '@/lib/access-gate';
import { APP_NAME, GATE_COPY, QUIET_LINK_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { GateForm } from './gate-form';

/** A password prompt must not become the public search result for "mat-plan" (OSS-2). */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Access-gate stopgap entry page (V0-4). Replaced by Clerk household login at AUTH-1. */
export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const safeFrom = safeInternalPath(from);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="text-muted-foreground text-sm">{GATE_COPY.subhead}</p>
      </header>
      <GateForm from={safeFrom} />
      <Link href="/" className={cn(QUIET_LINK_CLASS, 'self-center')}>
        <span aria-hidden="true">←&nbsp;</span>
        {GATE_COPY.back}
      </Link>
    </main>
  );
}
