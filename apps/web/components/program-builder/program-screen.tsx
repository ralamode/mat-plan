'use client';

import type { ProgramActions, ProgramView } from '@mat-plan/shared';
import { useRef } from 'react';

import { NAME_WRAP_CLASS, NAV_LINK_CLASS } from '@/lib/constants';

import { BUILDER_COPY, usedByText } from './builder-text';
import { ProgramHeader } from './program-header';
import { PROGRAMS_PATH } from './routes';
import { StatusLine, useStatusLine } from './status-line';
import { WeekEditor } from './week-editor/week-editor';
import { WhosOnIt } from './whos-on-it';
import { WorkoutsList } from './workouts-list';
import { BuilderLink } from './route-link';

/**
 * One program's page: who's on it, its workouts and its week (FAM-1 step 8a; plan §8 "Program
 * page"; the prototype's `vProgram`). Steps 10 and 10b grow it: the week editor, and the Copy and
 * Put-on dialogs with their buttons.
 *
 * **The screen is the page.** Its route is thin, so the screen renders the page's `<h1>`, its
 * top-level blocks and "← Programs", inside the shell's one `<main>`. It adds no landmark of its own.
 *
 * A client component because it holds the page's one status line: Rename, Take off and the week
 * editor all report there. **It is a bar pinned to the bottom of the screen** _(maintainer,
 * 2026-11-16)_, not a line under "Used by": on a phone the week sits about 650px below the top, and
 * a message about Thursday's ✕ landed off screen. It is mounted empty, so a message is announced,
 * and is one line tall from the first paint ("Changes save as you make them." until a message):
 * a bar that appeared, or blinked to nothing between messages, would cover what was just tapped.
 *
 * A member of `actions` that is `undefined` is an action the route has not wired yet: the screen
 * hides its control (plan §6). `takeOff` arrives that way, at step 15.
 */
export type ProgramScreenProps = { program: ProgramView; actions: ProgramActions };

export function ProgramScreen({ program, actions }: ProgramScreenProps) {
  const { status, report } = useStatusLine();
  const barRef = useRef<HTMLDivElement>(null);
  return (
    // Controls scroll clear of the status bar when focused near the bottom.
    // (7rem: the bar with a two-line message and the iPhone's home bar.)
    <div className="flex flex-col gap-6 [&_:is(input,select,textarea,button,a)]:scroll-mb-28">
      <div className="flex flex-col gap-2">
        <BuilderLink href={PROGRAMS_PATH} className={NAV_LINK_CLASS}>
          {BUILDER_COPY.backToPrograms}
        </BuilderLink>
        <ProgramHeader
          programPublicId={program.programPublicId}
          name={program.name}
          renameProgram={actions.renameProgram}
          onStatus={report}
        />
        <p className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
          {usedByText(program.athletes.map((athlete) => athlete.name))}
        </p>
      </div>
      <WhosOnIt
        program={program}
        takeOff={actions.takeOff}
        putOn={actions.putOn}
        onStatus={report}
      />
      <WorkoutsList
        program={program}
        copyWorkout={actions.copyWorkout}
        putOnWired={!!actions.putOn}
        onStatus={report}
      />
      <WeekEditor program={program} saveWeek={actions.saveWeek} onStatus={report} barRef={barRef} />
      {/* The page's one status bar, in view wherever the change was made. */}
      <div
        ref={barRef}
        className="bg-background sticky bottom-0 border-t pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {status.message ? null : (
          <p className="text-muted-foreground px-3 py-2 text-sm">{BUILDER_COPY.savesAsYouGo}</p>
        )}
        <StatusLine status={status} className="flex flex-col" />
      </div>
    </div>
  );
}
