import { GitHubMark } from '@/components/landing/github-mark';
import { Button } from '@/components/ui/button';
import { CTA_CLASS, GITHUB_REPO_URL, PICKER_EMPTY_COPY } from '@/lib/constants';

/**
 * The profile picker's explained empty state (ONB-0) — the screen a brand-new deployment opens on.
 *
 * It replaces `<EmptyState>No profiles found. Seed the database to get started.</EmptyState>`, which told
 * a human to run a database command. `EmptyState` is deliberately NOT reused: it renders a `<p>`
 * (`components/ui/empty-state.tsx`), which cannot legally contain an `<h2>`, sibling paragraphs and a
 * button — the committed UX panel's B1 called that out as the obvious implementation that breaks.
 *
 * Decisions that look like style and are not:
 *
 *  - **No box.** The only token that draws a container edge is `border`, which measures **1.26:1** on the
 *    light page (2.69:1 dark) and is pinned as failing SC 1.4.11 in `app/design/tokens/token-sets.test.ts`.
 *    A container nobody can see is not a container, so grouping comes from the `<h2>` + `gap-3`, the way
 *    the landing does it.
 *  - **No `id`, so no `aria-labelledby`.** The section is a plain grouping, which lets this component be
 *    rendered more than once in a document — it is also a cell in `app/design/tokens/inventory.tsx`, which
 *    is the only route that axe-scans it in BOTH themes and measures it for overflow at 360px (the empty
 *    picker is unreachable from Playwright: `fullyParallel: true` + one shared DB).
 *  - **`text-foreground` on the explanatory paragraphs**, not `text-muted-foreground` (4.74:1 — AA by
 *    0.24). Three paragraphs read once, cold, on a gym floor should not sit on the AA floor; only the
 *    short follow-up line is muted. ⚠️ Never put `text-muted-foreground` on `bg-muted`/`bg-accent`/
 *    `bg-secondary` here: that pair measures 4.34:1, and `token-sets.test.ts` asserts no screen does it.
 *  - **`CTA_CLASS` is load-bearing**, not decoration: the button base is `whitespace-nowrap`, and this
 *    label is ~474px at 200% text size against a 296px column. See the const's own comment.
 *  - **Same tab** (no `target="_blank"`): on a phone the back button is the only recovery path a reader
 *    will find, and that is also why no `rel` is needed.
 *
 * **Folder vs filename.** `components/onboarding/` because `docs/roadmap.md`'s pillar table assigns empty
 * states to **Onboarding & Access** (`ONB-*`) while `app/p/` and `lib/dal/profiles.ts` are Profiles &
 * Tenancy, and because ONB-2 adds a second first-run surface (copy on Today) that belongs beside this
 * one rather than in `profiles/`. The FILE is named for the surface it actually is, so that second file
 * has an obvious distinct name instead of two things both called "first run".
 *
 * Pure sync Server Component — no state, no `'use client'`.
 */
export function PickerEmptyState() {
  return (
    <section className="flex max-w-prose flex-col gap-3">
      <h2 className="text-lg font-medium">{PICKER_EMPTY_COPY.heading}</h2>
      <p>{PICKER_EMPTY_COPY.what}</p>
      <p>{PICKER_EMPTY_COPY.next}</p>
      <p className="text-muted-foreground text-sm">{PICKER_EMPTY_COPY.notYet}</p>
      <Button asChild variant="outline" size="lg" className={CTA_CLASS}>
        <a href={`${GITHUB_REPO_URL}${PICKER_EMPTY_COPY.setupAnchor}`}>
          <GitHubMark />
          {PICKER_EMPTY_COPY.setupCta}
        </a>
      </Button>
    </section>
  );
}
