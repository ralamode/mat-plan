// @vitest-environment jsdom
import {
  PROGRAM_REFUSAL,
  SLOT_LABEL_MAX,
  UNIT_LABELS,
  unitsForTrackingType,
  WORKOUT_NAME_MAX,
  type ProgramActions,
} from '@mat-plan/shared';
import { heavyADraft, newWorkoutEmpty, programsList } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { SAVING_LABEL } from '@/lib/constants';

import {
  BUILDER_COPY,
  EDITOR_COPY,
  EDITOR_ERRORS,
  fieldsToFixText,
  linkLabel,
  moveLabel,
  removeLabel,
  saveRefusal,
  undoneText,
  usedByText,
} from './builder-text';
import { programPath } from './routes';
import { DOUBLE_TAP_MS, WorkoutEditorScreen } from './workout-editor-screen';

afterEach(cleanup);
beforeEach(() => push.mockReset());

function actions(extra: Partial<ProgramActions> = {}): ProgramActions {
  return {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn().mockResolvedValue({ ok: true, workoutPublicId: 'w' }),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn(),
    newItem: vi.fn(),
    ...extra,
  };
}

const family = programsList.find((p) => p.programPublicId === heavyADraft.programPublicId)!;
const BACK = programPath(heavyADraft.programPublicId);
const cards = () => within(screen.getByRole('list')).getAllByRole('listitem');
const cardNames = () => cards().map((card) => within(card).getByRole('heading').textContent);
/** The rest field's value on a superset's last card. */
const restIn = (card: HTMLElement) =>
  (within(card).getByLabelText(/^Rest/) as HTMLInputElement).value;
const frames = () => new Promise((resolve) => setTimeout(resolve, 60));
const alerts = () =>
  screen
    .queryAllByRole('alert')
    .map((el) => el.textContent)
    .filter(Boolean);
const save = () => fireEvent.click(screen.getByRole('button', { name: EDITOR_COPY.save }));
const editor = (extra: Partial<ProgramActions> = {}, draft = heavyADraft) => {
  const all = actions(extra);
  render(<WorkoutEditorScreen draft={draft} picker={{ options: [] }} actions={all} />);
  return all;
};

