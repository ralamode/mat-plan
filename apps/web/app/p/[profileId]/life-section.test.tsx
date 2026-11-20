// @vitest-environment jsdom
import {
  ACTIVITY_TYPE_KEYS,
  ACTIVITY_TYPE_SEED_ROWS,
  PRACTICE_AMEND_REFUSAL,
  PRACTICE_UNIT,
} from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  logLifeActivitiesAction: vi.fn(async () => ({ ok: true, error: null })),
  editPracticeAction: vi.fn(async () => ({ ok: true })),
}));

import {
  AMEND_ERROR_COPY,
  changeLabel,
  LIFE_COPY,
  PRACTICE_COPY,
  RATE_LIMITED,
} from '@/lib/constants';
import type { LoggedLifeActivity } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';
import { LIFE_ACTIVITIES } from '@/lib/life/life-activities';

import { DAY_COPY } from '@/components/day/day-copy';
import { openFolded } from '@/components/day/day-test-utils';

import { editPracticeAction, logLifeActivitiesAction } from './actions';
import { LifeSection } from './life-section';

// COMPONENT TIER (RTL/jsdom). V1-24 3b-page, and 3b-life-a's Change and clear (plan A1–A4). The page
// is an async Server Component Vitest cannot render, and no e2e reaches a day before yesterday, so
// this is where the read-only states are proved. Every expected string comes from the copy consts.
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const DAY = '2026-09-30';
const PRACTICE = ACTIVITY_TYPE_KEYS.wrestling_practice;
const WAKE = ACTIVITY_TYPE_KEYS.wake;
const practiceLabel = LIFE_ACTIVITIES.find((a) => a.key === PRACTICE)!.label;
// Wake left the routine catalog (FAM-1 12f PR 5), so its label is read from the activity type it still is.
const wakeLabel = ACTIVITY_TYPE_SEED_ROWS.find((a) => a.key === WAKE)!.label;

const practice = (value: number, entryId = `019826b4-0000-7000-8000-00000000c${value}`) =>
  ({ entryId, activityKey: PRACTICE, value, unit: PRACTICE_UNIT }) satisfies LoggedLifeActivity;
const minutes = (value: number) => formatValueUnit(value, PRACTICE_UNIT);

type Props = Parameters<typeof LifeSection>[0];
const section = (overrides: Partial<Props> = {}) => (
  <LifeSection
    profileId="019826b4-0000-7000-8000-000000000001"
    day={DAY}
    writable
    amendable
    activityKeys={[WAKE, PRACTICE]}
    logged={[]}
    {...overrides}
  />
);
const changeButton = (value: number) =>
  screen.getByRole('button', { name: changeLabel(PRACTICE_COPY.changeSubject, minutes(value)) });
const field = () => screen.getByLabelText(PRACTICE_COPY.fieldLabel) as HTMLInputElement;
/** Change, after opening the section: a logged Life on a writable day arrives as one line. */
const open = (value: number) => {
  openFolded();
  fireEvent.click(changeButton(value));
};
const submit = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

/** The inline ✓ / ✕ names the editor uses. */
const PRACTICE_SAVE = PRACTICE_COPY.saveLabel;
const PRACTICE_CANCEL = PRACTICE_COPY.cancelLabel;

