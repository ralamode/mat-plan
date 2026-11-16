// @vitest-environment jsdom
import { ROW_REFUSAL, type DayPlan, type RowAmend, type RowResult } from '@mat-plan/shared';
import {
  closedDayLoggedOnly,
  yesterdayEditedAfterLogging,
  yesterdayHalfDone,
} from '@mat-plan/shared/program/fixtures';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';

import { DAY_COPY, refusalCopy } from './day-copy';
import { card, makeMount, press, status } from './day-test-utils';
import { CHANGED_FIELD_CLASS, LOGGED_FIELD_CLASS } from './row-parts';
import { unitSpoken } from './row-values';

/**
 * Change (FAM-1 step 13b-ii): a logged number edited in place, with the maintainer's guards
 * (2026-11-16) and the UX panel's findings (the ✓ in Safari's event order, a number not saved never
 * looking logged, a phone's Cancel, per-field keeping, Undo's baseline, the override that holds).
 */

const { mount } = makeMount(createFakeDayActions);

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.restoreAllMocks();
});

const SPOKEN = { lb: unitSpoken('lb'), min: unitSpoken('min'), reps: DAY_COPY.reps.toLowerCase() };
const HEAVY = 'Heavy A';
const BENCH = 'DB bench press';
const bench = () => card(HEAVY, BENCH);
const setLabel = (set: number) => DAY_COPY.setLabel(BENCH, set);
const benchField = (set: number, spoken: string) =>
  within(bench()).getByRole<HTMLInputElement>('textbox', {
    name: DAY_COPY.fieldLabel(setLabel(set), spoken),
  });
const load = (set = 1) => benchField(set, SPOKEN.lb);
const reps = (set = 1) => benchField(set, SPOKEN.reps);
const benchTick = (set = 1) =>
  within(bench()).getByRole('button', { name: DAY_COPY.logLabel(setLabel(set)) });
/** Set 1's table row: logged in the fixture. */
const loggedRow = () => within(bench()).getAllByRole('row')[1]!;
const button = (name: string) => within(bench()).getByRole('button', { name });

/** Types into a field the way a person does: focus, then the new text. */
function type(input: HTMLInputElement, text: string) {
  act(() => input.focus());
  fireEvent.change(input, { target: { value: text } });
}
/** Focus leaves the row for the page (a tap elsewhere): a blur with nowhere inside the row. */
async function leave(input: HTMLInputElement) {
  await act(async () => input.blur());
}
/** Safari's order for a tap on the ✓ during an edit: pointer-down, the field's blur, the click. */
async function safariTap(input: HTMLInputElement, tickButton: HTMLElement) {
  await act(async () => {
    fireEvent.pointerDown(tickButton);
    input.blur(); // Safari does not focus a tapped button, so the blur has no relatedTarget
  });
  await act(async () => {
    fireEvent.click(tickButton);
  });
}

const amendOk = (input: RowAmend): Promise<RowResult> =>
  Promise.resolve({ ok: true, entryPublicId: input.entryPublicId, values: input.values });

