// @vitest-environment jsdom
import {
  MAX_HOUSEHOLD_ITEMS,
  MAX_WORKOUT_ITEMS,
  PROGRAM_REFUSAL,
  TRACKING_TYPE,
  TRACKING_TYPE_LABELS,
  type ProgramActions,
  type WorkoutDraft,
  NEW_ITEM_NAME_MESSAGES,
  EQUIPMENT_CODE,
  MODALITY,
  MUSCLE,
} from '@mat-plan/shared';
import { heavyADraft, newWorkoutEmpty } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

import { householdPickerOptions, pickerOptions } from '@/app/design/program/picker-options';
import type { MovementOptionDTO } from '@/lib/movements/movement-option';
import { MOVEMENT_PICKER_COPY } from '@/lib/movements/movement-picker-copy';

import {
  addedText,
  BUILDER_COPY,
  addItemsText,
  alreadyListedText,
  capText,
  createdText,
  EDITOR_COPY,
  existedText,
  existedUnlistedText,
  ITEM_PICKER_COPY,
  newItemLabel,
  notTickedText,
  pickedText,
  selectedText,
  selectExistingText,
  PENDING_CLASS,
  TRACKING_TYPE_EXAMPLES,
  workoutFullText,
} from '../builder-text';
import { tapAt, tapClock } from '../test-taps';
import { SHEET_COPY } from '@/components/ui/sheet';
import { WorkoutEditorScreen } from '../workout-editor-screen';

