// @vitest-environment jsdom
import { ON_PROGRAM, type DayActions, type DayPlan, type ProgramResult } from '@mat-plan/shared';
import {
  closedDayLoggedOnly,
  futurePreview,
  noProgram,
  notOnAProgramThatDay,
  sundayRestStretchOnly,
  todayStretchingFirst,
  todayTwoPrograms,
  yesterdayHalfDone,
} from '@mat-plan/shared/program/fixtures';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';

import { AthleteSwitcher, switcherLabels } from './athlete-switcher';
import { PROGRAM_COPY } from './day-copy';
import { restNotice } from './day-screen';
import { NotOnAProgram } from './not-on-a-program';
import { ProgramLine } from './program-line';

afterEach(() => {
  cleanup();
  // The sheet restores itself from `history.state` on mount (sheet.tsx), as sheet.test.tsx resets.
  window.history.replaceState(null, '');
});

const nameOf = (plan: DayPlan) =>
  plan.athletes.find((a) => a.profilePublicId === plan.profilePublicId)!.name;

describe('AthleteSwitcher', () => {
  const hrefFor = (id: string) => `/p/${id}`;

  it('lists every athlete by first name, marks the current one, and opens each one’s today', () => {
    render(<AthleteSwitcher plan={yesterdayHalfDone} hrefFor={hrefFor} />);
    const nav = screen.getByRole('navigation', { name: PROGRAM_COPY.switcher });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(switcherLabels(yesterdayHalfDone.athletes));
    const current = within(nav).getByRole('link', { current: 'page' });
    expect(current.getAttribute('href')).toBe(hrefFor(yesterdayHalfDone.profilePublicId));
    // A switch opens today: the link carries no day, even when yesterday is on screen.
    for (const [link, athlete] of links.map(
      (l, i) => [l, yesterdayHalfDone.athletes[i]!] as const,
    )) {
      expect(link.getAttribute('href')).toBe(hrefFor(athlete.profilePublicId));
    }
  });

  it('labels are first names, or the whole name where two share a first name (ignoring case)', () => {
    const athlete = (name: string, n: number) => ({
      profilePublicId: `00000000-0000-7000-8000-00000000000${n}`,
      name,
    });
    expect(
      switcherLabels([athlete('Maddie Ray', 1), athlete('Mason Ray', 2), athlete('Sam', 3)]),
    ).toEqual(['Maddie', 'Mason', 'Sam']);
    expect(
      switcherLabels([athlete('Sam Lee', 1), athlete('sam Ray', 2), athlete('Ada', 3)]),
    ).toEqual(['Sam Lee', 'sam Ray', 'Ada']);
  });

  it('is not shown for a household of one', () => {
    const alone = { ...todayTwoPrograms, athletes: todayTwoPrograms.athletes.slice(0, 1) };
    render(<AthleteSwitcher plan={alone} hrefFor={hrefFor} />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('NotOnAProgram', () => {
  it('no-program: not on a program yet, with no link while there is no Programs page', () => {
    render(<NotOnAProgram plan={noProgram} />);
    expect(screen.getByText(PROGRAM_COPY.notYet)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('no-program with a Programs page: asks for the athlete to be put on one, and links there', () => {
    render(<NotOnAProgram plan={noProgram} programsHref="/programs" />);
    expect(screen.getByText(new RegExp(PROGRAM_COPY.notYetPutOn(nameOf(noProgram))))).toBeTruthy();
    expect(screen.getByRole('link', { name: PROGRAM_COPY.programs }).getAttribute('href')).toBe(
      '/programs',
    );
  });

  it('not-on-a-program-that-day says so, and nothing shows for an athlete on a program', () => {
    render(<NotOnAProgram plan={notOnAProgramThatDay} />);
    expect(screen.getByText(PROGRAM_COPY.notThisDay)).toBeTruthy();
    cleanup();
    const { container } = render(<NotOnAProgram plan={todayTwoPrograms} />);
    expect(container.textContent).toBe('');
  });
});

describe('the rest-day notice', () => {
  it('sunday-rest-stretch-only: names the program that rests, as v12 does', () => {
    expect(restNotice(sundayRestStretchOnly)).toEqual({
      text: PROGRAM_COPY.restSome(['Family program']),
      allRest: false,
    });
  });

  it('when every program rests, it says nothing is scheduled on that weekday', () => {
    const allRest: DayPlan = { ...sundayRestStretchOnly, workouts: [] };
    expect(restNotice(allRest)).toEqual({
      text: PROGRAM_COPY.restAll(sundayRestStretchOnly.day),
      allRest: true,
    });
    expect(restNotice(allRest)?.text).toMatch(/Sundays\.$/);
  });

  it('not when a logged workout that left the week is on the day, as v12 does', () => {
    const offWeek = { ...sundayRestStretchOnly.workouts[0]!, scheduled: false };
    expect(restNotice({ ...sundayRestStretchOnly, workouts: [offWeek] })).toBeNull();
  });

  it('on one program that runs today, there is no rest line', () => {
    expect(restNotice(todayTwoPrograms)).toBeNull();
  });

  it('never on an older day, where an empty program means skipped, not rest', () => {
    expect(closedDayLoggedOnly.writable).toBe(false);
    const skipped: DayPlan = { ...closedDayLoggedOnly, workouts: [] };
    expect(restNotice(skipped)).toBeNull();
  });

  it('on a look-ahead day it does show, and never for an athlete not on a program', () => {
    const lookAheadRest: DayPlan = { ...futurePreview, workouts: [] };
    expect(restNotice(lookAheadRest)?.text).toBe(PROGRAM_COPY.restAll(futurePreview.day));
    expect(restNotice({ ...noProgram, onProgram: ON_PROGRAM.never })).toBeNull();
  });
});

describe('ProgramLine and the Program order dialog', () => {
  function mountLine(plan: DayPlan, actions: DayActions = createFakeDayActions(plan).actions) {
    return render(<ProgramLine plan={plan} actions={actions} />);
  }
  const orderButton = () => screen.getByRole('button', { name: PROGRAM_COPY.order });
  const items = () =>
    within(screen.getByRole('dialog'))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('span')?.textContent);

  it('names the day’s programs in order; one program reads "Program:"', () => {
    mountLine(todayTwoPrograms);
    expect(
      screen.getByText(PROGRAM_COPY.line(todayTwoPrograms.programs.map((p) => p.name))),
    ).toBeTruthy();
    cleanup();
    const one = { ...todayTwoPrograms, programs: todayTwoPrograms.programs.slice(0, 1) };
    mountLine(one);
    expect(screen.getByText(/^Program: /)).toBeTruthy();
  });

  it('shows Program order only with reorderPrograms, two programs that day, and a writable day', () => {
    const { logRow, untickRow, retickRow } = createFakeDayActions(todayTwoPrograms).actions;
    mountLine(todayTwoPrograms, { logRow, untickRow, retickRow });
    expect(screen.queryByRole('button', { name: PROGRAM_COPY.order })).toBeNull();
    cleanup();
    mountLine(sundayRestStretchOnly);
    expect(orderButton()).toBeTruthy();
    cleanup();
    mountLine({ ...todayTwoPrograms, writable: false });
    expect(screen.queryByRole('button', { name: PROGRAM_COPY.order })).toBeNull();
    cleanup();
    mountLine(noProgram);
    expect(screen.queryByText(/^Programs?:/)).toBeNull();
    cleanup();
    // Two programs that day, but off one of them since: nothing to order.
    mountLine({
      ...todayTwoPrograms,
      currentPrograms: todayTwoPrograms.currentPrograms.slice(0, 1),
    });
    expect(screen.queryByRole('button', { name: PROGRAM_COPY.order })).toBeNull();
  });

  it('the Program order dialog lists today-two-programs’ programs in order', () => {
    mountLine(todayTwoPrograms);
    fireEvent.click(orderButton());
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', {
        name: PROGRAM_COPY.orderTitle(nameOf(todayTwoPrograms)),
      }),
    ).toBeTruthy();
    expect(items()).toEqual(todayTwoPrograms.currentPrograms.map((p, i) => `${i + 1}. ${p.name}`));
  });

  it('a move saves the whole order, keeps focus on the arrow, and says where it went', async () => {
    const reorderPrograms = vi.fn(createFakeDayActions(todayTwoPrograms).actions.reorderPrograms);
    mountLine(todayTwoPrograms, {
      ...createFakeDayActions(todayTwoPrograms).actions,
      reorderPrograms,
    });
    fireEvent.click(orderButton());
    const [first, second] = todayTwoPrograms.currentPrograms;
    const down = screen.getByRole('button', { name: PROGRAM_COPY.moveDown(first!.name) });
    await act(async () => {
      down.focus();
      fireEvent.click(down);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(reorderPrograms).toHaveBeenCalledWith({
      profilePublicId: todayTwoPrograms.profilePublicId,
      programPublicIds: [second!.programPublicId, first!.programPublicId],
    });
    expect(items()).toEqual([`1. ${second!.name}`, `2. ${first!.name}`]);
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      PROGRAM_COPY.moveDown(first!.name),
    );
    expect(screen.getByText(PROGRAM_COPY.moved(first!.name, 2, 2))).toBeTruthy();
    // The end arrows follow the new order: the moved program is last, so its ↓ is the dead one.
    expect(
      screen
        .getByRole('button', { name: PROGRAM_COPY.moveDown(first!.name) })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: PROGRAM_COPY.moveUp(second!.name) })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: PROGRAM_COPY.moveUp(first!.name) })
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('the end arrows do nothing and say so', () => {
    const reorderPrograms = vi.fn();
    mountLine(todayStretchingFirst, {
      ...createFakeDayActions(todayStretchingFirst).actions,
      reorderPrograms,
    });
    fireEvent.click(orderButton());
    const [first] = todayStretchingFirst.currentPrograms;
    const up = screen.getByRole('button', { name: PROGRAM_COPY.moveUp(first!.name) });
    expect(up.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(up);
    expect(reorderPrograms).not.toHaveBeenCalled();
  });

  it('a failed save puts the order back and says it could not save', async () => {
    const refused: ProgramResult = { ok: false, reason: 'retry' };
    mountLine(todayTwoPrograms, {
      ...createFakeDayActions(todayTwoPrograms).actions,
      reorderPrograms: async () => refused,
    });
    fireEvent.click(orderButton());
    const [first] = todayTwoPrograms.currentPrograms;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: PROGRAM_COPY.moveDown(first!.name) }));
    });
    expect(items()).toEqual(todayTwoPrograms.currentPrograms.map((p, i) => `${i + 1}. ${p.name}`));
    expect(screen.getByText(PROGRAM_COPY.orderFailed)).toBeTruthy();
    // Closing and opening again starts clean: the old failure no longer describes the list.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: PROGRAM_COPY.done }));
    });
    fireEvent.click(orderButton());
    expect(screen.queryByText(PROGRAM_COPY.orderFailed)).toBeNull();
  });

  it('Done closes the dialog and returns focus to Program order', async () => {
    mountLine(todayTwoPrograms);
    fireEvent.click(orderButton());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: PROGRAM_COPY.done }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // The sheet hands focus back after its close settles (sheet.tsx), not in the click.
    await waitFor(() => expect(document.activeElement).toBe(orderButton()));
  });
});
