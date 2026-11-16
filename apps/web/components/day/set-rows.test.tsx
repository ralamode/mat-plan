// @vitest-environment jsdom
import {
  MAX_SETS_PER_MOVEMENT,
  quantityText,
  ROW_REFUSAL,
  supersetLabels,
  type DayPlan,
} from '@mat-plan/shared';
import {
  closedDayLoggedOnly,
  futurePreview,
  heavyASupersets,
  todayTwoPrograms,
  yesterdayEditedAfterLogging,
  yesterdayHalfDone,
} from '@mat-plan/shared/program/fixtures';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';
import { itemCountText } from '@/lib/constants';

import { DAY_COPY, refusalCopy, TYPED_PROBLEM_COPY } from './day-copy';
import { card, isTick, lb, makeMount, press, status, workout } from './day-test-utils';
import { LOGGED_CARD_CLASS, TINT_CLASS } from './row-parts';
import { formatRowValues, unitSpoken, unitSuffix, valueParts } from './row-values';

const { mount, show } = makeMount(createFakeDayActions);

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

/** An item's set table, and its rows (header row first). */
const table = (el: HTMLElement) => within(el).getByRole('table');
const bodyRows = (el: HTMLElement) => within(table(el)).getAllByRole('row').slice(1);
const headers = (el: HTMLElement) =>
  within(table(el))
    .getAllByRole('columnheader')
    .map((h) => h.textContent);
/** The words a field's name ends with: the unit spoken, or "reps". */
const SPOKEN = { sec: unitSpoken('sec'), lb: unitSpoken('lb'), reps: DAY_COPY.reps.toLowerCase() };
const setTick = (el: HTMLElement, name: string, set: number) =>
  within(el).getByRole('button', { name: DAY_COPY.logLabel(DAY_COPY.setLabel(name, set)) });
const setField = (el: HTMLElement, name: string, set: number, spoken: string) =>
  within(el).getByRole<HTMLInputElement>('textbox', {
    name: DAY_COPY.fieldLabel(DAY_COPY.setLabel(name, set), spoken),
  });

function item(plan: DayPlan, workoutName: string, itemName: string) {
  const found = plan.workouts
    .find((w) => w.name === workoutName)
    ?.items.find((i) => i.name === itemName);
  if (!found) throw new Error(`no ${itemName} in ${workoutName}`);
  return found;
}

