// @vitest-environment jsdom
import {
  ON_PROGRAM,
  ROW_REFUSAL,
  ROW_REFUSALS,
  type DayPlan,
  type RowResult,
} from '@mat-plan/shared';
import {
  archivedAthleteNothingLogged,
  closedDayLoggedOnly,
  closedDayNothingLogged,
  DAY_PLAN_FIXTURES,
  futurePreview,
  notOnAProgramThatDay,
  sundayRestStretchOnly,
  everyTypeOnce,
  todayTwoPrograms,
  workoutLeftTheWeek,
  yesterdayHalfDone,
} from '@mat-plan/shared/program/fixtures';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';

import { DAY_COPY, PROGRAM_COPY, refusalCopy, TYPED_PROBLEM_COPY } from './day-copy';
import { nothingLoggedNotice, restNotice } from './day-notices';
import {
  card,
  field,
  held,
  isTick,
  lb,
  press,
  status,
  tick,
  makeMount,
  workout,
} from './day-test-utils';
import { LOGGED_CARD_CLASS, TINT_CLASS } from './row-parts';

const { mount, show } = makeMount(createFakeDayActions);

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

describe('DayScreen: a section of the day page', () => {
  it('is an <h2> region, never the page’s <h1>', () => {
    show(todayTwoPrograms);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('region', { name: DAY_COPY.heading })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(DAY_COPY.heading);
  });

  it.each(Object.entries(DAY_PLAN_FIXTURES))(
    'renders %s: one <h3> per workout, one <h4> per item',
    (_name, plan) => {
      show(plan);
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
    show(todayTwoPrograms);
    expect(within(workout('Morning habits')).getByText(DAY_COPY.progress(2, 10))).toBeTruthy();
    cleanup();
    show(yesterdayHalfDone);
    expect(within(workout('Morning habits')).getByText(DAY_COPY.doneMark)).toBeTruthy();
    cleanup();
    show(empty);
    const section = workout('Morning habits');
    expect(within(section).queryByText(DAY_COPY.doneMark)).toBeNull();
    expect(within(section).queryByText(DAY_COPY.progress(0, 0))).toBeNull();
  });

  it('names the program only when the athlete is on more than one that day', () => {
    show(todayTwoPrograms);
    expect(within(workout('Evening stretch')).getByText('Stretching')).toBeTruthy();
    cleanup();
    show(everyTypeOnce);
    expect(within(workout('One of each')).queryByText('Every type')).toBeNull();
  });
});

