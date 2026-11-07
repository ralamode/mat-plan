import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PROFILE_KIND_LABELS } from '@mat-plan/shared';

import { ATHLETE_FORM_COPY, athletePath, NAME_WRAP_CLASS } from '@/lib/constants';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { requireSession } from '@/lib/dal/session';

import { AthleteForm } from './athlete-form';

// Route-segment config must be a static inline literal (Next can't follow an imported const), so
// 'nodejs' stays here. pg → Node runtime, not Edge. Mirrors the sibling Today route.
export const runtime = 'nodejs';

/**
 * 🔴 **A STATIC title, never the athlete's name** (PROF-1 D8, UX2). A page title lands in the browser
 * history, the tab strip and — on a shared device — the "recently closed" list, so putting a child's
 * name there publishes personal data to a surface this app does not control and cannot clear.
 */
export const metadata: Metadata = { title: 'Edit athlete' };

/**
 * Rename an athlete (PROF-1 a-r; acceptance criterion 8, "rename shall be reachable from the
 * athlete's own page").
 *
 * **Rename only, and the omissions are each a decision:**
 *
 * - **No `kind` control.** The kind is SHOWN and not editable — criterion 9 asks the form to show
 *   Child/Adult, and showing is not editing. One control cannot serve both "I added them as the
 *   wrong kind" (where emptying past `prescribed` cells is right) and "they turned 18" (where those
 *   cells were legitimately theirs), and the second is the realistic trigger
 *   (`docs/plans/prof-1-athletes.md` → D7). The radio belongs to a-1's ADD form.
 * - **No archive or delete.** They live in household settings and never on an athlete's own page
 *   (criterion 8, R1) — PROF-1 b.
 * - **No Program section.** ASSIGN-1 owns assignments; there is nothing to show yet (D4b).
 * - **No Activities link.** Criterion 11 (M30) unlinks the routine editor until ACT-1, so adding one
 *   here would restore the link the same PR removes from the day page.
 *
 * So this screen is a back link, a heading, one fact and one field, which is the whole design.
 */
export default async function EditAthletePage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  // 🔴 **The session IS the boundary (AUTH-1 1d).** Re-checked HERE rather than inherited from the
  // proxy: SECURITY.md refuses to call a matcher-driven layer a boundary (CVE-2025-29927), and
  // SEC-1's own scar was a prefetch header skipping the matcher entirely.
  // `app/pages-need-a-session.test.ts` is what keeps this call here.
  await requireSession();
  const { profileId } = await params;
  const profile = await getProfileByPublicId(profileId);
  // Unknown, soft-deleted or another household's id — one answer for all three (ADR 0006: 404, never
  // 403, because the threat is a leaked id and a 403 would confirm the leak is live).
  if (!profile) notFound();

  const own = athletePath(profile.id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        {/* ⚠️ `min-h-11` is load-bearing and UNGUARDED by CI: `e2e/a11y.spec.ts` excludes <a> from its
            tap-target scan (the SC 2.5.8 inline-text exception). It is here because this is the
            recovery path from a screen whose only other control writes — a parent who opened the
            wrong athlete taps this, on a phone, and ~20px of inline text is not a thumb target.
            `NAME_WRAP_CLASS` because the label is a name: `w-fit` makes the width derive from
            min-content, which is exactly where `break-words` would do nothing (D11). */}
        <Link
          href={own}
          className={`text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 w-fit items-center rounded-sm text-sm outline-none focus-visible:ring-3 ${NAME_WRAP_CLASS}`}
        >
          ← {profile.name}
        </Link>
        <h1 className={`text-3xl font-semibold tracking-tight ${NAME_WRAP_CLASS}`}>
          Edit {profile.name}
        </h1>
      </header>

      {/* Criterion 9: the form SHOWS the kind. 🔴 **A `<dl>`, not a disabled radio group.** A greyed
          control reads as "temporarily unavailable, try again" — which is false, and it would also
          put two things that look like fields next to each other where only one is. A definition
          list is the semantics for "this label has this value", and it answers "is this the right
          athlete?" BEFORE the parent starts typing. */}
      <dl className="flex flex-col gap-1">
        <dt className="text-sm font-medium">{ATHLETE_FORM_COPY.kindLabel}</dt>
        <dd className="text-base">{PROFILE_KIND_LABELS[profile.kind]}</dd>
        <dd className="text-muted-foreground text-sm">{ATHLETE_FORM_COPY.kindNote}</dd>
      </dl>

      <AthleteForm profileId={profile.id} name={profile.name} fallbackPath={own} />
    </main>
  );
}
