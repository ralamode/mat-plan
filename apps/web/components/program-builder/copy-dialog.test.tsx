// @vitest-environment jsdom
import {
  PROGRAM_REFUSAL,
  WORKOUT_NAME_MAX,
  type ProgramActions,
  type ProgramView,
} from '@mat-plan/shared';
import { familyProgram } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import {
  COPY_COPY,
  copiedText,
  copyName,
  copyTakenText,
  copyTitle,
  copyToLabel,
  doubleText,
  targetPeopleText,
  thisProgramOption,
  weekdayName,
} from './builder-text';
import { ProgramScreen } from './program-screen';

afterEach(cleanup);
beforeEach(() => {
  // The sheet pops its history entry on close; in jsdom that popstate would land in the next test.
  window.history.replaceState(null, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
});

const heavyA = familyProgram.workouts.find((w) => w.name === 'Heavy A')!;
const [stretching, adultsOwn] = familyProgram.otherPrograms;

function page(extra: Partial<ProgramActions> = {}, program: ProgramView = familyProgram) {
  const all: ProgramActions = {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn().mockResolvedValue({ ok: true, workoutPublicId: 'new' }),
    newItem: vi.fn(),
    ...extra,
  };
  render(<ProgramScreen program={program} actions={all} />);
  return all;
}
const openCopy = (name = 'Heavy A') =>
  fireEvent.click(screen.getByRole('button', { name: copyToLabel(name) }));
const dialog = () => screen.getByRole('dialog', { name: copyTitle(heavyA.name) });
const to = () => within(dialog()).getByLabelText(COPY_COPY.to) as HTMLSelectElement;
const copyButton = () => within(dialog()).getByRole('button', { name: COPY_COPY.copy });
const day = (k: number) => within(dialog()).getByRole('checkbox', { name: weekdayName(k) });

describe('Copy to a program (FAM-1 10b)', () => {
  it('each workout has "Copy to…", named for the workout; none when copyWorkout is not wired', () => {
    page();
    expect(screen.getByRole('button', { name: copyToLabel('Heavy A') }).textContent).toBe(
      COPY_COPY.open,
    );
    cleanup();
    page({ copyWorkout: undefined as unknown as ProgramActions['copyWorkout'] });
    expect(screen.queryByRole('button', { name: copyToLabel('Heavy A') })).toBeNull();
  });

  it('To starts on "Choose a program"; Copy waits for one, and a tap says so', () => {
    const all = page();
    openCopy();
    expect(to().value).toBe('');
    expect(copyButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(copyButton());
    expect(within(dialog()).getByText(COPY_COPY.chooseFirst)).toBeTruthy();
    expect(document.activeElement).toBe(to());
    expect(all.copyWorkout).not.toHaveBeenCalled();
  });

  it('a copy to another program sends the days; who will see it is said first', async () => {
    const all = page();
    openCopy();
    fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
    expect(
      within(dialog()).getByText(targetPeopleText(adultsOwn!.name, ['Adult One'])),
    ).toBeTruthy();
    // The label shows once a day is ticked, and is not prefilled from this program's week.
    expect(within(dialog()).queryByLabelText(/^Label/)).toBeNull();
    fireEvent.click(day(1));
    expect((within(dialog()).getByLabelText(/^Label/) as HTMLInputElement).value).toBe('');
    fireEvent.click(copyButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sent = vi.mocked(all.copyWorkout).mock.calls[0]![0];
    expect(sent).toMatchObject({
      workoutPublicId: heavyA.workoutPublicId,
      toProgramPublicId: adultsOwn!.programPublicId,
      weekdays: [1],
      label: null,
    });
    expect(sent.clientId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        copiedText(heavyA.name, adultsOwn!.name, [1], false),
      ),
    );
  });

  it('into this program: the label is prefilled from its week; a taken copy name stops Copy', () => {
    const taken = {
      ...familyProgram,
      workouts: [
        ...familyProgram.workouts,
        { ...heavyA, workoutPublicId: 'copy', name: copyName(heavyA.name), copiedFrom: null },
      ],
    };
    const all = page({}, taken);
    openCopy();
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    expect(within(dialog()).getByRole('option', { name: thisProgramOption(familyProgram.name) }));
    expect(within(dialog()).getByText(copyTakenText(copyName(heavyA.name)))).toBeTruthy();
    expect(copyButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(day(1));
    expect((within(dialog()).getByLabelText(/^Label/) as HTMLInputElement).value).toBe(
      'After school',
    );
    fireEvent.click(copyButton());
    expect(all.copyWorkout).not.toHaveBeenCalled();
  });

  it('a copy’s name stays within WORKOUT_NAME_MAX', () => {
    const long = 'x'.repeat(WORKOUT_NAME_MAX);
    expect(copyName(long).length).toBe(WORKOUT_NAME_MAX);
    expect(copyName(long).endsWith(' (copy)')).toBe(true);
    expect(copyName('Heavy A')).toBe('Heavy A (copy)');
  });

  it('someone on both programs who already does it on a picked day is named', () => {
    page();
    openCopy();
    // Athlete One is on Family program and Stretching; Heavy A is on Mondays here.
    fireEvent.change(to(), { target: { value: stretching!.programPublicId } });
    fireEvent.click(day(1));
    expect(
      within(dialog()).getByText(doubleText('Athlete One', 'Heavy A', [1], familyProgram.name)),
    ).toBeTruthy();
  });

  it('a retry stays in the dialog, says so, and sends the same attempt again', async () => {
    const all = page({
      copyWorkout: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.retry })
        .mockResolvedValue({ ok: true, workoutPublicId: 'new' }),
    });
    openCopy();
    fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
    fireEvent.click(copyButton());
    await waitFor(() => expect(within(dialog()).getByText(COPY_COPY.failed)).toBeTruthy());
    fireEvent.click(copyButton());
    await waitFor(() => expect(all.copyWorkout).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(all.copyWorkout).mock.calls.map(([d]) => d.clientId);
    expect(second).toBe(first);
  });

  it('Cancel closes with focus back on the row’s "Copy to…"; a new open is a new attempt', async () => {
    const all = page();
    openCopy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: copyToLabel('Heavy A') }),
    );
    expect(all.copyWorkout).not.toHaveBeenCalled();
  });
});
