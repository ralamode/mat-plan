'use client';

import { PROFILE_KIND_LABELS } from '@mat-plan/shared';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';

import { archiveAthleteAction, restoreAthleteAction } from '@/app/p/profile-actions';
import { useOnActionSuccess } from '@/app/p/[profileId]/use-on-action-success';
import { UndoLine } from '@/components/undo-line';
import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import {
  ANNOUNCE_AFTER_FOCUS_MS,
  athleteEditPath,
  athleteExportPath,
  EXPORT_CSV_LABEL,
  NAME_WRAP_CLASS,
  NAV_LINK_CLASS,
  NOTHING_TO_EXPORT,
  SETTINGS_COPY,
  SETTINGS_PATH,
  UNDO_BUTTON_ATTR,
  UNDO_LABEL,
} from '@/lib/constants';

import { INITIAL_ACTION_STATE } from '@/app/p/[profileId]/action-state';

import type { HouseholdAthleteDTO } from '@/lib/dal/profiles';

/** The focusable row id, so restore can land the person on the athlete who came back. */
const athleteRowId = (publicId: string) => `athlete-${publicId}`;
const RESULT_MESSAGE_ID = 'athlete-result';
const ARCHIVE_HELP_ID = 'archive-help';
/** The focus sentinel for "the Undo button", which has no stable id of its own. */
const UNDO_FOCUS = 'undo';

/**
 * One form + one submit, for the two id-only actions (PROF-1 b).
 *
 * 🔴 **Archive and Restore were nine near-verbatim lines apart**, differing in the action, two copy
 * strings and one `aria-describedby`. `V1-9b`'s delete and restore would have made that four copies,
 * which is the shape the maintainer's N4 rule names.
 *
 * ⚠️ **`onSubmit` + `preventDefault` is the real guard; `aria-disabled` alone was theatre.** The
 * first version put `aria-disabled` on a `type="submit"` inside a `<form action={…}>` and claimed a
 * double tap was prevented. It is not: `aria-disabled` does not stop a native submit, so two actions
 * dispatched — and a screen reader was told "dimmed" about a control that still fired, which is worse
 * than no attribute at all. Both writers are idempotent, so nothing broke; the claim was the defect.
 */
function IdActionButton({
  action,
  profileId,
  label,
  ariaLabel,
  describedBy,
  pending,
}: {
  action: (formData: FormData) => void;
  profileId: string;
  label: string;
  ariaLabel: string;
  describedBy?: string;
  pending: boolean;
}) {
  return (
    <form action={action} onSubmit={(e) => pending && e.preventDefault()}>
      <input type="hidden" name="profileId" value={profileId} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-disabled={pending || undefined}
      >
        {label}
      </Button>
    </form>
  );
}

/**
 * ONE row shape, a `controls` prop, and the 360px math done once (PROF-1 b).
 *
 * 🔴 **Why this is a component and not two near-identical blocks.** The Athletes and Archived
 * sections differ only in which buttons they carry, and the maintainer's N4 rule is explicit: a block
 * that appears twice gets parameterized at the second copy. The concrete payoff here is the width
 * math — two copies is how the 360px fix lands in one section and is missed in the other.
 *
 * ## The width math, at 360px
 *
 * `360 − px-4×2 = 328` in `<main>`, and the card's own `px-4` leaves **296px**. At `text-sm`/500,
 * Geist is ≈7.5px/char, and `Button size="sm"` adds ≈22px of padding and border:
 *
 * | Thing | ≈px |
 * | --- | --- |
 * | `Edit` | 52 |
 * | `Archive` / `Restore` | 74 |
 * | `↓ Export CSV` | 120 |
 * | a 40-char name at `text-base`/500 | **340 — wider than the card on its own** |
 *
 * So the row is **two stacked lines**, never one of four items. One row of
 * name + kind + Edit + Archive leaves `296 − 52 − 74 − 45 − 24 = 101px` for the name, which is four
 * lines of `wrap-anywhere` beside two 44px buttons floated by `items-center` — and **nothing in CI
 * sees it**: `scrollWidth` never grows, and the tap-target gate measures height.
 *
 * - The name and the kind are **one inline text run**, so the kind flows after the name instead of
 *   being a sibling flex item competing for width. `NAME_WRAP_CLASS` carries the `min-w-0` that lets
 *   a long name break at all.
 * - The controls sit on their own `flex-wrap` line, so at 200% text an item wraps **whole** rather
 *   than being clipped (`Restore` + `↓ Export CSV` ≈ 222px, which doubles past 296).
 */
