// @vitest-environment jsdom
import { PROGRAM_NAME_MAX, PROGRAM_REFUSAL, type ProgramActions } from '@mat-plan/shared';
import {
  adultProgramWithCopy,
  familyProgram,
  newProgramEmpty,
} from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The week editor refreshes the page on a stale week.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { athletePath, SAVING_LABEL } from '@/lib/constants';

import {
  athleteHint,
  BUILDER_COPY,
  copiedFromText,
  nameRefusal,
  renameLabel,
  takenOffText,
  takeOffFailedText,
  takeOffLabel,
  takingOffLabel,
  usedByText,
  WEEK_COPY,
  workoutSavedText,
  workoutSummary,
} from './builder-text';
import { noteArrival, takeArrival } from './arrival';
import { ProgramScreen } from './program-screen';
import { newWorkoutPath, PROGRAMS_PATH, workoutPath } from './routes';

afterEach(cleanup);

function actions(extra: Partial<ProgramActions> = {}): ProgramActions {
  return {
    createProgram: vi.fn(),
    renameProgram: vi.fn().mockResolvedValue({ ok: true }),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn(),
    newItem: vi.fn(),
    ...extra,
  };
}

/** Waits past the status line's clear-then-set frame. */
const frames = () => new Promise((resolve) => setTimeout(resolve, 60));

const section = (name: string) => screen.getByRole('region', { name });
/** What the page's alerts say. The status line's alert is mounted empty, so empty ones are skipped. */
const alerts = () =>
  screen
    .queryAllByRole('alert')
    .map((el) => el.textContent)
    .filter(Boolean);