describe('set rows, PREVIOUS and Add set, per set', () => {
  it('a set item is a table: Set, Previous, a column per field, ✓; one row per set', () => {
    show(todayTwoPrograms);
    const neck = card('Morning habits', 'Neck bridge');
    expect(headers(neck)).toEqual([
      DAY_COPY.set,
      DAY_COPY.previous,
      DAY_COPY.secHeader,
      `✓${DAY_COPY.logged}`,
    ]);
    const plan = item(todayTwoPrograms, 'Morning habits', 'Neck bridge');
    expect(bodyRows(neck)).toHaveLength(plan.rows.length);
    // PREVIOUS: the same item and set number last time, per set.
    plan.rows.forEach((row, i) => {
      expect(bodyRows(neck)[i]!.textContent).toContain(formatRowValues(row.previous!));
    });
    expect(setField(neck, 'Neck bridge', 1, SPOKEN.sec).getAttribute('placeholder')).toBe('30');
  });

  it('a weight × reps set has a load and a reps field, in that order', () => {
    show(todayTwoPrograms);
    const press = card('Heavy B', 'Push press');
    expect(headers(press)).toEqual([
      DAY_COPY.set,
      DAY_COPY.previous,
      unitSuffix('lb'),
      DAY_COPY.reps,
      `✓${DAY_COPY.logged}`,
    ]);
    expect(setField(press, 'Push press', 1, SPOKEN.reps).getAttribute('inputmode')).toBe('numeric');
  });

  it('an empty ✓ on a set sends nothing typed and shows the prescription, for that set', async () => {
    const control = mount(todayTwoPrograms);
    const neck = card('Morning habits', 'Neck bridge');
    await press(setTick(neck, 'Neck bridge', 2));
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({
      set: 2,
      values: { quantities: [] },
    });
    // Previous (`30 s` last time), and now the logged number where the field was: bare, since the
    // column's header names the unit.
    expect(within(bodyRows(neck)[1]!).getByText(quantityText(30, 'sec'))).toBeTruthy();
    expect(within(bodyRows(neck)[1]!).getByText('30')).toBeTruthy();
    expect(within(bodyRows(neck)[1]!).queryByRole('textbox')).toBeNull();
    expect(setTick(neck, 'Neck bridge', 2).getAttribute('aria-pressed')).toBe('true');
  });

  it('a typed load and reps are both sent', async () => {
    const control = mount(todayTwoPrograms);
    const press_ = card('Heavy B', 'Push press');
    fireEvent.change(setField(press_, 'Push press', 1, SPOKEN.lb), { target: { value: '22.5' } });
    fireEvent.change(setField(press_, 'Push press', 1, SPOKEN.reps), { target: { value: '5' } });
    await press(setTick(press_, 'Push press', 1));
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({
      set: 1,
      values: { quantities: [lb(22.5)], reps: 5 },
    });
  });

  it('a bad number of reps is refused by the reps field, which takes focus', async () => {
    const control = mount(todayTwoPrograms);
    const pushUps = card('Morning habits', 'Push-ups');
    fireEvent.change(setField(pushUps, 'Push-ups', 1, SPOKEN.reps), { target: { value: '6.5' } });
    await press(setTick(pushUps, 'Push-ups', 1));
    expect(within(pushUps).getByText(TYPED_PROBLEM_COPY.not_a_number)).toBeTruthy();
    expect(document.activeElement).toBe(setField(pushUps, 'Push-ups', 1, SPOKEN.reps));
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });

  it('"+ Add set" adds one empty row, focused; the button waits until it is ticked', async () => {
    const control = mount(todayTwoPrograms);
    const pushUps = () => card('Morning habits', 'Push-ups');
    const sets = item(todayTwoPrograms, 'Morning habits', 'Push-ups').rows.length;
    await press(within(pushUps()).getByRole('button', { name: DAY_COPY.addSetTo('Push-ups') }));
    expect(bodyRows(pushUps())).toHaveLength(sets + 1);
    expect(document.activeElement).toBe(setField(pushUps(), 'Push-ups', sets + 1, SPOKEN.reps));
    expect(
      within(pushUps()).queryByRole('button', { name: DAY_COPY.addSetTo('Push-ups') }),
    ).toBeNull();
    expect(status()).toBe(DAY_COPY.setAdded('Push-ups'));

    fireEvent.change(setField(pushUps(), 'Push-ups', sets + 1, SPOKEN.reps), {
      target: { value: '12' },
    });
    await press(setTick(pushUps(), 'Push-ups', sets + 1));
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({
      set: sets + 1,
      values: { reps: 12 },
    });
    expect(
      within(pushUps()).getByRole('button', { name: DAY_COPY.addSetTo('Push-ups') }),
    ).toBeTruthy();
  });

  it('"+ Add set" numbers the new set past the highest shown, even with a gap', async () => {
    const gap = structuredClone(todayTwoPrograms);
    const pushUps = gap.workouts[0]!.items.find((i) => i.name === 'Push-ups')!;
    pushUps.rows = [pushUps.rows[0]!, { ...pushUps.rows[1]!, set: 5 }];
    // The answer is the test's: the preview's fake assumes rows without a gap (fakes.ts).
    const control = mount(gap, {
      wrap: () => ({
        logRow: async (input) => ({
          ok: true,
          entryPublicId: '00000000-0000-7000-8000-0000000000d6',
          values: { quantities: [], reps: input.values.reps },
        }),
      }),
    });
    const el = () => card('Morning habits', 'Push-ups');
    await press(within(el()).getByRole('button', { name: DAY_COPY.addSetTo('Push-ups') }));
    fireEvent.change(setField(el(), 'Push-ups', 6, SPOKEN.reps), { target: { value: '10' } });
    await press(setTick(el(), 'Push-ups', 6));
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({ set: 6 });
  });

  it('a fully logged set card drops its tint while a row shows a message', async () => {
    mount(yesterdayHalfDone, { failNext: true });
    const neck = () => card('Morning habits', 'Neck bridge');
    expect(neck().classList.contains(TINT_CLASS)).toBe(true);
    await press(setTick(neck(), 'Neck bridge', 1));
    expect(within(neck()).getByText(refusalCopy(ROW_REFUSAL.retry, 'untick').message)).toBeTruthy();
    expect(neck().classList.contains(LOGGED_CARD_CLASS)).toBe(true);
    expect(neck().classList.contains(TINT_CLASS)).toBe(false);
  });

  it('a refused reps number is marked and focused in the reps field, not the load', async () => {
    const control = mount(todayTwoPrograms);
    const el = card('Heavy B', 'Push press');
    fireEvent.change(setField(el, 'Push press', 1, SPOKEN.lb), { target: { value: '25' } });
    fireEvent.change(setField(el, 'Push press', 1, SPOKEN.reps), { target: { value: '6.5' } });
    await press(setTick(el, 'Push press', 1));
    expect(document.activeElement).toBe(setField(el, 'Push press', 1, SPOKEN.reps));
    expect(setField(el, 'Push press', 1, SPOKEN.reps).getAttribute('aria-invalid')).toBe('true');
    expect(setField(el, 'Push press', 1, SPOKEN.lb).getAttribute('aria-invalid')).toBeNull();
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });

  it('Enter on the load moves to the reps; Enter on the reps is the ✓', async () => {
    const control = mount(todayTwoPrograms);
    const el = card('Heavy B', 'Push press');
    const load = setField(el, 'Push press', 2, SPOKEN.lb);
    expect(load.getAttribute('enterkeyhint')).toBe('next');
    load.focus();
    fireEvent.keyDown(load, { key: 'Enter' });
    expect(document.activeElement).toBe(setField(el, 'Push press', 2, SPOKEN.reps));
    expect(control.actions.logRow).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(setField(el, 'Push press', 2, SPOKEN.reps), { key: 'Enter' });
    });
    expect(control.actions.logRow).toHaveBeenCalledTimes(1);
  });

  it('a set’s sentences name the set', async () => {
    mount(todayTwoPrograms);
    await press(setTick(card('Morning habits', 'Neck bridge'), 'Neck bridge', 2));
    expect(status()).toBe(DAY_COPY.announce.logged(DAY_COPY.setLabel('Neck bridge', 2)));
  });

  it('after an un-tick, both fields untouched re-tick; a cleared reps field logs anew', async () => {
    const control = mount(yesterdayHalfDone);
    const el = () => card('Heavy A', 'DB bench press');
    await press(setTick(el(), 'DB bench press', 1));
    await press(setTick(el(), 'DB bench press', 1));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
    expect(control.actions.logRow).not.toHaveBeenCalled();
    await press(setTick(el(), 'DB bench press', 1));
    fireEvent.change(setField(el(), 'DB bench press', 1, SPOKEN.reps), { target: { value: '' } });
    await press(setTick(el(), 'DB bench press', 1));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
    expect(control.actions.logRow).toHaveBeenCalledTimes(1);
  });

  it('an extra set un-ticked keeps its row for the visit, after the page drops it, and ticks back', async () => {
    const control = mount(yesterdayEditedAfterLogging);
    const el = () => card('Morning habits', 'Push-ups');
    const last = item(yesterdayEditedAfterLogging, 'Morning habits', 'Push-ups').rows.at(-1)!.set;
    await press(setTick(el(), 'Push-ups', last));
    // The page's data, as the contract has it: a writable day lists only the extra sets logged.
    const next = structuredClone(control.plan);
    const pushUps = item(next, 'Morning habits', 'Push-ups');
    pushUps.rows = pushUps.rows.filter((r) => r.set !== last);
    await act(async () => control.setPlan(next));
    expect(setTick(el(), 'Push-ups', last).getAttribute('aria-pressed')).toBe('false');
    expect(within(el()).queryByRole('button', { name: DAY_COPY.addSetTo('Push-ups') })).toBeNull();
    await press(setTick(el(), 'Push-ups', last));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
  });

  it('a set that arrives later (logged on another phone) also keeps its row once un-ticked', async () => {
    // The fake never saw that entry, so the un-tick is the test's: it succeeds, as the server's would.
    const control = mount(todayTwoPrograms, {
      wrap: () => ({
        untickRow: async (input) => ({
          ok: true,
          entryPublicId: input.entryPublicId,
          values: { quantities: [], reps: 12 },
          hiddenAt: '2026-11-16T12:00:00.000000Z',
        }),
      }),
    });
    const el = () => card('Morning habits', 'Push-ups');
    const before = item(todayTwoPrograms, 'Morning habits', 'Push-ups').rows.length;
    const extra = before + 1;
    const arrived = structuredClone(control.plan);
    item(arrived, 'Morning habits', 'Push-ups').rows.push({
      set: extra,
      previous: null,
      logged: {
        entryPublicId: '00000000-0000-7000-8000-0000000000e1',
        values: { quantities: [], reps: 12 },
        prescribedText: '3 × 15',
      },
    });
    await act(async () => control.setPlan(arrived));
    await press(setTick(el(), 'Push-ups', extra));
    const dropped = structuredClone(control.plan);
    const rows = item(dropped, 'Morning habits', 'Push-ups');
    rows.rows = rows.rows.filter((r) => r.set !== extra);
    await act(async () => control.setPlan(dropped));
    expect(control.actions.untickRow).toHaveBeenCalledTimes(1);
    expect(setTick(el(), 'Push-ups', extra).getAttribute('aria-pressed')).toBe('false');
    expect(within(el()).queryByText(DAY_COPY.reload)).toBeNull();
  });

  it('Previous is two unbreakable parts, with the line free to break only between them', () => {
    show(todayTwoPrograms);
    const row = bodyRows(card('Heavy B', 'Push press'))[0]!;
    const previous = item(todayTwoPrograms, 'Heavy B', 'Push press').rows[0]!.previous!;
    const parts = [...row.querySelectorAll('.whitespace-nowrap')].map((n) => n.textContent);
    expect(parts).toEqual(valueParts(previous));
    expect(parts).toHaveLength(2);
  });

  it('"+ Add set" is offered one below the set limit', () => {
    const almost = structuredClone(todayTwoPrograms);
    const pushUps = almost.workouts[0]!.items.find((i) => i.name === 'Push-ups')!;
    pushUps.rows = Array.from({ length: MAX_SETS_PER_MOVEMENT - 1 }, (_, i) => ({
      set: i + 1,
      previous: null,
      logged: null,
    }));
    show(almost);
    expect(
      within(card('Morning habits', 'Push-ups')).getByRole('button', {
        name: DAY_COPY.addSetTo('Push-ups'),
      }),
    ).toBeTruthy();
  });

  it('a set the program cut, never logged, goes on a re-read; a logged one stays', async () => {
    const control = mount(todayTwoPrograms);
    const el = () => card('Morning habits', 'Push-ups');
    await press(setTick(el(), 'Push-ups', 1));
    const cut = structuredClone(control.plan);
    const pushUps = item(cut, 'Morning habits', 'Push-ups');
    pushUps.rows = pushUps.rows.filter((r) => r.set === 1);
    await act(async () => control.setPlan(cut));
    expect(bodyRows(el())).toHaveLength(1);
  });

  it('the ✓ takes focus when tapped, though a phone does not focus a tapped button', async () => {
    mount(todayTwoPrograms);
    const el = card('Morning habits', 'Push-ups');
    const reps = setField(el, 'Push-ups', 1, SPOKEN.reps);
    reps.focus();
    await act(async () => {
      fireEvent.click(setTick(el, 'Push-ups', 1));
    });
    expect(document.activeElement).toBe(setTick(card('Morning habits', 'Push-ups'), 'Push-ups', 1));
  });

  it('a row added here does not linger on a day that turns read-only', async () => {
    mount(todayTwoPrograms, {
      wrap: () => ({ logRow: async () => ({ ok: false, reason: ROW_REFUSAL.closed_day }) }),
    });
    const el = () => card('Morning habits', 'Push-ups');
    const sets = bodyRows(el()).length;
    await press(within(el()).getByRole('button', { name: DAY_COPY.addSetTo('Push-ups') }));
    await press(setTick(el(), 'Push-ups', 1));
    expect(bodyRows(el())).toHaveLength(sets);
  });

  it('no "+ Add set" at the set limit', () => {
    const full = structuredClone(todayTwoPrograms);
    const pushUps = full.workouts[0]!.items.find((i) => i.name === 'Push-ups')!;
    pushUps.rows = Array.from({ length: MAX_SETS_PER_MOVEMENT }, (_, i) => ({
      set: i + 1,
      previous: null,
      logged: null,
    }));
    show(full);
    expect(
      within(card('Morning habits', 'Push-ups')).queryByRole('button', {
        name: DAY_COPY.addSetTo('Push-ups'),
      }),
    ).toBeNull();
  });
});

