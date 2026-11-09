import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PROFILE_KIND_LABELS } from '@mat-plan/shared';

import {
  ATHLETE_FORM_COPY,
  NAME_WRAP_CLASS,
  NAV_LINK_CLASS,
  PAGE_SHELL_CLASS,
  QUIET_LINK_CLASS,
  SETTINGS_COPY,
  SETTINGS_PATH,
  athletePath,
} from '@/lib/constants';
import { householdState } from '@/lib/dal/household';
import { getProfileByPublicId } from '@/lib/dal/profiles';
import { requireSession } from '@/lib/dal/session';

import { RenameForm } from './rename-form';

// Route-segment config must be a static inline literal (Next can't follow an imported const), so
// 'nodejs' stays here. pg → Node runtime, not Edge. Mirrors the sibling Today route.
export const runtime = 'nodejs';

/**
 * 🔴 **A STATIC title, never the athlete's name** (PROF-1 D8, UX2). A page title lands in the browser
 * history, the tab strip and — on a shared device — the "recently closed" list, so putting a child's
 * name there publishes personal data to a surface this app does not control and cannot clear.
 */
export const metadata: Metadata = { title: 'Rename athlete' };

/**
 * Rename an athlete (PROF-1 a-r; acceptance criterion 8, "rename shall be reachable from the
 * athlete's own page").
 *
 * 🔴 **The screen is called RENAME, not Edit, and that is a correction.** The link, the heading and
 * the title all said "Edit" while the page carried one field and a button marked "Save name" —
 * three vocabularies for one action, and "Edit" read as *edit today's entries* to anyone tapping it
 * from directly under the day's logged list. The label was inherited from "Edit {name}'s routine",
 * which was accurate when the destination edited a routine; with `kind` dropped (D7) this page
 * renames and does nothing else, so it says so. a-1 or PR b can widen the word when they add a
 * second control.
 *
 * **The omissions are each a decision:**
 *
 * - **No `kind` control.** The kind is SHOWN and not editable — criterion 9 asks the form to show
 *   Child/Adult, and showing is not editing. One control cannot serve both "I added them as the
 *   wrong kind" (where emptying past `prescribed` cells is right) and "they turned 18", where those
 *   cells were legitimately theirs (D7). The radio belongs to a-1's ADD form.
 * - **No archive or delete.** They live in household settings and never on an athlete's own page
 *   (criterion 8, R1) — PROF-1 b.
 * - **No Program section** (ASSIGN-1 owns assignments) and **no Activities link** (criterion 11
 *   unlinks the routine editor until ACT-1).
 */
