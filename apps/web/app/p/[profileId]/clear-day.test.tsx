// @vitest-environment jsdom
import { CLEAR_DAY_CONFIRM_WORD, DAY_CLEAR_REFUSAL, type ClearEvent } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace }) }));
const clearDayAction = vi.fn();
const restoreClearAction = vi.fn();
vi.mock('./clear-day-actions', () => ({
  clearDayAction: (...args: unknown[]) => clearDayAction(...args),
  restoreClearAction: (...args: unknown[]) => restoreClearAction(...args),
}));

import { AMEND_COPY, CLEAR_DAY_COPY, CLEAR_DAY_OUTCOME_ID, RESTORE_ALL_ID } from '@/lib/constants';
import { formatDayShort } from '@/lib/date';
import type { ClearDaySummary } from '@/lib/entries/clear-summary';
import { RESTORE_DEADLINE } from '@/lib/entries/restore-deadline';

import { ClearDay } from './clear-day';
import { ClearDayBanner } from './clear-day-banner';

/**
 * Clear this day's two islands (V1-9b B2-ii). jsdom's `fireEvent.click` does not focus a button, so
 * every test that depends on focus at the tap focuses it first, as a real tap does on Chromium.
 */
const PROFILE = '019826b4-0000-7000-8000-000000000001';
const TODAY = '2026-11-19';
const SUMMARY: ClearDaySummary = {
  workouts: [{ name: 'Heavy A', count: 3 }],
  weighIns: 1,
  practices: 1,
  other: 0,
  total: 5,
};
const TOKEN = '2026-11-19T18:04:05.123456Z';
const OLDER: ClearEvent = { hiddenAt: '2026-11-19T09:00:00.000000Z', count: 4 };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  window.history.replaceState(null, '');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
});

const clearIsland = (summary: ClearDaySummary | null = SUMMARY) => (
  <ClearDay
    profileId={PROFILE}
    athleteName="Athlete One"
    day={TODAY}
    today={TODAY}
    summary={summary}
    deadline={RESTORE_DEADLINE.tomorrow}
  />
);
const banner = (
  events: readonly ClearEvent[],
  extra: Partial<{ writable: boolean; relogged: boolean }> = {},
) => (
  <ClearDayBanner
    profileId={PROFILE}
    day={TODAY}
    today={TODAY}
    events={events}
    writable={extra.writable ?? true}
    relogged={extra.relogged ?? false}
    deadline={extra.writable === false ? null : RESTORE_DEADLINE.tomorrow}
  />
);
/** The page's two islands, as `page.tsx` places them. */
const page = (events: readonly ClearEvent[], summary: ClearDaySummary | null = SUMMARY) => (
  <>
    {banner(events)}
    {clearIsland(summary)}
  </>
);

const trigger = () => screen.getByRole('button', { name: CLEAR_DAY_COPY.trigger });
const dialog = () =>
  screen.getByRole('dialog', { name: CLEAR_DAY_COPY.title(formatDayShort(TODAY)) });
const field = () => within(dialog()).getByRole('textbox') as HTMLInputElement;
const clearButton = () => within(dialog()).getByRole('button', { name: CLEAR_DAY_COPY.action });
const cancel = () => within(dialog()).getByRole('button', { name: AMEND_COPY.cancel });
const outcomeLine = () => document.getElementById(CLEAR_DAY_OUTCOME_ID)!;
const typeAndClear = () => {
  fireEvent.click(trigger());
  fireEvent.change(field(), { target: { value: CLEAR_DAY_CONFIRM_WORD } });
  fireEvent.click(clearButton());
};