describe('Change: where it applies', () => {
  it('a logged set on a writable day is a green-edged field holding its number', () => {
    mount(yesterdayHalfDone, { change: true });
    expect(load().value).toBe('27.5');
    expect(reps().value).toBe('8');
    expect(load().className).toContain('border-done');
    for (const part of LOGGED_FIELD_CLASS.split(' ')) expect(load().classList).toContain(part);
    expect(benchTick().getAttribute('aria-pressed')).toBe('true');
  });

  it('without amendRow (step 13 routes) the logged number stays text', () => {
    mount(yesterdayHalfDone);
    expect(within(loggedRow()).queryAllByRole('textbox')).toHaveLength(0);
    expect(loggedRow().textContent).toContain('27.5');
  });

  it('a read-only day shows text, never a Change field', () => {
    mount(closedDayLoggedOnly, { change: true });
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('a removed item keeps its logged rows as text (the writer refuses a Change there)', () => {
    mount(yesterdayEditedAfterLogging, { change: true });
    const pullUp = card(HEAVY, 'Pull-up');
    expect(within(pullUp).queryAllByRole('textbox')).toHaveLength(0);
  });

  it('🔴 a set logged in another unit than the item is in stays text: no load in the wrong unit', () => {
    const kg: DayPlan = structuredClone(yesterdayHalfDone);
    const item = kg.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!;
    item.unit = 'kg';
    const { actions } = mount(kg, { change: true });
    const rowOne = loggedRow();
    expect(within(rowOne).queryAllByRole('textbox')).toHaveLength(0);
    expect(rowOne.textContent).toContain('27.5 lb');
    expect(actions.amendRow).not.toHaveBeenCalled();
  });
});

describe('Change: saving', () => {
  it('a new load, then leaving the row, sends one amend with the reps unchanged', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    await leave(load());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(actions.amendRow.mock.calls[0]![0].values).toMatchObject({
      reps: 8,
      quantities: [{ unit: 'lb', value: 30 }],
    });
    expect(load().value).toBe('30');
    expect(within(bench()).getByText(DAY_COPY.change.changed('27.5 lb', '30 lb'))).toBeTruthy();
    expect(button(DAY_COPY.change.undo)).toBeTruthy();
    expect(status()).toBe(
      DAY_COPY.announce.changed(
        setLabel(1),
        `27.5 ${SPOKEN.lb}, 8 reps`,
        `30 ${SPOKEN.lb}, 8 reps`,
      ),
    );
  });

  it('moving between the row’s own fields sends nothing; leaving it sends load and reps as one', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    act(() => reps().focus()); // within the row: no send
    expect(actions.amendRow).not.toHaveBeenCalled();
    fireEvent.change(reps(), { target: { value: '6' } });
    await leave(reps());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(actions.amendRow.mock.calls[0]![0].values).toMatchObject({
      reps: 6,
      quantities: [{ value: 30 }],
    });
    expect(
      within(bench()).getByText(DAY_COPY.change.changed('27.5 lb × 8', '30 lb × 6')),
    ).toBeTruthy();
  });

  it('Enter in the row’s last field saves and moves focus to the ✓', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(reps(), '10');
    await act(async () => {
      fireEvent.keyDown(reps(), { key: 'Enter' });
    });
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(benchTick());
  });

  it('a ✓ pressed from the keyboard while a number is changed saves it and never un-ticks', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    await press(benchTick());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(actions.untickRow).not.toHaveBeenCalled();
    expect(benchTick().getAttribute('aria-pressed')).toBe('true');
  });

  it('a ✓ on a row with nothing changed still un-ticks it', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    await press(benchTick());
    expect(actions.untickRow).toHaveBeenCalledTimes(1);
    expect(benchTick().getAttribute('aria-pressed')).toBe('false');
  });

  it('the window losing focus sends nothing: a half-typed number is not saved', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '3');
    // A window blur: the field is still the page's active element.
    await act(async () => {
      fireEvent.blur(load());
    });
    expect(actions.amendRow).not.toHaveBeenCalled();
    expect(load().value).toBe('3');
  });

  it('focus selects the whole number, so typing replaces it', () => {
    mount(yesterdayHalfDone, { change: true });
    act(() => load().focus());
    expect([load().selectionStart, load().selectionEnd]).toEqual([0, '27.5'.length]);
  });

  it('a single row (a Duration) changes the same way', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    const splits = card('Morning habits', 'Splits stretch');
    const minutes = within(splits).getByRole<HTMLInputElement>('textbox');
    expect(minutes.value).toBe('5');
    type(minutes, '6');
    await leave(minutes);
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(within(splits).getByText(DAY_COPY.change.changed('5 min', '6 min'))).toBeTruthy();
  });
});

describe('Change: the ✓ in Safari’s order (Safari does not focus a tapped button)', () => {
  it('🔴 a blanked field then a ✓ tap keeps the set logged', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(reps(), '');
    await safariTap(reps(), benchTick());
    expect(actions.untickRow).not.toHaveBeenCalled();
    expect(benchTick().getAttribute('aria-pressed')).toBe('true');
    expect(reps().value).toBe('8');
  });

  it('🔴 the same number retyped then a ✓ tap keeps the set logged', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(reps(), '8');
    await safariTap(reps(), benchTick());
    expect(actions.untickRow).not.toHaveBeenCalled();
    expect(benchTick().getAttribute('aria-pressed')).toBe('true');
  });

  it('🔴 a new number then a ✓ tap saves once and keeps the set logged', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(reps(), '10');
    await safariTap(reps(), benchTick());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(actions.untickRow).not.toHaveBeenCalled();
    expect(benchTick().getAttribute('aria-pressed')).toBe('true');
    expect(reps().value).toBe('10');
  });
});

