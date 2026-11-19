'use client';

import { PROGRAM_REFUSAL, type ProgramActions, type ProgramView } from '@mat-plan/shared';
import { useRef, useState } from 'react';

import { PutOn } from './put-on-dialog';
import { BuilderLink } from './route-link';

import { Button } from '@/components/ui/button';
import { athletePath, FOCUS_TARGET_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';

import {
  athleteHint,
  BUILDER_COPY,
  PENDING_CLASS,
  takenOffText,
  takeOffFailedText,
  takeOffLabel,
  takingOffLabel,
} from './builder-text';

const HEADING_ID = 'program-whos-on-it';

/**
 * Focus is still where the tap left it: on the button, or lost because the button unmounted. An
 * answer that lands after the person has moved on (into Rename, say) must not pull focus away; on
 * a phone that would close the keyboard mid-word.
 */
const focusStayed = (tapped: HTMLElement | undefined) => {
  const at = document.activeElement;
  return !at || at === document.body || at === tapped;
};

/**
 * "Who's on it", with Take off (FAM-1 step 8a; the prototype's `takeoff`), wired at step 15.
 *
 * - **Each name is a link to the athlete's day page** (step 15, UX1-S4): after a Put on, the way to
 *   see what they now have. The row around it stays the focus target after a Take off.
 * - Take off shows only when the route supplies `takeOff` and the athlete has no last day yet. No
 *   confirm, as the prototype: it ends the program after today, and its message says how to undo it.
 * - **Focus has somewhere to go.** The button unmounts on success: someone who had started stays
 *   listed with a last day, so focus moves to their row; someone who had not started leaves the
 *   list, so focus moves to the section's heading. The message is reported after the move, so the
 *   polite announcement is not cut off by it. Only if focus is still where the tap left it: an
 *   answer that lands after the person moved on leaves their focus alone.
 * - A refusal keeps the button, refocuses it and says so as an alert, and so does a Take off that
 *   throws (a dropped connection), so no button is left pending. While one Take off is pending,
 *   every Take off button is `aria-disabled`.
 */
export function WhosOnIt({
  program,
  takeOff,
  putOn,
  onStatus,
}: {
  program: ProgramView;
  takeOff: ProgramActions['takeOff'];
  /** "Put someone on this program…": shown only when the route supplies it (since step 15). */
  putOn: ProgramActions['putOn'];
  /** Reports to the page's status line; `alert` for a refusal the person must act on. */
  onStatus: (message: string, tone?: 'alert') => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function takeOffAthlete(athlete: ProgramView['athletes'][number]) {
    if (!takeOff || pending) return;
    const tapped = buttons.current.get(athlete.profilePublicId);
    setPending(athlete.profilePublicId);
    let result: Awaited<ReturnType<typeof takeOff>>;
    try {
      result = await takeOff({
        programPublicId: program.programPublicId,
        profilePublicId: athlete.profilePublicId,
      });
    } catch {
      // A dropped connection is a refusal, as Put on's (`put-on-dialog.tsx`): said, and retryable.
      result = { ok: false, reason: PROGRAM_REFUSAL.retry };
    }
    setPending(null);
    if (!result.ok) {
      if (focusStayed(tapped)) buttons.current.get(athlete.profilePublicId)?.focus();
      onStatus(takeOffFailedText(athlete.name), 'alert');
      return;
    }
    // What Take off did, from its answer (C15): a last day means they stay listed until then; none
    // means they never started and leave the list (a start dated today included).
    const started = result.lastDay !== null;
    requestAnimationFrame(() => {
      const row = started ? rows.current.get(athlete.profilePublicId) : null;
      if (focusStayed(tapped)) (row ?? headingRef.current)?.focus();
      onStatus(takenOffText(athlete.name, program.name, started));
    });
  }

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2
        id={HEADING_ID}
        ref={headingRef}
        tabIndex={-1}
        className={`rounded-sm text-lg font-semibold ${FOCUS_TARGET_CLASS}`}
      >
        {BUILDER_COPY.whosOnIt}
      </h2>
      {program.athletes.length ? (
        <ul className="flex flex-col gap-2">
          {program.athletes.map((athlete) => (
            <li
              key={athlete.profilePublicId}
              className="flex items-center gap-2 rounded-lg border px-4 py-2"
            >
              <div
                ref={(node) => {
                  if (node) rows.current.set(athlete.profilePublicId, node);
                  else rows.current.delete(athlete.profilePublicId);
                }}
                tabIndex={-1}
                className={`flex min-w-0 flex-1 flex-col rounded-sm ${FOCUS_TARGET_CLASS}`}
              >
                <BuilderLink
                  href={athletePath(athlete.profilePublicId)}
                  className={`focus-visible:ring-ring inline-flex min-h-11 max-w-full items-center self-start rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-3 ${NAME_WRAP_CLASS}`}
                >
                  {athlete.name}
                </BuilderLink>
                <span className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
                  {athleteHint(athlete, program.today)}
                </span>
              </div>
              {takeOff && athlete.lastDay === null ? (
                <Button
                  ref={(node) => {
                    if (node) buttons.current.set(athlete.profilePublicId, node);
                    else buttons.current.delete(athlete.profilePublicId);
                  }}
                  variant="ghost"
                  className={`shrink-0 ${PENDING_CLASS}`}
                  aria-label={
                    pending === athlete.profilePublicId
                      ? takingOffLabel(athlete.name)
                      : takeOffLabel(athlete.name)
                  }
                  // One Take off at a time: every button says so while one is pending.
                  aria-disabled={pending !== null || undefined}
                  onClick={() => takeOffAthlete(athlete)}
                >
                  {pending === athlete.profilePublicId
                    ? BUILDER_COPY.takingOff
                    : BUILDER_COPY.takeOff}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{BUILDER_COPY.noOneOnIt}</p>
      )}
      {putOn ? (
        <PutOn program={program} putOn={putOn} takeOffWired={!!takeOff} onStatus={onStatus} />
      ) : null}
    </section>
  );
}
