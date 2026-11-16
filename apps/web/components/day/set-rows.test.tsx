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
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';

import { DAY_COPY, refusalCopy, TYPED_PROBLEM_COPY } from './day-copy';
import { card, isTick, lb, makeMount, press, status, workout } from './day-test-utils';
import { LOGGED_CARD_CLASS, TINT_CLASS } from './item-card';
import { formatRowValues } from './row-values';

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
    expect(headers(neck)).toEqual([DAY_COPY.set, DAY_COPY.previous, 'Sec', `✓${DAY_COPY.logged}`]);
    const plan = item(todayTwoPrograms, 'Morning habits', 'Neck bridge');
    expect(bodyRows(neck)).toHaveLength(plan.rows.length);
    // PREVIOUS: the same item and set number last time, per set.
    plan.rows.forEach((row, i) => {
      expect(bodyRows(neck)[i]!.textContent).toContain(formatRowValues(row.previous!));
    });
    expect(setField(neck, 'Neck bridge', 1, 'seconds').getAttribute('placeholder')).toBe('30');
  });

  it('a weight × reps set has a load and a reps field, in that order', () => {
    show(todayTwoPrograms);
    const press = card('Heavy B', 'Push press');
    expect(headers(press)).toEqual([
      DAY_COPY.set,
      DAY_COPY.previous,
      'lb',
      DAY_COPY.reps,
      `✓${DAY_COPY.logged}`,
    ]);
    expect(setField(press, 'Push press', 1, 'reps').getAttribute('inputmode')).toBe('numeric');
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
    fireEvent.change(setField(press_, 'Push press', 1, 'pounds'), { target: { value: '22.5' } });
    fireEvent.change(setField(press_, 'Push press', 1, 'reps'), { target: { value: '5' } });
    await press(setTick(press_, 'Push press', 1));
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({
      set: 1,
      values: { quantities: [lb(22.5)], reps: 5 },
    });
  });

  it('a bad number of reps is refused by the reps field, which takes focus', async () => {
    const control = mount(todayTwoPrograms);
    const pushUps = card('Morning habits', 'Push-ups');
    fireEvent.change(setField(pushUps, 'Push-ups', 1, 'reps'), { target: { value: '6.5' } });
    await press(setTick(pushUps, 'Push-ups', 1));
    expect(within(pushUps).getByText(TYPED_PROBLEM_COPY.not_a_number)).toBeTruthy();
    expect(document.activeElement).toBe(setField(pushUps, 'Push-ups', 1, 'reps'));
    expect(control.actions.logRow).not.toHaveBeenCalled();
  });

  it('"+ Add set" adds one empty row, focused; the button waits until it is ticked', async () => {
    const control = mount(todayTwoPrograms);
    const pushUps = () => card('Morning habits', 'Push-ups');
    const sets = item(todayTwoPrograms, 'Morning habits', 'Push-ups').rows.length;
    await press(within(pushUps()).getByRole('button', { name: DAY_COPY.addSet }));
    expect(bodyRows(pushUps())).toHaveLength(sets + 1);
    expect(document.activeElement).toBe(setField(pushUps(), 'Push-ups', sets + 1, 'reps'));
    expect(within(pushUps()).queryByRole('button', { name: DAY_COPY.addSet })).toBeNull();
    expect(status()).toBe(DAY_COPY.setAdded('Push-ups'));

    fireEvent.change(setField(pushUps(), 'Push-ups', sets + 1, 'reps'), {
      target: { value: '12' },
    });
    await press(setTick(pushUps(), 'Push-ups', sets + 1));
    expect(control.actions.logRow.mock.calls[0]![0]).toMatchObject({
      set: sets + 1,
      values: { reps: 12 },
    });
    expect(within(pushUps()).getByRole('button', { name: DAY_COPY.addSet })).toBeTruthy();
  });

  it('"+ Add set" numbers the new set past the highest shown, even with a gap', async () => {
    const gap = structuredClone(todayTwoPrograms);
    const pushUps = gap.workouts[0]!.items.find((i) => i.name === 'Push-ups')!;
    pushUps.rows = [pushUps.rows[0]!, { ...pushUps.rows[1]!, set: 5 }];
    const control = mount(gap);
    const el = () => card('Morning habits', 'Push-ups');
    await press(within(el()).getByRole('button', { name: DAY_COPY.addSet }));
    fireEvent.change(setField(el(), 'Push-ups', 6, 'reps'), { target: { value: '10' } });
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
      within(card('Morning habits', 'Push-ups')).queryByRole('button', { name: DAY_COPY.addSet }),
    ).toBeNull();
  });
});

describe('a day that cannot be written', () => {
  it('a closed day: what was logged, with no Previous column, field, ✓ or Add set (D33)', () => {
    show(closedDayLoggedOnly);
    const neck = card('Morning habits', 'Neck bridge');
    expect(headers(neck)).toEqual([DAY_COPY.set, 'Sec', `✓${DAY_COPY.logged}`]);
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
      expect(within(workout(w.name)).getByText(DAY_COPY.items(w.items.length))).toBeTruthy();
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
    expect(within(el).queryByRole('button', { name: DAY_COPY.addSet })).toBeNull();
    // Previous is for choosing what to log; a removed item cannot be logged again.
    expect(headers(el)).not.toContain(DAY_COPY.previous);
    expect(bodyRows(el)).toHaveLength(pull.rows.length);
    expect(setTick(el, 'Pull-up', 1).getAttribute('aria-pressed')).toBe('true');
  });
});