describe('WorkoutEditorScreen (FAM-1 8)', () => {
  it('renders heavy-a-draft: its name, a card per item in order, and the superset letters', () => {
    editor();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(EDITOR_COPY.editWorkout);
    expect((screen.getByLabelText(EDITOR_COPY.workoutName) as HTMLInputElement).value).toBe(
      'Heavy A',
    );
    expect(cardNames()).toEqual([
      'Superset A, item 1: DB bench press',
      'Superset A, item 2: Pull-up',
      'Superset B, item 1: Goblet squat',
      'Superset B, item 2: Sprawls',
      'Hollow-body hold',
    ]);
    expect(restIn(cards()[1]!)).toBe('90 s after each round');
    expect(screen.getByRole('link', { name: EDITOR_COPY.backToProgram }).getAttribute('href')).toBe(
      BACK,
    );
  });

  it('renders new-workout-empty: "New workout" and no items yet', () => {
    editor({}, newWorkoutEmpty);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(EDITOR_COPY.newWorkout);
    expect(screen.getByText(EDITOR_COPY.noItems)).toBeTruthy();
  });

  it('with its program: the back link names it, and the editor says who a change applies to', () => {
    render(
      <WorkoutEditorScreen
        draft={heavyADraft}
        picker={{ options: [] }}
        actions={actions()}
        program={family}
      />,
    );
    expect(screen.getByRole('link', { name: family.name })).toBeTruthy();
    expect(screen.getByText(usedByText(family.athletes))).toBeTruthy();
  });

  it('the name counter stops at WORKOUT_NAME_MAX', () => {
    editor();
    const field = screen.getByLabelText(EDITOR_COPY.workoutName) as HTMLInputElement;
    expect(field.maxLength).toBe(WORKOUT_NAME_MAX);
    expect(screen.getByText(`${heavyADraft.name.length}/${WORKOUT_NAME_MAX}`)).toBeTruthy();
    fireEvent.change(field, { target: { value: 'Heavy B' } });
    expect(field.getAttribute('aria-describedby')).toContain('-count');
  });

  it('the unit select offers the type’s units, and only where the type has a choice', () => {
    editor();
    const [bench, pullUp, , , hollow] = cards();
    const select = within(bench!).getByLabelText(EDITOR_COPY.unit) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(
      unitsForTrackingType('weight_reps').map((unit) => UNIT_LABELS[unit]),
    );
    expect(select.value).toBe('lb');
    expect(within(pullUp!).queryByLabelText(EDITOR_COPY.unit)).toBeNull();
    expect(within(hollow!).queryByLabelText(EDITOR_COPY.unit)).toBeNull();
    expect(within(hollow!).getByLabelText(/^Seconds/)).toBeTruthy();
  });

  it('a unit changed under a typed number says what the number now means', async () => {
    editor();
    fireEvent.change(within(cards()[0]!).getByLabelText(EDITOR_COPY.unit), {
      target: { value: 'kg' },
    });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('DB bench press: now 25 kg (was 25 lb).'),
    );
  });

  it('the unit chosen is the unit saved', async () => {
    const all = editor();
    const select = within(cards()[0]!).getByLabelText(EDITOR_COPY.unit) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'kg' } });
    expect(select.value).toBe('kg');
    save();
    await waitFor(() => expect(all.saveWorkout).toHaveBeenCalled());
    expect(vi.mocked(all.saveWorkout).mock.calls[0]![0].items[0]!.quantities).toEqual([
      { slot: 'primary', unit: 'kg', value: 25 },
    ]);
  });

  it('Save sends the draft as loaded and opens the program page', async () => {
    const all = editor();
    save();
    await waitFor(() => expect(push).toHaveBeenCalledWith(BACK));
    expect(all.saveWorkout).toHaveBeenCalledWith(heavyADraft);
  });

  it('a blank name is refused with no call, and the field takes focus', async () => {
    const all = editor();
    const field = screen.getByLabelText(EDITOR_COPY.workoutName);
    fireEvent.change(field, { target: { value: '  ' } });
    save();
    expect(all.saveWorkout).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(alerts()).toContain(EDITOR_ERRORS.name));
  });

  it('a blank Sets is refused on its card, which takes focus; the bar says to fix it', async () => {
    const all = editor();
    const sets = within(cards()[0]!).getByLabelText(EDITOR_COPY.sets);
    fireEvent.change(sets, { target: { value: '' } });
    save();
    expect(all.saveWorkout).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(sets);
    expect(within(cards()[0]!).getByText(EDITOR_ERRORS.sets)).toBeTruthy();
    expect(sets.getAttribute('aria-describedby')).toBeTruthy();
    await waitFor(() => expect(alerts()).toEqual([fieldsToFixText(1)]));
  });

  it('a name already in the program is said under the name, which takes focus', async () => {
    editor({
      saveWorkout: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.name_taken }),
    });
    save();
    const field = screen.getByLabelText(EDITOR_COPY.workoutName);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(within(field.parentElement!).getByText(EDITOR_COPY.nameTaken)).toBeTruthy();
    await waitFor(() => expect(alerts()).toEqual([EDITOR_COPY.nameTaken]));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: EDITOR_COPY.save })).toBeTruthy();
  });

  it.each([PROGRAM_REFUSAL.invalid, PROGRAM_REFUSAL.not_found, PROGRAM_REFUSAL.retry])(
    'a %s refusal is said in the bar, and Save is ready again',
    async (reason) => {
      const all = editor({ saveWorkout: vi.fn().mockResolvedValue({ ok: false, reason }) });
      save();
      await waitFor(() => expect(alerts()).toEqual([saveRefusal(reason)]));
      expect(push).not.toHaveBeenCalled();
      save();
      await waitFor(() => expect(all.saveWorkout).toHaveBeenCalledTimes(2));
      // A retry is the same attempt: the same workout and card ids.
      const [first, second] = vi.mocked(all.saveWorkout).mock.calls.map(([sent]) => sent);
      expect(second!.workoutClientId).toBe(first!.workoutClientId);
      expect(second!.items.map((i) => i.prescriptionClientId)).toEqual(
        first!.items.map((i) => i.prescriptionClientId),
      );
    },
  );

  it('while saving, Save reads "Saving…" and a second tap sends nothing', async () => {
    let answer!: (value: { ok: true; workoutPublicId: string }) => void;
    const saveWorkout = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    editor({ saveWorkout: saveWorkout as ProgramActions['saveWorkout'] });
    save();
    const pending = screen.getByRole('button', { name: SAVING_LABEL });
    expect(pending.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(pending);
    expect(saveWorkout).toHaveBeenCalledTimes(1);
    answer({ ok: true, workoutPublicId: 'w' });
    await waitFor(() => expect(push).toHaveBeenCalledWith(BACK));
  });

  it('Enter in a field does not save', () => {
    const all = editor();
    // jsdom never submits from a key press, so what is checked is that Enter's default is stopped.
    const field = screen.getByLabelText(EDITOR_COPY.workoutName);
    field.focus();
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false);
    expect(document.activeElement).not.toBe(field);
    expect(all.saveWorkout).not.toHaveBeenCalled();
  });

  it('a save answered after leaving the screen does not navigate', async () => {
    let answer!: (value: { ok: true; workoutPublicId: string }) => void;
    const saveWorkout = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { unmount } = render(
      <WorkoutEditorScreen
        draft={heavyADraft}
        picker={{ options: [] }}
        actions={actions({ saveWorkout: saveWorkout as ProgramActions['saveWorkout'] })}
      />,
    );
    save();
    unmount();
    answer({ ok: true, workoutPublicId: 'w' });
    await frames();
    expect(push).not.toHaveBeenCalled();
  });

  it('↓ moves a card, keeps the superset well formed, and focus stays on the same button', async () => {
    editor();
    const down = screen.getByRole('button', { name: moveLabel('down', 'DB bench press') });
    // Nothing focused, as Safari leaves it after a tap: the editor must put focus on the button.
    fireEvent.click(down);
    expect(cardNames().slice(0, 2)).toEqual([
      'Superset A, item 1: Pull-up',
      'Superset A, item 2: DB bench press',
    ]);
    // The group's rest moved with its last place.
    expect(restIn(cards()[1]!)).toBe('90 s after each round');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: moveLabel('down', 'DB bench press') }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('DB bench press moved down.'),
    );
  });

  it('↑ on the first card is aria-disabled, moves nothing, and says so', async () => {
    editor();
    const up = screen.getByRole('button', { name: moveLabel('up', 'DB bench press') });
    expect(up.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(up);
    expect(cardNames()[0]).toBe('Superset A, item 1: DB bench press');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(EDITOR_COPY.alreadyFirst),
    );
  });

  it('Remove takes the card off, ends a superset left with one item, and focus goes to the next card', async () => {
    editor();
    fireEvent.click(screen.getByRole('button', { name: removeLabel('Pull-up') }));
    expect(cardNames()[0]).toBe('DB bench press');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: removeLabel('Goblet squat') }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Pull-up removed. Cancel undoes all changes. A superset ended. Its rest is gone.',
      ),
    );
  });

  it('removing the last card moves focus to the Items heading', async () => {
    editor();
    for (const name of [
      'DB bench press',
      'Pull-up',
      'Goblet squat',
      'Sprawls',
      'Hollow-body hold',
    ]) {
      fireEvent.click(screen.getByRole('button', { name: removeLabel(name) }));
      // Past the double-tap window, so each Remove is its own tap.
      await new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_MS + 20));
    }
    expect(screen.getByText(EDITOR_COPY.noItems)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: EDITOR_COPY.items }));
  });

  it('Cancel with no changes goes straight back', () => {
    editor();
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    expect(push).toHaveBeenCalledWith(BACK);
  });

  it('Cancel or the back link with changes asks first; Keep editing returns to the link', () => {
    editor();
    fireEvent.change(screen.getByLabelText(EDITOR_COPY.workoutName), {
      target: { value: 'Heavy B' },
    });
    fireEvent.click(screen.getByRole('link', { name: EDITOR_COPY.backToProgram }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(EDITOR_COPY.discardQuestion)).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: EDITOR_COPY.keepEditing }),
    );
    fireEvent.click(screen.getByRole('button', { name: EDITOR_COPY.keepEditing }));
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: EDITOR_COPY.backToProgram }),
    );
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    fireEvent.click(screen.getByRole('button', { name: EDITOR_COPY.discard }));
    expect(push).toHaveBeenCalledWith(BACK);
  });

  it('the bar’s alert clears once the last refused field is fixed', async () => {
    editor();
    const sets = within(cards()[0]!).getByLabelText(EDITOR_COPY.sets);
    fireEvent.change(sets, { target: { value: '' } });
    save();
    await waitFor(() => expect(alerts()).toEqual([fieldsToFixText(1)]));
    fireEvent.change(sets, { target: { value: '4' } });
    await frames();
    expect(alerts()).toEqual([]);
  });

  it('a second Remove straight after the first is the same tap, and removes nothing', () => {
    editor();
    fireEvent.click(screen.getByRole('button', { name: removeLabel('Goblet squat') }));
    fireEvent.click(screen.getByRole('button', { name: removeLabel('Sprawls') }));
    expect(cards()).toHaveLength(4);
  });

  it('the discard question names its buttons, and Escape keeps editing', () => {
    editor();
    fireEvent.change(screen.getByLabelText(EDITOR_COPY.workoutName), {
      target: { value: 'Heavy B' },
    });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    expect(screen.getByRole('group', { name: EDITOR_COPY.discardQuestion })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: EDITOR_COPY.keepEditing }), {
      key: 'Escape',
    });
    expect(screen.queryByText(EDITOR_COPY.discardQuestion)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
  });

  it('Discard reads in body-contrast red on an outline, not the destructive fill', () => {
    editor();
    fireEvent.change(screen.getByLabelText(EDITOR_COPY.workoutName), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    expect(screen.getByRole('button', { name: EDITOR_COPY.discard }).className).not.toContain(
      'bg-destructive',
    );
  });

  it('a card edit counts as a change: Cancel asks first', async () => {
    editor();
    fireEvent.click(screen.getByRole('button', { name: removeLabel('Hollow-body hold') }));
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(EDITOR_COPY.discardQuestion)).toBeTruthy();
  });

  it('a reload asks only while there are changes', () => {
    editor();
    const reload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(reload()).toBe(false);
    fireEvent.change(screen.getByLabelText(EDITOR_COPY.workoutName), { target: { value: 'B' } });
    expect(reload()).toBe(true);
  });

  it('a move that splits a superset says so', async () => {
    editor();
    fireEvent.click(screen.getByRole('button', { name: moveLabel('down', 'Pull-up') }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Pull-up moved down. 2 supersets ended. 2 rests are gone.',
      ),
    );
  });

  it('changing the unit clears a refusal on the number', async () => {
    editor();
    const card = cards()[0]!;
    fireEvent.change(within(card).getByLabelText(/^Weight/), { target: { value: 'x' } });
    save();
    await waitFor(() => expect(alerts()).toEqual([fieldsToFixText(1)]));
    fireEvent.change(within(card).getByLabelText(EDITOR_COPY.unit), { target: { value: 'kg' } });
    expect(
      within(card)
        .getByLabelText(/^Weight/)
        .getAttribute('aria-invalid'),
    ).toBeNull();
  });

  it('the ids Save sends are the opened draft’s, even if the page hands a new draft', async () => {
    const all = actions();
    const view = render(
      <WorkoutEditorScreen draft={heavyADraft} picker={{ options: [] }} actions={all} />,
    );
    const other = { ...heavyADraft, workoutClientId: '01900000-0000-7000-8000-000000000999' };
    view.rerender(<WorkoutEditorScreen draft={other} picker={{ options: [] }} actions={all} />);
    save();
    await waitFor(() => expect(all.saveWorkout).toHaveBeenCalled());
    expect(vi.mocked(all.saveWorkout).mock.calls[0]![0].workoutClientId).toBe(
      heavyADraft.workoutClientId,
    );
  });

  it('removing the card that holds a group’s rest hands the rest to the group’s new last card', async () => {
    // A group of three: bench, pull-up, goblet squat, with the rest on the goblet squat.
    const [bench, pullUp, goblet] = heavyADraft.items;
    const three = {
      ...heavyADraft,
      items: [
        { ...bench!, superset: { group: 'a', order: 1 }, restAfter: null },
        { ...pullUp!, superset: { group: 'a', order: 2 }, restAfter: null },
        { ...goblet!, superset: { group: 'a', order: 3 }, restAfter: '90 s after each round' },
      ],
    };
    const all = editor({}, three);
    fireEvent.click(screen.getByRole('button', { name: removeLabel('Goblet squat') }));
    expect(restIn(cards()[1]!)).toBe('90 s after each round');
    save();
    await waitFor(() => expect(all.saveWorkout).toHaveBeenCalled());
    const sent = vi.mocked(all.saveWorkout).mock.calls[0]![0].items;
    expect(sent.map((item) => [item.superset, item.restAfter])).toEqual([
      [{ group: 'a', order: 1 }, null],
      [{ group: 'a', order: 2 }, '90 s after each round'],
    ]);
  });

  it('an item pushed out of a group of three is said to have left it', async () => {
    const [bench, pullUp, goblet, , hollow] = heavyADraft.items;
    const three = {
      ...heavyADraft,
      items: [
        { ...bench!, superset: { group: 'a', order: 1 }, restAfter: null },
        { ...pullUp!, superset: { group: 'a', order: 2 }, restAfter: null },
        { ...goblet!, superset: { group: 'a', order: 3 }, restAfter: '90 s after each round' },
        hollow!,
      ],
    };
    editor({}, three);
    fireEvent.click(screen.getByRole('button', { name: moveLabel('down', 'Goblet squat') }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Goblet squat moved down. Goblet squat left its superset.',
      ),
    );
  });

  it('a held Enter on Remove is held back; other held keys pass', () => {
    editor();
    const remove = screen.getByRole('button', { name: removeLabel('Pull-up') });
    expect(fireEvent.keyDown(remove, { key: 'Enter', repeat: true })).toBe(false);
    expect(fireEvent.keyDown(remove, { key: 'Tab', repeat: true })).toBe(true);
  });

  it('a draft the contract refuses is not sent, and the bar says so with no field blamed', async () => {
    const all = editor();
    fireEvent.change(screen.getByLabelText(EDITOR_COPY.workoutName), {
      target: { value: 'Heavy\u0000A' },
    });
    save();
    await waitFor(() => expect(alerts()).toEqual([saveRefusal(PROGRAM_REFUSAL.invalid)]));
    expect(all.saveWorkout).not.toHaveBeenCalled();
  });

  describe('supersets: link, unlink and the rest (8b)', () => {
    /** The link control whose next item is `next`. */
    const linkButton = (next: string) =>
      screen.getByRole('button', {
        name: new RegExp(
          `^(${EDITOR_COPY.linkNext}|${EDITOR_COPY.unlinkNext}|Join supersets [A-Z]+ and [A-Z]+): .+ and ${next}$`,
        ),
      });

    it('each card but the last says what a link would do, with the next item in its name', () => {
      editor();
      expect(linkButton('Pull-up').textContent).toBe(EDITOR_COPY.unlinkNext);
      expect(linkButton('Goblet squat').textContent).toBe('Join supersets A and B');
      expect(linkButton('Hollow-body hold').textContent).toBe(EDITOR_COPY.linkNext);
      expect(linkButton('Pull-up').getAttribute('aria-label')).toBe(
        linkLabel(EDITOR_COPY.unlinkNext, 'DB bench press', 'Pull-up'),
      );
      expect(within(cards()[4]!).queryByRole('button', { name: /next/ })).toBeNull();
    });

    it('the rest is edited on a superset’s last card only, and its field names the superset', () => {
      editor();
      expect(restIn(cards()[1]!)).toBe('90 s after each round');
      expect(restIn(cards()[3]!)).toBe('60 s after each round');
      for (const i of [0, 2, 4]) expect(within(cards()[i]!).queryByLabelText(/^Rest/)).toBeNull();
      expect(within(cards()[1]!).getByLabelText(/^Rest/).getAttribute('id')).toBeTruthy();
      expect(screen.getByLabelText('Rest of superset A (optional)')).toBeTruthy();
    });

    it('a new rest is saved on the group’s last item', async () => {
      const all = editor();
      fireEvent.change(within(cards()[1]!).getByLabelText(/^Rest/), { target: { value: '2 min' } });
      save();
      await waitFor(() => expect(all.saveWorkout).toHaveBeenCalled());
      expect(vi.mocked(all.saveWorkout).mock.calls[0]![0].items[1]!.restAfter).toBe('2 min');
    });

    it('a rest over the limit is refused on its field', async () => {
      const all = editor();
      const field = within(cards()[1]!).getByLabelText(/^Rest/);
      fireEvent.change(field, { target: { value: 'x'.repeat(SLOT_LABEL_MAX + 1) } });
      save();
      expect(all.saveWorkout).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(field);
      expect(within(cards()[1]!).getByText(EDITOR_ERRORS.rest)).toBeTruthy();
    });

    it('linking keeps focus on the button, which now offers the opposite', async () => {
      editor();
      fireEvent.click(linkButton('Hollow-body hold'));
      const button = linkButton('Hollow-body hold');
      expect(button.textContent).toBe(EDITOR_COPY.unlinkNext);
      expect(document.activeElement).toBe(button);
      expect(cardNames()[4]).toBe('Superset B, item 3: Hollow-body hold');
      expect(restIn(cards()[4]!)).toBe('60 s after each round');
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe('Linked: superset B now has 3 items.'),
      );
    });

    it('joining two supersets says which rest was dropped', async () => {
      editor();
      fireEvent.click(linkButton('Goblet squat'));
      expect(
        cardNames()
          .slice(0, 4)
          .every((name) => name!.startsWith('Superset A')),
      ).toBe(true);
      expect(restIn(cards()[3]!)).toBe('60 s after each round');
      expect(document.activeElement).toBe(linkButton('Goblet squat'));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe(
          'Supersets A and B are now A. Rest “90 s after each round” removed.',
        ),
      );
    });

    it('unlinking a pair ends it and says so', async () => {
      editor();
      fireEvent.click(linkButton('Pull-up'));
      expect(cardNames().slice(0, 2)).toEqual(['DB bench press', 'Pull-up']);
      expect(document.activeElement).toBe(linkButton('Pull-up'));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe(
          'Unlinked: superset A ended. Rest “90 s after each round” removed.',
        ),
      );
    });

    it('a second tap on the link straight after the first is the same tap', () => {
      editor();
      fireEvent.click(linkButton('Hollow-body hold'));
      fireEvent.click(linkButton('Hollow-body hold'));
      expect(linkButton('Hollow-body hold').textContent).toBe(EDITOR_COPY.unlinkNext);
    });

    it('a held Enter on the link control is held back', () => {
      editor();
      expect(fireEvent.keyDown(linkButton('Pull-up'), { key: 'Enter', repeat: true })).toBe(false);
    });

    it('unlink then link again leaves nothing changed: Cancel goes straight back', async () => {
      // A group of three, unlinked in the middle: the first two stay a superset.
      const [bench, pullUp, goblet] = heavyADraft.items;
      editor(
        {},
        {
          ...heavyADraft,
          items: [
            { ...bench!, superset: { group: 'a', order: 1 }, restAfter: null },
            { ...pullUp!, superset: { group: 'a', order: 2 }, restAfter: null },
            { ...goblet!, superset: { group: 'a', order: 3 }, restAfter: '90 s after each round' },
          ],
        },
      );
      fireEvent.click(linkButton('Goblet squat'));
      expect(restIn(cards()[1]!)).toBe('90 s after each round');
      await new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_MS + 20));
      fireEvent.click(linkButton('Goblet squat'));
      fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
      expect(push).toHaveBeenCalledWith(BACK);
    });

    const pause = () => new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_MS + 20));

    it('Unlink straight after Join gives each superset back its own rest', async () => {
      editor();
      fireEvent.click(linkButton('Goblet squat'));
      await pause();
      fireEvent.click(linkButton('Goblet squat'));
      expect(restIn(cards()[1]!)).toBe('90 s after each round');
      expect(restIn(cards()[3]!)).toBe('60 s after each round');
      fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
      expect(push).toHaveBeenCalledWith(BACK);
    });

    it('a pair unlinked and linked again gets its rest back, and nothing has changed', async () => {
      editor();
      fireEvent.click(linkButton('Pull-up'));
      await pause();
      fireEvent.click(linkButton('Pull-up'));
      expect(restIn(cards()[1]!)).toBe('90 s after each round');
      fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
      expect(push).toHaveBeenCalledWith(BACK);
    });

    it('an unlink that leaves one item says who left', async () => {
      const [bench, pullUp, goblet] = heavyADraft.items;
      editor(
        {},
        {
          ...heavyADraft,
          items: [
            { ...bench!, superset: { group: 'a', order: 1 }, restAfter: null },
            { ...pullUp!, superset: { group: 'a', order: 2 }, restAfter: null },
            { ...goblet!, superset: { group: 'a', order: 3 }, restAfter: '90 s after each round' },
          ],
        },
      );
      fireEvent.click(linkButton('Pull-up'));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe(
          'Unlinked: superset A now has 2 items.',
        ),
      );
      // The first item split off and linked again: a new key underneath, the same workout.
      await pause();
      fireEvent.click(linkButton('Pull-up'));
      fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
      expect(push).toHaveBeenCalledWith(BACK);
    });

    it('the next edit clears a status message', async () => {
      editor();
      fireEvent.click(linkButton('Hollow-body hold'));
      await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(''));
      fireEvent.change(screen.getByLabelText(EDITOR_COPY.workoutName), { target: { value: 'B' } });
      await frames();
      expect(screen.getByRole('status').textContent).toBe('');
    });

    const withoutRest = (index: number) => ({
      ...heavyADraft,
      items: heavyADraft.items.map((item, i) =>
        i === index ? { ...item, restAfter: null } : item,
      ),
    });

    it('Join then Unlink, when only one superset had a rest, gives back neither more nor less', async () => {
      editor({}, withoutRest(3));
      fireEvent.click(linkButton('Goblet squat'));
      await pause();
      fireEvent.click(linkButton('Goblet squat'));
      expect(restIn(cards()[1]!)).toBe('90 s after each round');
      expect(restIn(cards()[3]!)).toBe('');
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe(undoneText(false)));
      fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
      expect(push).toHaveBeenCalledWith(BACK);
    });

    it('an edit between two taps means the second is not an undo: a rest typed since stays', async () => {
      editor();
      fireEvent.click(linkButton('Goblet squat'));
      fireEvent.change(within(cards()[3]!).getByLabelText(/^Rest/), { target: { value: '2 min' } });
      await pause();
      fireEvent.click(linkButton('Goblet squat'));
      // The plain unlink rule: the rest is copied to both sides.
      expect(restIn(cards()[1]!)).toBe('2 min');
      expect(restIn(cards()[3]!)).toBe('2 min');
    });

    it('a rest removed by a join never comes back over one typed later', async () => {
      editor();
      fireEvent.click(linkButton('Goblet squat'));
      fireEvent.click(linkButton('Sprawls'));
      fireEvent.change(within(cards()[2]!).getByLabelText(/^Rest/), { target: { value: '2 min' } });
      await pause();
      fireEvent.click(linkButton('Goblet squat'));
      expect(restIn(cards()[1]!)).toBe('2 min');
    });

    it('two new items linked: the status says where its rest is', async () => {
      editor(
        {},
        {
          ...heavyADraft,
          items: heavyADraft.items.map((item) => ({ ...item, superset: null, restAfter: null })),
        },
      );
      fireEvent.click(linkButton('Pull-up'));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe(
          'Linked: superset A. Its rest is on its last item.',
        ),
      );
    });

    it('a group of four unlinked in the middle is two supersets', async () => {
      const [bench, pullUp, goblet, sprawls] = heavyADraft.items;
      editor(
        {},
        {
          ...heavyADraft,
          items: [bench!, pullUp!, goblet!, sprawls!].map((item, i) => ({
            ...item,
            superset: { group: 'a', order: i + 1 },
            restAfter: i === 3 ? '90 s after each round' : null,
          })),
        },
      );
      fireEvent.click(linkButton('Goblet squat'));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe('Unlinked: superset A is now two.'),
      );
      expect(restIn(cards()[1]!)).toBe('90 s after each round');
      expect(restIn(cards()[3]!)).toBe('90 s after each round');
    });

    it('the double-tap guard is per card: two cards tapped quickly both link', () => {
      editor(
        {},
        {
          ...heavyADraft,
          items: heavyADraft.items.map((item) => ({ ...item, superset: null, restAfter: null })),
        },
      );
      fireEvent.click(linkButton('Pull-up'));
      fireEvent.click(linkButton('Sprawls'));
      expect(linkButton('Pull-up').textContent).toBe(EDITOR_COPY.unlinkNext);
      expect(linkButton('Sprawls').textContent).toBe(EDITOR_COPY.unlinkNext);
    });

    it('typing into an empty rest and clearing it again is no change', () => {
      editor({}, withoutRest(1));
      const field = within(cards()[1]!).getByLabelText(/^Rest/);
      fireEvent.change(field, { target: { value: 'a' } });
      fireEvent.change(field, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
      expect(push).toHaveBeenCalledWith(BACK);
    });

    it.each([
      ['the name', () => screen.getByLabelText(EDITOR_COPY.workoutName)],
      ['the description', () => screen.getByLabelText(/^Description/)],
      ['a card field', () => within(cards()[0]!).getByLabelText(EDITOR_COPY.sets)],
      ['the rest', () => within(cards()[1]!).getByLabelText(/^Rest/)],
    ])('editing %s clears a status message', async (_, field) => {
      editor();
      fireEvent.click(linkButton('Hollow-body hold'));
      await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(''));
      fireEvent.change(field(), { target: { value: '3' } });
      await frames();
      expect(screen.getByRole('status').textContent).toBe('');
    });

    it('editing another field leaves a refusal’s alert in place', async () => {
      editor();
      fireEvent.change(within(cards()[0]!).getByLabelText(EDITOR_COPY.sets), {
        target: { value: '' },
      });
      save();
      await waitFor(() => expect(alerts()).toEqual([fieldsToFixText(1)]));
      fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'x' } });
      await frames();
      expect(alerts()).toEqual([fieldsToFixText(1)]);
    });

    it('a tapped link that would sit under the save bar is scrolled clear of it', () => {
      editor();
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
      const bar = screen.getByRole('button', { name: EDITOR_COPY.save }).closest('div.sticky')!;
      vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 600 } as DOMRect);
      const button = linkButton('Hollow-body hold');
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        top: 580,
        bottom: 624,
      } as DOMRect);
      fireEvent.click(button);
      expect(scrollBy).toHaveBeenCalledWith(0, 32);
      scrollBy.mockRestore();
    });
  });
});
