// @vitest-environment jsdom
import { ROW_REFUSAL, type DayActions, type DayPlan, type RowResult } from '@mat-plan/shared';
import {
  closedDayLoggedOnly,
  DAY_PLAN_FIXTURES,
  everyTypeOnce,
  todayTwoPrograms,
  workoutLeftTheWeek,
  yesterdayHalfDone,
} from '@mat-plan/shared/program/fixtures';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';

import { DAY_COPY, refusalCopy, TYPED_PROBLEM_COPY } from './day-copy';
import { DayScreen } from './day-screen';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

/**
 * The screen as the preview route mounts it: the fake's change comes back as new props. `wrap`
 * replaces any action, to answer what the fake never does (a rejection, a stale page).
 */
function mount(
  fixture: DayPlan,
  options: { failNext?: boolean; wrap?: (actions: Required<DayActions>) => DayActions } = {},
) {
  const control: { setPlan?: (plan: DayPlan) => void } = {};
  function Harness() {
    const [plan, setPlan] = useState(fixture);
    control.setPlan = setPlan;
    const [actions] = useState(() => {
      const fake = createFakeDayActions(fixture, setPlan);
      if (options.failNext) fake.failNext();
      return options.wrap ? options.wrap(fake.actions) : fake.actions;
    });
    return <DayScreen plan={plan} actions={actions} />;
  }
  render(<Harness />);
  return control;
}

/** A workout's section, by its heading. */
const workout = (name: string) =>
  screen.getByRole('region', { name: (n) => n === name || n.startsWith(`${name} `) });

/** The n-th item card (an `<li>`) named `name` within a workout. */
function card(workoutName: string, itemName: string) {
  const heading = within(workout(workoutName)).getByRole('heading', { level: 4, name: itemName });
  return heading.closest('li')!;
}
const tick = (el: HTMLElement) => within(el).getByRole('button', { name: /^Log / });
const field = (el: HTMLElement) => within(el).getByRole<HTMLInputElement>('textbox');

async function press(button: HTMLElement) {
  await act(async () => {
    button.focus();
    fireEvent.click(button);
  });
}

describe('DayScreen: a section of the day page', () => {
  it('is an <h2> region, never the page’s <h1>', () => {
    render(
      <DayScreen
        plan={todayTwoPrograms}
        actions={createFakeDayActions(todayTwoPrograms).actions}
      />,
    );
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('region', { name: DAY_COPY.heading })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(DAY_COPY.heading);
  });

  it.each(Object.entries(DAY_PLAN_FIXTURES))(
    'renders %s: one <h3> per workout, one <h4> per item',
    (_name, plan) => {
      render(<DayScreen plan={plan} actions={createFakeDayActions(plan).actions} />);
      const workouts = screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
      expect(workouts).toEqual(plan.workouts.map((w) => w.name));
      const items = plan.workouts.reduce((sum, w) => sum + w.items.length, 0);
      expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(items);
    },
  );
});

describe('the workout card', () => {
  it('reads "2 of 10", "Done ✓" when every row is logged, and nothing when there is nothing to count', () => {
    const empty: DayPlan = {
      ...todayTwoPrograms,
      workouts: [{ ...todayTwoPrograms.workouts[0]!, progress: { done: 0, total: 0 } }],
    };
    const { rerender } = render(
      <DayScreen
        plan={todayTwoPrograms}
        actions={createFakeDayActions(todayTwoPrograms).actions}
      />,
    );
    expect(within(workout('Morning habits')).getByText(DAY_COPY.progress(2, 10))).toBeTruthy();
    rerender(
      <DayScreen
        plan={yesterdayHalfDone}
        actions={createFakeDayActions(yesterdayHalfDone).actions}
      />,
    );
    expect(within(workout('Morning habits')).getByText(DAY_COPY.doneMark)).toBeTruthy();
    rerender(<DayScreen plan={empty} actions={createFakeDayActions(empty).actions} />);
    const section = workout('Morning habits');
    expect(within(section).queryByText(DAY_COPY.doneMark)).toBeNull();
    expect(within(section).queryByText(/ of /)).toBeNull();
  });

  it('names the program only when the athlete is on more than one that day', () => {
    render(
      <DayScreen
        plan={todayTwoPrograms}
        actions={createFakeDayActions(todayTwoPrograms).actions}
      />,
    );
    expect(within(workout('Evening stretch')).getByText('Stretching')).toBeTruthy();
    cleanup();
    render(
      <DayScreen plan={everyTypeOnce} actions={createFakeDayActions(everyTypeOnce).actions} />,
    );
    expect(within(workout('One of each')).queryByText('Every type')).toBeNull();
  });
});