export default async function RenameAthletePage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  // 🔴 **The session IS the boundary (AUTH-1 1d).** Re-checked HERE rather than inherited from the
  // proxy: SECURITY.md refuses to call a matcher-driven layer a boundary (CVE-2025-29927), and
  // SEC-1's own scar was a prefetch header skipping the matcher entirely.
  // `app/pages-need-a-session.test.ts` is what keeps this call here.
  await requireSession();
  const { profileId } = await params;
  const profile = await getProfileByPublicId(profileId);
  // PROF-1 b: a BOOLEAN from the DAL, never the role and never the scope (write-path invariant 2).
  const { canArchiveAthletes: canArchive } = await householdState();
  // Unknown, soft-deleted or another household's id — one answer for all three (ADR 0006: 404, never
  // 403, because the threat is a leaked id and a 403 would confirm the leak is live).
  if (!profile) notFound();

  const own = athletePath(profile.id);
  const from = inAppReferrer((await searchParams).from, own);

  return (
    <main className={PAGE_SHELL_CLASS}>
      <header className="flex flex-col gap-2">
        {/* ⚠️ `min-h-11` (inside `NAV_LINK_CLASS`) is load-bearing and UNGUARDED by the a11y spec,
            which excludes <a> from its tap-target scan (the SC 2.5.8 inline-text exception). It is
            here because this is the recovery path from a screen whose only other control writes —
            a parent who opened the wrong athlete taps this, on a phone, and ~20px of inline text is
            not a thumb target. `e2e/athletes.spec.ts` measures it instead.
            `NAME_WRAP_CLASS` because the label is a name: `w-fit` makes the width derive from
            min-content, which is exactly where `break-words` would do nothing (D11). */}
        <Link href={from ?? own} className={`${NAV_LINK_CLASS} ${NAME_WRAP_CLASS}`}>
          {ATHLETE_FORM_COPY.backTo(profile.name)}
        </Link>
        <h1 className={`text-3xl font-semibold tracking-tight ${NAME_WRAP_CLASS}`}>
          Rename {profile.name}
        </h1>
        {/* Criterion 9: the screen SHOWS the kind — as a **label under the heading, and nothing
            else** _(maintainer, 2026-11-07)_. Two earlier versions over-built it: a `<dl>` whose
            `<dt>` carried the same weight as the Name `<label>`, so a parent scanning for "where do
            I type" saw two field labels and one box; then the same line plus "set when the athlete
            was added", which explains a question nobody asked. A greyed-out radio would be worse
            still — it reads as "temporarily unavailable", which is false.
            The kind is page metadata about who this is, the same shape as the day role on the day
            page's date line (V1-23 D1). It needs no caption, and the absence of a control is not a
            thing to apologise for. */}
        <p className="text-muted-foreground text-sm">{PROFILE_KIND_LABELS[profile.kind]}</p>
      </header>

      <RenameForm profileId={profile.id} name={profile.name} from={from} fallbackPath={own} />

      {/* PROF-1 b: archive is not on this form, so the screen says where it IS rather than leaving a
          parent to hunt. 🔴 **This is the ONE member-branched copy line in the feature** — a member
          cannot archive, so telling them to go to a screen whose Archive button they will not see
          would be the misdirection the day page's notice was corrected for. Restore is any-member, so
          that notice has no branch; archive is owner-only, so this one does. */}
      <p className="text-muted-foreground text-sm">
        {canArchive ? (
          <>
            {SETTINGS_COPY.archiveElsewhere}{' '}
            <Link href={SETTINGS_PATH} className={QUIET_LINK_CLASS}>
              {SETTINGS_COPY.heading}
            </Link>
            .
          </>
        ) : (
          SETTINGS_COPY.ownerOnly
        )}
      </p>
    </main>
  );
}

/**
 * The in-app referrer, **allowlisted** — or `null` when this page was not reached from inside the app.
 *
 * 🔴 **`null` is the load-bearing answer, and dropping this parameter was a review finding.** The
 * island uses it as the SIGNAL that `router.back()` is safe, not merely as a destination.
 * `window.history.length > 1` is true in almost every real phone tab (Safari reuses tabs; a pasted
 * link or a bookmark lands on top of whatever was there), so without `from` a parent who typed the
 * URL would be sent out of the app after a successful save. Two lenses found that independently.
 *
 * 🔴 **An allowlist, not `safeInternalPath`.** That helper clamps a path to this origin, which stops
 * an open redirect but still lets `?from=/anything/internal` point the back link anywhere in the app.
 * Here the legitimate set is known and tiny: today, the athlete's own day page. **A list of one is
 * not a reason to skip the mechanism** — the presence of the param is the signal, and PROF-1 b adds
 * `SETTINGS_PATH` to this array without touching the island.
 *
 * An array param (`?from=a&from=b`) arrives as a `string[]`, which is not one of the allowed values,
 * so it falls through like any other mismatch rather than needing its own branch.
 */
function inAppReferrer(from: string | string[] | undefined, own: string): string | null {
  // PROF-1 b adds `SETTINGS_PATH`, which three comments in this file and `rename-form.tsx` already
  // said it would — the island sends `?from=/settings`, and without the entry the allowlist fails
  // CLOSED (safe: no open redirect) and silently sends the parent to the day page instead of back to
  // the list they came from. A security lens found the code and its own comments disagreeing.
  const allowed = [own, SETTINGS_PATH];
  return typeof from === 'string' && allowed.includes(from) ? from : null;
}
