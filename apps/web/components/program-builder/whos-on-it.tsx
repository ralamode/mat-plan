'use client';

import type { ProgramActions, ProgramView } from '@mat-plan/shared';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { NAME_WRAP_CLASS } from '@/lib/constants';

import { athleteHint, BUILDER_COPY, takenOffText, takeOffFailedText } from './builder-text';

const HEADING_ID = 'program-whos-on-it';

/**
 * "Who's on it", with Take off (FAM-1 step 8a; the prototype's `takeoff`).
 *
 * - Take off shows only when the route supplies `takeOff` (step 15 wires it) and the athlete has no
 *   last day yet. No confirm, as the prototype: it ends the program after today.
 * - **Focus has somewhere to go.** The button unmounts on success: someone who had started stays
 *   listed with a last day, so focus moves to their row; someone who had not started leaves the
 *   list, so focus moves to the section's heading. The message is reported after the move, so the
 *   polite announcement is not cut off by it.
 * - A refusal keeps the button, refocuses it and says so.
 */
export function WhosOnIt({
  program,
  takeOff,
  onStatus,
}: {
  program: ProgramView;
  takeOff: ProgramActions['takeOff'];
  onStatus: (message: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function takeOffAthlete(athlete: ProgramView['athletes'][number]) {
    if (!takeOff || pending) return;
    const started = athlete.since <= program.today;
    setPending(athlete.profilePublicId);
    const result = await takeOff({
      programPublicId: program.programPublicId,
      profilePublicId: athlete.profilePublicId,
    });
    setPending(null);
    if (!result.ok) {
      buttons.current.get(athlete.profilePublicId)?.focus();
      onStatus(takeOffFailedText(athlete.name));
      return;
    }
    requestAnimationFrame(() => {
      const row = started ? rows.current.get(athlete.profilePublicId) : null;
      (row ?? headingRef.current)?.focus();
      onStatus(takenOffText(athlete.name, program.name, started));
    });
  }

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2
        id={HEADING_ID}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
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
                className="flex min-w-0 flex-1 flex-col outline-none"
              >
                <span className={`font-medium ${NAME_WRAP_CLASS}`}>{athlete.name}</span>
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
                  className="shrink-0"
                  aria-label={`${BUILDER_COPY.takeOff} ${athlete.name}`}
                  aria-disabled={pending === athlete.profilePublicId || undefined}
                  onClick={() => takeOffAthlete(athlete)}
                >
                  {BUILDER_COPY.takeOff}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{BUILDER_COPY.noOneOnIt}</p>
      )}
    </section>
  );
}