describe('ClearDay (V1-9b B2-ii)', () => {
  it('shows no trigger when nothing is live', () => {
    render(clearIsland(null));
    expect(screen.queryByRole('button', { name: CLEAR_DAY_COPY.trigger })).toBeNull();
  });

  it('names what it hides, the deadline and its condition, and that the workout record stays', () => {
    render(clearIsland());
    fireEvent.click(trigger());
    const text = dialog().textContent ?? '';
    expect(text).toContain(
      CLEAR_DAY_COPY.body(
        'Athlete One',
        [
          CLEAR_DAY_COPY.summaryWorkout('Heavy A', 3),
          CLEAR_DAY_COPY.summaryWeighIns(1),
          CLEAR_DAY_COPY.summaryPractices(1),
        ],
        CLEAR_DAY_COPY.deadline.tomorrow,
      ),
    );
    expect(text).toContain(CLEAR_DAY_COPY.sessionStays);
  });

  it('warns about a session note when the day holds an older session the page does not show', () => {
    render(clearIsland({ workouts: [], weighIns: 0, practices: 0, other: 2, total: 2 }));
    fireEvent.click(trigger());
    expect(dialog().textContent).toContain(CLEAR_DAY_COPY.sessionStays);
  });

  it('is not armed until the word is typed, and a tap says so without clearing', () => {
    render(clearIsland());
    fireEvent.click(trigger());
    expect(clearButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(clearButton());
    expect(clearDayAction).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain(CLEAR_DAY_COPY.confirmFirst(CLEAR_DAY_CONFIRM_WORD));
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('Enter with the word moves focus to Clear day and never clears, even held', () => {
    render(clearIsland());
    fireEvent.click(trigger());
    fireEvent.change(field(), { target: { value: ' Delete ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(document.activeElement).toBe(clearButton());
    // The held key's auto-repeat now lands on the button, as a submit: ignored.
    fireEvent.click(clearButton());
    expect(clearDayAction).not.toHaveBeenCalled();
    expect(dialog()).toBeTruthy();
  });

  it('resets the word on every open, so a reopened dialog is never armed', () => {
    render(clearIsland());
    fireEvent.click(trigger());
    fireEvent.change(field(), { target: { value: CLEAR_DAY_CONFIRM_WORD } });
    fireEvent.click(cancel());
    fireEvent.click(trigger());
    expect(field().value).toBe('');
    expect(clearButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('sends the athlete, the day and the word, and closes on success', async () => {
    clearDayAction.mockResolvedValueOnce({ ok: true, count: 5 });
    render(clearIsland());
    typeAndClear();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(clearDayAction).toHaveBeenCalledWith({
      profilePublicId: PROFILE,
      day: TODAY,
      confirm: CLEAR_DAY_CONFIRM_WORD,
    });
  });

  it('keeps the dialog and the word on retry, with a visible message', async () => {
    clearDayAction.mockResolvedValueOnce({ ok: false, reason: DAY_CLEAR_REFUSAL.retry });
    render(clearIsland());
    typeAndClear();
    await waitFor(() => expect(dialog().textContent).toContain(CLEAR_DAY_COPY.refused.retry));
    expect(field().value).toBe(CLEAR_DAY_CONFIRM_WORD);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a dropped connection keeps the dialog and the word, and claims no cause', async () => {
    clearDayAction.mockRejectedValueOnce(new Error('network'));
    render(clearIsland());
    typeAndClear();
    await waitFor(() => expect(dialog().textContent).toContain(CLEAR_DAY_COPY.failed));
    expect(field().value).toBe(CLEAR_DAY_CONFIRM_WORD);
  });

  it('cannot be closed while the clear is in flight', async () => {
    let finish!: (v: unknown) => void;
    clearDayAction.mockReturnValueOnce(new Promise((r) => (finish = r)));
    render(clearIsland());
    typeAndClear();
    fireEvent.click(cancel());
    expect(dialog()).toBeTruthy();
    await act(async () => finish({ ok: true, count: 1 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the clear, the banner and the hand-off between them (V1-9b B2-ii)', () => {
  it('after a clear, focus lands on Restore all once the banner mounts (target after the claim)', async () => {
    clearDayAction.mockResolvedValueOnce({ ok: true, count: 5 });
    const view = render(page([]));
    typeAndClear();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    view.rerender(page([{ hiddenAt: TOKEN, count: 5 }], null));
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById(RESTORE_ALL_ID)),
    );
  });

  it('the day empties while the clear is in flight: the dialog survives, then focus lands on Restore all', async () => {
    let finish!: (v: unknown) => void;
    clearDayAction.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const view = render(page([]));
    typeAndClear();
    // The revalidated page commits first: nothing live, the banner mounted. The island stays.
    view.rerender(page([{ hiddenAt: TOKEN, count: 5 }], null));
    expect(dialog()).toBeTruthy();
    await act(async () => finish({ ok: true, count: 5 }));
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById(RESTORE_ALL_ID)),
    );
  });

  it('a count of 0 says nothing was left, on the outcome line, and focuses it', async () => {
    clearDayAction.mockResolvedValueOnce({ ok: true, count: 0 });
    render(page([]));
    typeAndClear();
    await waitFor(() => expect(outcomeLine().textContent).toContain(CLEAR_DAY_COPY.nothingLeft));
    await waitFor(() => expect(document.activeElement).toBe(outcomeLine()));
  });

  it('a closed_day refusal is said on the banner even when the re-read unmounts the dialog', async () => {
    clearDayAction.mockResolvedValueOnce({ ok: false, reason: DAY_CLEAR_REFUSAL.closed_day });
    const view = render(page([]));
    typeAndClear();
    await waitFor(() =>
      expect(outcomeLine().textContent).toContain(CLEAR_DAY_COPY.refused.closed_day),
    );
    view.rerender(banner([], { writable: false })); // the re-read: no longer clearable
    expect(outcomeLine().textContent).toContain(CLEAR_DAY_COPY.refused.closed_day);
    // It stays on the day the person meant, not the new today.
    expect(replace).toHaveBeenCalledWith(expect.stringContaining(`?d=${TODAY}`));
  });
});

describe('ClearDayBanner (V1-9b B2-ii)', () => {
  it('offers Restore all on the newest clear, with its count and deadline', () => {
    render(banner([{ hiddenAt: TOKEN, count: 5 }]));
    expect(
      screen.getByText(CLEAR_DAY_COPY.banner(5, CLEAR_DAY_COPY.deadline.tomorrow)),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: CLEAR_DAY_COPY.restoreAll })).toBeTruthy();
  });

  it('with an older clear, restores the newest only and says how many it brings back', () => {
    render(banner([{ hiddenAt: TOKEN, count: 2 }, OLDER]));
    expect(screen.getByText(CLEAR_DAY_COPY.earlier(4))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: CLEAR_DAY_COPY.restoreN(2) })).toHaveLength(1);
  });

  it('on a day logged again since, names the count rather than "all"', () => {
    render(banner([{ hiddenAt: TOKEN, count: 3 }], { relogged: true }));
    expect(screen.getByRole('button', { name: CLEAR_DAY_COPY.restoreN(3) })).toBeTruthy();
  });

  it('renders no banner on a day closed for Restore all', () => {
    render(banner([{ hiddenAt: TOKEN, count: 3 }], { writable: false }));
    expect(screen.queryByRole('button', { name: CLEAR_DAY_COPY.restoreAll })).toBeNull();
  });

  it.each([
    [{ restored: 5, keptHidden: 0 }, CLEAR_DAY_COPY.restored, [] as ClearEvent[]],
    [
      { restored: 3, keptHidden: 2 },
      CLEAR_DAY_COPY.restoredSome(3, 2),
      [{ hiddenAt: TOKEN, count: 2 }],
    ],
    [{ restored: 0, keptHidden: 2 }, CLEAR_DAY_COPY.restoredNone, [{ hiddenAt: TOKEN, count: 2 }]],
    [{ restored: 0, keptHidden: 0 }, CLEAR_DAY_COPY.nothingToRestore, [] as ClearEvent[]],
  ])(
    'Restore all %o, tapped (so focused), says so on the outcome line, which takes focus',
    async (counts, text, after) => {
      restoreClearAction.mockResolvedValueOnce({ ok: true, ...counts });
      const view = render(banner([{ hiddenAt: TOKEN, count: 5 }]));
      const button = screen.getByRole('button', { name: CLEAR_DAY_COPY.restoreAll });
      button.focus();
      fireEvent.click(button);
      await waitFor(() => expect(outcomeLine().textContent).toContain(text));
      expect(document.activeElement).toBe(outcomeLine());
      // The revalidated page, as the server answers it (a kept-hidden clear stays).
      view.rerender(banner(after));
      expect(document.activeElement).toBe(outcomeLine());
      expect(outcomeLine().textContent).toContain(text);
      expect(restoreClearAction).toHaveBeenCalledWith({
        profilePublicId: PROFILE,
        day: TODAY,
        hiddenAt: TOKEN,
      });
    },
  );

  it('restoring the newest with an older clear left keeps the line, says what is left, and keeps focus on its Restore', async () => {
    restoreClearAction.mockResolvedValueOnce({ ok: true, restored: 2, keptHidden: 0 });
    const view = render(banner([{ hiddenAt: TOKEN, count: 2 }, OLDER]));
    const button = screen.getByRole('button', { name: CLEAR_DAY_COPY.restoreN(2) });
    button.focus();
    fireEvent.click(button);
    const text = CLEAR_DAY_COPY.restoredOlderLeft(2, 4);
    await waitFor(() => expect(outcomeLine().textContent).toContain(text));
    view.rerender(banner([OLDER]));
    expect(outcomeLine().textContent).toContain(text);
    expect(document.activeElement).toBe(document.getElementById(RESTORE_ALL_ID));
  });

  it('a newer clear clears an old outcome line', async () => {
    restoreClearAction.mockResolvedValueOnce({ ok: true, restored: 1, keptHidden: 0 });
    const view = render(banner([{ hiddenAt: TOKEN, count: 1 }]));
    fireEvent.click(screen.getByRole('button', { name: CLEAR_DAY_COPY.restoreAll }));
    await waitFor(() => expect(outcomeLine().textContent).toContain(CLEAR_DAY_COPY.restored));
    view.rerender(banner([]));
    view.rerender(banner([{ hiddenAt: '2026-11-19T20:00:00.000000Z', count: 3 }]));
    expect(outcomeLine().textContent).toBe('');
  });

  it('a dropped connection says so, with no cause', async () => {
    restoreClearAction.mockRejectedValueOnce(new Error('network'));
    render(banner([{ hiddenAt: TOKEN, count: 5 }]));
    fireEvent.click(screen.getByRole('button', { name: CLEAR_DAY_COPY.restoreAll }));
    await waitFor(() => expect(outcomeLine().textContent).toContain(CLEAR_DAY_COPY.failed));
  });
});
