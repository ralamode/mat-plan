// @vitest-environment jsdom
import { ACTIVITY_TYPE_KEYS, PRACTICE_AMEND_REFUSAL, PRACTICE_UNIT } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  logLifeActivitiesAction: vi.fn(async () => ({ ok: true, error: null })),
  editPracticeAction: vi.fn(async () => ({ ok: true })),
}));

import {
  AMEND_COPY,
  AMEND_ERROR_COPY,
  changeLabel,
  LIFE_COPY,
  PRACTICE_COPY,
  RATE_LIMITED,
} from '@/lib/constants';
import type { LoggedLifeActivity } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';
import { LIFE_ACTIVITIES } from '@/lib/life/life-activities';

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
const wakeLabel = LIFE_ACTIVITIES.find((a) => a.key === WAKE)!.label;

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
const open = (value: number) => fireEvent.click(changeButton(value));
const submit = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

describe('LifeSection — its states', () => {
  it('writable and nothing logged: the practice button, and no Wake', () => {
    render(section());
    expect(screen.getByRole('heading', { name: LIFE_COPY.heading })).toBeTruthy();
    expect(screen.getByRole('button', { name: PRACTICE_COPY.logLabel })).toBeTruthy();
    expect(screen.getByLabelText(PRACTICE_COPY.fieldLabel)).toBeTruthy();
    expect(screen.queryByRole('button', { name: wakeLabel })).toBeNull();
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

  it('a logged Wake is not shown', () => {
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

  it('renders nothing when the routine has no life activity to show', () => {
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
    expect(screen.getByRole('status').textContent).toBe('');
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
    expect(screen.getByRole('status').textContent).toBe('');
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
    await submit(AMEND_COPY.save);
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

  it('Save reads Clear while the field is empty; a clear is shown and focus goes to the returning field', async () => {
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

  it('an archived athlete: Save stays Save, and a blank is refused before any request', async () => {
    render(section({ writable: false, amendable: true, logged: [practice(90)] }));
    open(90);
    fireEvent.change(field(), { target: { value: '' } });
    expect(screen.queryByText(PRACTICE_COPY.clearHint)).toBeNull();
    await submit(AMEND_COPY.save);
    expect(editPracticeAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(PRACTICE_COPY.blankSave);
  });

  it('an out-of-range value stays under the field; a stale one is the island alert', async () => {
    render(section({ logged: [practice(90)] }));
    open(90);
    vi.mocked(editPracticeAction).mockResolvedValueOnce({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.bad_value,
    });
    fireEvent.change(field(), { target: { value: '5' } });
    await submit(AMEND_COPY.save);
    expect(screen.getByRole('alert').textContent).toBe(PRACTICE_COPY.outOfRange);
    expect(field().getAttribute('aria-invalid')).toBe('true');

    vi.mocked(editPracticeAction).mockResolvedValueOnce({
      ok: false,
      reason: PRACTICE_AMEND_REFUSAL.stale,
    });
    fireEvent.change(field(), { target: { value: '60' } });
    await submit(AMEND_COPY.save);
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
    await submit(AMEND_COPY.save);
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
    expect(screen.getByRole('alert').textContent).toBe(PRACTICE_COPY.dayTaken(60));
    fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.cancel }));
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
    expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull();
  });
});
