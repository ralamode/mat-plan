// @vitest-environment jsdom
import { PROGRAM_NAME_MAX, PROGRAM_REFUSAL, type ProgramActions } from '@mat-plan/shared';
import {
  adultProgramWithCopy,
  familyProgram,
  newProgramEmpty,
} from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  athleteHint,
  BUILDER_COPY,
  copiedFromText,
  nameRefusal,
  takenOffText,
  takeOffFailedText,
  usedByText,
  workoutSummary,
} from './builder-text';
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

const section = (name: string) => screen.getByRole('region', { name });

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
      'Saturday',
      'Sunday',
    ]);
    // Saturday: three slots in the author's order; Sunday: a rest day, as text.
    const saturday = week.getByRole('heading', { name: 'Saturday' }).parentElement!;
    expect(
      within(saturday)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Morning · : Morning habits',
      'After lunch · : Heavy B',
      'Evening · : Conditioning',
    ]);
    const sunday = week.getByRole('heading', { name: 'Sunday' }).parentElement!;
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
    const takeOff = vi.fn().mockResolvedValue({ ok: true });
    const { rerender } = render(
      <ProgramScreen program={familyProgram} actions={actions({ takeOff })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take off Athlete Two' }));
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
    expect(document.activeElement?.textContent).toContain('Athlete Two');
    expect(screen.queryByRole('button', { name: 'Take off Athlete Two' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Take off Athlete One' })).toBeTruthy();
  });

  it('Take off someone who has not started: they leave, and focus goes to the heading', async () => {
    const takeOff = vi.fn().mockResolvedValue({ ok: true });
    const later = {
      ...familyProgram,
      athletes: [{ ...familyProgram.athletes[1]!, since: '2026-11-15' }],
    };
    const { rerender } = render(<ProgramScreen program={later} actions={actions({ takeOff })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take off Athlete Two' }));
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

  it('Take off says it is working while the action is pending', () => {
    const takeOff = vi.fn(() => new Promise<never>(() => {}));
    render(<ProgramScreen program={familyProgram} actions={actions({ takeOff })} />);
    const button = screen.getByRole('button', { name: 'Take off Athlete One' });
    fireEvent.click(button);
    expect(button.textContent).toBe(BUILDER_COPY.takingOff);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(takeOff).toHaveBeenCalledTimes(1);
  });

  it('a Take off that fails keeps the button, refocuses it and says so', async () => {
    const takeOff = vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.retry });
    render(<ProgramScreen program={familyProgram} actions={actions({ takeOff })} />);
    const button = screen.getByRole('button', { name: 'Take off Athlete One' });
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(takeOffFailedText('Athlete One')),
    );
    expect(document.activeElement).toBe(button);
  });

  it('Rename: a stacked form with the counter up to PROGRAM_NAME_MAX; Save returns to the heading', async () => {
    const renameProgram = vi.fn().mockResolvedValue({ ok: true });
    render(<ProgramScreen program={familyProgram} actions={actions({ renameProgram })} />);
    fireEvent.click(screen.getByRole('button', { name: `Rename ${familyProgram.name}` }));
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
        screen.getByRole('button', { name: `Rename ${familyProgram.name}` }),
      ),
    );
  });

  it('Rename refused: the form stays, says why, and focuses the field; Escape cancels', async () => {
    const renameProgram = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.name_taken });
    render(<ProgramScreen program={familyProgram} actions={actions({ renameProgram })} />);
    fireEvent.click(screen.getByRole('button', { name: `Rename ${familyProgram.name}` }));
    const field = screen.getByLabelText(BUILDER_COPY.programName);
    fireEvent.change(field, { target: { value: 'Stretching' } });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.save }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      nameRefusal(PROGRAM_REFUSAL.name_taken),
    );
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByLabelText(BUILDER_COPY.programName)).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(familyProgram.name);
  });
});
