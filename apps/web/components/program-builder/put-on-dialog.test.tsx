// @vitest-environment jsdom
import { addDays, PROGRAM_REFUSAL, type ProgramActions, type ProgramView } from '@mat-plan/shared';
import { familyProgram, familyProgramAfterTakeOff } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { createFakeProgramActions, type FakeProgramState } from '@/app/design/program/fakes';
import { APP_HOME_PATH } from '@/lib/constants';

import {
  backOnText,
  candidateOnLabel,
  keepLabel,
  keepsText,
  lastDayText,
  orderHintText,
  PUT_ON_COPY,
  putOnTitle,
  sameTargetsText,
  startedText,
  startEffectText,
  startingNamesText,
  startLabel,
  stayOnEitherWayText,
  switchHintText,
} from './builder-text';
import { ProgramScreen } from './program-screen';

afterEach(() => {
  cleanup();
  refresh.mockClear();
  vi.useRealTimers();
});
beforeEach(() => {
  // The device's today is the fixture's: the start line names its day against the device's clock.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${familyProgram.today}T12:00:00`));
  // The sheet pops its history entry on close; in jsdom that popstate would land in the next test.
  window.history.replaceState(null, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
});

function actions(extra: Partial<ProgramActions> = {}): ProgramActions {
  return {
    createProgram: vi.fn(),
    renameProgram: vi.fn(),
    saveWorkout: vi.fn(),
    saveWeek: vi.fn(),
    copyWorkout: vi.fn(),
    newItem: vi.fn(),
    putOn: vi.fn().mockResolvedValue({ ok: true }),
    ...extra,
  };
}
const page = (extra: Partial<ProgramActions> = {}, program: ProgramView = familyProgram) => {
  const all = actions(extra);
  render(<ProgramScreen program={program} actions={all} />);
  return all;
};
const openDialog = () => fireEvent.click(screen.getByRole('button', { name: PUT_ON_COPY.open }));
const dialog = () => screen.getByRole('dialog', { name: putOnTitle(familyProgram.name) });
const adult = familyProgram.candidates.find((c) => !c.on)!;
const box = (name: string | RegExp) => within(dialog()).getByRole('checkbox', { name });
const start = (count: number) =>
  within(dialog()).getByRole('button', { name: startLabel(count, familyProgram.name) });
const keep = (count: number) =>
  within(dialog()).getByRole('button', { name: keepLabel(count, familyProgram.name) });

describe('Put someone on (FAM-1 10b)', () => {
  it('a screen hides the control of a member that is undefined: no putOn, no button', () => {
    page({ putOn: undefined });
    expect(screen.queryByRole('button', { name: PUT_ON_COPY.open })).toBeNull();
  });

  it('Start is inactive until someone is picked, and a tap says why', () => {
    const all = page();
    openDialog();
    expect(start(0).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(start(0));
    expect(within(dialog()).getByText(PUT_ON_COPY.pickSomeone)).toBeTruthy();
    expect(all.putOn).not.toHaveBeenCalled();
    fireEvent.click(box(adult.name));
    expect(start(1).getAttribute('aria-disabled')).toBeNull();
    // The message goes once there is someone to start.
    expect(within(dialog()).queryByText(PUT_ON_COPY.pickSomeone)).toBeNull();
  });

  it('someone already on it is ticked and inactive; the others say what they keep', () => {
    page();
    openDialog();
    const on = familyProgram.candidates.find((c) => c.on)!;
    const onBox = box(candidateOnLabel(on.name, PUT_ON_COPY.onIt));
    expect((onBox as HTMLInputElement).checked).toBe(true);
    expect(onBox.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(onBox);
    expect(start(0)).toBeTruthy();
    expect(within(dialog()).getByText(keepsText(adult.keeps))).toBeTruthy();
  });

  it('someone taken off reads their last day and can be put back on (C15)', async () => {
    const all = page({}, familyProgramAfterTakeOff);
    openDialog();
    const off = familyProgramAfterTakeOff.athletes.find((a) => a.lastDay)!;
    const offBox = box(off.name);
    expect(offBox.getAttribute('aria-disabled')).toBeNull();
    // Their last day is today: said in words, as recorded, not as a date.
    expect(off.lastDay).toBe(familyProgramAfterTakeOff.today);
    expect(
      within(dialog()).getByText(lastDayText(off.lastDay!, familyProgramAfterTakeOff.today)),
    ).toBeTruthy();
    fireEvent.click(offBox);
    fireEvent.click(keep(1));
    await waitFor(() => expect(all.putOn).toHaveBeenCalled());
    expect(vi.mocked(all.putOn!).mock.calls[0]![0].profilePublicIds).toEqual([off.profilePublicId]);
  });

  it('Start sends who and from; the bar says it once focus is back', async () => {
    const all = page();
    openDialog();
    fireEvent.click(box(adult.name));
    fireEvent.click(within(dialog()).getByRole('radio', { name: /^Tomorrow/ }));
    fireEvent.click(start(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(all.putOn).toHaveBeenCalledWith({
      programPublicId: familyProgram.programPublicId,
      profilePublicIds: [adult.profilePublicId],
      from: addDays(familyProgram.today, 1),
    });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        startedText(
          [adult.name],
          familyProgram.name,
          addDays(familyProgram.today, 1),
          familyProgram.today,
        ),
      ),
    );
    // The only one left to add went on, and the page's refresh has not landed (the mock changes
    // nothing): the trigger is already the line, in the same render as the close, and focus is on it.
    expect(screen.queryByRole('button', { name: PUT_ON_COPY.open })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText(PUT_ON_COPY.everyoneOn));
  });

  it('the start date says what it changes, from the program’s own week', () => {
    page();
    openDialog();
    // The fixture's today is a Saturday: Morning habits, Heavy B and Conditioning.
    const today = within(dialog()).getByText(/^Today: /);
    expect(today.textContent).toContain('Heavy B');
    expect(today.textContent).toContain('already logged today stays');
    fireEvent.click(within(dialog()).getByRole('radio', { name: /^Tomorrow/ }));
    // Sunday has nothing: it names the first day that does.
    expect(
      within(dialog()).getByText(
        startEffectText('tomorrow', [], {
          day: addDays(familyProgram.today, 2),
          workouts: ['Morning habits', 'Heavy A'],
        }),
      ),
    ).toBeTruthy();
  });

  it('someone ticked back on gets no order hint: they go back where they were (invariant 19)', () => {
    const off = familyProgramAfterTakeOff.candidates.find((c) => c.on)!;
    const withKeeps: ProgramView = {
      ...familyProgramAfterTakeOff,
      candidates: familyProgramAfterTakeOff.candidates.map((c) =>
        c.profilePublicId === off.profilePublicId ? { ...c, keeps: ['Stretching'] } : c,
      ),
    };
    page({ takeOff: vi.fn() }, withKeeps);
    openDialog();
    const lastOff = withKeeps.athletes.find((a) => a.lastDay)!;
    fireEvent.click(box(lastOff.name));
    expect(within(dialog()).queryByText(orderHintText(familyProgram.name))).toBeNull();
  });

  it('ticking someone who keeps another program explains the order, and how to switch', () => {
    page({ takeOff: vi.fn() });
    openDialog();
    expect(within(dialog()).queryByText(orderHintText(familyProgram.name))).toBeNull();
    fireEvent.click(box(adult.name));
    expect(within(dialog()).getByText(orderHintText(familyProgram.name))).toBeTruthy();
    expect(within(dialog()).getByText(switchHintText(adult.keeps))).toBeTruthy();
  });

  it('a retry stays in the dialog and says so; a stale page closes and refreshes', async () => {
    page({ putOn: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.retry }) });
    openDialog();
    fireEvent.click(box(adult.name));
    fireEvent.click(start(1));
    await waitFor(() => expect(within(dialog()).getByText(PUT_ON_COPY.failed)).toBeTruthy());
    cleanup();
    page({ putOn: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.not_found }) });
    openDialog();
    fireEvent.click(box(adult.name));
    fireEvent.click(start(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(PUT_ON_COPY.stale));
  });

  it('with everyone on it, there is no button, and the page says so', () => {
    const everyone = {
      ...familyProgram,
      candidates: familyProgram.candidates.map((c) => ({ ...c, on: true })),
    };
    page({}, everyone);
    expect(screen.queryByRole('button', { name: PUT_ON_COPY.open })).toBeNull();
    expect(screen.getByText(PUT_ON_COPY.everyoneOn)).toBeTruthy();
  });

  it('putting the last person on closes the sheet properly and still says so', async () => {
    // The real preview fake, so the page's program changes under the open sheet.
    const back = vi.mocked(window.history.back);
    const seed: FakeProgramState = { programs: [], program: familyProgram, items: [] };
    function Harness() {
      const [state, setState] = useState(seed);
      const [fake] = useState(() => createFakeProgramActions(seed, setState));
      return <ProgramScreen program={state.program!} actions={fake.actions} />;
    }
    render(<Harness />);
    openDialog();
    fireEvent.click(box(adult.name));
    fireEvent.click(start(1));
    await waitFor(() => expect(screen.getByText(PUT_ON_COPY.everyoneOn)).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
    // The sheet closed as a sheet: its history entry was popped.
    expect(back).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        startedText([adult.name], familyProgram.name, familyProgram.today, familyProgram.today),
      ),
    );
    expect(document.activeElement).toBe(screen.getByText(PUT_ON_COPY.everyoneOn));
  });

  it('a start that is now yesterday (left past midnight) refreshes the day, not "try again"', async () => {
    page({ putOn: vi.fn().mockResolvedValue({ ok: false, reason: PROGRAM_REFUSAL.invalid }) });
    openDialog();
    fireEvent.click(box(adult.name));
    fireEvent.click(start(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(PUT_ON_COPY.dayChanged),
    );
  });

  it('someone put back on is said to stay, not to start', async () => {
    page({}, familyProgramAfterTakeOff);
    openDialog();
    const off = familyProgramAfterTakeOff.athletes.find((a) => a.lastDay)!;
    fireEvent.click(box(off.name));
    fireEvent.click(keep(1));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        backOnText([off.name], familyProgram.name),
      ),
    );
  });
});