describe('a day that cannot be written', () => {
  it('a closed day: what was logged, with no Previous column, field, ✓ or Add set (D33)', () => {
    show(closedDayLoggedOnly);
    const neck = card('Morning habits', 'Neck bridge');
    expect(headers(neck)).toEqual([DAY_COPY.set, DAY_COPY.secHeader, `✓${DAY_COPY.logged}`]);
    expect(within(neck).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(neck).queryAllByRole('button')).toHaveLength(0);
    const logged = item(closedDayLoggedOnly, 'Morning habits', 'Neck bridge').rows;
    expect(bodyRows(neck)).toHaveLength(logged.length);
    expect(within(bodyRows(neck)[0]!).getByText(DAY_COPY.logged)).toBeTruthy();
  });

  it('yesterday, writable, keeps the Previous column', () => {
    show(yesterdayHalfDone);
    expect(headers(card('Heavy A', 'DB bench press'))).toContain(DAY_COPY.previous);
  });

  it('future-preview renders read-only cards: items, no rows, and the workout’s size', () => {
    show(futurePreview);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: isTick })).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    for (const w of futurePreview.workouts) {
      expect(within(workout(w.name)).getByText(itemCountText(w.items.length))).toBeTruthy();
    }
  });
});

describe('supersets', () => {
  it('heavy-a-supersets renders linked supersets with their rest', () => {
    show(heavyASupersets);
    const heavyA = heavyASupersets.workouts.find((w) => w.name === 'Heavy A')!;
    const section = workout('Heavy A');
    for (const [group, letter] of [
      ['a', 'A'],
      ['b', 'B'],
    ] as const) {
      const list = within(section).getByRole('list', { name: DAY_COPY.superset(letter) });
      const names = heavyA.items.filter((i) => i.superset?.group === group).map((i) => i.name);
      expect(
        within(list)
          .getAllByRole('heading', { level: 4 })
          .map((h) => h.textContent),
      ).toEqual(names.map((name, i) => `${letter}${i + 1} ${name}`));
      expect(within(section).getByText(DAY_COPY.rest(heavyA.restAfter[group]!))).toBeTruthy();
    }
  });

  it('superset letters are ordinal: group b reads A1, A2 when group a is gone', () => {
    show(yesterdayEditedAfterLogging);
    const heavyA = yesterdayEditedAfterLogging.workouts.find((w) => w.name === 'Heavy A')!;
    expect(heavyA.items.some((i) => i.superset?.group === 'a')).toBe(false);
    expect(supersetLabels(heavyA.items).filter(Boolean)).toEqual(['A1', 'A2']);
    const list = within(workout('Heavy A')).getByRole('list', { name: DAY_COPY.superset('A') });
    expect(
      within(list)
        .getAllByRole('heading', { level: 4 })
        .map((h) => h.textContent),
    ).toEqual(['A1 Goblet squat', 'A2 Sprawls']);
  });
});