describe('a single row: ✓, un-tick and re-tick', () => {
  it('an empty ✓ shows the prescription’s numbers (target) as the logged values', async () => {
    mount(todayTwoPrograms);
    const splits = card('Morning habits', 'Splits stretch');
    expect(field(splits).getAttribute('placeholder')).toBe('5');
    await press(tick(splits));
    // The prescription's `5 min`, and now the logged one where the field was.
    expect(within(splits).getAllByText('5 min')).toHaveLength(2);
    expect(within(splits).queryByRole('textbox')).toBeNull();
    expect(tick(splits).getAttribute('aria-pressed')).toBe('true');
    expect(within(workout('Morning habits')).getByText(DAY_COPY.progress(3, 10))).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(DAY_COPY.announce.logged('Splits stretch'));
  });

  it('logs what was typed, and focus stays on the ✓', async () => {
    mount(todayTwoPrograms);
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '12.5' } });
    await press(tick(vest));
    expect(within(vest).getByText('12.5 lb')).toBeTruthy();
    expect(document.activeElement).toBe(tick(vest));
  });

  it('a Check says Done only once it is logged', async () => {
    mount(todayTwoPrograms);
    const grip = card('Morning habits', 'Grip: rice bucket');
    expect(within(grip).getByText(DAY_COPY.done)).toBeTruthy();
    await press(tick(grip));
    expect(within(grip).queryByText(DAY_COPY.done)).toBeNull();
    expect(tick(grip).getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    ['today', todayTwoPrograms],
    ['yesterday', yesterdayHalfDone],
  ])('un-tick leaves no tomb; re-tick restores the row, on %s', async (_day, plan) => {
    const actions = createFakeDayActions(plan).actions;
    const spy = {
      ...actions,
      logRow: vi.fn(actions.logRow),
      retickRow: vi.fn(actions.retickRow),
    };
    render(<DayScreen plan={plan} actions={spy} />);
    const grip = card('Morning habits', 'Grip: rice bucket');
    await press(tick(grip));
    expect(tick(grip).getAttribute('aria-pressed')).toBe('false');
    expect(within(grip).queryByText(DAY_COPY.done)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      DAY_COPY.announce.unticked('Grip: rice bucket'),
    );
    await press(tick(grip));
    expect(tick(grip).getAttribute('aria-pressed')).toBe('true');
    expect(spy.retickRow).toHaveBeenCalledTimes(1);
    expect(spy.logRow).not.toHaveBeenCalled();
  });

  it('after an un-tick the field keeps the number: unchanged re-ticks, changed logs a new entry', async () => {
    const actions = createFakeDayActions(yesterdayHalfDone).actions;
    const spy = { ...actions, logRow: vi.fn(actions.logRow), retickRow: vi.fn(actions.retickRow) };
    render(<DayScreen plan={yesterdayHalfDone} actions={spy} />);
    const splits = card('Morning habits', 'Splits stretch');
    await press(tick(splits));
    expect(field(splits).value).toBe('5');
    fireEvent.change(field(splits), { target: { value: '7' } });
    await press(tick(splits));
    expect(spy.retickRow).not.toHaveBeenCalled();
    expect(spy.logRow).toHaveBeenCalledTimes(1);
    expect(within(splits).getByText('7 min')).toBeTruthy();
  });
});

describe('a ✓ that fails', () => {
  it('un-ticks, keeps what was typed, says it could not save, and the retry reuses the clientId', async () => {
    const seen: string[] = [];
    mount(todayTwoPrograms, {
      failNext: true,
      wrap: (a) => ({
        ...a,
        logRow: (input) => {
          seen.push(input.clientId);
          return a.logRow(input);
        },
      }),
    });
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '12' } });
    await press(tick(vest));
    const failed = refusalCopy(ROW_REFUSAL.retry, 'tick').message;
    expect(within(vest).getByText(failed)).toBeTruthy();
    expect(tick(vest).getAttribute('aria-pressed')).toBe('false');
    expect(field(vest).value).toBe('12');
    expect(field(vest).getAttribute('aria-describedby')).toBe(
      tick(vest).getAttribute('aria-describedby'),
    );
    expect(within(workout('Morning habits')).getByText(DAY_COPY.notSaved(1))).toBeTruthy();

    await press(tick(vest));
    expect(within(vest).getByText('12 lb')).toBeTruthy();
    expect(within(vest).queryByText(failed)).toBeNull();
    expect(within(workout('Morning habits')).queryByText(DAY_COPY.notSaved(1))).toBeNull();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  it('a retry with a different number is a new attempt with a new clientId', async () => {
    const seen: string[] = [];
    mount(todayTwoPrograms, {
      failNext: true,
      wrap: (a) => ({ ...a, logRow: (input) => (seen.push(input.clientId), a.logRow(input)) }),
    });
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '12' } });
    await press(tick(vest));
    fireEvent.change(field(vest), { target: { value: '14' } });
    await press(tick(vest));
    expect(seen[1]).not.toBe(seen[0]);
    expect(within(vest).getByText('14 lb')).toBeTruthy();
  });

  it('a rejected write (a dropped connection) fails the same way, never left ticked', async () => {
    mount(todayTwoPrograms, {
      wrap: (a) => ({ ...a, logRow: () => Promise.reject(new Error('offline')) }),
    });
    const splits = card('Morning habits', 'Splits stretch');
    await press(tick(splits));
    expect(tick(splits).getAttribute('aria-pressed')).toBe('false');
    expect(within(splits).getByText(refusalCopy(ROW_REFUSAL.retry, 'tick').message)).toBeTruthy();
  });

  it('a failed un-tick says the row is still logged', async () => {
    mount(todayTwoPrograms, { failNext: true });
    const grip = card('Morning habits', 'Grip: rice bucket');
    await press(tick(grip));
    expect(tick(grip).getAttribute('aria-pressed')).toBe('true');
    expect(within(grip).getByText(refusalCopy(ROW_REFUSAL.retry, 'untick').message)).toBeTruthy();
  });
});

