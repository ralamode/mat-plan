import type { ProgramActions, ProgramList } from '@mat-plan/shared';

/**
 * The Programs list (FAM-1 lane B; plan §4, §8 "Programs list").
 *
 * 🚧 **A stub from step 0b: step 8a fills it in.** It is typed to the screen's final props, the
 * contract's data and the contract's actions object, so the preview route (`/design/program`) and,
 * later, the real route mount it the same way and never change when the screen grows.
 *
 * **The screen is the page.** Its route is thin, so the screen renders the page's `<h1>` and its
 * top-level blocks, inside the shell's one `<main>`. It adds no landmark of its own around them.
 *
 * A member of `actions` that is `undefined` is an action the route has not wired yet: the screen
 * hides its control (plan §6).
 */
export type ProgramsListScreenProps = { programs: ProgramList; actions: ProgramActions };

export function ProgramsListScreen({ programs, actions }: ProgramsListScreenProps) {
  const supplied = Object.entries(actions).flatMap(([name, action]) => (action ? [name] : []));
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight">Programs</h1>
      <p className="text-muted-foreground text-sm">Not built yet: FAM-1 step 8a.</p>
      <p>
        {programs.length} programs: {programs.map((program) => program.name).join(', ') || 'none'}
      </p>
      <p className="text-sm">Actions: {supplied.join(', ')}</p>
    </div>
  );
}
