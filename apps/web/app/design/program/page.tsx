import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { NAV_LINK_CLASS, NAV_ROW_CLASS } from '@/lib/constants';
import { requireSession } from '@/lib/dal/session';

import { PreviewHarness } from './preview-harness';
import {
  parsePreview,
  PREVIEW_SCREEN_NAMES,
  PREVIEW_SCREENS,
  previewEntries,
  previewHref,
  previewLabel,
  PROGRAM_PREVIEW_PATH,
} from './preview-registry';

/**
 * `/design/program`: each FAM-1 screen, mounted with a named fixture and the fakes (plan §4, §6).
 *
 * `?screen=<screen>&fixture=<name>` mounts that screen with that fixture; `&fail=next` makes the
 * fake's next write fail. With no params, or ones that name nothing, it lists every state as a
 * link. The screens, fixtures and links all come from `preview-registry.ts`.
 *
 * ## Why a route
 *
 * The reasons `/design/tokens` gives: no new dependency, and every PR's Vercel preview serves it,
 * so a screen is checked on a real phone against the accepted prototype before its data exists.
 * It renders inside the real `AppShell`, so a screen gets the measure, the padding and the one
 * `<main>` it will have in production. `nav={false}` because the rail lists the household's real
 * athletes and this page shows fixture ones.
 *
 * ## Gating
 *
 * Exactly as `/design/tokens`: `requireSession()` in the page body, which
 * `app/pages-need-a-session.test.ts` enforces, plus `noindex`. It is not excluded from production
 * builds, because a Vercel preview is one. **It reads no data**: there is no DAL call beyond the
 * session check, every value shown is a fixture of synthetic people, and the actions are in-memory
 * fakes that write nothing. **Nothing links here**: it is reached by typing the path, and
 * `preview-registry.test.ts` keeps it out of the app's navigation.
 *
 * ## Its lifetime
 *
 * It stays while lanes B and C build against fixtures, and while later milestones change the same
 * screens. The contract owner removes it, with the fakes, when no screen is built this way.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const INDEX_TITLE = 'Program preview';

/**
 * A title per state. Next announces a client navigation by the title changing, so one static title
 * would make moving between the index and its 21 states silent to a screen reader.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const selection = parsePreview(await searchParams);
  return {
    title: selection ? `Preview: ${previewLabel(selection)}` : INDEX_TITLE,
    // Not indexable. Gated too, so this is belt and braces.
    robots: { index: false, follow: false },
  };
}

export default async function ProgramPreviewPage({ searchParams }: Props) {
  // The session is the boundary, re-checked here and not inherited from the proxy (SECURITY.md).
  await requireSession();

  const selection = parsePreview(await searchParams);

  if (selection) {
    return (
      <AppShell nav={false}>
        {/* One link and a caption: not a navigation landmark (the rule at `app/p/new/page.tsx`). */}
        <div className="flex flex-col gap-1">
          <Link href={PROGRAM_PREVIEW_PATH} className={NAV_LINK_CLASS}>
            ← All screens and fixtures
          </Link>
          <p className="text-muted-foreground text-sm">Preview: {previewLabel(selection)}</p>
        </div>
        {/* Keyed, so moving to another state starts from its fixture and not the last one's edits. */}
        <PreviewHarness key={previewHref(selection)} {...selection} />
      </AppShell>
    );
  }

  const entries = previewEntries();
  return (
    <AppShell nav={false}>
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{INDEX_TITLE}</h1>
        <p className="text-muted-foreground max-w-prose">
          Each FAM-1 screen with a named fixture and in-memory actions. Nothing here reads or writes
          the household&rsquo;s data, and every person shown is made up.
        </p>
      </header>
      {PREVIEW_SCREEN_NAMES.map((screen) => (
        <section key={screen} aria-labelledby={`preview-${screen}`} className="flex flex-col gap-3">
          <h2 id={`preview-${screen}`} className="text-lg font-medium">
            {PREVIEW_SCREENS[screen].title}
          </h2>
          <ul className="flex flex-col gap-2">
            {entries
              .filter((entry) => entry.screen === screen)
              .map((entry) => (
                <li key={previewHref(entry)}>
                  <Link href={previewHref(entry)} className={NAV_ROW_CLASS}>
                    <span className="text-sm font-medium">{entry.fixture}</span>
                    {/* A real space, so the link's name is two words whatever the layout. */}{' '}
                    {entry.failNext ? (
                      <span className="text-muted-foreground text-sm">the next write fails</span>
                    ) : null}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </AppShell>
  );
}