function AthleteRow({
  athlete,
  controls,
}: {
  athlete: HouseholdAthleteDTO;
  controls: React.ReactNode;
}) {
  return (
    <li
      id={athleteRowId(athlete.id)}
      // Focusable only programmatically: restore moves focus here so a screen-reader user lands on
      // the athlete who came back rather than on `<body>`. It is not a tab stop.
      tabIndex={-1}
      className="focus-visible:ring-ring flex flex-col gap-2 rounded-lg border px-4 py-3 outline-none focus-visible:ring-3"
    >
      <p className={NAME_WRAP_CLASS}>
        <span className="font-medium">{athlete.name}</span>{' '}
        <span className="text-muted-foreground text-sm">· {PROFILE_KIND_LABELS[athlete.kind]}</span>
      </p>
      <div className="flex flex-wrap gap-2">{controls}</div>
    </li>
  );
}

/**
 * Household settings' one interactive island (PROF-1 b).
 *
 * The server page owns the data and the headings; this owns the three things only a client can do:
 * the forms, the one live region, and focus.
 *
 * ## Focus is TRANSITION-driven, and the order is announce-AFTER-focus
 *
 * 🔴 **`useOnActionSuccess`'s shape, not a mount effect.** A mount effect fires on any remount — a
 * parent key change, a replayed pre-hydration submit — and cannot tell "this person just archived"
 * from "the island re-rendered". The repo already settled this
 * (`[profileId]/use-on-action-success.ts`); here the trigger is `useActionState`'s object identity.
 *
 * 🔴 **Focus first, then announce one frame later.** A synchronous focus change makes VoiceOver speak
 * the focused element and commonly suppresses or interleaves a pending `polite` region, so an
 * announcement set in the same commit as the focus move is the one most likely to be swallowed. The
 * approved prototype orders it the same way, with a ~60ms gap.
 */
