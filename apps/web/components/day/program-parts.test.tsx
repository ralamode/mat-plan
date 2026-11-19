// @vitest-environment jsdom
import {
  ON_PROGRAM,
  PROGRAM_REFUSAL,
  type DayActions,
  type DayPlan,
  type ProgramResult,
} from '@mat-plan/shared';
import {
  archivedAthleteNothingLogged,
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
import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import { athletePath } from '@/lib/constants';

import { AthleteSwitcher, switcherLabels } from './athlete-switcher';
import { athleteNameOf, PROGRAM_COPY } from './day-copy';
import { restNotice } from './day-notices';
import { NotOnAProgram } from './not-on-a-program';
import { ProgramLine } from './program-line';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  // The sheet restores itself from `history.state` on mount (sheet.tsx), as sheet.test.tsx resets.
  window.history.replaceState(null, '');
});

const nameOf = athleteNameOf;

describe('AthleteSwitcher', () => {
  const hrefFor = athletePath;

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

  it('takes the placer’s class (the day page hides it where its rail lists the athletes)', () => {
    render(<AthleteSwitcher plan={yesterdayHalfDone} hrefFor={hrefFor} className="lg:hidden" />);
    expect(screen.getByRole('navigation').classList.contains('lg:hidden')).toBe(true);
  });

  it('is not shown when no one else is listed (a household of one, or none listed)', () => {
    const me = todayTwoPrograms.athletes.find(
      (a) => a.profilePublicId === todayTwoPrograms.profilePublicId,
    )!;
    for (const athletes of [[me], []]) {
      render(<AthleteSwitcher plan={{ ...todayTwoPrograms, athletes }} hrefFor={hrefFor} />);
      expect(screen.queryByRole('navigation')).toBeNull();
      cleanup();
    }
  });

  it('on an archived athlete’s day (not listed), one live athlete is the way back', () => {
    const plan = archivedAthleteNothingLogged;
    expect(plan.athletes).toHaveLength(1);
    const other = plan.athletes[0]!;
    expect(other.profilePublicId).not.toBe(plan.profilePublicId);
    render(<AthleteSwitcher plan={plan} hrefFor={hrefFor} />);
    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe(hrefFor(other.profilePublicId));
    // The viewed athlete is not in the list, so no link is the current one.
    expect(links[0]!.getAttribute('aria-current')).toBeNull();
    // Its whole name: the archived athlete's own name is not listed to be told apart from.
    expect(links[0]!.textContent).toBe(other.name);
  });
});

