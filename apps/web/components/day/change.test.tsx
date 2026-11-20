// @vitest-environment jsdom
import { ROW_REFUSAL, type DayPlan, type RowAmend, type RowResult } from '@mat-plan/shared';
import {
  closedDayLoggedOnly,
  everyTypeOnce,
  yesterdayEditedAfterLogging,
  yesterdayHalfDone,
} from '@mat-plan/shared/program/fixtures';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDayActions } from '@/app/design/program/fakes';
import { AMEND_COPY } from '@/lib/constants';

import { DAY_COPY, refusalCopy } from './day-copy';
import { card, describedTexts, held, makeMount, press, status, openFolded } from './day-test-utils';
import { CHANGED_FIELD_CLASS, LOGGED_FIELD_CLASS } from './row-parts';
import { unitSpoken } from './row-values';

/**
 * Change (FAM-1 step 13b-ii): a logged number edited in place, with the maintainer's guards
 * (2026-11-16) and the UX panel's findings (the ✓ in Safari's event order, a number not saved never
 * looking logged, a phone's ✕, per-field keeping, Undo's baseline, the override that holds).
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
/** The row's ✕ (cancel), named for its row. */
const cancelX = (set = 1) => button(AMEND_COPY.cancelLabel(setLabel(set)));

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

/** An entry id for a row this test logs (the fixture's own are for its logged rows). */
const ENTRY_3 = '01930000-0000-7000-8000-0000000000e3';

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

  it('🔴 a set logged in another unit offers its reps only: the load stays text in its own unit (12d-iii)', async () => {
    const kg: DayPlan = structuredClone(yesterdayHalfDone);
    const item = kg.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!;
    item.unit = 'kg';
    const { actions } = mount(kg, { change: true });
    const rowOne = loggedRow();
    // One field, the reps; the load is text with its own unit, never a kg field.
    expect(within(rowOne).getAllByRole('textbox')).toEqual([reps()]);
    expect(rowOne.textContent).toContain('27.5 lb');
    // The note says why, once for the exercise under its heading, and asks for no conversion; every
    // logged set's ✓ and reps field point at it (#688 follow-up; maintainer, 2026-11-19).
    const said = DAY_COPY.otherUnit(unitSpoken('lb'), unitSpoken('kg'), {
      noun: DAY_COPY.otherUnitNoun.load,
      unticked: null,
    });
    expect(within(bench()).getAllByText(said)).toHaveLength(1);
    expect(describedTexts(benchTick())).toContain(said);
    expect(describedTexts(reps())).toContain(said);
    expect(describedTexts(benchTick(2))).toContain(said);
    // The load cell says the unit's word, not its code, to a screen reader (plan U2.5).
    const cell = within(rowOne).getByText(unitSpoken('lb'));
    expect(cell.className).toContain('sr-only');

    type(reps(), '6');
    await leave(reps());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    // The load goes back exactly as it was logged, in pounds.
    expect(actions.amendRow.mock.calls[0]![0].values).toEqual({
      quantities: [{ slot: 'primary', unit: 'lb', value: 27.5 }],
      reps: 6,
    });
    expect(within(bench()).getByText(DAY_COPY.change.changed('8', '6 reps'))).toBeTruthy();
    expect(loggedRow().textContent).toContain('27.5 lb');
  });

  it('a set logged in the item’s unit has no other-unit line', () => {
    mount(yesterdayHalfDone, { change: true });
    const said = DAY_COPY.otherUnit(unitSpoken('lb'), unitSpoken('kg'), {
      noun: DAY_COPY.otherUnitNoun.load,
      unticked: null,
    });
    expect(within(bench()).queryByText(said)).toBeNull();
    expect(describedTexts(benchTick())).not.toContain(said);
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

  it('a ✓ tapped while a number is changed saves it and never un-ticks', async () => {
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

  it('🔴 a keystroke right after focus is never selected over (iOS’s late select)', () => {
    vi.useFakeTimers();
    try {
      mount(yesterdayHalfDone, { change: true });
      act(() => load().focus());
      fireEvent.change(load(), { target: { value: '3' } });
      load().setSelectionRange(1, 1); // the caret after the "3", as typing leaves it
      act(() => vi.runAllTimers()); // the late select-all fires now
      expect([load().selectionStart, load().selectionEnd]).toEqual([1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a single row (a Duration) changes the same way', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    openFolded();
    const splits = card('Morning habits', 'Splits stretch');
    const minutes = within(splits).getByRole<HTMLInputElement>('textbox');
    expect(minutes.value).toBe('5');
    type(minutes, '6');
    await leave(minutes);
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(within(splits).getByText(DAY_COPY.change.changed('5 min', '6 min'))).toBeTruthy();
  });

  it('a single row’s ✕ is named for it and puts the number back, focus on its ✓', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    openFolded();
    const splits = card('Morning habits', 'Splits stretch');
    const minutes = within(splits).getByRole<HTMLInputElement>('textbox');
    type(minutes, '6');
    await press(
      within(splits).getByRole('button', { name: AMEND_COPY.cancelLabel('Splits stretch') }),
    );
    expect(minutes.value).toBe('5');
    expect(document.activeElement).toBe(
      within(splits).getByRole('button', { name: DAY_COPY.logLabel('Splits stretch') }),
    );
    expect(actions.amendRow).not.toHaveBeenCalled();
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
    type(reps(), '9'); // typed, then typed back: the row is not dirty, but an edit is open
    fireEvent.change(reps(), { target: { value: '8' } });
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
    // The reps still hold the stored number, so they keep the logged look.
    for (const part of LOGGED_FIELD_CLASS.split(' ')) expect(reps().classList).toContain(part);
    const line = within(bench()).getByText(DAY_COPY.change.notSaved('27.5 lb × 8'));
    // The ✕ is on the line under the row, beside what it would throw away.
    expect(line.parentElement?.contains(cancelX())).toBe(true);
    expect(cancelX().getAttribute('aria-describedby')).toBe(line.id);
  });

  it('the ✕ (a phone’s Escape) puts the stored number back and moves focus to the ✓', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '35');
    await press(cancelX());
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
    expect(cancelX()).toBeTruthy();
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
    expect(actions.amendRow.mock.lastCall![0]).toMatchObject({
      entryPublicId: actions.amendRow.mock.calls[0]![0].entryPublicId,
      values: { reps: 8, quantities: [{ unit: 'lb', value: 27.5 }] },
    });
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

describe('a ✓ after an un-tick that answers with the same entry (a writer that revives it)', () => {
  it('shows the new number while the page’s data still holds the old one', async () => {
    const splits = yesterdayHalfDone.workouts
      .find((w) => w.name === 'Morning habits')!
      .items.find((i) => i.name === 'Splits stretch')!;
    const id = splits.rows[0]!.logged!.entryPublicId;
    // The page's data never moves: it still shows the entry with 5 min, as a slow refresh would.
    mount(yesterdayHalfDone, {
      wrap: () => ({
        untickRow: async () => ({
          ok: true,
          entryPublicId: id,
          values: splits.rows[0]!.logged!.values,
          hiddenAt: '2026-11-13T18:00:00.000Z',
        }),
        logRow: async (input) => ({ ok: true, entryPublicId: id, values: input.values }),
      }),
    });
    openFolded();
    const el = () => card('Morning habits', 'Splits stretch');
    const tickButton = () =>
      within(el()).getByRole('button', { name: DAY_COPY.logLabel('Splits stretch') });
    await press(tickButton());
    const minutes = within(el()).getByRole<HTMLInputElement>('textbox');
    fireEvent.change(minutes, { target: { value: '6' } });
    await press(tickButton());
    expect(tickButton().getAttribute('aria-pressed')).toBe('true');
    expect(el().textContent).toContain('6 min');
    // (The heading's prescription also reads "5 min", so only the new number is asserted.)
  });
});

describe('an un-tick that the page’s data has caught up with (the same id may come back)', () => {
  const MORNING = 'Morning habits';
  const SPLITS = 'Splits stretch';
  const splitsOf = (plan: DayPlan) =>
    plan.workouts.find((w) => w.name === MORNING)!.items.find((i) => i.name === SPLITS)!;
  const original = splitsOf(yesterdayHalfDone).rows[0]!.logged!;
  /** The plan with Splits stretch logged again under its old entry id, at `minutes`. */
  function loggedAgain(plan: DayPlan, minutes: number): DayPlan {
    const next: DayPlan = structuredClone(plan);
    splitsOf(next).rows[0]!.logged = {
      ...original,
      values: { quantities: [{ ...original.values.quantities[0]!, value: minutes }] },
    };
    return next;
  }
  const el = () => card(MORNING, SPLITS);
  const tickButton = () => within(el()).getByRole('button', { name: DAY_COPY.logLabel(SPLITS) });

  it('another phone’s ✓ after this one’s un-tick shows the set logged', async () => {
    const control = mount(yesterdayHalfDone);
    openFolded();
    await press(tickButton());
    expect(tickButton().getAttribute('aria-pressed')).toBe('false');
    expect(splitsOf(control.plan).rows[0]!.logged).toBeNull(); // the data has caught up
    act(() => control.setPlan(loggedAgain(control.plan, 7)));
    expect(tickButton().getAttribute('aria-pressed')).toBe('true');
    expect(el().textContent).toContain('7 min');
  });

  it('a ✓ whose answer was lost shows logged once the data has it, and stops counting', async () => {
    const box: { control?: ReturnType<typeof mount> } = {};
    box.control = mount(yesterdayHalfDone, {
      wrap: (a) => ({
        logRow: async () => {
          // The write lands (the data will show it), but the answer never arrives.
          const control = box.control!;
          setTimeout(() => act(() => control.setPlan(loggedAgain(control.plan, 6))));
          throw new Error('connection dropped');
        },
        untickRow: a.untickRow,
      }),
    });
    openFolded();
    await press(tickButton());
    const minutes = within(el()).getByRole<HTMLInputElement>('textbox');
    fireEvent.change(minutes, { target: { value: '6' } });
    await press(tickButton());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tickButton().getAttribute('aria-pressed')).toBe('true');
    expect(el().textContent).toContain('6 min');
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
  });
});

describe('Change: the ✓ and ✕ in a browser’s order', () => {
  it('🔴 an unlogged set: a number typed, then the ✓ tapped, logs it on the first tap', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    const field3 = within(bench()).getByRole<HTMLInputElement>('textbox', {
      name: DAY_COPY.fieldLabel(setLabel(3), SPOKEN.lb),
    });
    type(field3, '30');
    fireEvent.pointerDown(benchTick(3));
    await press(benchTick(3));
    expect(actions.logRow).toHaveBeenCalledTimes(1);
  });
  it('🔴 the ✕ tapped in Safari’s order sends nothing', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '35');
    await safariTap(load(), cancelX());
    expect(actions.amendRow).not.toHaveBeenCalled();
    expect(load().value).toBe('27.5');
  });
});

describe('Change: review fixes', () => {
  it('a keyboard press on the ✓ reads the row as it is, whatever a pointer noted', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(reps(), '9');
    fireEvent.change(reps(), { target: { value: '8' } }); // typed back: an edit, nothing dirty
    fireEvent.pointerDown(benchTick()); // a press that never became a click
    await act(async () => {
      benchTick().focus();
      fireEvent.keyDown(benchTick(), { key: ' ' });
      fireEvent.click(benchTick());
    });
    expect(actions.untickRow).toHaveBeenCalledTimes(1);
  });

  it('a ✓ tapped while a Change is in flight neither un-ticks nor sends twice', async () => {
    const gate = held();
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: (a) => ({ amendRow: (input) => gate.after(() => a.amendRow(input)) }),
    });
    type(load(), '30');
    await leave(load());
    await act(async () => {
      fireEvent.pointerDown(benchTick());
      fireEvent.click(benchTick());
    });
    await gate.resolve();
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(actions.untickRow).not.toHaveBeenCalled();
    expect(load().value).toBe('30');
  });

  it('a failed save offers Try again, which sends it again', async () => {
    let calls = 0;
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({
        amendRow: async (input) =>
          ++calls === 1 ? { ok: false, reason: ROW_REFUSAL.retry } : amendOk(input),
      }),
    });
    type(load(), '30');
    await leave(load());
    await press(button(DAY_COPY.change.retry));
    expect(actions.amendRow).toHaveBeenCalledTimes(2);
    expect(within(bench()).getByText(DAY_COPY.change.changed('27.5 lb', '30 lb'))).toBeTruthy();
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
  });

  it('typing the stored number back after a failed save clears the failure', async () => {
    mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: async () => ({ ok: false, reason: ROW_REFUSAL.retry }) }),
    });
    type(load(), '30');
    await leave(load());
    expect(screen.getByText(DAY_COPY.notSaved(1))).toBeTruthy();
    type(load(), '27.5');
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
    expect(within(bench()).queryByText(DAY_COPY.change.failed('27.5 lb × 8'))).toBeNull();
  });

  it('a failed Undo keeps Undo to try again, and is not counted as not saved', async () => {
    let calls = 0;
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({
        amendRow: async (input) =>
          ++calls === 2 ? { ok: false, reason: ROW_REFUSAL.retry } : amendOk(input),
      }),
    });
    type(load(), '35');
    await leave(load());
    await press(button(DAY_COPY.change.undo));
    expect(within(bench()).getByText(DAY_COPY.change.undoFailed('35 lb × 8'))).toBeTruthy();
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
    await press(button(DAY_COPY.change.undo));
    expect(actions.amendRow).toHaveBeenCalledTimes(3);
    expect(load().value).toBe('27.5');
  });

  it('a kept field is said beside the Change that did save', async () => {
    mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    act(() => reps().focus());
    fireEvent.change(reps(), { target: { value: 'eight' } });
    await leave(reps());
    expect(
      within(bench()).getByText(
        `${DAY_COPY.change.changed('27.5 lb', '30 lb')}. ${DAY_COPY.change.kept.not_a_number('8 reps')}`,
      ),
    ).toBeTruthy();
  });

  it('a kept line goes once the field is typed in again', async () => {
    mount(yesterdayHalfDone, { change: true });
    const over = '5000';
    type(load(), over);
    await leave(load());
    const kept = DAY_COPY.change.kept.out_of_range('27.5 lb', over);
    expect(within(bench()).getByText(kept)).toBeTruthy();
    // Typed back to the stored number, so the row is not dirty: only the clear can hide the line.
    type(load(), '2');
    fireEvent.change(load(), { target: { value: '27.5' } });
    expect(within(bench()).queryByText(kept)).toBeNull();
  });

  it('another phone’s Change also retires Undo’s baseline: the next Change starts from its number', async () => {
    const control = mount(yesterdayHalfDone, { change: true, wrap: () => ({ amendRow: amendOk }) });
    type(load(), '30');
    await leave(load());
    const next: DayPlan = structuredClone(control.plan);
    const logged = next.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!
      .rows[0]!.logged!;
    logged.values = {
      ...logged.values,
      quantities: [{ ...logged.values.quantities[0]!, value: 40 }],
    };
    act(() => control.setPlan(next));
    type(load(), '45');
    await leave(load());
    expect(within(bench()).getByText(DAY_COPY.change.changed('40 lb', '45 lb'))).toBeTruthy();
  });

  it('only the fields typed in are sent as typed: another phone’s reps are not sent back', async () => {
    const control = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    const next: DayPlan = structuredClone(control.plan);
    next.workouts
      .find((w) => w.name === HEAVY)!
      .items.find((i) => i.name === BENCH)!.rows[0]!.logged!.values.reps = 10;
    act(() => control.setPlan(next));
    await leave(load());
    expect(control.actions.amendRow.mock.lastCall![0].values).toMatchObject({
      reps: 10,
      quantities: [{ value: 30 }],
    });
  });

  it('a Change refused because the day closed turns the page read-only', async () => {
    mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: async () => ({ ok: false, reason: ROW_REFUSAL.closed_day }) }),
    });
    type(load(), '30');
    await leave(load());
    expect(screen.getByText(DAY_COPY.closed)).toBeTruthy();
    expect(within(bench()).queryAllByRole('textbox')).toHaveLength(0);
  });

  it('the ✕ is announced', async () => {
    mount(yesterdayHalfDone, { change: true });
    type(load(), '35');
    await press(cancelX());
    expect(status()).toBe(DAY_COPY.announce.cancelled(setLabel(1)));
  });
});