describe('Change: a number that is not saved', () => {
  it('🔴 typed over, the field loses the logged look and the row says what is stored', () => {
    mount(yesterdayHalfDone, { change: true });
    type(load(), '35');
    for (const part of CHANGED_FIELD_CLASS.split(' ')) expect(load().classList).toContain(part);
    expect(load().classList).not.toContain('bg-done-surface');
    expect(within(bench()).getByText(DAY_COPY.change.notSaved('27.5 lb × 8'))).toBeTruthy();
    expect(button(DAY_COPY.change.cancel)).toBeTruthy();
  });

  it('Cancel (a phone’s Escape) puts the stored number back and moves focus to the ✓', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '35');
    await press(button(DAY_COPY.change.cancel));
    expect(load().value).toBe('27.5');
    expect(document.activeElement).toBe(benchTick());
    expect(actions.amendRow).not.toHaveBeenCalled();
    expect(within(bench()).queryByText(DAY_COPY.change.notSaved('27.5 lb × 8'))).toBeNull();
  });

  it('Escape puts the stored number back', () => {
    mount(yesterdayHalfDone, { change: true });
    type(load(), '35');
    fireEvent.keyDown(load(), { key: 'Escape' });
    expect(load().value).toBe('27.5');
  });

  it('a blank keeps the old number and says so, with nothing sent', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '');
    await leave(load());
    expect(actions.amendRow).not.toHaveBeenCalled();
    expect(load().value).toBe('27.5');
    expect(within(bench()).getByText(DAY_COPY.change.kept.missing('27.5 lb'))).toBeTruthy();
  });

  it('a non-number keeps its own field’s number while the other field is still sent', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    act(() => reps().focus());
    fireEvent.change(reps(), { target: { value: 'eight' } });
    await leave(reps());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(actions.amendRow.mock.calls[0]![0].values).toMatchObject({
      reps: 8,
      quantities: [{ value: 30 }],
    });
    expect(reps().value).toBe('8');
  });

  it('a failed save keeps what was typed, says what is stored, and counts as not saved', async () => {
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: async () => ({ ok: false, reason: ROW_REFUSAL.retry }) }),
    });
    type(load(), '30');
    await leave(load());
    expect(load().value).toBe('30');
    expect(load().getAttribute('aria-invalid')).toBeNull();
    expect(within(bench()).getByText(DAY_COPY.change.failed('27.5 lb × 8'))).toBeTruthy();
    expect(screen.getByText(DAY_COPY.notSaved(1))).toBeTruthy();
    expect(button(DAY_COPY.change.cancel)).toBeTruthy();
    // The ✓ is the retry.
    await press(benchTick());
    expect(actions.amendRow).toHaveBeenCalledTimes(2);
    expect(actions.untickRow).not.toHaveBeenCalled();
  });

  it('a rejected write is a failed save too', async () => {
    mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: () => Promise.reject(new Error('offline')) }),
    });
    type(load(), '30');
    await leave(load());
    expect(within(bench()).getByText(DAY_COPY.change.failed('27.5 lb × 8'))).toBeTruthy();
  });

  it('a refusal that means the page is stale puts the stored number back and offers Reload', async () => {
    mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: async () => ({ ok: false, reason: ROW_REFUSAL.bad_value }) }),
    });
    type(load(), '30');
    await leave(load());
    expect(load().value).toBe('27.5');
    expect(
      within(bench()).getByText(refusalCopy(ROW_REFUSAL.bad_value, 'amend').message),
    ).toBeTruthy();
    expect(button(DAY_COPY.reload)).toBeTruthy();
  });
});

describe('Change: Undo and what the row shows after', () => {
  it('Undo returns the number from before the first Change, never a typo in between', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '350');
    await leave(load());
    type(load(), '35');
    await leave(load());
    expect(within(bench()).getByText(DAY_COPY.change.changed('27.5 lb', '35 lb'))).toBeTruthy();
    await press(button(DAY_COPY.change.undo));
    expect(actions.amendRow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ quantities: [expect.objectContaining({ value: 27.5 })] }),
      }),
    );
    expect(load().value).toBe('27.5');
    expect(within(bench()).getByText(DAY_COPY.change.changedBack('27.5 lb × 8'))).toBeTruthy();
    expect(document.activeElement).toBe(benchTick());
  });

  it('a failed Undo says what is still stored', async () => {
    let calls = 0;
    mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({
        amendRow: async (input) =>
          ++calls === 1 ? amendOk(input) : { ok: false, reason: ROW_REFUSAL.retry },
      }),
    });
    type(load(), '35');
    await leave(load());
    await press(button(DAY_COPY.change.undo));
    expect(within(bench()).getByText(DAY_COPY.change.undoFailed('35 lb × 8'))).toBeTruthy();
  });

  it('a saved Change shows its number until the page’s data catches up', async () => {
    // The write succeeds but the page's data does not move (a refresh not back yet).
    mount(yesterdayHalfDone, { change: true, wrap: () => ({ amendRow: amendOk }) });
    type(load(), '30');
    await leave(load());
    expect(load().value).toBe('30');
    expect(within(bench()).getByText(DAY_COPY.change.changed('27.5 lb', '30 lb'))).toBeTruthy();
  });

  it('another phone’s Change retires the line and its Undo', async () => {
    const control = mount(yesterdayHalfDone, { change: true, wrap: () => ({ amendRow: amendOk }) });
    type(load(), '30');
    await leave(load());
    const next: DayPlan = structuredClone(control.plan);
    const row = next.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!
      .rows[0]!;
    row.logged!.values = {
      ...row.logged!.values,
      quantities: [{ ...row.logged!.values.quantities[0]!, value: 40 }],
    };
    act(() => control.setPlan(next));
    expect(load().value).toBe('40');
    expect(within(bench()).queryByRole('button', { name: DAY_COPY.change.undo })).toBeNull();
  });
});
