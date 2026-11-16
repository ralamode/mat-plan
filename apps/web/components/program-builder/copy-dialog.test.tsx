// @vitest-environment jsdom
import {
  copyName,
  PROGRAM_REFUSAL,
  WORKOUT_NAME_MAX,
  type ProgramActions,
  type ProgramView,
} from '@mat-plan/shared';
import { familyProgram, programsList } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { createFakeProgramActions, type FakeProgramState } from '@/app/design/program/fakes';

import {
  COPY_COPY,
  copiedText,
  copyTakenElsewhereText,
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

  it('into this program: a Name field, prefilled; a taken name is said on it and nothing is sent', () => {
    const taken = {
      ...familyProgram,
      workouts: [
        ...familyProgram.workouts,
        { ...heavyA, workoutPublicId: 'copy', name: copyName(heavyA.name), copiedFrom: null },
      ],
    };
    const all = page({}, taken);
    openCopy();
    // No Name field for another program until it refuses the name.
    fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
    expect(within(dialog()).queryByLabelText(/^Name/)).toBeNull();
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    expect(within(dialog()).getByRole('option', { name: thisProgramOption(familyProgram.name) }));
    const name = within(dialog()).getByLabelText(/^Name/) as HTMLInputElement;
    expect(name.value).toBe(copyName(heavyA.name));
    fireEvent.click(day(1));
    expect((within(dialog()).getByLabelText(/^Label/) as HTMLInputElement).value).toBe(
      'After school',
    );
    fireEvent.click(copyButton());
    expect(within(dialog()).getByText(copyTakenText(copyName(heavyA.name)))).toBeTruthy();
    expect(document.activeElement).toBe(name);
    expect(all.copyWorkout).not.toHaveBeenCalled();
  });

  it('into this program, the name typed is the one sent, and the bar names it', async () => {
    const all = page();
    openCopy();
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    fireEvent.change(within(dialog()).getByLabelText(/^Name/), { target: { value: 'Heavy A2' } });
    fireEvent.click(copyButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(vi.mocked(all.copyWorkout).mock.calls[0]![0].name).toBe('Heavy A2');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        copiedText('Heavy A2', familyProgram.name, [], true),
      ),
    );
  });

  it('another program that has the name refuses it: the Name field shows, prefilled, said why', async () => {
    const all = page({
      copyWorkout: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: PROGRAM_REFUSAL.name_taken })
        .mockResolvedValue({ ok: true, workoutPublicId: 'new' }),
    });
    openCopy();
    fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
    fireEvent.click(copyButton());
    const name = await within(dialog()).findByLabelText(/^Name/);
    expect((name as HTMLInputElement).value).toBe(copyName(heavyA.name));
    expect(
      within(dialog()).getByText(copyTakenElsewhereText(adultsOwn!.name, heavyA.name)),
    ).toBeTruthy();
    fireEvent.click(copyButton());
    await waitFor(() => expect(all.copyWorkout).toHaveBeenCalledTimes(2));
    expect(vi.mocked(all.copyWorkout).mock.calls[1]![0].name).toBe(copyName(heavyA.name));
  });

  it('a label prefilled from this program does not follow the copy to another one', () => {
    page();
    openCopy();
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
    fireEvent.click(day(1));
    expect((within(dialog()).getByLabelText(/^Label/) as HTMLInputElement).value).toBe('');
  });

  it('each opening is a new attempt: two copies send two client ids', async () => {
    const all = page();
    for (let i = 0; i < 2; i++) {
      openCopy();
      fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
      fireEvent.click(copyButton());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    const [first, second] = vi.mocked(all.copyWorkout).mock.calls.map(([d]) => d.clientId);
    expect(second).not.toBe(first);
  });

  it('a copy that throws (a dropped connection) is a retry: the dialog stays and says so', async () => {
    page({ copyWorkout: vi.fn().mockRejectedValue(new Error('Failed to fetch')) });
    openCopy();
    fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
    fireEvent.click(copyButton());
    await waitFor(() => expect(within(dialog()).getByText(COPY_COPY.failed)).toBeTruthy());
  });

  it('the Name field’s prefill stays within WORKOUT_NAME_MAX for a 30-character workout', () => {
    const long = 'x'.repeat(WORKOUT_NAME_MAX);
    const program = {
      ...familyProgram,
      workouts: familyProgram.workouts.map((w) => (w === heavyA ? { ...w, name: long } : w)),
    };
    page({}, program);
    openCopy(long);
    const select = within(screen.getByRole('dialog')).getByLabelText(COPY_COPY.to);
    fireEvent.change(select, { target: { value: familyProgram.programPublicId } });
    const name = (within(screen.getByRole('dialog')).getByLabelText(/^Name/) as HTMLInputElement)
      .value;
    expect(name.length).toBe(WORKOUT_NAME_MAX);
    expect(name.endsWith(' (copy)')).toBe(true);
  });

  it('an emptied Name is said in words, and nothing is sent', () => {
    const all = page();
    openCopy();
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    fireEvent.change(within(dialog()).getByLabelText(/^Name/), { target: { value: '   ' } });
    fireEvent.click(copyButton());
    expect(within(dialog()).getByText(COPY_COPY.nameMissing)).toBeTruthy();
    expect(all.copyWorkout).not.toHaveBeenCalled();
  });

  it('a label the person typed stays when To changes', () => {
    page();
    openCopy();
    fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
    fireEvent.click(day(1));
    fireEvent.change(within(dialog()).getByLabelText(/^Label/), { target: { value: 'Dawn' } });
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    expect((within(dialog()).getByLabelText(/^Label/) as HTMLInputElement).value).toBe('Dawn');
  });

  it('after a retry, a changed draft is a new attempt', async () => {
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
    fireEvent.change(to(), { target: { value: stretching!.programPublicId } });
    fireEvent.click(copyButton());
    await waitFor(() => expect(all.copyWorkout).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(all.copyWorkout).mock.calls.map(([d]) => d.clientId);
    expect(second).not.toBe(first);
  });

  it('a stale page closes, refreshes and says nothing was copied', async () => {
    page({
      copyWorkout: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.not_found }),
    });
    openCopy();
    fireEvent.change(to(), { target: { value: adultsOwn!.programPublicId } });
    fireEvent.click(copyButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(COPY_COPY.stale));
  });

  it('a copy into this program takes focus to its new row', async () => {
    const seed: FakeProgramState = { programs: programsList, program: familyProgram, items: [] };
    function Harness() {
      const [state, setState] = useState(seed);
      const [fake] = useState(() => createFakeProgramActions(seed, setState));
      return <ProgramScreen program={state.program!} actions={fake.actions} />;
    }
    render(<Harness />);
    openCopy();
    fireEvent.change(to(), { target: { value: familyProgram.programPublicId } });
    fireEvent.click(copyButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain(copyName(heavyA.name)),
    );
    expect(document.activeElement?.tagName).toBe('A');
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

  it('Cancel closes with focus back on the row’s "Copy to…"', async () => {
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