describe('NotOnAProgram', () => {
  it('no-program: not on a program yet, with no link when the page passes none', () => {
    render(<NotOnAProgram plan={noProgram} />);
    expect(noProgram.writable).toBe(true);
    expect(screen.getByText(`${PROGRAM_COPY.notYet} ${PROGRAM_COPY.notYetLogHere}`)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('no-program on a day that logs nothing: no "log here" (FAM-1 12c)', () => {
    render(<NotOnAProgram plan={{ ...noProgram, writable: false }} />);
    expect(screen.getByText(PROGRAM_COPY.notYet)).toBeTruthy();
    expect(screen.queryByText(new RegExp(PROGRAM_COPY.notYetLogHere))).toBeNull();
  });

  it('no-program with a Programs page: asks for the athlete to be put on one, and links there', () => {
    render(<NotOnAProgram plan={noProgram} programsHref={PROGRAMS_PATH} />);
    expect(screen.getByText(new RegExp(PROGRAM_COPY.notYetPutOn(nameOf(noProgram))))).toBeTruthy();
    expect(screen.getByRole('link', { name: PROGRAM_COPY.programs }).getAttribute('href')).toBe(
      PROGRAMS_PATH,
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
    const resting = sundayRestStretchOnly.programs.filter(
      (p) => !sundayRestStretchOnly.workouts.some((w) => w.programPublicId === p.programPublicId),
    );
    expect(resting).toHaveLength(1);
    expect(restNotice(sundayRestStretchOnly)).toEqual({
      text: PROGRAM_COPY.restSome(resting.map((p) => p.name)),
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

  it('when every program has a workout that day, there is no rest line', () => {
    expect(restNotice(todayTwoPrograms)).toBeNull();
  });

  it('one resting program, alone on the day, says nothing beyond the all-rest line', () => {
    const one: DayPlan = {
      ...sundayRestStretchOnly,
      programs: sundayRestStretchOnly.programs.filter(
        (p) => !sundayRestStretchOnly.workouts.some((w) => w.programPublicId === p.programPublicId),
      ),
      workouts: [],
    };
    expect(restNotice(one)?.allRest).toBe(true);
  });

  it('never on an older day, where an empty program means skipped, not rest', () => {
    expect(closedDayLoggedOnly.writable).toBe(false);
    const skipped: DayPlan = { ...closedDayLoggedOnly, workouts: [] };
    expect(restNotice(skipped)).toBeNull();
  });

  it('on a look-ahead day it does show, and never for an athlete not on a program', () => {
    const lookAheadRest: DayPlan = { ...futurePreview, workouts: [] };
    expect(restNotice(lookAheadRest)?.text).toBe(PROGRAM_COPY.restAll(futurePreview.day));
    // The gate, not an empty program list: a resting day for an athlete not on a program that day.
    expect(
      restNotice({ ...sundayRestStretchOnly, workouts: [], onProgram: ON_PROGRAM['not-this-day'] }),
    ).toBeNull();
  });
});

describe('ProgramLine and the Program order dialog', () => {
  function mountLine(plan: DayPlan, actions: DayActions = createFakeDayActions(plan).actions) {
    return render(<ProgramLine plan={plan} actions={actions} />);
  }
  const withReorder = (plan: DayPlan, reorderPrograms: DayActions['reorderPrograms']) => ({
    ...createFakeDayActions(plan).actions,
    reorderPrograms,
  });
  const orderButton = () => screen.getByRole('button', { name: PROGRAM_COPY.order });
  const items = () =>
    within(screen.getByRole('dialog'))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('span')?.textContent);
  const arrow = (direction: 'up' | 'down', name: string) =>
    screen.getByRole('button', {
      name: (direction === 'up' ? PROGRAM_COPY.moveUp : PROGRAM_COPY.moveDown)(name),
    });
  const numbered = (programs: DayPlan['currentPrograms']) =>
    programs.map((p, i) => `${i + 1}. ${p.name}`);
  /** A reorder whose answers the test hands out, one per call, in order. */
  function deferredReorder() {
    const answers: Array<(result: ProgramResult) => void> = [];
    const reorder = vi.fn<NonNullable<DayActions['reorderPrograms']>>(
      () => new Promise<ProgramResult>((resolve) => answers.push(resolve)),
    );
    const answer = (n: number, result: ProgramResult) => act(async () => answers[n]!(result));
    return { reorder, answer };
  }
  const [FIRST, SECOND] = todayTwoPrograms.currentPrograms as [
    DayPlan['currentPrograms'][number],
    DayPlan['currentPrograms'][number],
  ];

  it('names the day’s programs in order; one program reads "Program:"', () => {
    mountLine(todayTwoPrograms);
    expect(
      screen.getByText(PROGRAM_COPY.line(todayTwoPrograms.programs.map((p) => p.name))),
    ).toBeTruthy();
    cleanup();
    // One program that day, though the athlete is on two now: a line, and no Program order.
    const one = { ...todayTwoPrograms, programs: todayTwoPrograms.programs.slice(0, 1) };
    mountLine(one);
    expect(screen.getByText(/^Program: /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: PROGRAM_COPY.order })).toBeNull();
  });

  it('shows Program order only with reorderPrograms, two current programs, and a writable day', () => {
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
    expect(items()).toEqual(numbered(todayTwoPrograms.currentPrograms));
  });

  it('a move saves the whole order, says where it went, and the end arrows follow', async () => {
    const reorderPrograms = vi.fn(createFakeDayActions(todayTwoPrograms).actions.reorderPrograms);
    mountLine(todayTwoPrograms, withReorder(todayTwoPrograms, reorderPrograms));
    fireEvent.click(orderButton());
    await act(async () => {
      fireEvent.click(arrow('down', FIRST.name));
    });
    expect(reorderPrograms).toHaveBeenCalledWith({
      profilePublicId: todayTwoPrograms.profilePublicId,
      programPublicIds: [SECOND.programPublicId, FIRST.programPublicId],
    });
    expect(items()).toEqual([`1. ${SECOND.name}`, `2. ${FIRST.name}`]);
    expect(screen.getByText(PROGRAM_COPY.moved(FIRST.name, 2, 2))).toBeTruthy();
    expect(arrow('down', FIRST.name).getAttribute('aria-disabled')).toBe('true');
    expect(arrow('up', SECOND.name).getAttribute('aria-disabled')).toBe('true');
    expect(arrow('up', FIRST.name).getAttribute('aria-disabled')).toBeNull();
  });

  it('the end arrows do nothing and say so', () => {
    const reorderPrograms = vi.fn();
    mountLine(todayStretchingFirst, withReorder(todayStretchingFirst, reorderPrograms));
    fireEvent.click(orderButton());
    const [first] = todayStretchingFirst.currentPrograms;
    const up = arrow('up', first!.name);
    expect(up.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(up);
    expect(reorderPrograms).not.toHaveBeenCalled();
  });

  it('a tap during a save is sent when it settles, and the page’s older order cannot undo it', async () => {
    const { reorder, answer } = deferredReorder();
    const view = mountLine(todayTwoPrograms, withReorder(todayTwoPrograms, reorder));
    fireEvent.click(orderButton());
    fireEvent.click(arrow('down', FIRST.name)); // save 1: [second, first], in flight
    fireEvent.click(arrow('up', FIRST.name)); // queued: [first, second]
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(items()).toEqual(numbered([FIRST, SECOND]));

    await answer(0, { ok: true });
    expect(reorder).toHaveBeenCalledTimes(2);
    expect(reorder.mock.calls[1]![0]).toMatchObject({
      programPublicIds: [FIRST.programPublicId, SECOND.programPublicId],
    });
    // The page re-reads after save 1 and hands back save 1's order, while save 2 is in flight.
    const afterOne = { ...todayTwoPrograms, currentPrograms: [SECOND, FIRST] };
    view.rerender(<ProgramLine plan={afterOne} actions={withReorder(afterOne, reorder)} />);
    await answer(1, { ok: true });
    expect(items()).toEqual(numbered([FIRST, SECOND]));
  });

  it('a refusal on a third queued save shows the order the server took, not an older re-read', async () => {
    const { reorder, answer } = deferredReorder();
    const view = mountLine(todayTwoPrograms, withReorder(todayTwoPrograms, reorder));
    fireEvent.click(orderButton());
    fireEvent.click(arrow('down', FIRST.name)); // save 1: [second, first]
    fireEvent.click(arrow('up', FIRST.name)); // queued: [first, second]
    await answer(0, { ok: true }); // save 2 starts
    // Save 1's re-read lands while save 2 is in flight.
    const afterOne = { ...todayTwoPrograms, currentPrograms: [SECOND, FIRST] };
    view.rerender(<ProgramLine plan={afterOne} actions={withReorder(afterOne, reorder)} />);
    fireEvent.click(arrow('down', FIRST.name)); // queued: [second, first]
    await answer(1, { ok: true }); // save 2 took [first, second]; save 3 starts
    await answer(2, { ok: false, reason: PROGRAM_REFUSAL.retry });
    expect(items()).toEqual(numbered([FIRST, SECOND]));
  });

  it('a refusal after an earlier success puts back the order the server took, not the first one', async () => {
    let calls = 0;
    const reorderPrograms = vi.fn(async (): Promise<ProgramResult> =>
      ++calls === 1 ? { ok: true } : { ok: false, reason: PROGRAM_REFUSAL.retry },
    );
    mountLine(todayTwoPrograms, withReorder(todayTwoPrograms, reorderPrograms));
    fireEvent.click(orderButton());
    await act(async () => {
      fireEvent.click(arrow('down', FIRST.name));
    });
    await act(async () => {
      fireEvent.click(arrow('up', FIRST.name));
    });
    expect(items()).toEqual(numbered([SECOND, FIRST]));
    expect(screen.getByText(PROGRAM_COPY.orderFailed)).toBeTruthy();
  });

  it('a failed save keeps focus on the arrow tapped, even when the revert moves it', async () => {
    const { reorder, answer } = deferredReorder();
    mountLine(todayTwoPrograms, withReorder(todayTwoPrograms, reorder));
    fireEvent.click(orderButton());
    const down = arrow('down', FIRST.name);
    down.focus();
    fireEvent.click(down);
    // As a browser can, when it re-inserts the moved row.
    (document.activeElement as HTMLElement).blur();
    await answer(0, { ok: false, reason: PROGRAM_REFUSAL.retry });
    expect(items()).toEqual(numbered(todayTwoPrograms.currentPrograms));
    expect(document.activeElement).toBe(arrow('down', FIRST.name));
    expect(arrow('down', FIRST.name).getAttribute('aria-describedby')).toBeTruthy();
  });

  it('a save that throws (a dropped connection) is a failure, not a stuck list', async () => {
    mountLine(
      todayTwoPrograms,
      withReorder(todayTwoPrograms, () => Promise.reject(new Error('offline'))),
    );
    fireEvent.click(orderButton());
    await act(async () => {
      fireEvent.click(arrow('down', FIRST.name));
    });
    expect(items()).toEqual(numbered(todayTwoPrograms.currentPrograms));
    expect(screen.getByText(PROGRAM_COPY.orderFailed)).toBeTruthy();
  });

  it.each([PROGRAM_REFUSAL.invalid, PROGRAM_REFUSAL.not_found])(
    'a refusal meaning the programs changed elsewhere (%s) re-reads the page instead of "try again"',
    async (reason) => {
      mountLine(
        todayTwoPrograms,
        withReorder(todayTwoPrograms, async () => ({ ok: false, reason })),
      );
      fireEvent.click(orderButton());
      await act(async () => {
        fireEvent.click(arrow('down', FIRST.name));
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByText(PROGRAM_COPY.orderStale)).toBeTruthy();
    },
  );

  it('an order the page re-reads while nothing is pending is adopted', () => {
    const view = mountLine(todayTwoPrograms);
    fireEvent.click(orderButton());
    const reordered = { ...todayTwoPrograms, currentPrograms: [SECOND, FIRST] };
    view.rerender(<ProgramLine plan={reordered} actions={withReorder(reordered, vi.fn())} />);
    expect(items()).toEqual(numbered([SECOND, FIRST]));
  });

  it('a refused save puts back the order the page re-read during it: the server’s, not the old one', async () => {
    const THIRD = { programPublicId: '00000000-0000-7000-8000-0000000000c3', name: 'Third' };
    const three = { ...todayTwoPrograms, currentPrograms: [FIRST, SECOND, THIRD] };
    const { reorder, answer } = deferredReorder();
    const view = mountLine(three, withReorder(three, reorder));
    fireEvent.click(orderButton());
    fireEvent.click(arrow('down', FIRST.name)); // in flight: [second, first, third]
    // Another phone reorders meanwhile, and the page re-reads it.
    const elsewhere = { ...three, currentPrograms: [THIRD, SECOND, FIRST] };
    view.rerender(<ProgramLine plan={elsewhere} actions={withReorder(elsewhere, reorder)} />);
    await answer(0, { ok: false, reason: PROGRAM_REFUSAL.retry });
    expect(items()).toEqual(numbered([THIRD, SECOND, FIRST]));
    // And it is now the order to fall back to: a second refusal does not bring the old one back.
    fireEvent.click(arrow('up', FIRST.name));
    await answer(1, { ok: false, reason: PROGRAM_REFUSAL.retry });
    expect(items()).toEqual(numbered([THIRD, SECOND, FIRST]));
  });

  it('a re-read of the page does not pull focus back to the arrow', async () => {
    const view = mountLine(todayTwoPrograms);
    fireEvent.click(orderButton());
    await act(async () => {
      fireEvent.click(arrow('down', FIRST.name));
    });
    const done = screen.getByRole('button', { name: PROGRAM_COPY.done });
    done.focus();
    // The same order, as a new array: what every re-read of the page hands back.
    const again = { ...todayTwoPrograms, currentPrograms: [SECOND, FIRST] };
    view.rerender(<ProgramLine plan={again} actions={withReorder(again, vi.fn())} />);
    expect(document.activeElement).toBe(done);
  });

  it('a failed save says so; closing and opening again starts clean', async () => {
    mountLine(
      todayTwoPrograms,
      withReorder(todayTwoPrograms, async () => ({ ok: false, reason: PROGRAM_REFUSAL.retry })),
    );
    fireEvent.click(orderButton());
    await act(async () => {
      fireEvent.click(arrow('down', FIRST.name));
    });
    expect(items()).toEqual(numbered(todayTwoPrograms.currentPrograms));
    expect(screen.getByText(PROGRAM_COPY.orderFailed)).toBeTruthy();
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
