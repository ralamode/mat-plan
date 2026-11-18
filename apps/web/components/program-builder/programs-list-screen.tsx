import type { ProgramActions, ProgramList } from '@mat-plan/shared';

import { APP_HOME_PATH, NAME_WRAP_CLASS, NAV_LINK_CLASS } from '@/lib/constants';
import { formatList } from '@/lib/i18n/plural';

import { BUILDER_COPY } from './builder-text';
import { CreateProgram } from './create-program';
import { GroupList, GroupRowLink } from './group-list';
import { programPath } from './routes';
import { BuilderLink } from './route-link';

/**
 * The Programs list (FAM-1 step 8a; plan §8 "Programs list"; the prototype's `vPrograms`).
 *
 * Each program is one link to its page, naming who is on it. "+ Create a program" names a new one
 * in place (`CreateProgram`).
 *
 * **The screen is the page.** Its route is thin, so the screen renders the page's `<h1>` and its
 * top-level blocks, inside the shell's one `<main>`, and the way back: the shell's rail is hidden on
 * a phone, so without "← Home" a phone has no way out but the browser's back.
 *
 * A member of `actions` that is `undefined` is an action the route has not wired yet: the screen
 * hides its control (plan §6). This screen uses only `createProgram`, which is always supplied.
 */
export type ProgramsListScreenProps = { programs: ProgramList; actions: ProgramActions };

export function ProgramsListScreen({ programs, actions }: ProgramsListScreenProps) {
  return (
    <div className="flex flex-col gap-4">
      <BuilderLink href={APP_HOME_PATH} className={NAV_LINK_CLASS}>
        {BUILDER_COPY.home}
      </BuilderLink>
      <h1 className="text-2xl font-semibold tracking-tight">{BUILDER_COPY.programs}</h1>
      {programs.length ? (
        <GroupList>
          {programs.map((program) => (
            <li key={program.programPublicId}>
              <GroupRowLink href={programPath(program.programPublicId)} title={program.name}>
                <span className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
                  {program.athletes.length ? formatList(program.athletes) : BUILDER_COPY.noOneYet}
                </span>
              </GroupRowLink>
            </li>
          ))}
        </GroupList>
      ) : (
        <p className="text-muted-foreground">{BUILDER_COPY.noPrograms}</p>
      )}
      <CreateProgram createProgram={actions.createProgram} startOpen={programs.length === 0} />
      {/* The prototype goes on to say how to reuse a workout ("Copy to…"); that control is 10b's,
          so the sentence waits for it. */}
      <p className="text-muted-foreground text-sm">{BUILDER_COPY.severalPrograms}</p>
    </div>
  );
}