describe('a single row: ✓, un-tick and re-tick', () => {
  it('an empty ✓ sends no numbers, and shows the prescription’s (target) as the logged values', async () => {
    const control = mount(todayTwoPrograms);
    const splits = card('Morning habits', 'Splits stretch');
    expect(field(splits).getAttribute('placeholder')).toBe('5');
    await press(tick(splits));
    // D13: the writer fills an absent quantity from the prescription; the screen sends none.
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({
      set: 1,
      day: todayTwoPrograms.day,
      values: { quantities: [] },
    });
    // The prescription's `5 min`, and now the logged one where the field was.
    expect(within(splits).getAllByText('5 min')).toHaveLength(2);
    expect(within(splits).queryByRole('textbox')).toBeNull();
    expect(tick(splits).getAttribute('aria-pressed')).toBe('true');
    expect(within(workout('Morning habits')).getByText(DAY_COPY.progress(3, 10))).toBeTruthy();
    expect(status()).toBe(DAY_COPY.announce.logged('Splits stretch'));
  });

  it('the ✓ is optimistic: ticked while the write is in flight, and a second press sends nothing', async () => {
    const gate = held();
    const control = mount(todayTwoPrograms, {
      wrap: (a) => ({ logRow: (input) => gate.after(() => a.logRow(input)) }),
    });
    const splits = card('Morning habits', 'Splits stretch');
    await press(tick(splits));
    expect(tick(splits).getAttribute('aria-pressed')).toBe('true');
    expect(tick(splits).getAttribute('aria-disabled')).toBe('true');
    expect(within(splits).getAllByText('5 min')).toHaveLength(2);
    await press(tick(splits));
    expect(control.actions.logRow).toHaveBeenCalledTimes(1);
    expect(control.actions.untickRow).not.toHaveBeenCalled();
    await gate.resolve();
    expect(tick(splits).getAttribute('aria-disabled')).toBeNull();
  });

  it('logs what was typed, and focus stays on the ✓', async () => {
    const control = mount(todayTwoPrograms);
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '12.5' } });
    await press(tick(vest));
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({
      values: { quantities: [lb(12.5)] },
    });
    expect(within(vest).getByText('12.5 lb')).toBeTruthy();
    expect(document.activeElement).toBe(tick(vest));
  });

  it('Enter in the field is the ✓', async () => {
    const control = mount(todayTwoPrograms);
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '11' } });
    await act(async () => {
      fireEvent.keyDown(field(vest), { key: 'Enter' });
    });
    expect(control.actions.logRow).toHaveBeenCalledTimes(1);
    expect(within(vest).getByText('11 lb')).toBeTruthy();
    // The field is gone once the row is logged: focus is on the ✓, never the page.
    expect(document.activeElement).toBe(tick(vest));
  });

  it('"Last time" shows on a row that can still be logged', () => {
    show(todayTwoPrograms);
    expect(
      within(card('Morning habits', 'Splits stretch')).getByText(`${DAY_COPY.lastTime} 5 min`),
    ).toBeTruthy();
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
    const control = mount(plan);
    const grip = card('Morning habits', 'Grip: rice bucket');
    await press(tick(grip));
    expect(tick(grip).getAttribute('aria-pressed')).toBe('false');
    expect(within(grip).queryByText(DAY_COPY.done)).toBeNull();
    expect(status()).toBe(DAY_COPY.announce.unticked('Grip: rice bucket'));
    const unticked = await control.actions.untickRow.mock.results[0]!.value;
    await press(tick(grip));
    expect(tick(grip).getAttribute('aria-pressed')).toBe('true');
    expect(control.actions.retickRow.mock.calls[0]![0]).toMatchObject({
      entryPublicId: unticked.entryPublicId,
      hiddenAt: unticked.hiddenAt,
      day: plan.day,
    });
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });

  it('after an un-tick the field keeps the number: unchanged re-ticks, changed logs a new entry', async () => {
    const control = mount(yesterdayHalfDone);
    const splits = card('Morning habits', 'Splits stretch');
    await press(tick(splits));
    expect(field(splits).value).toBe('5');
    fireEvent.change(field(splits), { target: { value: '7' } });
    await press(tick(splits));
    expect(control.actions.retickRow).not.toHaveBeenCalled();
    expect(control.actions.logRow).toHaveBeenCalledTimes(1);
    expect(within(splits).getByText('7 min')).toBeTruthy();
  });

  it('after an un-tick, an emptied field is a new ✓ of the prescription, not a re-tick', async () => {
    const control = mount(yesterdayHalfDone);
    const splits = card('Morning habits', 'Splits stretch');
    await press(tick(splits));
    fireEvent.change(field(splits), { target: { value: '' } });
    await press(tick(splits));
    expect(control.actions.retickRow).not.toHaveBeenCalled();
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({ values: { quantities: [] } });
  });

  it('an untouched field re-ticks, even when the item’s unit changed since', async () => {
    const control = mount(yesterdayHalfDone);
    await press(tick(card('Morning habits', 'Vest weight')));
    const plan = structuredClone(control.plan);
    const vest = plan.workouts[0]!.items.find((i) => i.name === 'Vest weight')!;
    vest.unit = 'kg';
    vest.target = { reps: null, quantities: [{ ...lb(5), unit: 'kg' }] };
    act(() => control.setPlan(plan));
    await press(tick(card('Morning habits', 'Vest weight')));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });

  it('after an un-tick, the same number typed again (5.0 for 5) re-ticks the same entry', async () => {
    const control = mount(yesterdayHalfDone);
    const splits = card('Morning habits', 'Splits stretch');
    await press(tick(splits));
    fireEvent.change(field(splits), { target: { value: '5.0' } });
    await press(tick(splits));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });

  it('a re-tick whose token is gone logs the row as a new ✓', async () => {
    const notFound: RowResult = { ok: false, reason: ROW_REFUSAL.not_found };
    const control = mount(yesterdayHalfDone, { wrap: () => ({ retickRow: async () => notFound }) });
    const splits = card('Morning habits', 'Splits stretch');
    await press(tick(splits));
    await press(tick(splits));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({
      values: { quantities: [{ unit: 'min', value: 5 }] },
    });
    expect(tick(splits).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a row whose prescription was removed', () => {
  /** Vest weight, logged, then taken out of the workout: it keeps its logged row only. */
  function removedVest(): DayPlan {
    const plan = structuredClone(todayTwoPrograms) as DayPlan;
    const vest = plan.workouts[0]!.items.find((i) => i.name === 'Vest weight')!;
    vest.prescriptionPublicId = null;
    vest.target = { reps: null, quantities: [] };
    vest.rows[0] = {
      ...vest.rows[0]!,
      previous: null,
      logged: {
        entryPublicId: '00000000-0000-7000-8000-0000000000aa',
        values: { quantities: [lb(10)] },
        prescribedText: '10 lb',
      },
    };
    return plan;
  }

  it('un-ticks to its kept number, with no field, and ticks back the same entry', async () => {
    const control = mount(removedVest());
    const vest = card('Morning habits', 'Vest weight');
    expect(within(vest).getByText(DAY_COPY.removed)).toBeTruthy();
    await press(tick(vest));
    expect(tick(vest).getAttribute('aria-pressed')).toBe('false');
    expect(within(vest).queryByRole('textbox')).toBeNull();
    // The frozen prescription, and the kept number where the logged one was.
    expect(within(vest).getAllByText('10 lb')).toHaveLength(2);
    await press(tick(vest));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });
});

describe('a ✓ that fails', () => {
  it('un-ticks, keeps what was typed, says it could not save, and the retry reuses the clientId', async () => {
    const control = mount(todayTwoPrograms, { failNext: true });
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
    // "Couldn't save" does not say the number is wrong.
    expect(field(vest).getAttribute('aria-invalid')).toBeNull();
    expect(within(workout('Morning habits')).getByText(DAY_COPY.notSaved(1))).toBeTruthy();
    expect(status()).toBe(DAY_COPY.announce.failed('Vest weight', failed));

    await press(tick(vest));
    expect(within(vest).getByText('12 lb')).toBeTruthy();
    expect(within(vest).queryByText(failed)).toBeNull();
    expect(within(workout('Morning habits')).queryByText(DAY_COPY.notSaved(1))).toBeNull();
    const [first, second] = control.actions.logRow.mock.calls.map(([input]) => input.clientId);
    expect(second).toBe(first);
  });

  it('a retry with a different number is a new attempt with a new clientId', async () => {
    const control = mount(todayTwoPrograms, { failNext: true });
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '12' } });
    await press(tick(vest));
    fireEvent.change(field(vest), { target: { value: '14' } });
    await press(tick(vest));
    const [first, second] = control.actions.logRow.mock.calls.map(([input]) => input.clientId);
    expect(second).not.toBe(first);
    expect(within(vest).getByText('14 lb')).toBeTruthy();
  });

  it('own_hidden: the next try is a new clientId, since that one is held by a hidden entry', async () => {
    const ownHidden: RowResult = { ok: false, reason: ROW_REFUSAL.own_hidden };
    let calls = 0;
    const control = mount(todayTwoPrograms, {
      wrap: (a) => ({
        logRow: (input) => (++calls === 1 ? Promise.resolve(ownHidden) : a.logRow(input)),
      }),
    });
    const splits = card('Morning habits', 'Splits stretch');
    await press(tick(splits));
    expect(within(splits).getByText(refusalCopy(ROW_REFUSAL.own_hidden, 'tick').message));
    await press(tick(splits));
    const [first, second] = control.actions.logRow.mock.calls.map(([input]) => input.clientId);
    expect(second).not.toBe(first);
  });

  it('a rejected write (a dropped connection) fails the same way, never left ticked', async () => {
    mount(todayTwoPrograms, {
      wrap: () => ({ logRow: () => Promise.reject(new Error('offline')) }),
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
    // Still logged, so still edged; no tint while a message shows (destructive is under AA on it).
    expect(grip.classList.contains(LOGGED_CARD_CLASS)).toBe(true);
    expect(grip.classList.contains(TINT_CLASS)).toBe(false);
  });

  it('a change to the row in the page’s data clears its old message', async () => {
    const control = mount(todayTwoPrograms, { failNext: true });
    await press(tick(card('Morning habits', 'Vest weight')));
    const failed = refusalCopy(ROW_REFUSAL.retry, 'tick').message;
    expect(screen.getByText(failed)).toBeTruthy();
    // Another phone logged it meanwhile, and the page's data now says so.
    const plan = structuredClone(control.plan);
    const vest = plan.workouts[0]!.items.find((i) => i.name === 'Vest weight')!;
    vest.rows[0]!.logged = {
      entryPublicId: '00000000-0000-7000-8000-0000000000bb',
      values: { quantities: [lb(10)] },
      prescribedText: '10 lb',
    };
    act(() => control.setPlan(plan));
    expect(screen.queryByText(failed)).toBeNull();
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
    expect(tick(card('Morning habits', 'Vest weight')).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('inline refusals', () => {
  it.each([
    ['5 min', 'not_a_number'],
    ['-5', 'not_a_number'],
    ['1e3', 'not_a_number'],
    ['5.1234', 'not_a_number'],
    ['5000', 'out_of_range'],
  ] as const)(
    'a non-number (%s) is refused by the field, which takes focus and says why',
    async (typed, problem) => {
      const control = mount(todayTwoPrograms);
      const splits = card('Morning habits', 'Splits stretch');
      fireEvent.change(field(splits), { target: { value: typed } });
      await press(tick(splits));
      expect(within(splits).getByText(TYPED_PROBLEM_COPY[problem])).toBeTruthy();
      expect(document.activeElement).toBe(field(splits));
      expect(field(splits).getAttribute('aria-invalid')).toBe('true');
      expect(status()).toBe(
        DAY_COPY.announce.failed('Splits stretch', TYPED_PROBLEM_COPY[problem]),
      );
      expect(control.actions.logRow).not.toHaveBeenCalled();
      // A refused number was never a save: it is not "not saved", and typing clears it.
      expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
      fireEvent.change(field(splits), { target: { value: '6' } });
      expect(within(splits).queryByText(TYPED_PROBLEM_COPY[problem])).toBeNull();
    },
  );

  it('a ✓ the server refuses as bad_value offers Reload, not a new number (UX panel, 12b)', async () => {
    // The screen checks a ✓ by the writer's own rule before sending it, so a refusal means the item
    // changed under the page (its unit, its type): retyping would fail every time.
    const bad: RowResult = { ok: false, reason: ROW_REFUSAL.bad_value };
    mount(todayTwoPrograms, { wrap: () => ({ logRow: async () => bad }) });
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '12' } });
    await press(tick(vest));
    expect(within(vest).getByText(refusalCopy(ROW_REFUSAL.bad_value, 'tick').message));
    expect(within(vest).getByRole('button', { name: DAY_COPY.reload })).toBeTruthy();
    expect(field(vest).getAttribute('aria-invalid')).not.toBe('true');
    expect(document.activeElement).not.toBe(field(vest));
  });

  it('every refusal of a ✓ but a retry has copy, and a stale one offers Reload', () => {
    for (const reason of ROW_REFUSALS) {
      const copy = refusalCopy(reason, 'tick');
      expect(copy.message, reason).not.toBe('');
      if (reason === ROW_REFUSAL.bad_value) expect(copy.reload).toBe(true);
    }
  });

  it('a stale page offers Reload, which refreshes and keeps focus on the ✓', async () => {
    const stale: RowResult = { ok: false, reason: ROW_REFUSAL.program_changed };
    mount(todayTwoPrograms, { wrap: () => ({ logRow: async () => stale }) });
    const vest = card('Morning habits', 'Vest weight');
    fireEvent.change(field(vest), { target: { value: '11' } });
    const splits = () => card('Morning habits', 'Splits stretch');
    await press(tick(splits()));
    expect(screen.getByText(DAY_COPY.notSaved(1))).toBeTruthy();
    await press(within(splits()).getByRole('button', { name: DAY_COPY.reload }));
    expect(refresh).toHaveBeenCalledTimes(1);
    // Reload does not clear other rows itself (whether a real refresh keeps them is Next's
    // router.refresh contract, which keeps client state).
    expect(field(vest).value).toBe('11');
    expect(document.activeElement).toBe(tick(splits()));
    // Reload clears that row's message and its "not saved": the data is about to say what is true.
    expect(
      within(splits()).queryByText(refusalCopy(ROW_REFUSAL.program_changed, 'tick').message),
    ).toBeNull();
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
  });

  it('a failed row that leaves the page stops counting as not saved', async () => {
    const control = mount(todayTwoPrograms, { failNext: true });
    await press(tick(card('Morning habits', 'Splits stretch')));
    expect(screen.getByText(DAY_COPY.notSaved(1))).toBeTruthy();
    const plan = structuredClone(control.plan);
    plan.workouts[0]!.items = plan.workouts[0]!.items.filter((i) => i.name !== 'Splits stretch');
    act(() => control.setPlan(plan));
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
  });

  it('the first closed_day turns the whole screen read-only, and focus goes to its notice', async () => {
    const closed: RowResult = { ok: false, reason: ROW_REFUSAL.closed_day };
    mount(todayTwoPrograms, { wrap: () => ({ logRow: async () => closed }) });
    await press(tick(card('Morning habits', 'Splits stretch')));
    expect(screen.queryAllByRole('button', { name: isTick })).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    const notice = screen.getByRole('group', { name: DAY_COPY.closed });
    expect(document.activeElement).toBe(notice);
    // No "last time" on a day nothing can be logged on (D33).
    expect(screen.queryByText(new RegExp(`^${DAY_COPY.lastTime}`))).toBeNull();
    // The data is fetched again: a retried ✓ refused at the window may have been saved the first
    // time, and the fresh data shows it (UX panel, 12b).
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('after closed_day, an earlier failure no longer counts or shows: nothing is left to retry', async () => {
    const closed: RowResult = { ok: false, reason: ROW_REFUSAL.closed_day };
    let calls = 0;
    mount(todayTwoPrograms, {
      failNext: true,
      wrap: (a) => ({
        logRow: (input) => (++calls === 1 ? a.logRow(input) : Promise.resolve(closed)),
      }),
    });
    await press(tick(card('Morning habits', 'Splits stretch')));
    expect(screen.getByText(DAY_COPY.notSaved(1))).toBeTruthy();
    await press(tick(card('Evening stretch', 'Hamstring stretch')));
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
    expect(screen.queryByText(refusalCopy(ROW_REFUSAL.retry, 'tick').message)).toBeNull();
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
    act(() => control.setPlan({ ...todayTwoPrograms, day: '2026-11-13' }));
    expect(field(card('Morning habits', 'Vest weight')).value).toBe('');
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
  });
});

describe('a day that cannot be written', () => {
  it('a closed day shows what was logged as text, with no ✓, field or Previous', () => {
    show(closedDayLoggedOnly);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    const splits = card('Morning habits', 'Splits stretch');
    expect(within(splits).getAllByText('5 min')).toHaveLength(2);
    expect(within(splits).getByText(DAY_COPY.logged)).toBeTruthy();
  });

  it('a set-type card looks done only when every set is logged', () => {
    show(yesterdayHalfDone);
    // DB bench press: 2 of 4 logged. Neck bridge: 3 of 3.
    const half = card('Heavy A', 'DB bench press');
    expect(half.classList.contains(LOGGED_CARD_CLASS)).toBe(false);
    expect(half.classList.contains(TINT_CLASS)).toBe(false);
    const full = card('Morning habits', 'Neck bridge');
    expect(full.classList.contains(LOGGED_CARD_CLASS)).toBe(true);
    expect(full.classList.contains(TINT_CLASS)).toBe(true);
  });

  it('a workout that left the week is read-only on a writable day', () => {
    show(workoutLeftTheWeek);
    expect(within(workout('Heavy A')).queryAllByRole('button')).toHaveLength(0);
    expect(within(workout('Morning habits')).queryAllByRole('button').length).toBeGreaterThan(0);
  });
});

describe('DayScreen: a day that shows only what was logged, with nothing logged', () => {
  const said = (plan: DayPlan) =>
    screen.queryByText(PROGRAM_COPY.nothingLogged(plan.day, plan.today));

  it('an older day says no workouts were logged, the day written as the date line writes it', () => {
    const empty = closedDayNothingLogged;
    expect(empty.workouts).toHaveLength(0);
    show(empty);
    // Pinned once: 2026-11-10 is a Tuesday, written as the page's date line writes it.
    expect(said(empty)?.textContent).toBe('No workouts logged on Tue, Nov 10.');
    expect(nothingLoggedNotice(empty)).toBe(said(empty)?.textContent);
    // Not a rest day: on a day read back, an empty program means skipped.
    expect(restNotice(empty)).toBeNull();
    // A static line in the section, after its heading: not a live region, no heading of its own.
    const line = said(empty)!;
    expect(line.closest('[aria-live],[role=status],[role=alert]')).toBeNull();
    expect(line.closest('section')?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([DAY_COPY.heading]);
  });

  it('an archived athlete’s today says it of today', () => {
    const empty = archivedAthleteNothingLogged;
    expect(empty.writable).toBe(false);
    expect(empty.day).toBe(empty.today);
    show(empty);
    expect(said(empty)?.textContent).toBe('No workouts logged today.');
  });

  it('never beside a logged workout, on a writable or look-ahead day, or off a program', () => {
    const cases: DayPlan[] = [
      closedDayLoggedOnly,
      { ...sundayRestStretchOnly, workouts: [] }, // writable: a rest day, which says so
      { ...futurePreview, workouts: [] },
      { ...closedDayLoggedOnly, workouts: [], onProgram: ON_PROGRAM['not-this-day'] },
      { ...closedDayLoggedOnly, workouts: [], onProgram: ON_PROGRAM.never },
      notOnAProgramThatDay,
    ];
    for (const plan of cases) {
      show(plan);
      expect(said(plan)).toBeNull();
      cleanup();
    }
  });
});
