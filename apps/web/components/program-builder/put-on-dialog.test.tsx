// @vitest-environment jsdom
import { addDays, PROGRAM_REFUSAL, type ProgramActions, type ProgramView } from '@mat-plan/shared';
import { familyProgram, familyProgramAfterTakeOff } from '@mat-plan/shared/program/fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import {
  candidateOnLabel,
  keepsText,
  lastDayText,
  orderHintText,
  PUT_ON_COPY,
  putOnTitle,
  startedText,
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

  it('someone taken off reads their last day, not "on it"', () => {
    page({}, familyProgramAfterTakeOff);
    openDialog();
    const off = familyProgramAfterTakeOff.athletes.find((a) => a.lastDay)!;
    expect(box(candidateOnLabel(off.name, lastDayText(off.lastDay!)))).toBeTruthy();
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
    expect(within(dialog()).getByText(/^Tomorrow: nothing from this program/)).toBeTruthy();
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
});