afterEach(cleanup);
beforeEach(() => {
  push.mockReset();
  // The sheet pops its history entry on close; in jsdom that popstate lands in the NEXT test and
  // closes its sheet (sheet.test.tsx stubs it the same way).
  window.history.replaceState(null, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
});

const NEW_ID = '00000000-0000-7000-8000-000000009001';

function actions(extra: Partial<ProgramActions> = {}): ProgramActions {
  return {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn().mockResolvedValue({ ok: true, workoutPublicId: 'w' }),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn(),
    newItem: vi.fn().mockResolvedValue({
      ok: true,
      itemPublicId: NEW_ID,
      name: 'Bear crawl',
      trackingType: TRACKING_TYPE.reps,
      existed: false,
    }),
    ...extra,
  };
}

const editor = (
  extra: Partial<ProgramActions> = {},
  draft: WorkoutDraft = newWorkoutEmpty,
  options: readonly MovementOptionDTO[] = pickerOptions,
) => {
  const all = actions(extra);
  render(<WorkoutEditorScreen draft={draft} picker={{ options }} actions={all} />);
  return all;
};

/** The opener, from the DOM: Radix hides the page from role queries while the sheet is open. */
const opener = () =>
  [...document.querySelectorAll('button')].find(
    (button) => button.textContent === ITEM_PICKER_COPY.open,
  )!;
const openPicker = () => fireEvent.click(opener());
const sheet = () => screen.getByRole('dialog');
const row = (name: string) =>
  within(sheet()).getByRole('checkbox', { name: new RegExp(`^${name}`) });
const cardNames = () =>
  [...document.querySelectorAll('ol > li h3')].map((heading) => heading.textContent);
/** The picks so far: the line Add is described by. */
const picked = () => {
  const id = within(sheet())
    .getByRole('button', { name: /^Add \d/ })
    .getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent : undefined;
};
const search = (text: string) =>
  fireEvent.change(within(sheet()).getByRole('searchbox'), { target: { value: text } });

describe('the item picker (FAM-1 9)', () => {
  it('searching sends nothing: no action runs until a person taps Create (CAT-3 P6)', () => {
    const all = editor();
    openPicker();
    for (const text of ['bulgarain', 'bb curl', 'push', 'zzzzz', 'a long typed name']) search(text);
    // The new-item form opens with the typed name, and still nothing is sent.
    fireEvent.click(
      within(sheet()).getByRole('button', { name: newItemLabel('a long typed name') }),
    );
    for (const action of Object.values(all)) expect(action).not.toHaveBeenCalled();
    // …and no URL carries it: the router is never asked to navigate.
    expect(push).not.toHaveBeenCalled();
  });

  it('renders picker-options: a checkbox row per item, saying what it tracks', () => {
    editor();
    openPicker();
    const pushUps = row('Push-ups');
    expect(pushUps.getAttribute('aria-checked')).toBe('false');
    expect(pushUps.textContent).toContain(TRACKING_TYPE_LABELS.reps);
    expect(within(sheet()).getAllByRole('checkbox')).toHaveLength(pickerOptions.length);
  });

  it('items picked together are added in the order they were picked, with no numbers', async () => {
    editor();
    openPicker();
    for (const name of ['Sprawls', 'Push-ups', 'Wall sit']) fireEvent.click(row(name));
    expect(row('Push-ups').getAttribute('aria-checked')).toBe('true');
    expect(picked()).toBe(pickedText(['Sprawls', 'Push-ups', 'Wall sit']));
    fireEvent.click(within(sheet()).getByRole('button', { name: addItemsText(3) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(cardNames()).toEqual(['Sprawls', 'Push-ups', 'Wall sit']);
    const sets = [...document.querySelectorAll('ol > li input')].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(sets.every((value) => value === '')).toBe(true);
    expect(document.activeElement?.textContent).toBe('Sprawls');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(addedText(3)));
  });

  it('"n items added." is said once, after Add; a plain Close after it says nothing new', async () => {
    editor();
    openPicker();
    fireEvent.click(row('Sprawls'));
    fireEvent.click(within(sheet()).getByRole('button', { name: addItemsText(1) }));
    const bar = screen.getByRole('status');
    await waitFor(() => expect(bar.textContent).toBe(addedText(1)));
    // From here, any change to the bar is a second announcement.
    let changes = 0;
    const watch = new MutationObserver(() => changes++);
    watch.observe(bar, { childList: true, characterData: true, subtree: true });
    openPicker();
    // The footer's Close (the header's ✕ has the same name).
    fireEvent.click(within(sheet()).getAllByRole('button', { name: SHEET_COPY.close }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    watch.disconnect();
    expect(changes).toBe(0);
  });

  it('an untick takes the item out of the order', () => {
    editor();
    openPicker();
    fireEvent.click(row('Sprawls'));
    fireEvent.click(row('Push-ups'));
    fireEvent.click(row('Sprawls'));
    expect(picked()).toBe(pickedText(['Push-ups']));
  });

  it('Close keeps the ticks for next time', () => {
    editor();
    openPicker();
    fireEvent.click(row('Sprawls'));
    fireEvent.click(within(sheet()).getAllByRole('button', { name: 'Close' }).at(-1)!);
    openPicker();
    expect(row('Sprawls').getAttribute('aria-checked')).toBe('true');
  });

  it('after Add, the picker opens with nothing ticked', async () => {
    editor();
    openPicker();
    fireEvent.click(row('Sprawls'));
    fireEvent.click(within(sheet()).getByRole('button', { name: addItemsText(1) }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    openPicker();
    expect(row('Sprawls').getAttribute('aria-checked')).toBe('false');
  });

  it('🔴 an item the list did not have takes the stored name, and says nothing new was made (7a-ii)', async () => {
    editor({
      newItem: vi.fn().mockResolvedValue({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear Crawl',
        trackingType: TRACKING_TYPE.reps,
        existed: true,
      }),
    });
    openPicker();
    search('bear crawl');
    fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel('bear crawl') }));
    fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
      target: { value: TRACKING_TYPE.reps },
    });
    fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));
    await waitFor(() => expect(row('Bear Crawl').getAttribute('aria-checked')).toBe('true'));
    await waitFor(() =>
      expect(
        within(sheet()).getAllByText(existedUnlistedText('Bear Crawl', TRACKING_TYPE_LABELS.reps))
          .length,
      ).toBeGreaterThan(0),
    );
    // Not "is in the list": it was not.
    expect(
      within(sheet()).queryByText(existedText('Bear Crawl', TRACKING_TYPE_LABELS.reps)),
    ).toBeNull();
  });

  it('🔴 a retry whose first try landed says created, not "nothing new was made" (7a-ii review)', async () => {
    const newItem = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.retry })
      .mockResolvedValueOnce({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear crawl',
        trackingType: TRACKING_TYPE.reps,
        existed: true,
      });
    editor({ newItem });
    openPicker();
    search('Bear crawl');
    fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel('Bear crawl') }));
    fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
      target: { value: TRACKING_TYPE.reps },
    });
    const create = () =>
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));
    create();
    await waitFor(() => expect(newItem).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create })).toBeTruthy(),
    );
    create();
    await waitFor(() => expect(row('Bear crawl').getAttribute('aria-checked')).toBe('true'));
    await waitFor(() =>
      expect(within(sheet()).getAllByText(createdText('Bear crawl')).length).toBeGreaterThan(0),
    );
    expect(
      within(sheet()).queryAllByText(existedUnlistedText('Bear crawl', TRACKING_TYPE_LABELS.reps)),
    ).toEqual([]);
  });

  it('a retry answered with ANOTHER device’s item (other type) is not "created": it says what exists', async () => {
    const newItem = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.retry })
      .mockResolvedValueOnce({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear Crawl',
        trackingType: TRACKING_TYPE.time_sets,
        existed: true,
      });
    editor({ newItem });
    openPicker();
    search('Bear crawl');
    fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel('Bear crawl') }));
    fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
      target: { value: TRACKING_TYPE.reps },
    });
    const create = () =>
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));
    create();
    await waitFor(() => expect(newItem).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create })).toBeTruthy(),
    );
    create();
    await waitFor(() => expect(row('Bear Crawl').getAttribute('aria-checked')).toBe('true'));
    await waitFor(() =>
      expect(
        within(sheet()).getAllByText(
          existedUnlistedText('Bear Crawl', TRACKING_TYPE_LABELS.time_sets),
        ).length,
      ).toBeGreaterThan(0),
    );
    expect(within(sheet()).queryAllByText(createdText('Bear Crawl'))).toEqual([]);
  });

  it('with nothing ticked, Add says so and does nothing', () => {
    editor();
    openPicker();
    const add = within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.pickToAdd });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('an item already on a card is tagged, and can be added again', () => {
    editor({}, heavyADraft);
    openPicker();
    expect(row('Pull-up').textContent).toContain(
      MOVEMENT_PICKER_COPY.tagAlreadyIn(ITEM_PICKER_COPY.alreadyIn),
    );
    expect(row('Pull-up').textContent).not.toContain('already in already in');
    expect(row('Pull-up').getAttribute('aria-disabled')).toBeNull();
  });

  it('a workout stops at MAX_WORKOUT_ITEMS: a tap past it says why', async () => {
    const full = {
      ...heavyADraft,
      items: Array.from({ length: MAX_WORKOUT_ITEMS - 1 }, (_, i) => ({
        ...heavyADraft.items[4]!,
        prescriptionClientId: `00000000-0000-7000-8000-0000000${String(1000 + i)}`,
      })),
    };
    editor({}, full);
    openPicker();
    fireEvent.click(row('Sprawls'));
    fireEvent.click(row('Push-ups'));
    expect(row('Push-ups').getAttribute('aria-checked')).toBe('false');
    await waitFor(() =>
      expect(within(sheet()).getAllByRole('status')[0]!.textContent).toBe(
        capText(MAX_WORKOUT_ITEMS),
      ),
    );
  });

  it('no match: the hint says how to make it, and the create button names the text', () => {
    editor();
    openPicker();
    search('Bear crawl');
    expect(within(sheet()).getByText(ITEM_PICKER_COPY.noMatch)).toBeTruthy();
    expect(within(sheet()).getByRole('button', { name: newItemLabel('Bear crawl') })).toBeTruthy();
  });

  describe('a new item', () => {
    const openForm = (typed = 'Bear crawl') => {
      openPicker();
      search(typed);
      fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel(typed) }));
    };
    /** The plain "+ New item", then a name typed in the form. */
    const openBlankForm = (name: string) => {
      openPicker();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name), {
        target: { value: name },
      });
    };
    const create = () => within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create });

    it('takes over the sheet, its name filled in, and asks what it tracks with no default', () => {
      editor();
      openForm();
      expect(within(sheet()).queryByRole('searchbox')).toBeNull();
      expect(
        (within(sheet()).getByLabelText(ITEM_PICKER_COPY.name) as HTMLInputElement).value,
      ).toBe('Bear crawl');
      const type = within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks) as HTMLSelectElement;
      expect(type.value).toBe('');
      expect(create().getAttribute('aria-disabled')).toBe('true');
    });

    it('is made with its type, selected, and listed', async () => {
      const all = editor();
      openForm();
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: TRACKING_TYPE.reps },
      });
      expect(within(sheet()).getByText(TRACKING_TYPE_EXAMPLES.reps)).toBeTruthy();
      fireEvent.click(create());
      await waitFor(() => expect(row('Bear crawl').getAttribute('aria-checked')).toBe('true'));
      expect(all.newItem).toHaveBeenCalledWith({
        name: 'Bear crawl',
        trackingType: TRACKING_TYPE.reps,
      });
      expect(all.saveWorkout).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(within(sheet()).getAllByText(createdText('Bear crawl')).length).toBeGreaterThan(0),
      );
    });

    it('a name already in the list selects that item, and makes nothing', async () => {
      const all = editor();
      openBlankForm('Pull up');
      expect(
        within(sheet()).getByText(alreadyListedText('Pull-up', TRACKING_TYPE_LABELS.reps)),
      ).toBeTruthy();
      fireEvent.click(within(sheet()).getByRole('button', { name: selectExistingText('Pull-up') }));
      await waitFor(() => expect(row('Pull-up').getAttribute('aria-checked')).toBe('true'));
      expect(all.newItem).not.toHaveBeenCalled();
    });

    it('a name the server already has selects that item', async () => {
      const pullUp = pickerOptions.find((option) => option.name === 'Pull-up')!;
      editor({
        newItem: vi.fn().mockResolvedValue({
          ok: true,
          itemPublicId: pullUp.publicId,
          name: pullUp.name,
          trackingType: TRACKING_TYPE.reps,
          existed: true,
        }),
      });
      openForm('Chin over bar');
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: TRACKING_TYPE.reps },
      });
      fireEvent.click(create());
      await waitFor(() => expect(row('Pull-up').getAttribute('aria-checked')).toBe('true'));
      await waitFor(() =>
        expect(
          within(sheet()).getAllByText(existedText('Pull-up', TRACKING_TYPE_LABELS.reps)).length,
        ).toBeGreaterThan(0),
      );
    });

    it('a refused name is said under the field, and the form stays', async () => {
      editor({
        newItem: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.invalid }),
      });
      openForm();
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: TRACKING_TYPE.reps },
      });
      fireEvent.click(create());
      await waitFor(() => expect(within(sheet()).getByText(ITEM_PICKER_COPY.refused)).toBeTruthy());
      expect(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name)).toBeTruthy();
    });

    it('Enter in the name moves to the type and never creates', () => {
      const all = editor();
      openForm();
      const name = within(sheet()).getByLabelText(ITEM_PICKER_COPY.name);
      // jsdom never submits from a key press: what is checked is that Enter's default is stopped.
      expect(fireEvent.keyDown(name, { key: 'Enter' })).toBe(false);
      expect(document.activeElement).toBe(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks));
      expect(all.newItem).not.toHaveBeenCalled();
    });

    it('Cancel goes back to the list with the ticks', () => {
      editor();
      openPicker();
      fireEvent.click(row('Sprawls'));
      search('Bear crawl');
      fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel('Bear crawl') }));
      fireEvent.click(within(sheet()).getByRole('button', { name: BUILDER_COPY.cancel }));
      search('');
      expect(row('Sprawls').getAttribute('aria-checked')).toBe('true');
    });
  });

  it('the editor still says when the workout is empty', () => {
    editor();
    expect(screen.getByText(EDITOR_COPY.noItems)).toBeTruthy();
  });

  describe('after the second pass', () => {
    const openForm = (typed = 'Bear crawl') => {
      openPicker();
      search(typed);
      fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel(typed) }));
    };
    const statusRegion = () => within(sheet()).getAllByRole('status')[0]!;

    it('a message does not outlive the next search', async () => {
      editor();
      openForm();
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: TRACKING_TYPE.reps },
      });
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));
      await waitFor(() => expect(statusRegion().textContent).toBe(createdText('Bear crawl')));
      search('zzzz');
      await waitFor(() =>
        expect(statusRegion().textContent).toContain(MOVEMENT_PICKER_COPY.statusNoMatches),
      );
    });

    it('after Create, focus is on the item’s row; after Cancel, on the create button', async () => {
      editor();
      openForm();
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: TRACKING_TYPE.reps },
      });
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));
      await waitFor(() => expect(document.activeElement).toBe(row('Bear crawl')));
      // The search's deferred value settles a render later; the plain button follows it.
      const newItem = await waitFor(() =>
        within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }),
      );
      fireEvent.click(newItem);
      fireEvent.click(within(sheet()).getByRole('button', { name: BUILDER_COPY.cancel }));
      expect(document.activeElement).toBe(
        within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }),
      );
    });

    it('an inactive Create moves to what is missing', () => {
      const all = editor();
      openForm();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));
      expect(document.activeElement).toBe(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks));
      expect(all.newItem).not.toHaveBeenCalled();
    });

    it('a name the same-movement rule folds to nothing is refused, once Create is pressed', () => {
      const all = editor();
      openPicker();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      const name = within(sheet()).getByLabelText(ITEM_PICKER_COPY.name);
      fireEvent.change(name, { target: { value: 'S' } });
      // Not on the first keystroke of "Squat".
      expect(within(sheet()).queryByText(NEW_ITEM_NAME_MESSAGES.noKey)).toBeNull();
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: TRACKING_TYPE.reps },
      });
      const create = within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create });
      expect(create.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(create);
      // The contract's own refusal (C8), not the lane's copy of it.
      expect(within(sheet()).getByText(NEW_ITEM_NAME_MESSAGES.noKey)).toBeTruthy();
      expect(document.activeElement).toBe(name);
      expect(all.newItem).not.toHaveBeenCalled();
    });

    it('closing the sheet drops the form; the ticks stay', () => {
      editor();
      openPicker();
      fireEvent.click(row('Sprawls'));
      search('Bear crawl');
      fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel('Bear crawl') }));
      fireEvent.keyDown(sheet(), { key: 'Escape' });
      openPicker();
      expect(within(sheet()).queryByLabelText(ITEM_PICKER_COPY.name)).toBeNull();
      expect(row('Sprawls').getAttribute('aria-checked')).toBe('true');
    });

    it('a full workout says so at "+ Add items" and opens nothing', async () => {
      const full = {
        ...heavyADraft,
        items: Array.from({ length: MAX_WORKOUT_ITEMS }, (_, i) => ({
          ...heavyADraft.items[4]!,
          prescriptionClientId: `00000000-0000-7000-8000-0000000${String(1000 + i)}`,
        })),
      };
      editor({}, full);
      // It looks stopped before the tap (7b-ii; it looked live: #460), and says why under it.
      expect(opener().getAttribute('aria-disabled')).toBe('true');
      expect(opener().className).toContain(PENDING_CLASS);
      const hint = document.getElementById(opener().getAttribute('aria-describedby')!);
      expect(hint?.textContent).toBe(workoutFullText);
      expect(workoutFullText).toBe('This workout is full: a workout holds at most 30 items.');
      openPicker();
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe(workoutFullText));
    });

    it('an item made here is listed once, when the route’s own list has it too', async () => {
      const all = actions();
      const view = render(
        <WorkoutEditorScreen
          draft={newWorkoutEmpty}
          picker={{ options: pickerOptions }}
          actions={all}
        />,
      );
      openForm();
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: TRACKING_TYPE.reps },
      });
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));
      await waitFor(() => expect(row('Bear crawl')).toBeTruthy());
      const withNew: MovementOptionDTO[] = [
        ...pickerOptions,
        {
          // A household item, as one made in the form is: the first option is a library row now.
          ...householdPickerOptions[0]!,
          publicId: NEW_ID,
          name: 'Bear crawl',
          trackingType: TRACKING_TYPE.reps,
        },
      ];
      view.rerender(
        <WorkoutEditorScreen draft={newWorkoutEmpty} picker={{ options: withNew }} actions={all} />,
      );
      expect(within(sheet()).getAllByRole('checkbox', { name: /^Bear crawl/ })).toHaveLength(1);
    });

    const typeReps = () =>
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: TRACKING_TYPE.reps },
      });
    const pressCreate = () =>
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));

    it('Create in the sheet never saves the workout (the picker is outside the editor’s form)', async () => {
      const all = editor({}, heavyADraft);
      openForm();
      typeReps();
      pressCreate();
      await waitFor(() => expect(row('Bear crawl').getAttribute('aria-checked')).toBe('true'));
      expect(all.saveWorkout).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    });

    it('added cards are sent with their item and an id each', async () => {
      const all = editor({}, heavyADraft);
      openPicker();
      fireEvent.click(row('Sprawls'));
      fireEvent.click(row('Wall sit'));
      fireEvent.click(within(sheet()).getByRole('button', { name: addItemsText(2) }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      for (const input of within(document.querySelector('ol')!)
        .getAllByLabelText('Sets')
        .slice(-2)) {
        fireEvent.change(input, { target: { value: '3' } });
      }
      fireEvent.click(screen.getByRole('button', { name: EDITOR_COPY.save }));
      await waitFor(() => expect(all.saveWorkout).toHaveBeenCalled());
      const sent = vi.mocked(all.saveWorkout).mock.calls[0]![0].items.slice(-2);
      const option = (name: string) => pickerOptions.find((o) => o.name === name)!;
      expect(sent).toMatchObject([
        { itemPublicId: option('Sprawls').publicId, itemName: 'Sprawls', sets: 3 },
        { itemPublicId: option('Wall sit').publicId, itemName: 'Wall sit', sets: 3 },
      ]);
      const ids = new Set([
        ...heavyADraft.items.map((item) => item.prescriptionClientId),
        ...sent.map((item) => item.prescriptionClientId),
      ]);
      expect(ids.size).toBe(heavyADraft.items.length + 2);
    });

    it('an alias is the item it names: "rdl" selects Romanian Deadlift and makes nothing', async () => {
      const rdl: MovementOptionDTO = {
        publicId: '00000000-0000-7000-8000-000000009100',
        name: 'Romanian Deadlift',
        owner: 'catalog',
        group: 'legs',
        aliases: ['RDL'],
        unitDefault: null,
        isBodyweight: false,
        trackingType: TRACKING_TYPE.weight_reps,
        modality: MODALITY.strength,
        pattern: 'hinge',
        equipment: [EQUIPMENT_CODE.barbell],
        primaryMuscle: MUSCLE.hamstrings,
        secondaryMuscles: [],
        supervision: null,
        hasInstructions: false,
      };
      const all = editor({}, newWorkoutEmpty, [...pickerOptions, rdl]);
      openPicker();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name), {
        target: { value: 'rdl' },
      });
      fireEvent.click(
        within(sheet()).getByRole('button', { name: selectExistingText('Romanian Deadlift') }),
      );
      await waitFor(() =>
        expect(row('Romanian Deadlift').getAttribute('aria-checked')).toBe('true'),
      );
      expect(all.newItem).not.toHaveBeenCalled();
    });

    it('a create answered after Cancel leaves a newer form alone, and still lists the item', async () => {
      let answer!: (value: unknown) => void;
      editor({ newItem: vi.fn(() => new Promise((resolve) => (answer = resolve))) as never });
      openForm();
      typeReps();
      pressCreate();
      fireEvent.click(within(sheet()).getByRole('button', { name: BUILDER_COPY.cancel }));
      fireEvent.click(
        await waitFor(() =>
          within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }),
        ),
      );
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name), {
        target: { value: 'Other thing' },
      });
      answer({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear crawl',
        trackingType: TRACKING_TYPE.reps,
        existed: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        (within(sheet()).getByLabelText(ITEM_PICKER_COPY.name) as HTMLInputElement).value,
      ).toBe('Other thing');
      fireEvent.click(within(sheet()).getByRole('button', { name: BUILDER_COPY.cancel }));
      search('Bear');
      await waitFor(() => expect(row('Bear crawl').getAttribute('aria-checked')).toBe('false'));
    });

    it('a double tap on Cancel is not an Add: Add sits where Cancel was', () => {
      editor();
      openPicker();
      fireEvent.click(row('Sprawls'));
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      const at = Date.now() + 1000;
      tapAt(within(sheet()).getByRole('button', { name: BUILDER_COPY.cancel }), at);
      const add = within(sheet()).getByRole('button', { name: addItemsText(1) });
      tapAt(add, at + 100);
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(cardNames()).toEqual([]);
      tapAt(add, at + 1000);
      expect(cardNames()).toEqual(['Sprawls']);
    });

    it('a message does not outlive Add', async () => {
      editor();
      openForm();
      typeReps();
      pressCreate();
      await waitFor(() => expect(row('Bear crawl').getAttribute('aria-checked')).toBe('true'));
      // The message is there first (it is set a frame later), so Add is what clears it.
      await waitFor(() =>
        expect(within(sheet()).getAllByText(createdText('Bear crawl')).length).toBeGreaterThan(0),
      );
      // A second after Create: a new tap, not the same one.
      tapClock().tap(within(sheet()).getByRole('button', { name: addItemsText(1) }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      openPicker();
      expect(within(sheet()).queryAllByText(createdText('Bear crawl'))).toEqual([]);
    });

    it('the name is sent cleaned, and the item takes the server’s type, not the one chosen', async () => {
      const all = editor({
        newItem: vi.fn().mockResolvedValue({
          ok: true,
          itemPublicId: NEW_ID,
          name: 'Bear crawl',
          trackingType: TRACKING_TYPE.duration,
          existed: true,
        }),
      });
      openPicker();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name), {
        target: { value: '  Bear   crawl ' },
      });
      typeReps();
      pressCreate();
      await waitFor(() =>
        expect(row('Bear crawl').textContent).toContain(TRACKING_TYPE_LABELS.duration),
      );
      expect(all.newItem).toHaveBeenCalledWith({
        name: 'Bear crawl',
        trackingType: TRACKING_TYPE.reps,
      });
    });

    it('an item another parent made takes its stored name, not the one typed', async () => {
      editor({
        newItem: vi.fn().mockResolvedValue({
          ok: true,
          itemPublicId: NEW_ID,
          name: 'Bear Crawl',
          trackingType: TRACKING_TYPE.reps,
          existed: true,
        }),
      });
      openPicker();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name), {
        target: { value: 'bear crawl' },
      });
      typeReps();
      pressCreate();
      await waitFor(() => expect(row('Bear Crawl')).toBeTruthy());
      tapClock().tap(within(sheet()).getByRole('button', { name: addItemsText(1) }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(cardNames()).toEqual(['Bear Crawl']);
    });

    it('an invalid name with a type chosen: Create moves to the name', () => {
      editor();
      openPicker();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      const name = within(sheet()).getByLabelText(ITEM_PICKER_COPY.name);
      fireEvent.change(name, { target: { value: 'Bear, crawl' } });
      typeReps();
      pressCreate();
      expect(document.activeElement).toBe(name);
    });

    it('a full workout: a new item is made but not ticked, and the message says so', async () => {
      const almost = {
        ...heavyADraft,
        items: Array.from({ length: MAX_WORKOUT_ITEMS - 1 }, (_, i) => ({
          ...heavyADraft.items[4]!,
          prescriptionClientId: `00000000-0000-7000-8000-0000000${String(1000 + i)}`,
        })),
      };
      editor({}, almost);
      openPicker();
      fireEvent.click(row('Sprawls'));
      openForm();
      typeReps();
      pressCreate();
      await waitFor(() =>
        expect(within(sheet()).getAllByText(notTickedText('Bear crawl')).length).toBeGreaterThan(0),
      );
      expect(row('Bear crawl').getAttribute('aria-checked')).toBe('false');
    });

    it('Enter in the search ticks the one match and says so', async () => {
      editor();
      openPicker();
      search('Wall sit');
      fireEvent.keyDown(within(sheet()).getByRole('searchbox'), { key: 'Enter' });
      await waitFor(() =>
        expect(within(sheet()).getAllByRole('status')[0]!.textContent).toBe(
          selectedText('Wall sit'),
        ),
      );
      expect(row('Wall sit').getAttribute('aria-checked')).toBe('true');
    });

    it('Enter in a name already listed moves to "Select …", which the line explains', () => {
      editor();
      openPicker();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      const name = within(sheet()).getByLabelText(ITEM_PICKER_COPY.name);
      fireEvent.change(name, { target: { value: 'pull up' } });
      fireEvent.keyDown(name, { key: 'Enter' });
      const select = within(sheet()).getByRole('button', { name: selectExistingText('Pull-up') });
      expect(document.activeElement).toBe(select);
      expect(select.getAttribute('aria-describedby')).toBeTruthy();
      expect(document.getElementById(select.getAttribute('aria-describedby')!)!.textContent).toBe(
        alreadyListedText('Pull-up', TRACKING_TYPE_LABELS.reps),
      );
    });

    it('a create answered after a plain Cancel ticks nothing and says nothing', async () => {
      let answer!: (value: unknown) => void;
      editor({ newItem: vi.fn(() => new Promise((resolve) => (answer = resolve))) as never });
      openForm();
      typeReps();
      pressCreate();
      fireEvent.click(within(sheet()).getByRole('button', { name: BUILDER_COPY.cancel }));
      answer({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear crawl',
        trackingType: TRACKING_TYPE.reps,
        existed: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(within(sheet()).queryAllByText(createdText('Bear crawl'))).toEqual([]);
      search('Bear');
      await waitFor(() => expect(row('Bear crawl').getAttribute('aria-checked')).toBe('false'));
    });

    it('Create, Cancel, Create again, both answers land: the item is listed once', async () => {
      const answers: ((value: unknown) => void)[] = [];
      editor({ newItem: vi.fn(() => new Promise((resolve) => answers.push(resolve))) as never });
      openForm();
      typeReps();
      pressCreate();
      fireEvent.click(within(sheet()).getByRole('button', { name: BUILDER_COPY.cancel }));
      search('Bear crawl');
      fireEvent.click(
        await waitFor(() =>
          within(sheet()).getByRole('button', { name: newItemLabel('Bear crawl') }),
        ),
      );
      typeReps();
      pressCreate();
      answers[0]!({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear crawl',
        trackingType: TRACKING_TYPE.reps,
        existed: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      answers[1]!({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear crawl',
        trackingType: TRACKING_TYPE.reps,
        existed: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(within(sheet()).getAllByRole('checkbox', { name: /^Bear crawl/ })).toHaveLength(1);
    });

    it('a failure to reach the server is seen in the form, and the name is not blamed', async () => {
      editor({ newItem: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.retry }) });
      openForm();
      typeReps();
      pressCreate();
      await waitFor(() =>
        expect(
          within(sheet())
            .queryAllByText(ITEM_PICKER_COPY.failed)
            .some((node) => !node.closest('.sr-only')),
        ).toBe(true),
      );
      expect(
        within(sheet()).getByLabelText(ITEM_PICKER_COPY.name).getAttribute('aria-invalid'),
      ).toBeNull();
      expect(document.activeElement).toBe(
        within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }),
      );
    });

    it('a create answered after Escape ticks nothing in the closed sheet', async () => {
      let answer!: (value: unknown) => void;
      editor({ newItem: vi.fn(() => new Promise((resolve) => (answer = resolve))) as never });
      openForm();
      typeReps();
      pressCreate();
      fireEvent.keyDown(sheet(), { key: 'Escape' });
      answer({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear crawl',
        trackingType: TRACKING_TYPE.reps,
        existed: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      openPicker();
      expect(within(sheet()).queryAllByText(createdText('Bear crawl'))).toEqual([]);
      search('Bear');
      await waitFor(() => expect(row('Bear crawl').getAttribute('aria-checked')).toBe('false'));
    });

    it('Create while creating sends nothing more', async () => {
      const newItem = vi.fn(() => new Promise(() => {}));
      editor({ newItem: newItem as never });
      openForm();
      typeReps();
      pressCreate();
      const creating = within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.creating });
      creating.focus();
      fireEvent.click(creating);
      expect(newItem).toHaveBeenCalledTimes(1);
      expect(creating.getAttribute('aria-disabled')).toBe('true');
      // Nothing is missing while it creates: focus stays put.
      expect(document.activeElement).toBe(creating);
    });

    it('a missing type is marked, and an empty name says why', () => {
      editor();
      openPicker();
      fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
      pressCreate();
      expect(within(sheet()).getByText(ITEM_PICKER_COPY.giveAName)).toBeTruthy();
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name), {
        target: { value: 'Bear crawl' },
      });
      pressCreate();
      expect(
        within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks).getAttribute('aria-invalid'),
      ).toBe('true');
    });

    it('after a failure, Cancel leaves no failure message on the list', async () => {
      editor({ newItem: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.retry }) });
      const shown = () =>
        within(sheet())
          .queryAllByText(ITEM_PICKER_COPY.failed)
          .filter((node) => !node.closest('.sr-only'))
          .map((node) => node.textContent);
      openForm();
      typeReps();
      pressCreate();
      await waitFor(() => expect(shown().length).toBe(1));
      fireEvent.click(within(sheet()).getByRole('button', { name: BUILDER_COPY.cancel }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(within(sheet()).queryByLabelText(ITEM_PICKER_COPY.name)).toBeNull();
      expect(shown()).toEqual([]);
    });
    it('a retry in flight no longer shows the last failure', async () => {
      const newItem = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.retry })
        .mockReturnValue(new Promise(() => {}));
      editor({ newItem: newItem as never });
      const shown = () =>
        within(sheet())
          .queryAllByText(ITEM_PICKER_COPY.failed)
          .filter((node) => !node.closest('.sr-only'))
          .map((node) => node.textContent);
      openForm();
      typeReps();
      pressCreate();
      await waitFor(() => expect(shown().length).toBe(1));
      pressCreate();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(newItem).toHaveBeenCalledTimes(2);
      expect(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.creating })).toBeTruthy();
      expect(shown()).toEqual([]);
    });
    it('after a failure, a name already listed does not keep the failure above Select', async () => {
      editor({ newItem: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.retry }) });
      const shown = () =>
        within(sheet())
          .queryAllByText(ITEM_PICKER_COPY.failed)
          .filter((node) => !node.closest('.sr-only'))
          .map((node) => node.textContent);
      openForm();
      typeReps();
      pressCreate();
      await waitFor(() => expect(shown().length).toBe(1));
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name), {
        target: { value: 'pull up' },
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(
        within(sheet()).getByRole('button', { name: selectExistingText('Pull-up') }),
      ).toBeTruthy();
      expect(shown()).toEqual([]);
    });
  });
});