describe('Change: second-pass fixes', () => {
  it('a Change whose write lands but whose answer is lost stops counting once the data has it', async () => {
    mount(yesterdayHalfDone, {
      change: true,
      wrap: (a) => ({
        amendRow: async (input) => {
          await a.amendRow(input);
          throw new Error('connection dropped');
        },
      }),
    });
    type(load(), '30');
    await leave(load());
    expect(load().value).toBe('30');
    expect(screen.queryByText(DAY_COPY.notSaved(1))).toBeNull();
    expect(within(bench()).queryByText(DAY_COPY.change.failed('27.5 lb × 8'))).toBeNull();
  });

  it('a logged field only focused, then the ✓ tapped in Safari’s order, un-ticks on that tap', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    act(() => load().focus());
    await safariTap(load(), benchTick());
    expect(actions.untickRow).toHaveBeenCalledTimes(1);
  });

  it('Escape while a Change is in flight cancels nothing and says nothing', async () => {
    const gate = held();
    mount(yesterdayHalfDone, {
      change: true,
      wrap: (a) => ({ amendRow: (input) => gate.after(() => a.amendRow(input)) }),
    });
    type(load(), '30');
    await leave(load()); // sent, and held in flight
    expect(load().readOnly).toBe(true); // the Change is in flight
    fireEvent.keyDown(load(), { key: 'Escape' });
    expect(status()).not.toBe(DAY_COPY.announce.cancelled(setLabel(1)));
    await gate.resolve();
    expect(load().value).toBe('30');
  });

  it('while a Change is in flight the ✕ stays mounted, does nothing, and leaves focus alone', async () => {
    const gate = held();
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: (a) => ({ amendRow: (input) => gate.after(() => a.amendRow(input)) }),
    });
    type(load(), '30');
    await leave(load()); // sent, and held in flight
    // Still mounted, so the line does not move (the shared component hides it: its own test).
    await press(cancelX());
    // A ✕ that did nothing does not move focus to the ✓ either.
    expect(document.activeElement).not.toBe(benchTick());
    expect(status()).not.toBe(DAY_COPY.announce.cancelled(setLabel(1)));
    await gate.resolve();
    // The save landed: one write, and the line says what changed (a cancel would have no line).
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    expect(within(bench()).getByText(DAY_COPY.change.changed('27.5 lb', '30 lb'))).toBeTruthy();
  });

  it('a ✓ then a Change before the data caught up still shows another phone’s later number', async () => {
    const control = mount(yesterdayHalfDone, {
      change: true,
      wrap: (a) => ({
        // The server fills the prescription's reps in, as the real writer does (D13).
        logRow: async (input) => ({
          ok: true,
          entryPublicId: ENTRY_3,
          values: { ...input.values, reps: input.values.reps ?? 8 },
        }),
        amendRow: amendOk,
        untickRow: a.untickRow,
      }),
    });
    const set3 = () =>
      within(bench()).getByRole<HTMLInputElement>('textbox', {
        name: DAY_COPY.fieldLabel(setLabel(3), SPOKEN.lb),
      });
    type(set3(), '30');
    await press(benchTick(3));
    type(set3(), '35');
    await leave(set3());
    const withSet3 = (value: number): DayPlan => {
      const next: DayPlan = structuredClone(control.plan);
      const row = next.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!
        .rows[2]!;
      row.logged = {
        ...yesterdayHalfDone.workouts
          .find((w) => w.name === HEAVY)!
          .items.find((i) => i.name === BENCH)!.rows[0]!.logged!,
        entryPublicId: ENTRY_3,
        values: { reps: 8, quantities: [{ slot: 'primary', unit: 'lb', value }] },
      };
      return next;
    };
    act(() => control.setPlan(withSet3(30))); // a refresh from before the Change
    expect(set3().value).toBe('35');
    act(() => control.setPlan(withSet3(40))); // another phone
    expect(set3().value).toBe('40');
  });

  it('a ✓ then an un-tick before the data has the ✓: its late refresh keeps the set un-ticked', async () => {
    const splits = yesterdayHalfDone.workouts
      .find((w) => w.name === 'Morning habits')!
      .items.find((i) => i.name === 'Splits stretch')!;
    const empty: DayPlan = structuredClone(yesterdayHalfDone);
    empty.workouts
      .find((w) => w.name === 'Morning habits')!
      .items.find((i) => i.name === 'Splits stretch')!.rows[0]!.logged = null;
    const control = mount(empty, {
      wrap: () => ({
        logRow: async (input) => ({ ok: true, entryPublicId: ENTRY_3, values: input.values }),
        untickRow: async () => ({
          ok: true,
          entryPublicId: ENTRY_3,
          values: splits.rows[0]!.logged!.values,
          hiddenAt: '2026-11-13T18:00:00.000Z',
        }),
      }),
    });
    openFolded();
    const el = () => card('Morning habits', 'Splits stretch');
    const tickButton = () =>
      within(el()).getByRole('button', { name: DAY_COPY.logLabel('Splits stretch') });
    await press(tickButton()); // ✓ (the data has not caught up)
    await press(tickButton()); // un-tick the mis-tap
    const late: DayPlan = structuredClone(control.plan);
    late.workouts
      .find((w) => w.name === 'Morning habits')!
      .items.find((i) => i.name === 'Splits stretch')!.rows[0]!.logged = {
      ...splits.rows[0]!.logged!,
      entryPublicId: ENTRY_3,
    };
    act(() => control.setPlan(late)); // the ✓'s refresh, arriving late
    expect(tickButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('a ✕ press that turned into a scroll does not stop the next save', async () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    // The touch starts on the ✕ and becomes a scroll: the browser calls the press off, and the
    // field keeps focus throughout.
    fireEvent.pointerDown(cancelX());
    fireEvent.pointerCancel(cancelX());
    await leave(load()); // a tap elsewhere: this blur must send
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
  });

  it('a ✓ then a Change before the data had it, then another phone’s un-tick, shows the set empty', async () => {
    const control = mount(yesterdayHalfDone, {
      change: true,
      wrap: (a) => ({
        logRow: async (input) => ({
          ok: true,
          entryPublicId: ENTRY_3,
          values: { ...input.values, reps: input.values.reps ?? 8 },
        }),
        amendRow: amendOk,
        untickRow: a.untickRow,
      }),
    });
    const set3 = () =>
      within(bench()).getByRole<HTMLInputElement>('textbox', {
        name: DAY_COPY.fieldLabel(setLabel(3), SPOKEN.lb),
      });
    type(set3(), '30');
    await press(benchTick(3));
    type(set3(), '35');
    await leave(set3());
    const withSet3 = (value: number | null): DayPlan => {
      const next: DayPlan = structuredClone(control.plan);
      const benchRows = next.workouts
        .find((w) => w.name === HEAVY)!
        .items.find((i) => i.name === BENCH)!.rows;
      benchRows[2]!.logged =
        value === null
          ? null
          : {
              ...yesterdayHalfDone.workouts
                .find((w) => w.name === HEAVY)!
                .items.find((i) => i.name === BENCH)!.rows[0]!.logged!,
              entryPublicId: ENTRY_3,
              values: { reps: 8, quantities: [{ slot: 'primary', unit: 'lb', value }] },
            };
      return next;
    };
    act(() => control.setPlan(withSet3(30))); // the ✓'s refresh, from before the Change
    act(() => control.setPlan(withSet3(null))); // another phone un-ticked it
    expect(benchTick(3).getAttribute('aria-pressed')).toBe('false');
  });

  it('a ✓ then two Changes before the data had any: the ✓’s late refresh is not another phone', async () => {
    const control = mount(yesterdayHalfDone, {
      change: true,
      wrap: (a) => ({
        logRow: async (input) => ({
          ok: true,
          entryPublicId: ENTRY_3,
          values: { ...input.values, reps: input.values.reps ?? 8 },
        }),
        amendRow: amendOk,
        untickRow: a.untickRow,
      }),
    });
    const set3 = () =>
      within(bench()).getByRole<HTMLInputElement>('textbox', {
        name: DAY_COPY.fieldLabel(setLabel(3), SPOKEN.lb),
      });
    type(set3(), '30');
    await press(benchTick(3));
    type(set3(), '35');
    await leave(set3());
    type(set3(), '40');
    await leave(set3());
    const late: DayPlan = structuredClone(control.plan);
    late.workouts
      .find((w) => w.name === HEAVY)!
      .items.find((i) => i.name === BENCH)!.rows[2]!.logged = {
      ...yesterdayHalfDone.workouts
        .find((w) => w.name === HEAVY)!
        .items.find((i) => i.name === BENCH)!.rows[0]!.logged!,
      entryPublicId: ENTRY_3,
      values: { reps: 8, quantities: [{ slot: 'primary', unit: 'lb', value: 30 }] },
    };
    act(() => control.setPlan(late)); // the ✓'s refresh, from before both Changes
    expect(set3().value).toBe('40');
  });
});

