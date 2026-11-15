import type { ProgramActions, ProgramView } from '@mat-plan/shared';

import { NAME_WRAP_CLASS } from '@/lib/constants';

/**
 * One program's page: who's on it, its workouts and its week, with the Put-on and Copy dialogs
 * (FAM-1 lane B; plan §4, §8 "Program page").
 *
 * 🚧 **A stub from step 0b: steps 8a, 10 and 10b fill it in.** It is typed to the screen's final
 * props, the contract's data and the contract's actions object, so the preview route
 * (`/design/program`) and, later, the real route mount it the same way and never change when the
 * screen grows.
 *
 * **The screen is the page.** Its route is thin, so the screen renders the page's `<h1>` and its
 * top-level blocks, inside the shell's one `<main>`. It adds no landmark of its own around them.
 *
 * A member of `actions` that is `undefined` is an action the route has not wired yet: the screen
 * hides its control (plan §6). `putOn` and `takeOff` arrive that way, at step 15.
 */
export type ProgramScreenProps = { program: ProgramView; actions: ProgramActions };

export function ProgramScreen({ program, actions }: ProgramScreenProps) {
  const supplied = Object.entries(actions).flatMap(([name, action]) => (action ? [name] : []));
  const slots = Object.values(program.week).flat().length;
  return (
    <div className="flex flex-col gap-3">
      <h1 className={`text-3xl font-semibold tracking-tight ${NAME_WRAP_CLASS}`}>{program.name}</h1>
      <p className="text-muted-foreground text-sm">Not built yet: FAM-1 steps 8a, 10 and 10b.</p>
      <p>
        {program.athletes.length} on it, {program.workouts.length} workouts, {slots} slots in the
        week
      </p>
      <p className="text-sm">Actions: {supplied.join(', ')}</p>
    </div>
  );
}