describe('ProgramScreen (FAM-1 8a)', () => {
  it('renders family-program: header, who’s on it, workouts, the week', () => {
    render(<ProgramScreen program={familyProgram} actions={actions()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(familyProgram.name);
    expect(
      screen.getByRole('link', { name: BUILDER_COPY.backToPrograms }).getAttribute('href'),
    ).toBe(PROGRAMS_PATH);
    expect(screen.getByText(usedByText(['Athlete One', 'Athlete Two']))).toBeTruthy();

    const who = within(section(BUILDER_COPY.whosOnIt)).getAllByRole('listitem');
    expect(who.map((li) => li.textContent)).toEqual(
      familyProgram.athletes.map((a) => `${a.name}${athleteHint(a, familyProgram.today)}`),
    );

    const workouts = within(section(BUILDER_COPY.workouts));
    const links = workouts.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      ...familyProgram.workouts.map((w) =>
        workoutPath(familyProgram.programPublicId, w.workoutPublicId),
      ),
      newWorkoutPath(familyProgram.programPublicId),
    ]);
    expect(links[0]!.textContent).toContain(workoutSummary(6, [1, 2, 3, 4, 5, 6]));

    const week = within(section(BUILDER_COPY.week));
    expect(week.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      // The fixture's today is a Saturday.
      `Saturday · ${WEEK_COPY.today}`,
      'Sunday',
    ]);
    // Saturday: three slots in the author's order, each its label over its workout.
    const saturday = week.getByRole('heading', { name: /^Saturday/ }).parentElement!.parentElement!;
    expect(
      within(saturday)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('button')!.textContent),
    ).toEqual([
      // The text, ✎ included; it is aria-hidden, so not part of the button's name.
      `${WEEK_COPY.editLabel}: Morning✎Morning habits`,
      `${WEEK_COPY.editLabel}: After lunch✎Heavy B`,
      `${WEEK_COPY.editLabel}: Evening✎Conditioning`,
    ]);
    const sunday = week.getByRole('heading', { name: 'Sunday' }).parentElement!.parentElement!;
    expect(within(sunday).queryByRole('list')).toBeNull();
    expect(within(sunday).getByText(BUILDER_COPY.restDay)).toBeTruthy();
  });

  it('renders new-program-empty: every section says it is empty', () => {
    render(<ProgramScreen program={newProgramEmpty} actions={actions()} />);
    expect(screen.getByText(usedByText([]))).toBeTruthy();
    expect(within(section(BUILDER_COPY.whosOnIt)).getByText(BUILDER_COPY.noOneOnIt)).toBeTruthy();
    expect(within(section(BUILDER_COPY.workouts)).getByText(BUILDER_COPY.noWorkouts)).toBeTruthy();
    expect(within(section(BUILDER_COPY.week)).getAllByText(BUILDER_COPY.restDay)).toHaveLength(7);
  });

  it('renders adult-program-with-copy: a copy names where it came from, frozen', () => {
    render(<ProgramScreen program={adultProgramWithCopy} actions={actions()} />);
    const copy = adultProgramWithCopy.workouts.find((w) => w.copiedFrom)!;
    expect(screen.getByText(copiedFromText(copy.copiedFrom!))).toBeTruthy();
    expect(screen.getAllByText(/^Copied from/)).toHaveLength(1);
  });

  it('hides Take off while the route has not wired takeOff', () => {
    render(<ProgramScreen program={familyProgram} actions={actions()} />);
    expect(screen.queryByRole('button', { name: /^Take off/ })).toBeNull();
  });

  it('Take off: the row keeps a last day, focus moves to it, and the status line says so', async () => {
    const takeOff = vi.fn().mockResolvedValue({ ok: true, lastDay: familyProgram.today });
    const { rerender } = render(
      <ProgramScreen program={familyProgram} actions={actions({ takeOff })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: takeOffLabel('Athlete Two') }));
    // The fake hands the screen the next state, as a real action's re-render does.
    const after = {
      ...familyProgram,
      athletes: familyProgram.athletes.map((a) =>
        a.name === 'Athlete Two' ? { ...a, lastDay: familyProgram.today } : a,
      ),
    };
    rerender(<ProgramScreen program={after} actions={actions({ takeOff })} />);
    const message = takenOffText('Athlete Two', familyProgram.name, true);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(message));
    expect(takeOff).toHaveBeenCalledWith({
      programPublicId: familyProgram.programPublicId,
      profilePublicId: familyProgram.athletes[1]!.profilePublicId,
    });
    // The row's text block, not merely something containing the name (<body> would).
    expect(document.activeElement).toBe(screen.getByText('Athlete Two').parentElement);
    expect(screen.queryByRole('button', { name: takeOffLabel('Athlete Two') })).toBeNull();
    expect(screen.getByRole('button', { name: takeOffLabel('Athlete One') })).toBeTruthy();
  });

  it('Take off follows its answer, not the dates: a start dated today with no last day leaves', async () => {
    const takeOff = vi.fn().mockResolvedValue({ ok: true, lastDay: null });
    const today = {
      ...familyProgram,
      athletes: [{ ...familyProgram.athletes[1]!, since: familyProgram.today }],
    };
    const { rerender } = render(<ProgramScreen program={today} actions={actions({ takeOff })} />);
    fireEvent.click(screen.getByRole('button', { name: takeOffLabel('Athlete Two') }));
    rerender(<ProgramScreen program={{ ...today, athletes: [] }} actions={actions({ takeOff })} />);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        takenOffText('Athlete Two', familyProgram.name, false),
      ),
    );
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: BUILDER_COPY.whosOnIt }),
    );
  });

  it('Take off someone who has not started: they leave, and focus goes to the heading', async () => {
    // Take off answers what it did (C15): no last day, so they never start.
    const takeOff = vi.fn().mockResolvedValue({ ok: true, lastDay: null });
    const later = {
      ...familyProgram,
      athletes: [{ ...familyProgram.athletes[1]!, since: '2026-11-15' }],
    };
    const { rerender } = render(<ProgramScreen program={later} actions={actions({ takeOff })} />);
    fireEvent.click(screen.getByRole('button', { name: takeOffLabel('Athlete Two') }));
    rerender(<ProgramScreen program={{ ...later, athletes: [] }} actions={actions({ takeOff })} />);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        takenOffText('Athlete Two', familyProgram.name, false),
      ),
    );
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: BUILDER_COPY.whosOnIt }),
    );
  });

  it('Take off says it is working while one is pending, on every button', () => {
    const takeOff = vi.fn(() => new Promise<never>(() => {}));
    render(<ProgramScreen program={familyProgram} actions={actions({ takeOff })} />);
    const button = screen.getByRole('button', { name: takeOffLabel('Athlete One') });
    fireEvent.click(button);
    expect(button.textContent).toBe(BUILDER_COPY.takingOff);
    expect(button.getAttribute('aria-label')).toBe(takingOffLabel('Athlete One'));
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const other = screen.getByRole('button', { name: takeOffLabel('Athlete Two') });
    expect(other.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    fireEvent.click(other);
    expect(takeOff).toHaveBeenCalledTimes(1);
  });

  it('a Take off that fails keeps the button, refocuses it and says so', async () => {
    const takeOff = vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.retry });
    render(<ProgramScreen program={familyProgram} actions={actions({ takeOff })} />);
    const button = screen.getByRole('button', { name: takeOffLabel('Athlete One') });
    fireEvent.click(button);
    await waitFor(() => expect(alerts()).toEqual([takeOffFailedText('Athlete One')]));
    expect(screen.getByRole('status').textContent).toBe('');
    expect(document.activeElement).toBe(button);
  });

  it('🔴 a Take off that throws (a dropped connection) is a refusal: no button left pending (15)', async () => {
    const takeOff = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ProgramScreen program={familyProgram} actions={actions({ takeOff })} />);
    const button = screen.getByRole('button', { name: takeOffLabel('Athlete One') });
    fireEvent.click(button);
    await waitFor(() => expect(alerts()).toEqual([takeOffFailedText('Athlete One')]));
    expect(document.activeElement).toBe(button);
    for (const name of ['Athlete One', 'Athlete Two']) {
      const each = screen.getByRole('button', { name: takeOffLabel(name) });
      expect(each.getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('each name under "Who’s on it" links to the athlete’s day page (15)', () => {
    render(<ProgramScreen program={familyProgram} actions={actions()} />);
    const who = section(BUILDER_COPY.whosOnIt);
    for (const athlete of familyProgram.athletes) {
      expect(within(who).getByRole('link', { name: athlete.name }).getAttribute('href')).toBe(
        athletePath(athlete.profilePublicId),
      );
    }
  });

  it('🔴 arriving from a workout’s Save: focus on the Workouts heading, and the bar says it (7b-ii)', async () => {
    noteArrival(familyProgram.programPublicId, workoutSavedText('Heavy A'));
    render(<ProgramScreen program={familyProgram} actions={actions()} />);
    const heading = screen.getByRole('heading', { level: 2, name: BUILDER_COPY.workouts });
    expect(document.activeElement).toBe(heading);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(workoutSavedText('Heavy A')),
    );
    // Taken once: the same page opened again moves nothing.
    cleanup();
    render(<ProgramScreen program={familyProgram} actions={actions()} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('a message left for another program is not taken by this one', () => {
    noteArrival(adultProgramWithCopy.programPublicId, workoutSavedText('Heavy A'));
    render(<ProgramScreen program={familyProgram} actions={actions()} />);
    expect(document.activeElement).toBe(document.body);
    expect(takeArrival(adultProgramWithCopy.programPublicId)).toBe(workoutSavedText('Heavy A'));
  });

  it('Rename: a stacked form with the counter up to PROGRAM_NAME_MAX; Save returns to the heading', async () => {
    const renameProgram = vi.fn().mockResolvedValue({ ok: true });
    render(<ProgramScreen program={familyProgram} actions={actions({ renameProgram })} />);
    fireEvent.click(screen.getByRole('button', { name: renameLabel(familyProgram.name) }));
    const field = screen.getByLabelText(BUILDER_COPY.programName) as HTMLInputElement;
    expect(field.value).toBe(familyProgram.name);
    expect(field.maxLength).toBe(PROGRAM_NAME_MAX);
    expect(document.getElementById(field.getAttribute('aria-describedby')!)!.textContent).toBe(
      `${familyProgram.name.length}/${PROGRAM_NAME_MAX}`,
    );
    // Still one <h1> while the form is open.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    fireEvent.change(field, { target: { value: 'Winter program' } });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.save }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(BUILDER_COPY.renamed));
    expect(renameProgram).toHaveBeenCalledWith({
      programPublicId: familyProgram.programPublicId,
      name: 'Winter program',
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: renameLabel(familyProgram.name) }),
      ),
    );
  });

  it('Rename refused: the form stays, says why, and focuses the field; Escape cancels', async () => {
    const renameProgram = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.name_taken });
    render(<ProgramScreen program={familyProgram} actions={actions({ renameProgram })} />);
    fireEvent.click(screen.getByRole('button', { name: renameLabel(familyProgram.name) }));
    const field = screen.getByLabelText(BUILDER_COPY.programName);
    fireEvent.change(field, { target: { value: 'Stretching' } });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.save }));
    await waitFor(() => expect(alerts()).toEqual([nameRefusal(PROGRAM_REFUSAL.name_taken)]));
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByLabelText(BUILDER_COPY.programName)).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(familyProgram.name);
  });
  it('Rename with the name unchanged closes without a call or a message', async () => {
    const renameProgram = vi.fn();
    render(<ProgramScreen program={familyProgram} actions={actions({ renameProgram })} />);
    fireEvent.click(screen.getByRole('button', { name: renameLabel(familyProgram.name) }));
    fireEvent.change(screen.getByLabelText(BUILDER_COPY.programName), {
      target: { value: `  ${familyProgram.name} ` },
    });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.save }));
    expect(screen.queryByLabelText(BUILDER_COPY.programName)).toBeNull();
    expect(renameProgram).not.toHaveBeenCalled();
    // The status line is set a frame after it is cleared, so look after that frame.
    await frames();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('opening Rename clears the status line', async () => {
    const takeOff = vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.retry });
    render(<ProgramScreen program={familyProgram} actions={actions({ takeOff })} />);
    fireEvent.click(screen.getByRole('button', { name: takeOffLabel('Athlete One') }));
    await waitFor(() => expect(alerts()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: renameLabel(familyProgram.name) }));
    expect(alerts()).toEqual([]);
  });

  it('the same message twice is cleared, then said again', async () => {
    const takeOff = vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.retry });
    render(<ProgramScreen program={familyProgram} actions={actions({ takeOff })} />);
    const button = screen.getByRole('button', { name: takeOffLabel('Athlete One') });
    fireEvent.click(button);
    await waitFor(() => expect(alerts()).toHaveLength(1));
    fireEvent.click(button);
    await waitFor(() => expect(alerts()).toEqual([]));
    await waitFor(() => expect(alerts()).toEqual([takeOffFailedText('Athlete One')]));
  });

  it('a rename answer that arrives after Cancel is dropped', async () => {
    let answer!: (result: { ok: false; reason: 'name_taken' }) => void;
    const renameProgram = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    render(
      <ProgramScreen
        program={familyProgram}
        actions={actions({ renameProgram: renameProgram as ProgramActions['renameProgram'] })}
      />,
    );
    const open = () =>
      fireEvent.click(screen.getByRole('button', { name: renameLabel(familyProgram.name) }));
    open();
    fireEvent.change(screen.getByLabelText(BUILDER_COPY.programName), {
      target: { value: 'Stretching' },
    });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.save }));
    expect(screen.getByRole('button', { name: SAVING_LABEL }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    // Answered after the reopen, so only the attempt counter can keep it off the new form.
    open();
    answer({ ok: false, reason: 'name_taken' });
    await frames();
    const field = screen.getByLabelText(BUILDER_COPY.programName);
    expect(alerts()).toEqual([]);
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect((field as HTMLInputElement).value).toBe(familyProgram.name);
  });

  it('a Take off answer that lands while Rename is open leaves focus in the name field', async () => {
    let answer!: (result: { ok: true; lastDay: string | null }) => void;
    const takeOff = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    render(
      <ProgramScreen
        program={familyProgram}
        actions={actions({ takeOff: takeOff as ProgramActions['takeOff'] })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: takeOffLabel('Athlete Two') }));
    fireEvent.click(screen.getByRole('button', { name: renameLabel(familyProgram.name) }));
    const field = screen.getByLabelText(BUILDER_COPY.programName);
    expect(document.activeElement).toBe(field);
    answer({ ok: true, lastDay: familyProgram.today });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        takenOffText('Athlete Two', familyProgram.name, true),
      ),
    );
    expect(document.activeElement).toBe(field);
  });

  it('a Take off that kept focus on its button moves it to the row (a real tap focuses)', async () => {
    const takeOff = vi.fn().mockResolvedValue({ ok: true, lastDay: familyProgram.today });
    render(<ProgramScreen program={familyProgram} actions={actions({ takeOff })} />);
    const button = screen.getByRole('button', { name: takeOffLabel('Athlete Two') });
    button.focus();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        takenOffText('Athlete Two', familyProgram.name, true),
      ),
    );
    expect(document.activeElement).toBe(screen.getByText('Athlete Two').parentElement);
  });

  it('a failed Take off that lands while Rename is open leaves focus in the name field', async () => {
    let answer!: (result: { ok: false; reason: 'retry' }) => void;
    const takeOff = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    render(
      <ProgramScreen
        program={familyProgram}
        actions={actions({ takeOff: takeOff as ProgramActions['takeOff'] })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: takeOffLabel('Athlete Two') }));
    fireEvent.click(screen.getByRole('button', { name: renameLabel(familyProgram.name) }));
    const field = screen.getByLabelText(BUILDER_COPY.programName);
    answer({ ok: false, reason: PROGRAM_REFUSAL.retry });
    await waitFor(() => expect(alerts()).toEqual([takeOffFailedText('Athlete Two')]));
    expect(document.activeElement).toBe(field);
  });
});