describe('Change: Escape from any control, and a ✕ press that ends elsewhere', () => {
  /** Past the grace in which the ✕'s click may still come (`CANCEL_CLICK_GRACE_MS`). */
  const afterGrace = async () => {
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Escape from the ✓ while typed over puts the number back, and focus stays on the ✓', () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    act(() => benchTick().focus());
    fireEvent.keyDown(benchTick(), { key: 'Escape' });
    expect(load().value).toBe('27.5');
    expect(document.activeElement).toBe(benchTick());
    expect(actions.amendRow).not.toHaveBeenCalled();
  });

  it('Escape from the ✕ puts the number back, and focus moves to the ✓ before the ✕ goes', () => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    act(() => cancelX().focus());
    fireEvent.keyDown(cancelX(), { key: 'Escape' });
    expect(load().value).toBe('27.5');
    expect(document.activeElement).toBe(benchTick());
    expect(actions.amendRow).not.toHaveBeenCalled();
  });

  it('Escape on a row that is not being changed is left alone', () => {
    mount(yesterdayHalfDone, { change: true });
    act(() => benchTick().focus());
    // `fireEvent` answers false when the event was prevented.
    expect(fireEvent.keyDown(benchTick(), { key: 'Escape' })).toBe(true);
  });

  it.each([
    ['the ✓', () => benchTick()],
    ['the ✕', () => cancelX()],
  ])('the window losing focus from %s sends nothing', async (_label, control) => {
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    act(() => control().focus());
    // A window blur: the control is still the page's active element.
    await act(async () => {
      fireEvent.blur(control());
    });
    expect(actions.amendRow).not.toHaveBeenCalled();
  });

  it('leaving the row from the ✓ sends the Change once', async () => {
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: amendOk }),
    });
    type(load(), '30');
    act(() => benchTick().focus());
    await act(async () => benchTick().blur());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
  });

  it('🔴 a tap on the ✕ in an iPhone’s order cancels, even when the finger lifts past its edge', async () => {
    // iOS: pointerdown, pointerup (where the finger lifts says nothing: iOS targets the click itself),
    // the compat mousedown's blur of the field, then the click on the ✕.
    const { actions } = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    const x = cancelX();
    // The finger lifts past the ✕'s edge. jsdom has no layout, so the point is placed by hand: a
    // rule that read the release point would take this for "elsewhere" (the bug this pins).
    const restore = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => document.body,
    });
    await act(async () => {
      fireEvent.pointerDown(x, { pointerId: 1 });
      fireEvent.pointerUp(document.body, { pointerId: 1 });
      load().blur();
    });
    if (restore) Object.defineProperty(document, 'elementFromPoint', restore);
    else Reflect.deleteProperty(document, 'elementFromPoint');
    await act(async () => {
      fireEvent.click(x);
    });
    await afterGrace();
    expect(load().value).toBe('27.5');
    expect(actions.amendRow).not.toHaveBeenCalled();
  });

  it('a ✕ press dragged off with a mouse in Safari (the field already blurred) is sent after the grace', async () => {
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: amendOk }),
    });
    type(load(), '30');
    await act(async () => {
      fireEvent.pointerDown(cancelX(), { pointerId: 1 });
      load().blur(); // Safari blurs the field at pointer-down and does not focus the ✕
      fireEvent.pointerUp(document.body, { pointerId: 1 });
    });
    expect(actions.amendRow).not.toHaveBeenCalled(); // the click may still come
    await afterGrace();
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    // A later, unrelated release sends nothing more: the watch was one-shot.
    await act(async () => {
      fireEvent.pointerUp(document.body, { pointerId: 1 });
    });
    await afterGrace();
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
  });

  it('an iPhone slide-off (the field still focused) is called off, and leaving the row then sends once', async () => {
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: amendOk }),
    });
    type(load(), '30');
    await act(async () => {
      fireEvent.pointerDown(cancelX(), { pointerId: 1 });
      fireEvent.pointerUp(cancelX(), { pointerId: 1 }); // captured to the ✕; no click follows
    });
    await afterGrace();
    expect(actions.amendRow).not.toHaveBeenCalled();
    expect(load().value).toBe('30');
    await leave(load());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
  });

  it('a ✕ press that becomes a scroll, with focus already out of the row, sends at once', async () => {
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: amendOk }),
    });
    type(load(), '30');
    await act(async () => {
      fireEvent.pointerDown(cancelX(), { pointerId: 1 });
      load().blur();
      fireEvent.pointerCancel(cancelX(), { pointerId: 1 });
    });
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
  });

  it('Chrome: a ✕ press released elsewhere with focus on the ✕ keeps the row open, then leaving it sends once', async () => {
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({ amendRow: amendOk }),
    });
    type(load(), '30');
    const x = cancelX();
    await act(async () => {
      fireEvent.pointerDown(x, { pointerId: 1 });
      x.focus(); // Chrome focuses a button on mousedown
      fireEvent.pointerUp(document.body, { pointerId: 1 });
    });
    await afterGrace();
    expect(actions.amendRow).not.toHaveBeenCalled();
    expect(load().value).toBe('30');
    await act(async () => x.blur());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
  });

  it('a failed save, then leaving the row from the ✓, sends exactly once more', async () => {
    let calls = 0;
    const { actions } = mount(yesterdayHalfDone, {
      change: true,
      wrap: () => ({
        amendRow: async (input) =>
          (calls += 1) === 1 ? { ok: false, reason: ROW_REFUSAL.retry } : amendOk(input),
      }),
    });
    type(load(), '30');
    await leave(load());
    expect(actions.amendRow).toHaveBeenCalledTimes(1);
    act(() => benchTick().focus());
    await act(async () => benchTick().blur());
    expect(actions.amendRow).toHaveBeenCalledTimes(2);
  });
});

