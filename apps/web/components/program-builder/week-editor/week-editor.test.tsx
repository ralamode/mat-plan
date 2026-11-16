// @vitest-environment jsdom
import { PROGRAM_REFUSAL, type ProgramActions, type ProgramView } from '@mat-plan/shared';
import { familyProgram, newProgramEmpty } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import {
  addedOnText,
  BUILDER_COPY,
  EDITOR_COPY,
  hasItLabel,
  addOnLabel,
  moveOnLabel,
  removedRowText,
  removeFromLabel,
  restoredText,
  undoLabel,
  WEEK_COPY,
  weekdayName,
} from '../builder-text';
import { ProgramScreen } from '../program-screen';
import { tapClock } from '../test-taps';

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

const id = (name: string) => familyProgram.workouts.find((w) => w.name === name)!.workoutPublicId;
const HEAVY_A = id('Heavy A');
const HEAVY_B = id('Heavy B');

function actions(extra: Partial<ProgramActions> = {}): ProgramActions {
  return {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn().mockResolvedValue({ ok: true }),
    copyWorkout: vi.fn(),
    newItem: vi.fn(),
    ...extra,
  };
}
const page = (extra: Partial<ProgramActions> = {}, program: ProgramView = familyProgram) => {
  const all = actions(extra);
  const view = render(<ProgramScreen program={program} actions={all} />);
  return { all, view };
};
/** A day's block: its heading row and its slots. */
const day = (weekday: number) =>
  screen.getByRole('heading', { level: 3, name: new RegExp(`^${weekdayName(weekday)}`) })
    .parentElement!.parentElement!;
const slotNames = (weekday: number) =>
  within(day(weekday))
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('button')?.textContent?.replace(`${WEEK_COPY.editLabel}: `, ''));
const sent = (all: ProgramActions, call = 0) => vi.mocked(all.saveWeek).mock.calls[call]![0].days;
const status = () => screen.getByRole('status').textContent;
const alerts = () =>
  screen
    .getAllByRole('alert')
    .map((el) => el.textContent)
    .filter(Boolean);
/** A save that waits until the test answers it. */
function held() {
  const answers: ((value: { ok: true } | { ok: false; reason: string }) => void)[] = [];
  const saveWeek = vi.fn(
    () => new Promise((resolve) => answers.push(resolve as (typeof answers)[number])),
  );
  return { saveWeek: saveWeek as unknown as ProgramActions['saveWeek'], answers };
}
const SATURDAY = ['MorningMorning habits', 'After lunchHeavy B', 'EveningConditioning'];

