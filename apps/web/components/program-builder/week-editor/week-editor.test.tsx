// @vitest-environment jsdom
import { PROGRAM_REFUSAL, type ProgramActions, type ProgramView } from '@mat-plan/shared';
import { familyProgram, newProgramEmpty } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import {
  addedOnText,
  addOnLabel,
  moveOnLabel,
  removedRowText,
  removeFromLabel,
  restoredText,
  WEEK_COPY,
  weekdayName,
} from '../builder-text';
import { ProgramScreen } from '../program-screen';
import { DOUBLE_TAP_MS } from '../use-attempt';

afterEach(cleanup);

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
const pause = () => new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_MS + 20));

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
    const monday = within(form).getByRole('checkbox', { name: `Monday, ${WEEK_COPY.hasIt}` });
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
    const up = screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) });
    up.focus();
    fireEvent.click(up);
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
    fireEvent.click(screen.getByRole('button', { name: removeFromLabel('Heavy B', 6) }));
    const undo = within(day(6)).getByRole('button', { name: WEEK_COPY.undo });
    expect(document.activeElement).toBe(undo);
    expect(within(day(6)).getByText(removedRowText('Heavy B'))).toBeTruthy();
    // The row stays where the slot was: second, between the other two.
    expect(slotNames(6)).toEqual(['MorningMorning habits', WEEK_COPY.undo, 'EveningConditioning']);
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(1));
    expect(sent(all)[6].map((s) => s.workoutPublicId)).not.toContain(HEAVY_B);
    // A double tap on ✕ lands on Undo: it is the same tap.
    fireEvent.click(undo);
    expect(all.saveWeek).toHaveBeenCalledTimes(1);
    await pause();
    fireEvent.click(within(day(6)).getByRole('button', { name: WEEK_COPY.undo }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(2));
    expect(sent(all, 1)).toEqual(familyProgram.week);
    expect(slotNames(6)).toEqual([
      'MorningMorning habits',
      'After lunchHeavy B',
      'EveningConditioning',
    ]);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: removeFromLabel('Heavy B', 6) }),
    );
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
    fireEvent.change(field, { target: { value: 'Dawn' } });
    fireEvent.click(within(day(6)).getByRole('button', { name: WEEK_COPY.save }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalled());
    expect(sent(all)[6][1]).toEqual({ workoutPublicId: HEAVY_B, label: 'Dawn' });
    expect(document.activeElement?.textContent).toContain('Heavy B');
  });

  it('a stale page is refused: the week goes back, and the bar says to reload', async () => {
    page({
      saveWeek: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.once_per_day }),
    });
    fireEvent.click(screen.getByRole('button', { name: moveOnLabel('up', 'Heavy B', 6) }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .map((el) => el.textContent)
          .filter(Boolean),
      ).toEqual([WEEK_COPY.stale]),
    );
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

  it('a new week from the page replaces the editor’s copy', () => {
    const { all, view } = page();
    const week = { ...familyProgram.week, 0: [{ workoutPublicId: HEAVY_A, label: 'Copied' }] };
    view.rerender(<ProgramScreen program={{ ...familyProgram, week }} actions={all} />);
    expect(slotNames(0)).toEqual(['CopiedHeavy A']);
  });
});