describe('inline refusals', () => {
  it.each([
    ['5 min', 'not_a_number'],
    ['-5', 'not_a_number'],
    ['1e3', 'not_a_number'],
    ['5000', 'out_of_range'],
  ] as const)(
    'a non-number (%s) is refused by the field, which takes focus',
    async (typed, problem) => {
      const logRow = vi.fn();
      mount(todayTwoPrograms, { wrap: (a) => ({ ...a, logRow }) });
      const splits = card('Morning habits', 'Splits stretch');
      fireEvent.change(field(splits), { target: { value: typed } });
      await press(tick(splits));
      expect(within(splits).getByText(TYPED_PROBLEM_COPY[problem])).toBeTruthy();
      expect(document.activeElement).toBe(field(splits));
      expect(field(splits).getAttribute('aria-invalid')).toBe('true');
      expect(logRow).not.toHaveBeenCalled();
    },
  );

  it('a stale page offers Reload, which refreshes and keeps the other rows’ typed text', async () => {
    const stale: RowResult = { ok: false, reason: ROW_REFUSAL.program_changed };
    mount(todayTwoPrograms, { wrap: (a) => ({ ...a, logRow: async () => stale }) });
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '11' } });
    await press(tick(card('Morning habits', 'Splits stretch')));
    await press(
      within(card('Morning habits', 'Splits stretch')).getByRole('button', {
        name: DAY_COPY.reload,
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(field(vest).value).toBe('11');
  });

  it('the first closed_day turns the whole screen read-only', async () => {
    const closed: RowResult = { ok: false, reason: ROW_REFUSAL.closed_day };
    mount(todayTwoPrograms, { wrap: (a) => ({ ...a, logRow: async () => closed }) });
    await press(tick(card('Morning habits', 'Splits stretch')));
    expect(screen.getAllByText(DAY_COPY.closed).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: /^Log / })).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});

describe('typed values and redraws', () => {
  it('typed numbers survive ticking another row', async () => {
    mount(todayTwoPrograms);
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '11' } });
    await press(tick(card('Morning habits', 'Splits stretch')));
    await press(tick(card('Evening stretch', 'Hamstring stretch')));
    expect(field(card('Morning habits', 'Vest weight')).value).toBe('11');
  });

  it('a new day starts clean: nothing typed or failed carries over', async () => {
    const control = mount(todayTwoPrograms, { failNext: true });
    fireEvent.change(field(card('Morning habits', 'Vest weight')), { target: { value: '11' } });
    await press(tick(card('Morning habits', 'Splits stretch')));
    expect(screen.getByText(DAY_COPY.notSaved(1))).toBeTruthy();
    act(() => control.setPlan!({ ...todayTwoPrograms, day: '2026-11-13' }));
    expect(field(card('Morning habits', 'Vest weight')).value).toBe('');
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
  });
});

describe('a day that cannot be written', () => {
  it('a closed day shows what was logged as text, with no ✓, field or Previous', () => {
    render(
      <DayScreen
        plan={closedDayLoggedOnly}
        actions={createFakeDayActions(closedDayLoggedOnly).actions}
      />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    const splits = card('Morning habits', 'Splits stretch');
    expect(within(splits).getAllByText('5 min')).toHaveLength(2);
    expect(within(splits).getByText(DAY_COPY.logged)).toBeTruthy();
    expect(within(splits).queryByText(new RegExp(DAY_COPY.lastTime))).toBeNull();
  });

  it('a workout that left the week is read-only on a writable day', () => {
    render(
      <DayScreen
        plan={workoutLeftTheWeek}
        actions={createFakeDayActions(workoutLeftTheWeek).actions}
      />,
    );
    expect(within(workout('Heavy A')).queryAllByRole('button')).toHaveLength(0);
    expect(within(workout('Morning habits')).queryAllByRole('button').length).toBeGreaterThan(0);
  });
});