export function AthleteList({
  athletes,
  canArchive,
}: {
  athletes: HouseholdAthleteDTO[];
  /** `canArchiveAthletes` from the DAL — a boolean, never the role and never the scope. */
  canArchive: boolean;
}) {
  const [archiveState, archive, archivePending] = useActionState(
    archiveAthleteAction,
    INITIAL_ACTION_STATE,
  );
  const [restoreState, restore, restorePending] = useActionState(
    restoreAthleteAction,
    INITIAL_ACTION_STATE,
  );

  const [announcement, setAnnouncement] = useState('');
  const [result, setResult] = useState<{ kind: 'archived' | 'restored'; id: string } | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ id: string; n: number } | null>(null);
  const nameOf = (id: string) => athletes.find((a) => a.id === id)?.name ?? '';

  // 🔴 **The repo's hook, imported — not its body copied a fifth and sixth time.** The first version
  // of this island re-implemented `useOnActionSuccess`'s `seen`/identity-compare inline, twice, while
  // its own comment said "the repo already settled this". That hook's docblock exists *because* the
  // idiom had been copy-pasted four times; a reuse lens pointed out I had just made it six.
  useOnActionSuccess(archiveState, () => {
    if (!archiveState.savedId) return;
    setResult({ kind: 'archived', id: archiveState.savedId });
    setFocusTarget((f) => ({ id: UNDO_FOCUS, n: (f?.n ?? 0) + 1 }));
  });
  useOnActionSuccess(restoreState, () => {
    if (!restoreState.savedId) return;
    setResult({ kind: 'restored', id: restoreState.savedId });
    setFocusTarget((f) => ({ id: athleteRowId(restoreState.savedId!), n: (f?.n ?? 0) + 1 }));
  });

  const pending = archivePending || restorePending;

  // Derived once, used by the effect AND the render. It was written out twice before.
  const resultMessage =
    result?.kind === 'archived'
      ? SETTINGS_COPY.archivedResult(nameOf(result.id))
      : result
        ? SETTINGS_COPY.restoredResult(nameOf(result.id))
        : '';

  // 🔴 **The refusal a person can actually hit, which the first version dropped on the floor.**
  // `enterMutation` returns `NO_ATHLETE_SAVE` when a session has lapsed — iOS evicting a backgrounded
  // settings tab is the ordinary way — and `RATE_LIMITED` under the mutation limiter. Neither needs a
  // crafted request. Without this the parent taps Restore on the gym floor, `pending` flips and
  // clears, and **nothing changes**: no text, no announcement, no focus. So they tap again, which the
  // limiter counts. `role="alert"` rather than the polite region, because there is something to act
  // on — and an alert MAY mount with its text, unlike `Announcer` (see its rule 1).
  const error = restoreState.error ?? archiveState.error;

  useEffect(() => {
    if (!focusTarget) return;
    // Focus SYNCHRONOUSLY…
    const el =
      focusTarget.id === UNDO_FOCUS
        ? document.querySelector<HTMLElement>(`[${UNDO_BUTTON_ATTR}]`)
        : document.getElementById(focusTarget.id);
    el?.focus();
    // …then let the region change land a frame later, so the focus speech does not swallow it.
    const t = setTimeout(() => setAnnouncement(resultMessage), ANNOUNCE_AFTER_FOCUS_MS);
    return () => clearTimeout(t);
    // The TRANSITION is what should re-run this, not every render that recomputes the message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget]);

  const live = athletes.filter((a) => !a.archived);
  const archived = athletes.filter((a) => a.archived);

  return (
    <>
      {/* The ONE persistent live region for this page. ⚠️ Mounted unconditionally and with NO class
          that hides it while empty: `empty:hidden` resolves to `display:none`, which takes the region
          out of the accessibility tree and makes the next message silent (`announcer.tsx` rule 3 —
          added after a-r's rename form shipped exactly that bug). */}
      <Announcer message={announcement} />

      {/* Between the heading and the first section, so Undo is the second tab stop and on screen. */}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <UndoLine
        message={resultMessage}
        messageId={RESULT_MESSAGE_ID}
        undoLabel={result ? SETTINGS_COPY.undoLabel(nameOf(result.id)) : UNDO_LABEL}
        pending={pending}
        onUndo={
          result?.kind === 'archived'
            ? () => {
                // Undo IS restore — the same writer and the same action, so a lost Undo line costs a
                // scroll to the Restore button, never a capability.
                const data = new FormData();
                data.set('profileId', result.id);
                restore(data);
              }
            : undefined
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{SETTINGS_COPY.athletes}</h2>
        {/* PERMANENT, and above the controls it explains — not in the Archived empty state, which
            disappears the moment anyone is archived. For a member the same slot states why there is
            no Archive button, because that is where they look for it. */}
        <p id={ARCHIVE_HELP_ID} className="text-muted-foreground text-sm">
          {canArchive ? SETTINGS_COPY.archiveHelp : SETTINGS_COPY.ownerOnly}
        </p>
        <ul className="flex flex-col gap-2">
          {live.map((a) => (
            <AthleteRow
              key={a.id}
              athlete={a}
              controls={
                <>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`${athleteEditPath(a.id)}?from=${SETTINGS_PATH}`}
                      aria-label={SETTINGS_COPY.editFor(a.name)}
                    >
                      {SETTINGS_COPY.edit}
                    </Link>
                  </Button>
                  {canArchive ? (
                    <IdActionButton
                      action={archive}
                      profileId={a.id}
                      label={SETTINGS_COPY.archive}
                      ariaLabel={SETTINGS_COPY.archiveFor(a.name)}
                      describedBy={ARCHIVE_HELP_ID}
                      pending={pending}
                    />
                  ) : null}
                </>
              }
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{SETTINGS_COPY.archived}</h2>
        {archived.length === 0 ? (
          <p className="text-muted-foreground text-sm">{SETTINGS_COPY.archivedEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {archived.map((a) => (
              <AthleteRow
                key={a.id}
                athlete={a}
                controls={
                  <>
                    {/* Restore is ANY member (decision M1) — no `canArchive` branch. */}
                    <IdActionButton
                      action={restore}
                      profileId={a.id}
                      label={SETTINGS_COPY.restore}
                      ariaLabel={SETTINGS_COPY.restoreFor(a.name)}
                      pending={pending}
                    />
                    {a.hasHistory ? (
                      // A LINK with NAV_LINK_CLASS, not `Button asChild`: the Button base carries
                      // `whitespace-nowrap shrink-0`, which at 200% text makes this ≈280px against a
                      // 296px card and clips rather than wraps. The day page renders the same
                      // artifact the same way.
                      <a
                        href={athleteExportPath(a.id)}
                        download
                        className={NAV_LINK_CLASS}
                        // SC 2.5.3: the accessible name must CONTAIN the visible text, so the
                        // visible string comes first and a voice-control user saying it matches.
                        aria-label={`${EXPORT_CSV_LABEL} for ${a.name}`}
                      >
                        {EXPORT_CSV_LABEL}
                      </a>
                    ) : (
                      // Maintainer decision N3. Without this the route builds an EOCD-only zip that
                      // iOS Files opens as nothing — indistinguishable from a failed download. A
                      // disabled control with a stated reason is the whole fix.
                      <p className="text-muted-foreground flex min-h-11 items-center text-sm">
                        {NOTHING_TO_EXPORT}
                      </p>
                    )}
                  </>
                }
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
