import type { ProgramActions, ProgramList } from '@mat-plan/shared';
import Link from 'next/link';

import { APP_HOME_PATH, NAME_WRAP_CLASS, NAV_LINK_CLASS } from '@/lib/constants';
import { formatList } from '@/lib/i18n/plural';

import { BUILDER_COPY } from './builder-text';
import { CHEVRON_CLASS, GROUP_LIST_CLASS, GROUP_ROW_LINK_CLASS } from './classes';
import { CreateProgram } from './create-program';
import { programPath } from './routes';

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
      <Link href={APP_HOME_PATH} className={NAV_LINK_CLASS}>
        {BUILDER_COPY.home}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{BUILDER_COPY.programs}</h1>
      {programs.length ? (
        <ul className={GROUP_LIST_CLASS}>
          {programs.map((program) => (
            <li key={program.programPublicId}>
              <Link href={programPath(program.programPublicId)} className={GROUP_ROW_LINK_CLASS}>
                {/* The row link stacks its children, so the chevron needs a row of its own. */}
                <span className="flex items-center gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`font-semibold ${NAME_WRAP_CLASS}`}>{program.name}</span>
                    <span className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
                      {program.athletes.length
                        ? formatList(program.athletes)
                        : BUILDER_COPY.noOneYet}
                    </span>
                  </span>
                  <span aria-hidden="true" className={CHEVRON_CLASS}>
                    ›
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
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