describe('the household’s item cap (FAM-1 7b-ii, plan §Caps)', () => {
  /** The household's own items, topped up to `MAX_HOUSEHOLD_ITEMS` with synthetic ones. */
  const atCap: readonly MovementOptionDTO[] = [
    ...pickerOptions,
    ...Array.from(
      { length: MAX_HOUSEHOLD_ITEMS - householdPickerOptions.length },
      (_, i): MovementOptionDTO => ({
        publicId: `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
        name: `Made item ${i}`,
        trackingType: TRACKING_TYPE.reps,
        owner: 'household',
        unitDefault: null,
        isBodyweight: false,
      }),
    ),
  ];
  const create = () => within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create });
  const openForm = (typed: string) => {
    openPicker();
    fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.newItem }));
    fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name), {
      target: { value: typed },
    });
  };
  /** The lines a person sees saying `text` (the sheet's status repeats it for a screen reader). */
  const seen = (text: string) =>
    within(sheet())
      .queryAllByText(text)
      .filter((node) => !node.closest('.sr-only'));

  it('says the household is full before any typing; one item fewer, nothing', () => {
    editor({}, newWorkoutEmpty, atCap);
    openPicker();
    expect(within(sheet()).getByText(ITEM_PICKER_COPY.householdFull)).toBeTruthy();
    cleanup();
    editor({}, newWorkoutEmpty, atCap.slice(0, -1));
    openPicker();
    expect(within(sheet()).queryByText(ITEM_PICKER_COPY.householdFull)).toBeNull();
  });

  it('🔴 a new name cannot be created: Create is inactive, a tap sends nothing and says why', async () => {
    const all = editor({}, newWorkoutEmpty, atCap);
    openForm('Bear crawl');
    fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
      target: { value: TRACKING_TYPE.reps },
    });
    expect(create().getAttribute('aria-disabled')).toBe('true');
    expect(seen(ITEM_PICKER_COPY.householdFull)).toHaveLength(1);
    const focused = document.activeElement;
    fireEvent.click(create());
    expect(all.newItem).not.toHaveBeenCalled();
    // Nothing is missing, so focus is not sent to a field.
    expect(document.activeElement).toBe(focused);
    // Seen in the form's footer, once (the standing line steps aside for the message).
    await waitFor(() =>
      expect(seen(ITEM_PICKER_COPY.householdFull).map((n) => n.id)).toEqual(['']),
    );
  });

  it('a name that is already an item still selects it (never capped)', async () => {
    editor({}, newWorkoutEmpty, atCap);
    openForm('Push-ups');
    const select = within(sheet()).getByRole('button', { name: selectExistingText('Push-ups') });
    expect(select.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(select);
    await waitFor(() => expect(row('Push-ups').getAttribute('aria-checked')).toBe('true'));
  });

  it('a create refused limit_reached (a race) says so in the form’s footer, with focus on Create', async () => {
    editor({
      newItem: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.limit_reached }),
    });
    openForm('Bear crawl');
    fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
      target: { value: TRACKING_TYPE.reps },
    });
    fireEvent.click(create());
    await waitFor(() => expect(seen(ITEM_PICKER_COPY.full)).toHaveLength(1));
    expect(within(sheet()).queryByText(ITEM_PICKER_COPY.failed)).toBeNull();
    expect(document.activeElement).toBe(create());
  });
});