describe('the week editor (FAM-1 10)', () => {
  it('+ Add opens a form under the day: the workout has no default, and Add waits for one', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: addOnLabel(1) }));
    const form = screen.getByRole('form', { name: addOnLabel(1) });
    const select = within(form).getByLabelText(WEEK_COPY.workout) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(document.activeElement).toBe(select);
    expect(
      within(form).getByRole('button', { name: WEEK_COPY.addButton }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(within(form).getByRole('option', { name: 'Heavy A (already on Monday)' })).toBeTruthy();
  });

  it('adding to several days skips the days that have it, and says so', async () => {
    const { all } = page();
    fireEvent.click(screen.getByRole('button', { name: addOnLabel(1) }));
    const form = screen.getByRole('form', { name: addOnLabel(1) });
    fireEvent.change(within(form).getByLabelText(WEEK_COPY.workout), {
      target: { value: HEAVY_A },
    });
    // Monday and Friday have it: shown ticked, and inactive.
    const monday = within(form).getByRole('checkbox', { name: hasItLabel(1) });
    expect(monday.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Tuesday' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Sunday' }));
    fireEvent.click(within(form).getByRole('button', { name: WEEK_COPY.addButton }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(1));
    const days = sent(all);
    expect(days[2].at(-1)).toEqual({ workoutPublicId: HEAVY_A, label: null });
    expect(days[0]).toEqual([{ workoutPublicId: HEAVY_A, label: null }]);
    expect(days[1]).toEqual(familyProgram.week[1]);
    await waitFor(() => expect(status()).toBe(addedOnText('Heavy A', [2, 0], [1, 5])));
    expect(status()).toBe('Heavy A added on Tue and Sun. Already on Mon and Fri, so skipped.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: addOnLabel(1) }));
  });

  it('only days that have it: the form says to pick another, and sends nothing', () => {
    const { all } = page();
    fireEvent.click(screen.getByRole('button', { name: addOnLabel(1) }));
    const form = screen.getByRole('form', { name: addOnLabel(1) });
    fireEvent.change(within(form).getByLabelText(WEEK_COPY.workout), {
      target: { value: HEAVY_A },
    });
    fireEvent.click(within(form).getByRole('button', { name: WEEK_COPY.addButton }));
    expect(within(form).getByText(WEEK_COPY.pickADay)).toBeTruthy();
    expect(all.saveWeek).not.toHaveBeenCalled();
  });

  it('↑ moves a slot up within its day, saves the whole week, and keeps focus on the button', async () => {
    const { all } = page();
    // Nothing focused, as Safari leaves it after a tap: the editor must put focus on the button.
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }));
    expect(slotNames(6)).toEqual([
      'After lunchHeavy B',
      'MorningMorning habits',
      'EveningConditioning',
    ]);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }),
    );
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalled());
    expect(sent(all)[6].map((s) => s.workoutPublicId)[0]).toBe(HEAVY_B);
  });

  it('✕ leaves "… removed · Undo" in place; Undo puts it back where it was', async () => {
    const { all } = page();
    const clock = tapClock();
    clock.tap(screen.getByRole('button', { name: removeFromLabel('Heavy B', 6) }));
    const undo = within(day(6)).getByRole('button', { name: undoLabel('Heavy B', 6) });
    expect(document.activeElement).toBe(undo);
    expect(within(day(6)).getByText(removedRowText('Heavy B'))).toBeTruthy();
    // The row stays where the slot was: second, between the other two.
    expect(slotNames(6)).toEqual(['MorningMorning habits', WEEK_COPY.undo, 'EveningConditioning']);
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(1));
    expect(sent(all)[6].map((s) => s.workoutPublicId)).not.toContain(HEAVY_B);
    // A double tap on ✕ lands on Undo: it is the same tap.
    clock.again(undo);
    expect(all.saveWeek).toHaveBeenCalledTimes(1);
    clock.tap(within(day(6)).getByRole('button', { name: undoLabel('Heavy B', 6) }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(2));
    expect(sent(all, 1)).toEqual(familyProgram.week);
    expect(slotNames(6)).toEqual([
      'MorningMorning habits',
      'After lunchHeavy B',
      'EveningConditioning',
    ]);
    // Focus on the slot's text, not its ✕: a double tap on Undo must not remove it again.
    expect(document.activeElement?.textContent).toContain('Heavy B');
    clock.again(screen.getByRole('button', { name: removeFromLabel('Heavy B', 6) }));
    expect(all.saveWeek).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(status()).toBe(restoredText('Heavy B', 6)));
  });

  it('a label is edited by tapping the slot, and focus comes back to it', async () => {
    const { all } = page();
    const text = within(day(6)).getAllByRole('button', {
      name: new RegExp(`^${WEEK_COPY.editLabel}`),
    })[1]!;
    fireEvent.click(text);
    const field = within(day(6)).getByLabelText(/^Label/) as HTMLInputElement;
    expect(field.value).toBe('After lunch');
    // Focused in the same tap, so a phone raises its keyboard.
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'Dawn' } });
    fireEvent.click(within(day(6)).getByRole('button', { name: BUILDER_COPY.save }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalled());
    expect(sent(all)[6][1]).toEqual({ workoutPublicId: HEAVY_B, label: 'Dawn' });
    expect(document.activeElement?.textContent).toContain('Heavy B');
  });

  it('a stale page is refused: the week goes back, and the bar says to reload', async () => {
    page({
      saveWeek: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.once_per_day }),
    });
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }));
    await waitFor(() => expect(alerts()).toEqual([WEEK_COPY.stale]));
    // The page's week is the stale one: the latest is fetched, as the message says.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(slotNames(6)).toEqual([
      'MorningMorning habits',
      'After lunchHeavy B',
      'EveningConditioning',
    ]);
  });

  it('a change made while a save is out is sent when it returns, with both', async () => {
    let answer!: (value: { ok: true }) => void;
    const saveWeek = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue({ ok: true });
    const { all } = page({ saveWeek });
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }));
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy A', 1) }));
    expect(saveWeek).toHaveBeenCalledTimes(1);
    answer({ ok: true });
    await waitFor(() => expect(saveWeek).toHaveBeenCalledTimes(2));
    const latest = sent(all, 1);
    expect(latest[6][0]!.workoutPublicId).toBe(HEAVY_B);
    expect(latest[1][0]!.workoutPublicId).toBe(HEAVY_A);
  });

  it('with no workouts, no day offers + Add, and the week says why once', () => {
    page({}, newProgramEmpty);
    expect(screen.queryByRole('button', { name: addOnLabel(1) })).toBeNull();
    expect(screen.getAllByText(WEEK_COPY.noWorkouts)).toHaveLength(1);
  });

  it('a new week from the page replaces the editor’s own copy, once its save is back', async () => {
    const { all, view } = page();
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    const week = { ...familyProgram.week, 0: [{ workoutPublicId: HEAVY_A, label: 'Copied' }] };
    view.rerender(<ProgramScreen program={{ ...familyProgram, week }} actions={all} />);
    expect(slotNames(0)).toEqual(['CopiedHeavy A']);
    // The page's week, not the editor's copy: Saturday as the page has it.
    expect(slotNames(6)).toEqual([
      'MorningMorning habits',
      'After lunchHeavy B',
      'EveningConditioning',
    ]);
  });

  it('a save that throws (a dropped connection) is a retry: the week goes back, and the next change is sent', async () => {
    const saveWeek = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue({ ok: true });
    page({ saveWeek });
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }));
    await waitFor(() => expect(alerts()).toEqual([WEEK_COPY.failed]));
    expect(slotNames(6)).toEqual(SATURDAY);
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy A', 1) }));
    await waitFor(() => expect(saveWeek).toHaveBeenCalledTimes(2));
  });

  it('a refusal drops a change queued on top of it; the next change is sent on its own', async () => {
    const { saveWeek, answers } = held();
    const { all } = page({ saveWeek });
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }));
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy A', 1) }));
    answers[0]!({ ok: false, reason: PROGRAM_REFUSAL.retry });
    await waitFor(() => expect(alerts()).toEqual([WEEK_COPY.failed]));
    expect(saveWeek).toHaveBeenCalledTimes(1);
    expect(slotNames(1)).toEqual(['MorningMorning habits', 'After schoolHeavy A']);
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('down', 'Morning habits', 3) }));
    expect(saveWeek).toHaveBeenCalledTimes(2);
    expect(sent(all, 1)[6]).toEqual(familyProgram.week[6]);
  });

  it('a week the page brings while a save is out shows once the save is back', async () => {
    const { saveWeek, answers } = held();
    const { all, view } = page({ saveWeek });
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }));
    const week = { ...familyProgram.week, 0: [{ workoutPublicId: HEAVY_A, label: 'Copied' }] };
    view.rerender(<ProgramScreen program={{ ...familyProgram, week }} actions={all} />);
    // Still the editor's own week while its save is out.
    expect(slotNames(6)[0]).toBe('After lunchHeavy B');
    answers[0]!({ ok: true });
    await waitFor(() => expect(slotNames(0)).toEqual(['CopiedHeavy A']));
  });

  it('Undo puts the slot back into the week as it is now, keeping a change that came since', async () => {
    const { all, view } = page();
    const clock = tapClock();
    clock.tap(screen.getByRole('button', { name: removeFromLabel('Heavy B', 6) }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(1));
    const week = { ...sent(all), 0: [{ workoutPublicId: HEAVY_A, label: 'Copied' }] };
    view.rerender(<ProgramScreen program={{ ...familyProgram, week }} actions={all} />);
    clock.tap(within(day(6)).getByRole('button', { name: undoLabel('Heavy B', 6) }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(2));
    expect(sent(all, 1)[0]).toEqual(week[0]);
    expect(sent(all, 1)[6]).toEqual(familyProgram.week[6]);
  });

  it('removing a day’s last slot leaves Undo at the end of the day', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: removeFromLabel('Conditioning', 6) }));
    expect(slotNames(6)).toEqual(['MorningMorning habits', 'After lunchHeavy B', WEEK_COPY.undo]);
  });

  it('↓ moves a slot down; at either end the bar says so and nothing is sent', async () => {
    const { all } = page();
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('down', 'Conditioning', 6) }));
    await waitFor(() => expect(status()).toBe(EDITOR_COPY.alreadyLast));
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Morning habits', 6) }));
    await waitFor(() => expect(status()).toBe(EDITOR_COPY.alreadyFirst));
    expect(all.saveWeek).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('down', 'Morning habits', 6) }));
    expect(slotNames(6)).toEqual([
      'After lunchHeavy B',
      'MorningMorning habits',
      'EveningConditioning',
    ]);
  });

  it('Add with no workout chosen says so on the select, and sends nothing', () => {
    const { all } = page();
    fireEvent.click(screen.getByRole('button', { name: addOnLabel(1) }));
    const form = screen.getByRole('form', { name: addOnLabel(1) });
    fireEvent.click(within(form).getByRole('button', { name: WEEK_COPY.addButton }));
    const select = within(form).getByLabelText(WEEK_COPY.workout);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(select.getAttribute('aria-describedby')!)!.textContent).toBe(
      WEEK_COPY.chooseWorkout,
    );
    expect(all.saveWeek).not.toHaveBeenCalled();
  });

  it('a label the endpoint would refuse is said on the field, and costs nothing', () => {
    const { all } = page();
    fireEvent.click(
      within(day(6)).getAllByRole('button', { name: new RegExp(`^${WEEK_COPY.editLabel}`) })[1]!,
    );
    const field = within(day(6)).getByLabelText(/^Label/) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Dawn\tpatrol' } });
    fireEvent.click(within(day(6)).getByRole('button', { name: BUILDER_COPY.save }));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(within(day(6)).getByText(WEEK_COPY.labelInvalid)).toBeTruthy();
    expect(all.saveWeek).not.toHaveBeenCalled();
  });

  it('Escape closes the label editor; an unchanged label sends nothing', () => {
    const { all } = page();
    const text = () =>
      within(day(6)).getAllByRole('button', { name: new RegExp(`^${WEEK_COPY.editLabel}`) })[1]!;
    fireEvent.click(text());
    fireEvent.keyDown(within(day(6)).getByLabelText(/^Label/), { key: 'Escape' });
    expect(within(day(6)).queryByLabelText(/^Label/)).toBeNull();
    expect(document.activeElement).toBe(text());
    fireEvent.click(text());
    fireEvent.click(within(day(6)).getByRole('button', { name: BUILDER_COPY.save }));
    expect(all.saveWeek).not.toHaveBeenCalled();
  });

  it('the status bar says that changes save as they are made, until a message', () => {
    page();
    expect(screen.getByText(BUILDER_COPY.savesAsYouGo)).toBeTruthy();
  });
});