describe('Put someone on, on real data (FAM-1 15)', () => {
  const off = familyProgramAfterTakeOff.athletes.find((a) => a.lastDay)!;
  const startOn = (program: ProgramView) =>
    within(dialog()).getByRole('button', { name: startLabel(1, program.name) });

  it('names who is starting above the footer, once someone new is ticked', () => {
    page();
    openDialog();
    expect(within(dialog()).queryByText(startingNamesText([adult.name]))).toBeNull();
    fireEvent.click(box(adult.name));
    expect(within(dialog()).getByText(startingNamesText([adult.name]))).toBeTruthy();
  });

  it('only someone taken off today: they stay on, no day to pick, and the action keeps them', () => {
    page({}, familyProgramAfterTakeOff);
    openDialog();
    fireEvent.click(box(off.name));
    expect(within(dialog()).getByText(PUT_ON_COPY.stayOnNoGap)).toBeTruthy();
    expect(within(dialog()).queryByRole('radio')).toBeNull();
    expect(keep(1)).toBeTruthy();
    // Nobody new: no "Starting:" line and no shared-targets line.
    expect(within(dialog()).queryByText(startingNamesText([off.name]))).toBeNull();
    expect(within(dialog()).queryByText(sameTargetsText(familyProgram.name))).toBeNull();
  });

  it('mixed ticks: the new one starts on the day picked, the one taken off stays on either way', () => {
    page({}, familyProgramAfterTakeOff);
    openDialog();
    fireEvent.click(box(off.name));
    fireEvent.click(box(adult.name));
    expect(within(dialog()).getAllByRole('radio')).toHaveLength(2);
    expect(within(dialog()).getByText(new RegExp(stayOnEitherWayText([off.name])))).toBeTruthy();
    expect(within(dialog()).getByText(startingNamesText([adult.name]))).toBeTruthy();
    // Start counts who STARTS: "Starting: Adult One" over "Start 1 on …", never "Start 2".
    expect(
      within(dialog()).getByRole('button', { name: startLabel(1, familyProgram.name) }),
    ).toBeTruthy();
  });

  it('🔴 the shared-targets line is in the footer, under who is starting, and describes Start', () => {
    page();
    openDialog();
    fireEvent.click(box(adult.name));
    const line = within(dialog()).getByText(sameTargetsText(familyProgram.name));
    // In the pinned footer with Start, not at the bottom of the scrolling form (UX P1-U1).
    expect(line.closest('form')).toBeNull();
    const startButton = start(1);
    const described = (startButton.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain(startingNamesText([adult.name]));
    expect(described).toContain(sameTargetsText(familyProgram.name));
  });

  it('the targets line: one newcomer on an empty program has no one to share with; two do', () => {
    const empty: ProgramView = {
      ...familyProgram,
      athletes: [],
      candidates: familyProgram.candidates.map((c) => ({ ...c, on: false })),
    };
    page({}, empty);
    openDialog();
    fireEvent.click(box(adult.name));
    expect(startOn(empty)).toBeTruthy();
    expect(within(dialog()).queryByText(sameTargetsText(familyProgram.name))).toBeNull();
    const other = empty.candidates.find((c) => c.profilePublicId !== adult.profilePublicId)!;
    fireEvent.click(box(other.name));
    expect(within(dialog()).getByText(sameTargetsText(familyProgram.name))).toBeTruthy();
  });

  it('the targets line: no one is left to share with when everyone on it comes off today', () => {
    const allOff: ProgramView = {
      ...familyProgram,
      athletes: familyProgram.athletes.map((a) => ({ ...a, lastDay: familyProgram.today })),
    };
    page({}, allOff);
    openDialog();
    fireEvent.click(box(adult.name));
    expect(within(dialog()).queryByText(sameTargetsText(familyProgram.name))).toBeNull();
    // Ticking one of them back on: they stay on, so the newcomer shares with them.
    fireEvent.click(box(allOff.athletes[0]!.name));
    expect(within(dialog()).getByText(sameTargetsText(familyProgram.name))).toBeTruthy();
  });

  it('a household with no athlete is sent Home, never told everyone is on it', () => {
    page({}, { ...familyProgram, athletes: [], candidates: [] });
    expect(screen.queryByRole('button', { name: PUT_ON_COPY.open })).toBeNull();
    expect(screen.queryByText(PUT_ON_COPY.everyoneOn)).toBeNull();
    const link = screen.getByRole('link', { name: PUT_ON_COPY.addAthleteLink });
    expect(link.getAttribute('href')).toBe(APP_HOME_PATH);
    expect(link.closest('p')!.textContent).toBe(
      `${PUT_ON_COPY.addAthleteBefore}${PUT_ON_COPY.addAthleteLink}${PUT_ON_COPY.addAthleteAfter}`,
    );
  });

  it('🔴 the last one put on: focus returns to the line in the same render, before the refresh lands', async () => {
    // A refresh that lands only when the test says: the page's data is still the old one.
    const all = actions();
    const { rerender } = render(<ProgramScreen program={familyProgram} actions={all} />);
    openDialog();
    fireEvent.click(box(adult.name));
    fireEvent.click(start(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const line = screen.getByText(PUT_ON_COPY.everyoneOn);
    expect(document.activeElement).toBe(line);
    // The refresh lands: the data now says they are on, and focus has not moved.
    const after = {
      ...familyProgram,
      candidates: familyProgram.candidates.map((c) => ({ ...c, on: true })),
    };
    rerender(<ProgramScreen program={after} actions={all} />);
    expect(document.activeElement).toBe(screen.getByText(PUT_ON_COPY.everyoneOn));
  });

  it('🔴 past midnight, the start is named against the device’s today, not the page’s', async () => {
    page();
    openDialog();
    fireEvent.click(box(adult.name));
    fireEvent.click(within(dialog()).getByRole('radio', { name: /^Tomorrow/ }));
    // The page was loaded yesterday; the answer arrives after midnight, when "tomorrow" is today.
    const tomorrow = addDays(familyProgram.today, 1);
    vi.setSystemTime(new Date(`${tomorrow}T00:30:00`));
    fireEvent.click(start(1));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        startedText([adult.name], familyProgram.name, tomorrow, tomorrow),
      ),
    );
    expect(screen.getByRole('status').textContent).toContain('today');
  });

  it('the order hint says the program goes by the Programs list order (6d-iii, D41)', () => {
    page({ takeOff: vi.fn() });
    openDialog();
    fireEvent.click(box(adult.name));
    expect(within(dialog()).getByText(orderHintText(familyProgram.name)).textContent).toBe(
      `On their day page, ${familyProgram.name} goes in by the order of your Programs list. Their other programs keep their order.`,
    );
  });
});
