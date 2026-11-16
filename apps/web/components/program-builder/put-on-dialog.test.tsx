// @vitest-environment jsdom
import { addDays, PROGRAM_REFUSAL, type ProgramActions, type ProgramView } from '@mat-plan/shared';
import { familyProgram, familyProgramAfterTakeOff } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { createFakeProgramActions, type FakeProgramState } from '@/app/design/program/fakes';

import {
  backOnText,
  candidateOnLabel,
  keepsText,
  lastDayText,
  orderHintText,
  PUT_ON_COPY,
  putOnTitle,
  startedText,
  startEffectText,
  startLabel,
  switchHintText,
} from './builder-text';
import { ProgramScreen } from './program-screen';

afterEach(() => {
  cleanup();
  refresh.mockClear();
});
beforeEach(() => {
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
    expect(within(dialog()).getByText(lastDayText(off.lastDay!))).toBeTruthy();
    fireEvent.click(offBox);
    fireEvent.click(start(1));
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
    expect(document.activeElement).toBe(screen.getByRole('button', { name: PUT_ON_COPY.open }));
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
    fireEvent.click(within(dialog()).getByRole('radio', { name: /^Tomorrow/ }));
    fireEvent.click(start(1));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        backOnText([off.name], familyProgram.name),
      ),
    );
  });
});
