import type { DayActions, DayPlan } from '@mat-plan/shared';

/**
 * One athlete's workouts for one day (FAM-1 lane C; plan §4, §8 "Today", "Yesterday", "A closed
 * day", "Look ahead").
 *
 * 🚧 **A stub from step 0b: steps 13, 13b and 13d fill it in.** It is typed to the screen's final
 * props, the contract's data and the contract's actions object, so the preview route
 * (`/design/program`) and, from step 12c, the day page mount it the same way and never change when
 * the screen grows.
 *
 * **A section of the day page, not the page.** The page keeps its own `<h1>` and composes
 * Bodyweight and Life (lane S's sections) before this one, so the heading here is an `<h2>`.
 *
 * A member of `actions` that is `undefined` is an action the route has not wired yet: the screen
 * hides its control (plan §6). `amendRow` and `reorderPrograms` arrive that way, at steps 12d and
 * 15c.
 */
export type DayScreenProps = { plan: DayPlan; actions: DayActions };

export function DayScreen({ plan, actions }: DayScreenProps) {
  const supplied = Object.entries(actions).flatMap(([name, action]) => (action ? [name] : []));
  const done = plan.workouts.reduce((sum, workout) => sum + workout.progress.done, 0);
  const total = plan.workouts.reduce((sum, workout) => sum + workout.progress.total, 0);
  return (
    <section aria-labelledby="day-workouts-heading" className="flex flex-col gap-3">
      <h2 id="day-workouts-heading" className="text-lg font-medium">
        Workouts
      </h2>
      <p className="text-muted-foreground text-sm">Not built yet: FAM-1 steps 13, 13b and 13d.</p>
      <p>
        {plan.day}: {plan.workouts.length} workouts, {done} of {total} rows logged
      </p>
      <p className="text-sm">Actions: {supplied.join(', ')}</p>
    </section>
  );
}