describe('LifeSection — its states', () => {
  it('writable and nothing logged: the practice button', () => {
    render(section());
    expect(screen.getByRole('heading', { name: LIFE_COPY.heading })).toBeTruthy();
    expect(screen.getByRole('button', { name: PRACTICE_COPY.logLabel })).toBeTruthy();
    expect(screen.getByLabelText(PRACTICE_COPY.fieldLabel)).toBeTruthy();
    expect(screen.queryByText(LIFE_COPY.noneOnClosedDay)).toBeNull();
  });

  it('logged: the label, then its minutes on their own line, in the done row; the button is gone', () => {
    render(section({ logged: [practice(90)] }));
    const label = screen.getByText(practiceLabel);
    const value = screen.getByText(minutes(90));
    // Two lines (plan A1): siblings in one column, never one run of text.
    expect(label.parentElement).toBe(value.parentElement);
    expect(label.parentElement!.className).toContain('flex-col');
    expect(screen.queryByRole('button', { name: PRACTICE_COPY.logLabel })).toBeNull();
    expect(screen.queryByText(LIFE_COPY.noneOnClosedDay)).toBeNull();
  });

  it('Change shows on a day that can be changed, and never on a read-only one', () => {
    render(section({ logged: [practice(90)] }));
    openFolded();
    expect(changeButton(90)).toBeTruthy();
    cleanup();
    render(section({ writable: false, amendable: false, logged: [practice(90)] }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(minutes(90))).toBeTruthy();
  });

  it('two practices on one day (before 3b-0) are two rows, never one of them silently', () => {
    render(
      section({
        writable: false,
        amendable: false,
        logged: [practice(90, 'a'), practice(45, 'b')],
      }),
    );
    expect(screen.getByText(minutes(90))).toBeTruthy();
    expect(screen.getByText(minutes(45))).toBeTruthy();
  });

  it('read-only and nothing logged: "Nothing logged.", not a bare heading', () => {
    render(section({ writable: false, amendable: false }));
    expect(screen.getByText(LIFE_COPY.noneOnClosedDay)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Wake is not in the catalog: a logged Wake is not shown', () => {
    const wake: LoggedLifeActivity = {
      entryId: 'w',
      activityKey: WAKE,
      value: 412,
      unit: 'timing',
    };
    render(section({ writable: false, amendable: false, logged: [wake] }));
    expect(screen.queryByText(wakeLabel)).toBeNull();
    expect(screen.getByText(LIFE_COPY.noneOnClosedDay)).toBeTruthy();
  });

  it('Wake is not in the catalog: a routine of Wake alone renders nothing', () => {
    for (const activityKeys of [[], [WAKE]]) {
      const { container } = render(section({ activityKeys }));
      expect(container.innerHTML).toBe('');
      cleanup();
    }
  });
});

describe('LifeSection — the log, Change and clear (plan A3, A4)', () => {
  it('opening a day that already has a practice announces nothing', () => {
    render(section({ logged: [practice(90)] }));
    // It arrives folded: the island's region is behind the line, and silent.
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('');
  });

  it("a log is announced from the action's result and hands focus to the row's Change", async () => {
    const { rerender } = render(section());
    fireEvent.change(screen.getByLabelText(PRACTICE_COPY.fieldLabel), { target: { value: '90' } });
    await submit(PRACTICE_COPY.logLabel);
    expect(logLifeActivitiesAction).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe(LIFE_COPY.announced(practiceLabel));
    rerender(section({ logged: [practice(90)] }));
    expect(document.activeElement).toBe(changeButton(90));
  });

  it('paging to a logged day is not a log', () => {
    const { rerender } = render(section());
    rerender(section({ day: '2026-09-29', logged: [practice(60)] }));
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('');
  });

  it('the editor: a numeric keypad, named for practice, the value selected, and the total hint', () => {
    render(section({ logged: [practice(90)] }));
    open(90);
    expect(field().getAttribute('inputmode')).toBe('numeric');
    expect(field().value).toBe('90');
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(2);
    expect(screen.getByText(PRACTICE_COPY.clearHint)).toBeTruthy();
  });

  it('a save sends typed input (never FormData) and announces the new value', async () => {
    render(section({ logged: [practice(90)] }));
    open(90);
    fireEvent.change(field(), { target: { value: '45' } });
    await submit(PRACTICE_SAVE);
    expect(editPracticeAction).toHaveBeenCalledWith({
      profilePublicId: '019826b4-0000-7000-8000-000000000001',
      entryId: practice(90).entryId,
      value: '45',
      seenValue: 90,
    });
    expect(screen.getByRole('status').textContent).toBe(
      PRACTICE_COPY.announcedChanged(minutes(45)),
    );
  });

  it('the ✓ is named Clear while the field is empty; a clear is shown and focus goes to the returning field', async () => {
    const { rerender } = render(section({ logged: [practice(90)] }));
    open(90);
    fireEvent.change(field(), { target: { value: '' } });
    await submit(PRACTICE_COPY.clearLabel);
    expect(editPracticeAction).toHaveBeenCalledWith(expect.objectContaining({ value: '' }));
    rerender(section({ logged: [] }));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(PRACTICE_COPY.announcedCleared(minutes(90)));
    expect(status.className).not.toContain('sr-only');
    // The typed field returns, takes focus, and is described by the shown line.
    const returning = screen.getByLabelText(PRACTICE_COPY.fieldLabel);
    expect(document.activeElement).toBe(returning);
    // …and it is described by the shown line, so arriving focus reads what was cleared.
    expect(returning.getAttribute('aria-describedby')).toBe(status.id);
  });

  it('an archived athlete: the ✓ keeps its save name, and a blank is refused before any request', async () => {
    render(section({ writable: false, amendable: true, logged: [practice(90)] }));
    open(90);
    fireEvent.change(field(), { target: { value: '' } });
    expect(screen.queryByText(PRACTICE_COPY.clearHint)).toBeNull();
    await submit(PRACTICE_SAVE);
    expect(editPracticeAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      PRACTICE_COPY.blankSave.replace('✓', `✓${PRACTICE_SAVE}`),
    );
  });

  it('an out-of-range value stays under the field; a stale one is the island alert', async () => {
    render(section({ logged: [practice(90)] }));
    open(90);
    vi.mocked(editPracticeAction).mockResolvedValueOnce({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.bad_value,
    });
    fireEvent.change(field(), { target: { value: '5' } });
    await submit(PRACTICE_SAVE);
    expect(screen.getByRole('alert').textContent).toBe(PRACTICE_COPY.outOfRange);
    expect(field().getAttribute('aria-invalid')).toBe('true');

    vi.mocked(editPracticeAction).mockResolvedValueOnce({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.stale,
    });
    fireEvent.change(field(), { target: { value: '60' } });
    await submit(PRACTICE_SAVE);
    expect(screen.getByRole('alert').textContent).toBe(AMEND_ERROR_COPY.staleWrite);
  });

  it.each([
    [
      PRACTICE_AMEND_REFUSAL.closed_day,
      (): string => AMEND_ERROR_COPY.dayReadOnly(PRACTICE_COPY.noun),
    ],
    [PRACTICE_AMEND_REFUSAL.not_found, (): string => AMEND_ERROR_COPY.notFound(PRACTICE_COPY.noun)],
    [PRACTICE_AMEND_REFUSAL.retry, (): string => RATE_LIMITED],
  ] as const)('a %s refusal is the island alert with its own copy', async (reason, copy) => {
    render(section({ logged: [practice(90)] }));
    open(90);
    vi.mocked(editPracticeAction).mockResolvedValueOnce({ ok: false, reason });
    fireEvent.change(field(), { target: { value: '60' } });
    await submit(PRACTICE_SAVE);
    expect(screen.getByRole('alert').textContent).toBe(copy());
  });

  it("a refused log is the island's alert, read as the ✓'s name, and describes the field", async () => {
    vi.mocked(logLifeActivitiesAction).mockResolvedValueOnce({
      ok: false,
      error: PRACTICE_COPY.notSaved,
    });
    render(section());
    const minutesField = screen.getByLabelText(PRACTICE_COPY.fieldLabel);
    fireEvent.change(minutesField, { target: { value: '90' } });
    await submit(PRACTICE_COPY.logLabel);
    const alert = screen.getByRole('alert');
    // "Tap ✓ to try again." reads as the button's name in place of the hidden glyph.
    expect(alert.textContent).toBe(
      PRACTICE_COPY.notSaved.replace('✓', `✓${PRACTICE_COPY.logLabel}`),
    );
    expect(minutesField.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
    expect(document.activeElement).toBe(minutesField);
  });

  it('day_taken: the form is replaced by the other row, and focus reaches its Change', async () => {
    vi.mocked(logLifeActivitiesAction).mockResolvedValueOnce({
      ok: false,
      error: PRACTICE_COPY.dayTaken(60),
      dayTaken: true,
    });
    const { rerender } = render(section());
    fireEvent.change(screen.getByLabelText(PRACTICE_COPY.fieldLabel), { target: { value: '60' } });
    await submit(PRACTICE_COPY.logLabel);
    rerender(section({ logged: [practice(90)] }));
    expect(screen.getByRole('alert').textContent).toBe(PRACTICE_COPY.dayTaken(60));
    expect(document.activeElement).toBe(changeButton(90));
    // The editor opens on the OTHER number (90), so the alert naming 60 stays while it is open
    // (maintainer, 2026-11-16); Cancel drops it.
    open(90);
    const kept = screen.getByRole('alert');
    expect(kept.textContent).toBe(PRACTICE_COPY.dayTaken(60));
    // …and it describes the editor's field, so a screen reader hears the 60 that was not saved.
    expect(field().getAttribute('aria-describedby')?.split(' ')).toContain(kept.id);
    fireEvent.click(screen.getByRole('button', { name: PRACTICE_CANCEL }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('any other refusal is dropped when Change opens: it no longer describes the screen', async () => {
    vi.mocked(logLifeActivitiesAction).mockResolvedValueOnce({ ok: false, error: 'Not saved.' });
    const { rerender } = render(section());
    fireEvent.change(screen.getByLabelText(PRACTICE_COPY.fieldLabel), { target: { value: '60' } });
    await submit(PRACTICE_COPY.logLabel);
    rerender(section({ logged: [practice(90)] }));
    open(90);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a practice row with no value, or in another unit, shows no Change (the endpoint would refuse it)', () => {
    render(
      section({
        logged: [
          { entryId: 'n', activityKey: PRACTICE, value: null, unit: PRACTICE_UNIT },
          { entryId: 's', activityKey: PRACTICE, value: 3600, unit: 'sec' },
        ],
      }),
    );
    openFolded();
    expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull();
  });
});

describe('LifeSection — every item logged folds it to one line (FAM-1 12c-iii)', () => {
  const line = () => screen.queryByRole('button', { expanded: false });
  const collapse = () =>
    screen.queryByRole('button', { name: DAY_COPY.collapseLabel(LIFE_COPY.heading) });
  const changeOf = (value: number) =>
    screen.queryByRole('button', {
      name: changeLabel(PRACTICE_COPY.changeSubject, minutes(value)),
    });

  it('a practice logged when the day opens arrives as "Life, Wrestling practice 90 min"', () => {
    render(section({ logged: [practice(90)] }));
    expect(line()!.getAttribute('aria-label')).toBe(
      `${LIFE_COPY.heading}, ${practiceLabel} ${minutes(90)}`,
    );
    expect(changeOf(90)).toBeNull();
    expect(screen.getByRole('region', { name: LIFE_COPY.heading })).toBeTruthy();
  });

  it('the summary names an item with no value by its label alone, items joined with ", "', () => {
    render(
      section({
        logged: [
          { entryId: 'n', activityKey: PRACTICE, value: null, unit: PRACTICE_UNIT },
          practice(45, 'b'),
        ],
      }),
    );
    expect(line()!.getAttribute('aria-label')).toBe(
      `${LIFE_COPY.heading}, ${practiceLabel}, ${practiceLabel} ${minutes(45)}`,
    );
  });

  it('never folds: nothing logged, a read-only day or an archived athlete with a practice', () => {
    for (const props of [
      { logged: [] },
      { logged: [practice(90)], writable: false, amendable: false },
      { logged: [practice(90)], writable: false, amendable: true },
    ]) {
      render(section(props));
      expect(line()).toBeNull();
      expect(collapse()).toBeNull();
      cleanup();
    }
  });

  it('logged during the visit it stays open, with Collapse; a new day and back folds it', async () => {
    const { rerender } = render(section());
    fireEvent.change(field(), { target: { value: '90' } });
    await submit(PRACTICE_COPY.logLabel);
    rerender(section({ logged: [practice(90)] }));
    expect(line()).toBeNull();
    expect(collapse()).not.toBeNull();
    rerender(section({ day: '2026-09-29' }));
    rerender(section({ logged: [practice(90)] }));
    expect(line()).not.toBeNull();
  });

  it('a tap opens it with focus on Collapse; Collapse folds it with focus on the line', () => {
    render(section({ logged: [practice(90)] }));
    fireEvent.click(line()!);
    expect(document.activeElement).toBe(collapse());
    expect(changeOf(90)).not.toBeNull();
    fireEvent.click(collapse()!);
    expect(document.activeElement).toBe(line());
  });

  it('no Collapse while the editor is open or a refusal shows; it returns once both go', async () => {
    render(section({ logged: [practice(90)] }));
    open(90);
    expect(collapse()).toBeNull();
    vi.mocked(editPracticeAction).mockResolvedValueOnce({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.stale,
    });
    fireEvent.change(field(), { target: { value: '60' } });
    await submit(PRACTICE_SAVE);
    expect(screen.getByRole('alert').textContent).toBe(AMEND_ERROR_COPY.staleWrite);
    expect(collapse()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: PRACTICE_CANCEL }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(collapse()).not.toBeNull();
  });

  it('an alert alone holds Collapse (a log refused because the day was taken)', async () => {
    vi.mocked(logLifeActivitiesAction).mockResolvedValueOnce({
      ok: false,
      error: PRACTICE_COPY.dayTaken(60),
      dayTaken: true,
    });
    const { rerender } = render(section());
    fireEvent.change(field(), { target: { value: '60' } });
    await submit(PRACTICE_COPY.logLabel);
    rerender(section({ logged: [practice(90)] }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(collapse()).toBeNull();
  });

  it('under StrictMode a mount moves no focus, and a tap still focuses Collapse', () => {
    render(<StrictMode>{section({ logged: [practice(90)] })}</StrictMode>);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(line()!);
    expect(document.activeElement).toBe(collapse());
  });
});