describe('a superset after an item is added above it', () => {
  it('keeps what was typed in it: the group is not remounted', async () => {
    const control = mount(todayTwoPrograms);
    const el = () => card('Heavy B', 'Push press');
    fireEvent.change(setField(el(), 'Push press', 1, SPOKEN.lb), { target: { value: '33' } });
    const next = structuredClone(control.plan);
    const heavyB = next.workouts.find((w) => w.name === 'Heavy B')!;
    const extra = structuredClone(heavyB.items.find((i) => i.name === 'Split squat')!);
    extra.prescriptionPublicId = '00000000-0000-7000-8000-0000000000f1';
    extra.name = 'Warm-up squat';
    heavyB.items.unshift(extra);
    await act(async () => control.setPlan(next));
    expect(setField(el(), 'Push press', 1, SPOKEN.lb).value).toBe('33');
  });
});

describe('a superset with one item shown', () => {
  it('keeps its container, label and rest, as v12 does', () => {
    const one = structuredClone(todayTwoPrograms);
    const heavyB = one.workouts.find((w) => w.name === 'Heavy B')!;
    heavyB.items = heavyB.items.filter((i) => i.name !== 'Inverted row');
    show(one);
    const list = within(workout('Heavy B')).getByRole('list', { name: DAY_COPY.superset('A') });
    expect(within(list).getByRole('heading', { level: 4 }).textContent).toBe('A1 Push press');
    expect(within(workout('Heavy B')).getByText(DAY_COPY.rest(heavyB.restAfter.a!))).toBeTruthy();
  });
});

