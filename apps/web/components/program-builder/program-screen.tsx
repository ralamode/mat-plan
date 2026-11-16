'use client';

import type { ProgramActions, ProgramView } from '@mat-plan/shared';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { NAV_LINK_CLASS } from '@/lib/constants';

import { BUILDER_COPY, usedByText } from './builder-text';
import { ProgramHeader } from './program-header';
import { PROGRAMS_PATH } from './routes';
import { WeekShell } from './week-shell';
import { WhosOnIt } from './whos-on-it';
import { WorkoutsList } from './workouts-list';

/**
 * One program's page: who's on it, its workouts and its week (FAM-1 step 8a; plan §8 "Program
 * page"; the prototype's `vProgram`). Steps 10 and 10b grow it: the week editor, and the Copy and
 * Put-on dialogs with their buttons.
 *
 * **The screen is the page.** Its route is thin, so the screen renders the page's `<h1>`, its
 * top-level blocks and "← Programs", inside the shell's one `<main>`. It adds no landmark of its own.
 *
 * A client component because it holds the page's one status line: Rename and Take off both report
 * there. The line sits under the "Used by" sentence, where the prototype puts its banner, and is
 * mounted empty, so a message is announced; it takes the prototype's banner look once it has one.
 *
 * A member of `actions` that is `undefined` is an action the route has not wired yet: the screen
 * hides its control (plan §6). `takeOff` arrives that way, at step 15.
 */
export type ProgramScreenProps = { program: ProgramView; actions: ProgramActions };

export function ProgramScreen({ program, actions }: ProgramScreenProps) {
  const [status, setStatus] = useState('');
  // Cleared first, so the same message twice is announced twice and the banner blinks.
  const report = useCallback((message: string) => {
    setStatus('');
    if (message) requestAnimationFrame(() => setStatus(message));
  }, []);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={PROGRAMS_PATH} className={NAV_LINK_CLASS}>
          {BUILDER_COPY.backToPrograms}
        </Link>
        <ProgramHeader
          programPublicId={program.programPublicId}
          name={program.name}
          renameProgram={actions.renameProgram}
          onStatus={report}
        />
        <p className="text-muted-foreground text-sm">
          {usedByText(program.athletes.map((athlete) => athlete.name))}
        </p>
        {/* Mounted empty with no height, as `Announcer` asks; a banner once it has something. */}
        <Announcer
          message={status}
          className={status ? 'bg-muted rounded-lg px-3 py-2 text-sm font-medium' : 'h-0'}
        />
      </div>
      <WhosOnIt program={program} takeOff={actions.takeOff} onStatus={report} />
      <WorkoutsList program={program} />
      <WeekShell program={program} />
    </div>
  );
}
