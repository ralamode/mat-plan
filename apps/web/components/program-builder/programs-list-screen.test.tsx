// @vitest-environment jsdom
import { PROGRAM_NAME_MAX, PROGRAM_REFUSAL, type ProgramActions } from '@mat-plan/shared';
import { programsList } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { BUILDER_COPY, nameRefusal } from './builder-text';
import { ProgramsListScreen } from './programs-list-screen';
import { programPath } from './routes';

afterEach(cleanup);
beforeEach(() => push.mockReset());

function actionsWith(createProgram: ProgramActions['createProgram']): ProgramActions {
  return {
    createProgram,
    renameProgram: vi.fn(),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn(),
    newItem: vi.fn(),
  };
}

const NEW_ID = '00000000-0000-7000-8000-000200009999';

describe('ProgramsListScreen (FAM-1 8a)', () => {
  it('renders programs-list: one link per program, naming who is on it', () => {
    render(<ProgramsListScreen programs={programsList} actions={actionsWith(vi.fn())} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Programs');
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(programsList.length);
    const family = within(items[0]!).getByRole('link');
    expect(family.getAttribute('href')).toBe(programPath(programsList[0]!.programPublicId));
    expect(family.textContent).toContain('Family program');
    expect(family.textContent).toContain('Athlete One and Athlete Two');
    expect(screen.getByRole('link', { name: BUILDER_COPY.home })).toBeTruthy();
    // Closed while there are programs.
    expect(screen.queryByLabelText(BUILDER_COPY.programName)).toBeNull();
  });

  it('a program with no one on it says so', () => {
    const lonely = [{ ...programsList[0]!, athletes: [] }];
    render(<ProgramsListScreen programs={lonely} actions={actionsWith(vi.fn())} />);
    expect(within(screen.getByRole('list')).getByRole('link').textContent).toContain(
      BUILDER_COPY.noOneYet,
    );
  });

  it('its empty state: no list, and the name field already open, without taking focus', () => {
    render(<ProgramsListScreen programs={[]} actions={actionsWith(vi.fn())} />);
    expect(screen.getByText(BUILDER_COPY.noPrograms)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    const field = screen.getByLabelText(BUILDER_COPY.programName);
    expect(document.activeElement).not.toBe(field);
    expect(screen.queryByRole('button', { name: BUILDER_COPY.cancel })).toBeNull();
  });

  it('creates a program by naming it, then opens its page', async () => {
    const createProgram = vi.fn().mockResolvedValue({ ok: true, programPublicId: NEW_ID });
    render(<ProgramsListScreen programs={programsList} actions={actionsWith(createProgram)} />);
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.createProgram }));
    const field = screen.getByLabelText(BUILDER_COPY.programName);
    fireEvent.change(field, { target: { value: '  Summer block ' } });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.create }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(programPath(NEW_ID)));
    expect(createProgram).toHaveBeenCalledWith({
      clientId: expect.any(String),
      name: 'Summer block',
    });
  });

  it('the counter is outside the label, describes the field, and stops at PROGRAM_NAME_MAX', () => {
    render(<ProgramsListScreen programs={[]} actions={actionsWith(vi.fn())} />);
    const field = screen.getByLabelText(BUILDER_COPY.programName) as HTMLInputElement;
    expect(field.maxLength).toBe(PROGRAM_NAME_MAX);
    fireEvent.change(field, { target: { value: 'x'.repeat(PROGRAM_NAME_MAX) } });
    // The permanence hint first (7b-i: said before Create), then the counter.
    const [hint, counter] = field
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)!);
    expect(hint!.textContent).toBe(BUILDER_COPY.createHint);
    expect(counter!.textContent).toBe(`${PROGRAM_NAME_MAX}/${PROGRAM_NAME_MAX}`);
    expect(counter!.closest('label')).toBeNull();
    expect(counter!.getAttribute('role')).toBeNull();
  });

  it('a refusal says why under the field, focuses it, and a retry reuses the client id', async () => {
    const createProgram = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.retry })
      .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.name_taken });
    render(<ProgramsListScreen programs={[]} actions={actionsWith(createProgram)} />);
    const field = screen.getByLabelText(BUILDER_COPY.programName);
    fireEvent.change(field, { target: { value: 'Family program' } });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.create }));
    expect((await screen.findByRole('alert')).textContent).toBe(nameRefusal(PROGRAM_REFUSAL.retry));
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.create }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(nameRefusal(PROGRAM_REFUSAL.name_taken)),
    );
    const [first, second] = createProgram.mock.calls.map(([input]) => input.clientId);
    expect(second).toBe(first);
    expect(push).not.toHaveBeenCalled();
  });

  it('an empty name is refused without a call', async () => {
    const createProgram = vi.fn();
    render(<ProgramsListScreen programs={[]} actions={actionsWith(createProgram)} />);
    fireEvent.change(screen.getByLabelText(BUILDER_COPY.programName), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.create }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      nameRefusal(PROGRAM_REFUSAL.invalid),
    );
    expect(createProgram).not.toHaveBeenCalled();
  });

  it('Cancel closes the form and returns focus to the button that opened it', async () => {
    render(<ProgramsListScreen programs={programsList} actions={actionsWith(vi.fn())} />);
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.createProgram }));
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    const opener = screen.getByRole('button', { name: BUILDER_COPY.createProgram });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
  it('a new opening mints a new client id; a success keeps the button pending', async () => {
    const createProgram = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.retry })
      .mockResolvedValueOnce({ ok: true, programPublicId: NEW_ID });
    render(<ProgramsListScreen programs={programsList} actions={actionsWith(createProgram)} />);
    const attempt = async () => {
      fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.createProgram }));
      fireEvent.change(screen.getByLabelText(BUILDER_COPY.programName), {
        target: { value: 'Summer block' },
      });
      fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.create }));
    };
    await attempt();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    await attempt();
    await waitFor(() => expect(push).toHaveBeenCalledWith(programPath(NEW_ID)));
    const [first, second] = createProgram.mock.calls.map(([input]) => input.clientId);
    expect(second).not.toBe(first);
    const button = screen.getByRole('button', { name: BUILDER_COPY.creating });
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('a create that lands after Cancel does not navigate', async () => {
    let answer!: (result: { ok: true; programPublicId: string }) => void;
    const createProgram = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    render(
      <ProgramsListScreen
        programs={programsList}
        actions={actionsWith(createProgram as ProgramActions['createProgram'])}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.createProgram }));
    fireEvent.change(screen.getByLabelText(BUILDER_COPY.programName), {
      target: { value: 'Summer block' },
    });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.create }));
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.creating }));
    expect(createProgram).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.cancel }));
    answer({ ok: true, programPublicId: NEW_ID });
    await Promise.resolve();
    await Promise.resolve();
    expect(push).not.toHaveBeenCalled();
  });

  it('a pasted tab is sent as a space (a text input already drops newlines)', async () => {
    const createProgram = vi.fn().mockResolvedValue({ ok: true, programPublicId: NEW_ID });
    render(<ProgramsListScreen programs={[]} actions={actionsWith(createProgram)} />);
    fireEvent.change(screen.getByLabelText(BUILDER_COPY.programName), {
      target: { value: 'Summer\t\tblock 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.create }));
    await waitFor(() => expect(createProgram).toHaveBeenCalled());
    expect(createProgram.mock.calls[0]![0].name).toBe('Summer block 2');
  });

  it('a create that lands after leaving the screen does not navigate', async () => {
    let answer!: (result: { ok: true; programPublicId: string }) => void;
    const createProgram = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { unmount } = render(
      <ProgramsListScreen
        programs={programsList}
        actions={actionsWith(createProgram as ProgramActions['createProgram'])}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.createProgram }));
    fireEvent.change(screen.getByLabelText(BUILDER_COPY.programName), {
      target: { value: 'Summer block' },
    });
    fireEvent.click(screen.getByRole('button', { name: BUILDER_COPY.create }));
    unmount();
    answer({ ok: true, programPublicId: NEW_ID });
    await Promise.resolve();
    await Promise.resolve();
    expect(push).not.toHaveBeenCalled();
  });
});
