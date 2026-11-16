// @vitest-environment jsdom
import {
  MAX_WORKOUT_ITEMS,
  PROGRAM_REFUSAL,
  TRACKING_TYPE_LABELS,
  type ProgramActions,
  type WorkoutDraft,
} from '@mat-plan/shared';
import { heavyADraft, newWorkoutEmpty } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { pickerOptions } from '@/app/design/program/picker-options';
import type { MovementOptionDTO } from '@/lib/movements/movement-option';

import {
  addedText,
  addItemsText,
  alreadyListedText,
  capText,
  createdText,
  EDITOR_COPY,
  existedText,
  ITEM_PICKER_COPY,
  newItemLabel,
  pickedText,
  selectExistingText,
  TRACKING_TYPE_EXAMPLES,
} from '../builder-text';
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
    newItem: vi
      .fn()
      .mockResolvedValue({ ok: true, itemPublicId: NEW_ID, trackingType: 'reps', existed: false }),
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
/** The footer's line of picked names. */
const picked = () =>
  within(sheet())
    .getByRole('button', { name: /^Add \d/ })
    .parentElement!.querySelector('p')?.textContent;
const search = (text: string) =>
  fireEvent.change(within(sheet()).getByRole('searchbox'), { target: { value: text } });

describe('the item picker (FAM-1 9)', () => {
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

  it('a new item not in the list takes the name the server stored', async () => {
    editor({
      newItem: vi.fn().mockResolvedValue({
        ok: true,
        itemPublicId: NEW_ID,
        name: 'Bear Crawl',
        trackingType: 'reps',
        existed: true,
      }),
    });
    openPicker();
    search('bear crawl');
    fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel('bear crawl') }));
    fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
      target: { value: 'reps' },
    });
    fireEvent.click(within(sheet()).getByRole('button', { name: ITEM_PICKER_COPY.create }));
    await waitFor(() => expect(row('Bear Crawl').getAttribute('aria-checked')).toBe('true'));
    expect(
      within(sheet()).getByText(existedText('Bear Crawl', TRACKING_TYPE_LABELS.reps)),
    ).toBeTruthy();
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
    expect(row('Pull-up').textContent).toContain(ITEM_PICKER_COPY.alreadyIn);
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
    expect(within(sheet()).getAllByText(capText(MAX_WORKOUT_ITEMS)).length).toBeGreaterThan(0);
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
        target: { value: 'reps' },
      });
      expect(within(sheet()).getByText(TRACKING_TYPE_EXAMPLES.reps)).toBeTruthy();
      fireEvent.click(create());
      await waitFor(() => expect(row('Bear crawl').getAttribute('aria-checked')).toBe('true'));
      expect(all.newItem).toHaveBeenCalledWith({ name: 'Bear crawl', trackingType: 'reps' });
      expect(all.saveWorkout).not.toHaveBeenCalled();
      expect(within(sheet()).getByText(createdText('Bear crawl'))).toBeTruthy();
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
          trackingType: 'reps',
          existed: true,
        }),
      });
      openForm('Chin over bar');
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: 'reps' },
      });
      fireEvent.click(create());
      await waitFor(() => expect(row('Pull-up').getAttribute('aria-checked')).toBe('true'));
      expect(
        within(sheet()).getByText(existedText('Pull-up', TRACKING_TYPE_LABELS.reps)),
      ).toBeTruthy();
    });

    it('a refused name is said under the field, and the form stays', async () => {
      editor({
        newItem: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.invalid }),
      });
      openForm();
      fireEvent.change(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks), {
        target: { value: 'reps' },
      });
      fireEvent.click(create());
      await waitFor(() => expect(within(sheet()).getByText(ITEM_PICKER_COPY.refused)).toBeTruthy());
      expect(within(sheet()).getByLabelText(ITEM_PICKER_COPY.name)).toBeTruthy();
    });

    it('Enter in the name moves to the type and never creates', () => {
      const all = editor();
      openForm();
      const name = within(sheet()).getByLabelText(ITEM_PICKER_COPY.name);
      fireEvent.keyDown(name, { key: 'Enter' });
      expect(document.activeElement).toBe(within(sheet()).getByLabelText(ITEM_PICKER_COPY.tracks));
      expect(all.newItem).not.toHaveBeenCalled();
    });

    it('Cancel goes back to the list with the ticks', () => {
      editor();
      openPicker();
      fireEvent.click(row('Sprawls'));
      search('Bear crawl');
      fireEvent.click(within(sheet()).getByRole('button', { name: newItemLabel('Bear crawl') }));
      fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
      search('');
      expect(row('Sprawls').getAttribute('aria-checked')).toBe('true');
    });
  });

  it('the editor still says when the workout is empty', () => {
    editor();
    expect(screen.getByText(EDITOR_COPY.noItems)).toBeTruthy();
  });
});