describe('Change: a row logged in another unit (12d-iii)', () => {
  /** `yesterdayHalfDone` with the bench now in kg: its logged sets are in lb. */
  function inKg(from: DayPlan = yesterdayHalfDone): DayPlan {
    const kg: DayPlan = structuredClone(from);
    kg.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!.unit = 'kg';
    return kg;
  }

  it('the line stays while an un-tick is in flight: nothing below the row moves', async () => {
    const gate = held();
    mount(inKg(), {
      change: true,
      wrap: (a) => ({ untickRow: (input) => gate.after(() => a.untickRow(input)) }),
    });
    const before = within(bench()).getAllByText(/before the workout changed/).length;
    await act(async () => {
      fireEvent.click(benchTick());
    });
    expect(within(bench()).getAllByText(/before the workout changed/)).toHaveLength(before);
    expect(describedTexts(benchTick()).some((t) => t.includes('before the workout changed'))).toBe(
      true,
    );
    await gate.resolve();
  });

  it('a load typed before the unit changed is dropped: no field, no "not saved", nothing sent', async () => {
    const control = mount(yesterdayHalfDone, { change: true });
    type(load(), '30');
    await act(async () => control.setPlan(inKg(control.plan)));
    expect(within(loggedRow()).getAllByRole('textbox')).toEqual([reps()]);
    expect(within(bench()).queryByText(DAY_COPY.change.notSaved('27.5 lb × 8'))).toBeNull();
    await leave(reps());
    expect(control.actions.amendRow).not.toHaveBeenCalled();
  });

  it('Undo after a reps-only Change sends the row back as logged, in lb', async () => {
    const { actions } = mount(inKg(), { change: true });
    type(reps(), '6');
    await leave(reps());
    await press(button(DAY_COPY.change.undo));
    expect(actions.amendRow).toHaveBeenCalledTimes(2);
    expect(actions.amendRow.mock.calls[1]![0].values).toEqual({
      quantities: [{ slot: 'primary', unit: 'lb', value: 27.5 }],
      reps: 8,
    });
  });

  it('a count logged in another unit shows the line on its card and stays text', () => {
    const plan: DayPlan = structuredClone(everyTypeOnce);
    const vest = plan.workouts[0]!.items.find((i) => i.name === 'Vest weight')!;
    vest.unit = 'kg';
    vest.rows[0]!.logged = {
      entryPublicId: ENTRY_3,
      values: { quantities: [{ slot: 'primary', unit: 'lb', value: 10 }] },
      prescribedText: vest.rows[0]!.logged?.prescribedText ?? '10 lb',
    };
    mount(plan, { change: true });
    const item = card(plan.workouts[0]!.name, 'Vest weight');
    const said = DAY_COPY.otherUnit(unitSpoken('lb'), unitSpoken('kg'), {
      noun: DAY_COPY.otherUnitNoun.number,
      unticked: null,
    });
    expect(within(item).getByText(said)).toBeTruthy();
    expect(within(item).queryAllByRole('textbox')).toHaveLength(0);
    const tick = within(item).getByRole('button', { name: DAY_COPY.logLabel('Vest weight') });
    expect(describedTexts(tick)).toContain(said);
  });
});

