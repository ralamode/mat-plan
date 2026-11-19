import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { BUILDER_COPY } from '@/components/program-builder/builder-text';
import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import { NAV_LINK_CLASS, NOT_FOUND_COPY } from '@/lib/constants';

export const metadata: Metadata = { title: NOT_FOUND_COPY.heading };

/**
 * A program or a workout (7b-ii) this household cannot see, or an id that is not one (FAM-1
 * 7b-i): the app's own words for a 404, so existence never leaks, and the way back to Programs.
 *
 * ⚠️ **It mounts `AppShell` itself**: `notFound()` replaces the page, shell and all, and there is no
 * `app/programs/layout.tsx`, so this is the one `<main>` on the screen. `nav={false}`: a 404 awaits
 * no data, so there are no athletes for a rail.
 */
export default function ProgramNotFound() {
  return (
    <AppShell nav={false}>
      <Link href={PROGRAMS_PATH} className={NAV_LINK_CLASS}>
        {BUILDER_COPY.backToPrograms}
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">{NOT_FOUND_COPY.heading}</h1>
      <p className="text-muted-foreground max-w-prose">{NOT_FOUND_COPY.body}</p>
    </AppShell>
  );
}