describe('after the program was edited (D7)', () => {
  const plan = yesterdayEditedAfterLogging;

  it('an edited prescription shows the live one, and says what the logged rows were against', () => {
    show(plan);
    const bench = item(plan, 'Heavy A', 'DB bench press');
    const against = bench.rows.find((r) => r.logged)!.logged!.prescribedText;
    expect(against).not.toBe(bench.prescribedText);
    const el = card('Heavy A', 'DB bench press');
    expect(within(el).getByText(bench.prescribedText)).toBeTruthy();
    expect(within(el).getByText(DAY_COPY.loggedAgainst(against))).toBeTruthy();
  });

  it('a set logged beyond a reduced count still shows as a row', () => {
    show(plan);
    const pushUps = item(plan, 'Morning habits', 'Push-ups');
    expect(pushUps.prescribedText).toBe('2 × 15');
    expect(bodyRows(card('Morning habits', 'Push-ups'))).toHaveLength(pushUps.rows.length);
    expect(pushUps.rows.length).toBeGreaterThan(2);
  });

  it('a removed item keeps its logged rows, with no fields, Previous or Add set, and ✓ to un-tick', () => {
    show(plan);
    const pull = item(plan, 'Heavy A', 'Pull-up');
    expect(pull.prescriptionPublicId).toBeNull();
    const el = card('Heavy A', 'Pull-up');
    expect(within(el).getByText(DAY_COPY.removed)).toBeTruthy();
    expect(within(el).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(el).queryByRole('button', { name: DAY_COPY.addSetTo('Pull-up') })).toBeNull();
    // Previous is for choosing what to log; a removed item cannot be logged again.
    expect(headers(el)).not.toContain(DAY_COPY.previous);
    expect(bodyRows(el)).toHaveLength(pull.rows.length);
    expect(setTick(el, 'Pull-up', 1).getAttribute('aria-pressed')).toBe('true');
  });

  it('a removed item’s set un-ticks to its kept numbers, and ticks back the same entry', async () => {
    const control = mount(plan);
    const el = () => card('Heavy A', 'Pull-up');
    const logged = item(plan, 'Heavy A', 'Pull-up').rows[0]!.logged!;
    await press(setTick(el(), 'Pull-up', 1));
    expect(setTick(el(), 'Pull-up', 1).getAttribute('aria-pressed')).toBe('false');
    expect(within(bodyRows(el())[0]!).getByText(String(logged.values.reps))).toBeTruthy();
    await press(setTick(el(), 'Pull-up', 1));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });

  it('🔴 an un-ticked load logged in another unit never goes back out in the item’s unit', async () => {
    const changed = structuredClone(yesterdayHalfDone);
    const bench = changed.workouts
      .find((w) => w.name === 'Heavy A')!
      .items.find((i) => i.name === 'DB bench press')!;
    bench.unit = 'kg';
    bench.target = { ...bench.target, quantities: [{ ...lb(30), unit: 'kg' }] };
    const control = mount(changed);
    const el = () => card('Heavy A', 'DB bench press');
    await press(setTick(el(), 'DB bench press', 1));
    // The field is in kg: the lb number is not put in it.
    expect(setField(el(), 'DB bench press', 1, unitSpoken('kg')).value).toBe('');
    fireEvent.change(setField(el(), 'DB bench press', 1, SPOKEN.reps), { target: { value: '7' } });
    await press(setTick(el(), 'DB bench press', 1));
    const sent = control.actions.logRow.mock.calls[0]![0].values;
    expect(sent.quantities).toEqual([]);
    expect(sent.reps).toBe(7);
  });

  it('🔴 an un-ticked number is cleared if the item’s unit changes after, and still re-ticks', async () => {
    const control = mount(yesterdayHalfDone);
    const el = () => card('Heavy A', 'DB bench press');
    await press(setTick(el(), 'DB bench press', 1));
    expect(setField(el(), 'DB bench press', 1, SPOKEN.lb).value).not.toBe('');
    const next = structuredClone(control.plan);
    item(next, 'Heavy A', 'DB bench press').unit = 'kg';
    await act(async () => control.setPlan(next));
    expect(setField(el(), 'DB bench press', 1, unitSpoken('kg')).value).toBe('');
    await press(setTick(el(), 'DB bench press', 1));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });

  it('a removed item whose every set is un-ticked keeps its card when the page drops it', async () => {
    const control = mount(plan);
    const el = () => card('Heavy A', 'Pull-up');
    const sets = item(plan, 'Heavy A', 'Pull-up').rows.map((r) => r.set);
    for (const set of sets) await press(setTick(el(), 'Pull-up', set));
    const next = structuredClone(control.plan);
    const heavyA = next.workouts.find((w) => w.name === 'Heavy A')!;
    heavyA.items = heavyA.items.filter((i) => i.name !== 'Pull-up');
    await act(async () => control.setPlan(next));
    expect(setTick(el(), 'Pull-up', sets[0]!).getAttribute('aria-pressed')).toBe('false');
    await press(setTick(el(), 'Pull-up', sets[0]!));
    expect(control.actions.retickRow).toHaveBeenCalledTimes(1);
  });

  it('a removed item dropped by the page while still logged here neither looks done nor pressed', async () => {
    const control = mount(plan);
    const next = structuredClone(control.plan);
    const heavyA = next.workouts.find((w) => w.name === 'Heavy A')!;
    heavyA.items = heavyA.items.filter((i) => i.name !== 'Pull-up');
    await act(async () => control.setPlan(next));
    const el = card('Heavy A', 'Pull-up');
    expect(el.classList.contains(LOGGED_CARD_CLASS)).toBe(false);
    expect(el.classList.contains(TINT_CLASS)).toBe(false);
    expect(setTick(el, 'Pull-up', 1).getAttribute('aria-pressed')).toBe('false');
  });

  it('a load logged in another unit than the item’s now keeps its unit (D7)', () => {
    const changed = structuredClone(yesterdayHalfDone);
    const bench = changed.workouts
      .find((w) => w.name === 'Heavy A')!
      .items.find((i) => i.name === 'DB bench press')!;
    bench.unit = 'kg';
    show(changed);
    const logged = bench.rows[0]!.logged!.values.quantities[0]!;
    expect(
      within(bodyRows(card('Heavy A', 'DB bench press'))[0]!).getByText(
        quantityText(logged.value, logged.unit),
      ),
    ).toBeTruthy();
  });
});