describe('the other-unit note, once per exercise (#688 follow-up)', () => {
  /** `yesterdayHalfDone` with the bench in kg, and only the given sets still logged (in lb). */
  function inKg(keep: readonly number[] = []): DayPlan {
    const kg: DayPlan = structuredClone(yesterdayHalfDone);
    const item = kg.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!;
    item.unit = 'kg';
    if (keep.length) for (const row of item.rows) if (!keep.includes(row.set)) row.logged = null;
    return kg;
  }
  const said = () =>
    DAY_COPY.otherUnit(unitSpoken('lb'), unitSpoken('kg'), {
      noun: DAY_COPY.otherUnitNoun.load,
      unticked: null,
    });
  /** Every description in the card resolves: none points at an element that is not there. */
  const noDangling = () => {
    for (const el of within(bench())
      .queryAllByRole('button')
      .concat(within(bench()).queryAllByRole('textbox'))) {
      expect(describedTexts(el).join(' | ')).not.toContain('(missing #');
    }
  };

  it('the note stays for the visit when its last set is un-ticked; the row says its own line', async () => {
    mount(inKg([1]), { change: true });
    expect(within(bench()).getAllByText(said())).toHaveLength(1);
    noDangling();
    await press(benchTick());
    // Un-ticked: the row's own line, with its own copy; the note above has not moved.
    expect(within(bench()).getAllByText(said())).toHaveLength(1);
    expect(describedTexts(benchTick()).some((t) => t.includes('Tap ✓'))).toBe(true);
    noDangling();
  });

  it('an un-tick in flight keeps the note and adds no row line', async () => {
    const gate = held();
    mount(inKg([1]), {
      change: true,
      wrap: (a) => ({ untickRow: (input) => gate.after(() => a.untickRow(input)) }),
    });
    await act(async () => {
      fireEvent.click(benchTick());
    });
    expect(within(bench()).getAllByText(said())).toHaveLength(1);
    expect(describedTexts(benchTick())).toContain(said());
    noDangling();
    await gate.resolve();
  });

  it('the note goes when the workout changes back to the unit its sets were logged in', async () => {
    const control = mount(inKg([1]), { change: true });
    expect(within(bench()).getAllByText(said())).toHaveLength(1);
    const back: DayPlan = structuredClone(control.plan);
    back.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!.unit = 'lb';
    await act(async () => control.setPlan(back));
    // Never "Logged in pounds before the workout changed to pounds".
    expect(within(bench()).queryByText(/before the workout changed/)).toBeNull();
    noDangling();
  });

  it('a row never points at a note naming another unit than its own (a distance in two units)', async () => {
    const logged = (set: number, unit: 'm' | 'yd', value: number) => ({
      entryPublicId: `01930000-0000-7000-8000-0000000000f${set}`,
      values: { quantities: [{ slot: 'distance' as const, unit, value }] },
      prescribedText: '40 m',
    });
    const withRun = (unit: 'm' | 'mi', rows: Array<ReturnType<typeof logged> | null>): DayPlan => {
      const plan: DayPlan = structuredClone(everyTypeOnce);
      const item = plan.workouts
        .flatMap((w) => w.items)
        .find((i) => i.trackingType === 'distance')!;
      item.unit = unit;
      item.rows = rows.map((l, i) => ({ set: i + 1, previous: null, logged: l }));
      return plan;
    };
    const control = mount(withRun('m', [logged(1, 'yd', 40), null]), { change: true });
    const workout = control.plan.workouts.find((w) =>
      w.items.some((i) => i.trackingType === 'distance'),
    )!;
    const item = workout.items.find((i) => i.trackingType === 'distance')!;
    const el = () => card(workout.name, item.name);
    // The item goes to miles; set 2 was logged in metres meanwhile: two other units now.
    await act(async () =>
      control.setPlan(withRun('mi', [logged(1, 'yd', 40), logged(2, 'm', 40)])),
    );
    const tick = (set: number) =>
      within(el()).getByRole('button', {
        name: DAY_COPY.logLabel(DAY_COPY.setLabel(item.name, set)),
      });
    expect(describedTexts(tick(2)).join(' ')).toMatch(/metres|meters/);
    expect(describedTexts(tick(2)).join(' ')).not.toMatch(/yards/);
    expect(describedTexts(tick(1)).join(' ')).toMatch(/yards/);
    for (const set of [1, 2])
      expect(describedTexts(tick(set)).join(' ')).not.toContain('(missing #');
  });

  it('no description dangles in any state: logged, un-ticked, re-ticked', async () => {
    mount(inKg(), { change: true });
    noDangling();
    await press(benchTick());
    noDangling();
    await press(benchTick());
    noDangling();
  });
});

