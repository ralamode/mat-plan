// @vitest-environment jsdom
import {
  emptyWeek,
  MAX_DAY_SLOTS,
  MAX_PROGRAM_WORKOUTS,
  PROGRAM_REFUSAL,
  WEEKDAYS,
  type ProgramActions,
  type ProgramView,
} from '@mat-plan/shared';
import { familyProgram } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import {
  addOnLabel,
  BUILDER_COPY,
  COPY_COPY,
  copyRefusal,
  copyTitle,
  copyToLabel,
  dayFullLabel,
  dayFullText,
  programFullText,
  skippedFullText,
  thisProgramFullOption,
  WEEK_COPY,
  weekdayName,
} from './builder-text';
import { ProgramScreen } from './program-screen';
import { newWorkoutPath, workoutPath } from './routes';

/**
 * The program page's caps (FAM-1 7b-i, plan §Caps): each stops at its entry point, before the person
 * does the work, and a `limit_reached` that a race still reaches is said in the screen's own words.
 * A full day is built here until the contract's `family-program-full-weekday` fixture lands.
 */

afterEach(() => {
  cleanup();
  refresh.mockClear();
});
beforeEach(() => {
  // The sheet pops its history entry on close; in jsdom that popstate would land in the next test.
  window.history.replaceState(null, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
});

const [, , TUESDAY, WEDNESDAY] = WEEKDAYS;
const uuid = (n: number) => `019826b4-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** `familyProgram` with `extra` more workouts, the first `onTuesday` of them on Tuesday. */
function program({ extra, onTuesday = 0 }: { extra: number; onTuesday?: number }): ProgramView {
  const workouts = Array.from({ length: extra }, (_, i) => ({
    workoutPublicId: uuid(i + 1),
    name: `Extra ${i + 1}`,
    itemCount: 0,
    usedOn: i < onTuesday ? [TUESDAY] : [],
    copiedFrom: null,
  }));
  return {
    ...familyProgram,
    workouts: [...familyProgram.workouts, ...workouts],
    week: {
      ...familyProgram.week,
      [TUESDAY]: workouts
        .slice(0, onTuesday)
        .map((w) => ({ workoutPublicId: w.workoutPublicId, label: null })),
    },
  };
}

function page(view: ProgramView, extra: Partial<ProgramActions> = {}) {
  const all: ProgramActions = {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn().mockResolvedValue({ ok: true }),
    copyWorkout: vi.fn().mockResolvedValue({ ok: true, workoutPublicId: 'new' }),
    newItem: vi.fn(),
    ...extra,
  };
  const { rerender } = render(<ProgramScreen program={view} actions={all} />);
  // The page brings a newer week (another parent's save, a refresh) while a form is open.
  update = (next) => rerender(<ProgramScreen program={next} actions={all} />);
  return all;
}
let update: (next: ProgramView) => void = () => {};
const status = () => screen.getByRole('status').textContent;
const alerts = () =>
  screen
    .getAllByRole('alert')
    .map((el) => el.textContent)
    .filter(Boolean);
const addTuesday = () => screen.getByRole('button', { name: addOnLabel(TUESDAY) });

describe('"+ New workout" stops at MAX_PROGRAM_WORKOUTS', () => {
  const base = familyProgram.workouts.length;

  it('one under the cap it is still the link to a new workout', () => {
    page(program({ extra: MAX_PROGRAM_WORKOUTS - base - 1 }));
    const link = screen.getByRole('link', { name: BUILDER_COPY.newWorkout });
    expect(link.getAttribute('href')).toBe(newWorkoutPath(familyProgram.programPublicId));
    expect(screen.queryByText(programFullText)).toBeNull();
  });

  it('at the cap: an aria-disabled button with the reason under it, which a tap says too', async () => {
    page(program({ extra: MAX_PROGRAM_WORKOUTS - base }));
    expect(screen.queryByRole('link', { name: BUILDER_COPY.newWorkout })).toBeNull();
    const stop = screen.getByRole('button', { name: BUILDER_COPY.newWorkout });
    expect(stop.getAttribute('aria-disabled')).toBe('true');
    const hint = document.getElementById(stop.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe(programFullText);
    fireEvent.click(stop);
    await waitFor(() => expect(status()).toBe(programFullText));
  });
});

describe('a day’s "+ Add" stops at MAX_DAY_SLOTS', () => {
  it('a full day: aria-disabled, the reason under its header, and a tap opens no form', async () => {
    page(program({ extra: MAX_DAY_SLOTS, onTuesday: MAX_DAY_SLOTS }));
    const add = addTuesday();
    expect(add.getAttribute('aria-disabled')).toBe('true');
    const hint = document.getElementById(add.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe(dayFullText(TUESDAY));
    // Under the header row, never in it.
    expect(hint.parentElement).not.toBe(add.parentElement);
    add.focus();
    fireEvent.click(add);
    expect(screen.queryByRole('form', { name: addOnLabel(TUESDAY) })).toBeNull();
    await waitFor(() => expect(status()).toBe(dayFullText(TUESDAY)));
    expect(document.activeElement).toBe(add);
    // Another day is not stopped, and says nothing.
    const wednesday = screen.getByRole('button', { name: addOnLabel(WEDNESDAY) });
    expect(wednesday.getAttribute('aria-disabled')).toBeNull();
    expect(wednesday.getAttribute('aria-describedby')).toBeNull();
  });

  it('the 30th add stops the day, and focus stays on its "+ Add"', async () => {
    const all = page(program({ extra: MAX_DAY_SLOTS, onTuesday: MAX_DAY_SLOTS - 1 }));
    expect(addTuesday().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(addTuesday());
    const form = screen.getByRole('form', { name: addOnLabel(TUESDAY) });
    fireEvent.change(within(form).getByLabelText(WEEK_COPY.workout), {
      target: { value: uuid(MAX_DAY_SLOTS) },
    });
    fireEvent.click(within(form).getByRole('button', { name: WEEK_COPY.addButton }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(1));
    expect(vi.mocked(all.saveWeek).mock.calls[0]![0].days[TUESDAY]).toHaveLength(MAX_DAY_SLOTS);
    expect(addTuesday().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(addTuesday());
  });

  it('the add form shows a full day unticked and inactive, named "Tuesday, full"', () => {
    const all = page(program({ extra: MAX_DAY_SLOTS, onTuesday: MAX_DAY_SLOTS }));
    fireEvent.click(screen.getByRole('button', { name: addOnLabel(WEDNESDAY) }));
    const form = screen.getByRole('form', { name: addOnLabel(WEDNESDAY) });
    const tuesday = within(form).getByRole('checkbox', {
      name: dayFullLabel(TUESDAY),
    }) as HTMLInputElement;
    expect(tuesday.checked).toBe(false);
    expect(tuesday.getAttribute('aria-disabled')).toBe('true');
    expect(tuesday.parentElement!.textContent).toContain(WEEK_COPY.full);
    fireEvent.click(tuesday);
    expect(tuesday.checked).toBe(false);
    expect(all.saveWeek).not.toHaveBeenCalled();
  });

  it('a week refused limit_reached names the day, and the page is not refreshed', async () => {
    const all = page(program({ extra: MAX_DAY_SLOTS, onTuesday: MAX_DAY_SLOTS - 1 }), {
      saveWeek: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.limit_reached }),
    });
    fireEvent.click(addTuesday());
    const form = screen.getByRole('form', { name: addOnLabel(TUESDAY) });
    fireEvent.change(within(form).getByLabelText(WEEK_COPY.workout), {
      target: { value: uuid(MAX_DAY_SLOTS) },
    });
    fireEvent.click(within(form).getByRole('button', { name: WEEK_COPY.addButton }));
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(vi.mocked(all.saveWeek).mock.calls[0]![0].days[TUESDAY]).toHaveLength(MAX_DAY_SLOTS);
    expect(alerts()[0]).toMatch(/^Tuesday is full: /);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('Copy and the caps', () => {
  const heavyA = familyProgram.workouts.find((w) => w.name === 'Heavy A')!;
  const dialog = () => screen.getByRole('dialog', { name: copyTitle(heavyA.name) });
  const to = () => within(dialog()).getByLabelText(COPY_COPY.to) as HTMLSelectElement;
  const open = () => fireEvent.click(screen.getByRole('button', { name: copyToLabel('Heavy A') }));

  it('into this program a full day is inactive, "Tuesday, full"; into another it is not', () => {
    page(program({ extra: MAX_DAY_SLOTS, onTuesday: MAX_DAY_SLOTS }));
    open();
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    const full = within(dialog()).getByRole('checkbox', { name: dayFullLabel(TUESDAY) });
    expect(full.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(to(), { target: { value: familyProgram.otherPrograms[0]!.programPublicId } });
    expect(
      within(dialog())
        .getByRole('checkbox', { name: weekdayName(TUESDAY) })
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('a full day ticked for another program is dropped when To becomes this one', async () => {
    const all = page(program({ extra: MAX_DAY_SLOTS, onTuesday: MAX_DAY_SLOTS }));
    open();
    fireEvent.change(to(), { target: { value: familyProgram.otherPrograms[0]!.programPublicId } });
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: weekdayName(TUESDAY) }));
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    fireEvent.click(within(dialog()).getByRole('button', { name: COPY_COPY.copy }));
    await waitFor(() => expect(all.copyWorkout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(all.copyWorkout).mock.calls[0]![0].weekdays).toEqual([]);
  });

  it('limit_reached into another program: both causes, on To (aria-invalid), focused, no refresh', async () => {
    const other = familyProgram.otherPrograms[0]!;
    const all = page(familyProgram, {
      copyWorkout: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.limit_reached })
        .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.retry }),
    });
    open();
    fireEvent.change(to(), { target: { value: other.programPublicId } });
    fireEvent.click(within(dialog()).getByRole('button', { name: COPY_COPY.copy }));
    const said = copyRefusal(PROGRAM_REFUSAL.limit_reached, {
      sameProgram: false,
      dayPicked: false,
      target: other.name,
    });
    // The target is named, never "This program".
    expect(said.startsWith(other.name)).toBe(true);
    await waitFor(() => expect(within(dialog()).getByText(said)).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(to()));
    expect(to().getAttribute('aria-invalid')).toBe('true');
    const described = to().getAttribute('aria-describedby')!.split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toContain(said);
    expect(refresh).not.toHaveBeenCalled();
    // A second Copy clears it as it sends: a retry is not said on To.
    fireEvent.click(within(dialog()).getByRole('button', { name: COPY_COPY.copy }));
    await waitFor(() => expect(all.copyWorkout).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog()).getByText(COPY_COPY.failed)).toBeTruthy());
    expect(to().getAttribute('aria-invalid')).toBeNull();
    expect(to().getAttribute('aria-describedby')!.split(' ')).toHaveLength(1);
  });

  it('limit_reached into this program with no day picked: the program is full', async () => {
    page(familyProgram, {
      copyWorkout: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.limit_reached }),
    });
    open();
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    fireEvent.click(within(dialog()).getByRole('button', { name: COPY_COPY.copy }));
    const said = copyRefusal(PROGRAM_REFUSAL.limit_reached, {
      sameProgram: true,
      dayPicked: false,
      target: familyProgram.name,
    });
    await waitFor(() => expect(within(dialog()).getByText(said)).toBeTruthy());
  });

  it('at MAX_PROGRAM_WORKOUTS this program is "(full)" in To', () => {
    page(program({ extra: MAX_PROGRAM_WORKOUTS - familyProgram.workouts.length }));
    open();
    expect(
      within(dialog()).getByRole('option', { name: thisProgramFullOption(familyProgram.name) }),
    ).toBeTruthy();
    cleanup();
    page(familyProgram);
    open();
    expect(
      within(dialog()).queryByRole('option', { name: thisProgramFullOption(familyProgram.name) }),
    ).toBeNull();
  });

  it('the footer says a copy is permanent in the app, and how to have one removed', () => {
    page(familyProgram);
    open();
    expect(within(dialog()).getByText(COPY_COPY.permanent)).toBeTruthy();
  });
});

describe('a day that fills while a form is open is not sent', () => {
  it('the add form drops it from the days it sends', async () => {
    const all = page(program({ extra: MAX_DAY_SLOTS + 1, onTuesday: MAX_DAY_SLOTS - 1 }));
    fireEvent.click(screen.getByRole('button', { name: addOnLabel(WEDNESDAY) }));
    const form = screen.getByRole('form', { name: addOnLabel(WEDNESDAY) });
    fireEvent.change(within(form).getByLabelText(WEEK_COPY.workout), {
      target: { value: uuid(MAX_DAY_SLOTS + 1) },
    });
    fireEvent.click(within(form).getByRole('checkbox', { name: weekdayName(TUESDAY) }));
    update(program({ extra: MAX_DAY_SLOTS + 1, onTuesday: MAX_DAY_SLOTS }));
    fireEvent.click(within(form).getByRole('button', { name: WEEK_COPY.addButton }));
    await waitFor(() => expect(all.saveWeek).toHaveBeenCalledTimes(1));
    const days = vi.mocked(all.saveWeek).mock.calls[0]![0].days;
    expect(days[TUESDAY]).toHaveLength(MAX_DAY_SLOTS);
    expect(days[WEDNESDAY].map((slot) => slot.workoutPublicId)).toContain(uuid(MAX_DAY_SLOTS + 1));
  });

  it('Copy into this program drops it from the weekdays it sends', async () => {
    const all = page(program({ extra: MAX_DAY_SLOTS, onTuesday: MAX_DAY_SLOTS - 1 }));
    fireEvent.click(screen.getByRole('button', { name: copyToLabel('Heavy A') }));
    const dialog = screen.getByRole('dialog', { name: copyTitle('Heavy A') });
    fireEvent.change(within(dialog).getByLabelText(COPY_COPY.to), {
      target: { value: familyProgram.programPublicId },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: weekdayName(TUESDAY) }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: weekdayName(WEDNESDAY) }));
    update(program({ extra: MAX_DAY_SLOTS, onTuesday: MAX_DAY_SLOTS }));
    fireEvent.click(within(dialog).getByRole('button', { name: COPY_COPY.copy }));
    await waitFor(() => expect(all.copyWorkout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(all.copyWorkout).mock.calls[0]![0].weekdays).toEqual([WEDNESDAY]);
    // And says so, once the dialog has closed.
    await waitFor(() => expect(status()).toContain(skippedFullText([TUESDAY])));
    expect(skippedFullText([TUESDAY])).toBe('Tuesday was full, so skipped.');
  });
});

describe('the program page links to the workout pages (7b-ii)', () => {
  it('an empty program’s week says to make a workout first', () => {
    const empty = { ...familyProgram, workouts: [], week: emptyWeek() };
    const all = { saveWeek: vi.fn(), copyWorkout: vi.fn() } as unknown as ProgramActions;
    render(<ProgramScreen program={empty} actions={all} />);
    expect(screen.getByText(WEEK_COPY.noWorkouts)).toBeTruthy();
  });

  it('each workout row and "+ New workout" are links to their pages', () => {
    page(familyProgram);
    const workouts = within(screen.getByRole('region', { name: BUILDER_COPY.workouts }));
    const id = familyProgram.programPublicId;
    expect(workouts.getByRole('link', { name: BUILDER_COPY.newWorkout }).getAttribute('href')).toBe(
      newWorkoutPath(id),
    );
    const heavyA = familyProgram.workouts.find((workout) => workout.name === 'Heavy A')!;
    expect(workouts.getByRole('link', { name: /Heavy A/ }).getAttribute('href')).toBe(
      workoutPath(id, heavyA.workoutPublicId),
    );
  });
});
