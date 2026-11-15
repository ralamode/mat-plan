import type { ProgramActions, WorkoutDraft } from '@mat-plan/shared';

import { NAME_WRAP_CLASS } from '@/lib/constants';
import type { MovementPickerData } from '@/lib/movements/movement-option';

/**
 * The workout editor: one screen of item cards, with the item picker (FAM-1 lane B; plan §4, §8
 * "Workout editor", "Item picker").
 *
 * 🚧 **A stub from step 0b: steps 8, 8b and 9 fill it in.** It is typed to the screen's final props,
 * the contract's data and the contract's actions object, so the preview route (`/design/program`)
 * and, later, the real route mount it the same way and never change when the screen grows.
 *
 * **The screen is the page.** Its route is thin, so the screen renders the page's `<h1>` and its
 * top-level blocks, inside the shell's one `<main>`. It adds no landmark of its own around them.
 *
 * `draft` is what the editor loads and what it saves (`saveWorkout`). `picker` is the item picker's
 * data, in the shape the picker already takes (`MovementPickerData`): every item the household can
 * add, each with its tracking type. The program builder has no athlete, so no `recentIds`.
 */
export type WorkoutEditorScreenProps = {
  draft: WorkoutDraft;
  picker: MovementPickerData;
  actions: ProgramActions;
};

export function WorkoutEditorScreen({ draft, picker, actions }: WorkoutEditorScreenProps) {
  const supplied = Object.entries(actions).flatMap(([name, action]) => (action ? [name] : []));
  return (
    <div className="flex flex-col gap-3">
      <h1 className={`text-3xl font-semibold tracking-tight ${NAME_WRAP_CLASS}`}>
        {draft.name || 'New workout'}
      </h1>
      <p className="text-muted-foreground text-sm">Not built yet: FAM-1 steps 8, 8b and 9.</p>
      <p>
        {draft.items.length} items in the workout, {picker.options.length} to pick from
      </p>
      <p className="text-sm">Actions: {supplied.join(', ')}</p>
    </div>
  );
}