describe('another phone’s Change over a draft that was not an edit (12c-iii follow-up; #462)', () => {
  /** The plan with set 1 of the bench amended to `value` lb, as another phone would. */
  function amendedElsewhere(plan: DayPlan, value: number): DayPlan {
    const next: DayPlan = structuredClone(plan);
    const row = next.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!
      .rows[0]!;
    row.logged!.values.quantities[0]!.value = value;
    return next;
  }

  it('a draft typed back to what was stored is dropped: no "Not saved", and a blur sends nothing', async () => {
    const control = mount(yesterdayHalfDone, { change: true });
    const stored = load().value;
    type(load(), '99');
    type(load(), stored);
    await act(async () => control.setPlan(amendedElsewhere(control.plan, 35)));
    expect(load().value).toBe('35');
    expect(within(bench()).queryByText(/^Not saved\./)).toBeNull();
    await leave(load());
    expect(control.actions.amendRow).not.toHaveBeenCalled();
  });

  it('weight × reps: only the field typed back is dropped; the typed reps go with the other phone’s load', async () => {
    const control = mount(yesterdayHalfDone, { change: true });
    const stored = load().value;
    type(load(), '99');
    type(load(), stored);
    type(reps(), '9');
    await act(async () => control.setPlan(amendedElsewhere(control.plan, 35)));
    expect(load().value).toBe('35');
    await leave(reps());
    expect(control.actions.amendRow.mock.calls[0]![0]).toMatchObject({
      values: { quantities: [{ value: 35 }], reps: 9 },
    });
  });

  it('a new entry with new numbers keeps no part of the draft', async () => {
    const control = mount(yesterdayHalfDone, { change: true });
    const stored = load().value;
    type(load(), '99');
    type(load(), stored);
    type(reps(), '9');
    const next: DayPlan = structuredClone(control.plan);
    const row = next.workouts.find((w) => w.name === HEAVY)!.items.find((i) => i.name === BENCH)!
      .rows[0]!;
    row.logged!.entryPublicId = ENTRY_3;
    row.logged!.values.quantities[0]!.value = 35;
    await act(async () => control.setPlan(next));
    await leave(reps());
    expect(control.actions.amendRow).not.toHaveBeenCalled();
  });

  it('a real edit stays, and says what is stored now', async () => {
    const control = mount(yesterdayHalfDone, { change: true });
    type(load(), '40');
    await act(async () => control.setPlan(amendedElsewhere(control.plan, 35)));
    expect(load().value).toBe('40');
    expect(within(bench()).getByText(DAY_COPY.change.notSaved('35 lb × 8'))).toBeTruthy();
  });
});
