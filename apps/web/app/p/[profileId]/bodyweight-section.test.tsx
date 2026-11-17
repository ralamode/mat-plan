// @vitest-environment jsdom
import { DEFAULT_BODYWEIGHT_UNIT, IMPLAUSIBLE_BODYWEIGHT_MESSAGE } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The form imports the Server Action module ('use server'), which cannot be evaluated under jsdom
// (the strength-form.test.tsx precedent). This file is about what the SECTION renders.
vi.mock('./actions', () => ({
  logBodyweightAction: vi.fn(async () => ({ ok: true, error: null })),
  editBodyweightAction: vi.fn(async () => ({ ok: true, error: null })),
}));

import {
  AMEND_COPY,
  AMEND_ERROR_COPY,
  BODYWEIGHT_COPY,
  changeLabel,
  CLOSED_DAY_NOTICE,
  LAST_TIME_PREFIX,
} from '@/lib/constants';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';

import { editBodyweightAction, logBodyweightAction } from './actions';
import { BodyweightSection } from './bodyweight-section';

// COMPONENT TIER (RTL/jsdom). V1-24 PR 1a, and the prototype's row since 3b-bw (plan W1–W6). Every
// expected string comes from BODYWEIGHT_COPY, never re-typed.
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(logBodyweightAction).mockClear();
  vi.mocked(editBodyweightAction).mockClear();
});

const DAY = '2026-09-30';
const NEXT_DAY = '2026-10-01';
const weight = (value: number, entryId = `bw-${value}`): LoggedBodyweight => ({
  entryId,
  value,
  unit: DEFAULT_BODYWEIGHT_UNIT,
});
const shown = (w: LoggedBodyweight) => formatValueUnit(w.value, w.unit);

type Props = Parameters<typeof BodyweightSection>[0];
const section = (overrides: Partial<Props> = {}) => (
  <BodyweightSection
    profileId="p1"
    day={DAY}
    writable
    amendable
    logged={[]}
    last={null}
    {...overrides}
  />
);

const statusText = () => screen.getByRole('status').textContent;
const clientId = () =>
  document.querySelector<HTMLInputElement>('input[name="clientId"]')?.value ?? null;
const logButton = () => screen.getByRole('button', { name: BODYWEIGHT_COPY.logLabel });
const field = () => screen.getByLabelText('Weight') as HTMLInputElement;

describe('BodyweightSection — its states', () => {
  it('is headed "Bodyweight" in EVERY state', () => {
    for (const props of [
      { logged: [] },
      { logged: [weight(84.5)] },
      { logged: [], writable: false },
      { logged: [weight(84.5)], writable: false },
    ]) {
      render(section(props));
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(BODYWEIGHT_COPY.heading);
      cleanup();
    }
  });

  it('writable + nothing logged → the ✓ row: a text field with a decimal keypad, and an outline ✓', () => {
    render(section());
    expect(field().type).toBe('text');
    expect(field().inputMode).toBe('decimal');
    expect(field().required).toBe(false);
    expect(logButton().getAttribute('data-variant')).toBe('outline');
    expect(screen.queryByText(new RegExp(`^${LAST_TIME_PREFIX}`))).toBeNull();
  });

  it('the ✓ fills while a weight waits to be sent, and goes back to outline when emptied (3b-life-b B3)', () => {
    render(section());
    fireEvent.change(field(), { target: { value: '72' } });
    expect(logButton().getAttribute('data-variant')).toBe('default');
    expect(logButton().hasAttribute('data-ready')).toBe(true);
    fireEvent.change(field(), { target: { value: ' ' } });
    expect(logButton().getAttribute('data-variant')).toBe('outline');
  });

  it('"Last time" is its own muted line, never a placeholder, and describes the field', () => {
    render(section({ last: { value: 72.5, unit: 'lb', day: '2026-09-29' } }));
    const hint = screen.getByText(BODYWEIGHT_COPY.lastTime('72.5 lb', null));
    expect(field().placeholder).toBe('');
    expect(field().value).toBe('');
    expect(field().getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('"Last time" names the day when it was not the day before', () => {
    render(section({ last: { value: 72.5, unit: 'lb', day: '2026-09-27' } }));
    expect(screen.getByText(BODYWEIGHT_COPY.lastTime('72.5 lb', 'Sun'))).toBeTruthy();
    cleanup();
    render(section({ last: { value: 72.5, unit: 'lb', day: '2026-09-02' } }));
    expect(screen.getByText(BODYWEIGHT_COPY.lastTime('72.5 lb', 'Sep 2'))).toBeTruthy();
  });

  it('the unit select starts on the last weigh-in’s unit', () => {
    render(section({ last: { value: 38, unit: 'kg', day: '2026-09-29' } }));
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('kg');
  });

  it('one weight → ✓ 84.5 lb, read as "Logged 84.5 lb", and a Change control', () => {
    const w = weight(84.5);
    render(section({ logged: [w] }));
    expect(screen.getByText(BODYWEIGHT_COPY.logged).className).toContain('sr-only');
    expect(screen.getByText(shown(w), { exact: false })).toBeTruthy();
    // THE half that stops the second submit: no create form.
    expect(screen.queryByLabelText('Weight')).toBeNull();
    expect(screen.queryByRole('button', { name: BODYWEIGHT_COPY.logLabel })).toBeNull();
    expect(screen.getByRole('button', { name: changeLabel('weight', shown(w)) })).toBeTruthy();
  });

  it('several weights → all of them, never silently the newest', () => {
    const rows = [weight(84.5), weight(845)];
    render(section({ logged: rows }));
    expect(screen.getByText(BODYWEIGHT_COPY.several(rows.map(shown)))).toBeTruthy();
  });

  it('duplicates → one "ask a parent" line, and NO Change control', () => {
    for (const writable of [true, false]) {
      for (const rows of [
        [weight(84.5, 'a'), weight(84.5, 'b')], // the double submit
        [weight(84.5, 'a'), weight(845, 'b')], // two different weights
        [weight(84.5, 'a'), weight(84.5, 'b'), weight(845, 'c')],
      ]) {
        render(section({ logged: rows, writable }));
        expect(screen.getByText(BODYWEIGHT_COPY.duplicates(rows.map(shown)))).toBeTruthy();
        // One row's control cannot serve N rows: it would edit an unstated one of them.
        expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull();
        cleanup();
      }
    }
  });

  it('a read-only day shows the weight with NO Change, and does not repeat the page notice', () => {
    const w = weight(84.5);
    render(section({ logged: [w], writable: false, amendable: false }));
    expect(screen.getByText(shown(w), { exact: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull();
    expect(screen.queryByText(CLOSED_DAY_NOTICE)).toBeNull();
  });

  it('a read-only day with nothing → "Nothing logged.", not a bare heading', () => {
    render(section({ writable: false }));
    expect(screen.getByText(BODYWEIGHT_COPY.noneOnClosedDay)).toBeTruthy();
    expect(screen.queryByLabelText('Weight')).toBeNull();
  });
});

describe('BodyweightSection — the ✓ (plan W3, W6)', () => {
  it('an empty ✓ is refused before any request, with focus on the field', async () => {
    render(section());
    await act(async () => {
      fireEvent.click(logButton());
    });
    expect(logBodyweightAction).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    // The glyph is hidden; a screen reader hears the button's name in its place.
    expect(alert.textContent).toBe(
      BODYWEIGHT_COPY.blankLog.replace('✓', `✓${BODYWEIGHT_COPY.logLabel}`),
    );
    expect(document.activeElement).toBe(field());
    expect(field().getAttribute('aria-describedby')).toContain(alert.id);
    // Typing clears it.
    fireEvent.change(field(), { target: { value: '8' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a log announces "Bodyweight logged" and hands focus to Change once the row arrives', async () => {
    const { rerender } = render(section());
    fireEvent.change(field(), { target: { value: '84.5' } });
    await act(async () => {
      fireEvent.click(logButton());
    });
    expect(logBodyweightAction).toHaveBeenCalledOnce();
    expect(statusText()).toBe(BODYWEIGHT_COPY.announcedLogged);
    const w = weight(84.5);
    rerender(section({ logged: [w] }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: changeLabel('weight', shown(w)) }),
    );
  });

  it('a refused log whose form is replaced (the day was taken) stays on screen as an alert', async () => {
    vi.mocked(logBodyweightAction).mockResolvedValueOnce({
      ok: false,
      error: BODYWEIGHT_COPY.dayTaken,
    });
    const { rerender } = render(section());
    fireEvent.change(field(), { target: { value: '84.5' } });
    await act(async () => {
      fireEvent.click(logButton());
    });
    rerender(section({ logged: [weight(85)] }));
    expect(screen.getByRole('alert').textContent).toBe(BODYWEIGHT_COPY.dayTaken);
    // Opening Change dismisses it: it was about a log, not the value now being changed.
    fireEvent.click(screen.getByRole('button', { name: changeLabel('weight', shown(weight(85))) }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does NOT announce when paging from an empty day to a logged one (not a save)', () => {
    const { rerender } = render(section());
    rerender(section({ day: NEXT_DAY, logged: [weight(84.5)] }));
    expect(statusText()).toBe('');
    expect(document.activeElement).toBe(document.body);
  });

  /**
   * P1 on #180: without `key={day}` the form survives a client-side day change with its
   * `useState(newId)` key, so a key spent on one day is replayed for the next.
   */
  it('mints a fresh client id when the day changes, and keeps it while the day does not', () => {
    const { rerender } = render(section());
    const first = clientId();
    expect(first).toBeTruthy();
    rerender(section());
    expect(clientId(), 'a re-render of the SAME day must keep its key (idempotency)').toBe(first);
    rerender(section({ day: NEXT_DAY }));
    expect(clientId(), 'a new day must not inherit the previous day’s key').not.toBe(first);
  });
});

describe('BodyweightSection — Change, Save and Clear (plan W5, W6)', () => {
  const W = weight(84.5, 'entry-a');
  const amendInput = () =>
    screen.queryByLabelText(AMEND_COPY.valueLabel(W.unit)) as HTMLInputElement | null;
  const changeButton = (w: LoggedBodyweight = W) =>
    screen.getByRole('button', { name: changeLabel('weight', shown(w)) });
  const open = (w: LoggedBodyweight = W) => fireEvent.click(changeButton(w));

  it('opens with the saved value SELECTED, so the first digit replaces it', () => {
    render(section({ logged: [W] }));
    open();
    const input = amendInput()!;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    // v12's order: Cancel, then Save. The value stays visible above the editor.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual([AMEND_COPY.cancel, AMEND_COPY.save]);
    expect(screen.getByText(shown(W), { exact: false })).toBeTruthy();
  });

  it('the hint is always there, and Save reads Clear while the field is empty', () => {
    render(section({ logged: [W] }));
    open();
    const hint = screen.getByText(BODYWEIGHT_COPY.clearHint);
    expect(amendInput()!.getAttribute('aria-describedby')).toContain(hint.id);
    fireEvent.change(amendInput()!, { target: { value: '  ' } });
    const clear = screen.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel });
    expect(clear.textContent).toBe(BODYWEIGHT_COPY.clear);
    expect(clear.getAttribute('data-variant')).toBe('destructive');
    fireEvent.change(amendInput()!, { target: { value: '8' } });
    expect(screen.getByRole('button', { name: AMEND_COPY.save })).toBeTruthy();
  });

  it('an archived athlete: Save stays Save, no hint, and a blank is refused before any request', async () => {
    render(section({ logged: [W], writable: false, amendable: true }));
    open();
    expect(screen.queryByText(BODYWEIGHT_COPY.clearHint)).toBeNull();
    fireEvent.change(amendInput()!, { target: { value: '' } });
    const save = screen.getByRole('button', { name: AMEND_COPY.save });
    // Move focus OFF the field first: the editor focused it on open, so asserting it after the tap
    // would pass with the refusal's own focus call deleted (docs/lessons.md, focus assertions).
    save.focus();
    expect(document.activeElement).toBe(save);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(editBodyweightAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(BODYWEIGHT_COPY.blankSave);
    expect(document.activeElement).toBe(amendInput());
  });

  it('a save announces the new value and focuses Change', async () => {
    const { rerender } = render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '85.2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    const after = weight(85.2, 'entry-a');
    rerender(section({ logged: [after] }));
    expect(amendInput()).toBeNull();
    expect(statusText()).toBe(BODYWEIGHT_COPY.announcedChanged(shown(after)));
    expect(document.activeElement).toBe(changeButton(after));
  });

  it('a clear shows "cleared, it was …" and puts focus on the field that replaces the row', async () => {
    const { rerender } = render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel }));
    });
    rerender(section({ logged: [] }));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(BODYWEIGHT_COPY.announcedCleared(shown(W)));
    expect(status.className).not.toContain('sr-only'); // shown, not only spoken
    expect(document.activeElement).toBe(field());
    // A field error does not replace it; a log does.
    await act(async () => {
      fireEvent.click(logButton());
    });
    expect(statusText()).toBe(BODYWEIGHT_COPY.announcedCleared(shown(W)));
    fireEvent.change(field(), { target: { value: '85' } });
    await act(async () => {
      fireEvent.click(logButton());
    });
    expect(statusText()).toBe(BODYWEIGHT_COPY.announcedLogged);
  });

  it('the field after a clear is described by the cleared line, so arriving focus reads it', async () => {
    const { rerender } = render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel }));
    });
    rerender(section({ logged: [] }));
    const statusId = screen.getByRole('status').id;
    expect(statusId).not.toBe('');
    expect(field().getAttribute('aria-describedby')?.split(' ')).toContain(statusId);
  });

  it('a spoken-only status never describes the field: not on load, not after a log cleared elsewhere', async () => {
    const { rerender } = render(section());
    const statusId = screen.getByRole('status').id;
    expect(field().getAttribute('aria-describedby')?.split(' ') ?? []).not.toContain(statusId);
    fireEvent.change(field(), { target: { value: '84.5' } });
    await act(async () => {
      fireEvent.click(logButton());
    });
    rerender(section({ logged: [weight(84.5)] }));
    rerender(section({ logged: [] })); // another phone cleared it
    expect(statusText()).toBe(BODYWEIGHT_COPY.announcedLogged);
    expect(field().getAttribute('aria-describedby')?.split(' ') ?? []).not.toContain(statusId);
  });

  it('a day change drops an open editor and its typed value', () => {
    const { rerender } = render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '85.2' } });
    const b = weight(70, 'entry-b');
    rerender(section({ day: NEXT_DAY, logged: [b] }));
    expect(amendInput()).toBeNull();
    expect(changeButton(b)).toBeTruthy();
  });

  /** P1-1 on 1b: after a refused stale save revalidates, the box must hold the value that WON. */
  it('a revalidated value replaces the typed one while the editor is open', () => {
    const { rerender } = render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '84.9' } });
    rerender(section({ logged: [weight(85.2, 'entry-a')] }));
    expect(amendInput()!.value).toBe('85.2');
    expect(statusText()).toBe('');
  });

  it('Cancel returns focus to Change', () => {
    render(section({ logged: [W] }));
    open();
    fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.cancel }));
    expect(document.activeElement).toBe(changeButton());
  });

  it('a stale refusal is an alert, never announced as saved, and Cancel or a reopen drops it', async () => {
    vi.mocked(editBodyweightAction).mockResolvedValueOnce({
      ok: false,
      error: AMEND_ERROR_COPY.staleWrite,
    });
    render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '85' } });
    const save = screen.getByRole('button', { name: AMEND_COPY.save });
    save.focus(); // off the field, so the refusal's focus hand-off is what puts it back
    await act(async () => {
      fireEvent.click(save);
    });
    expect(screen.getByRole('alert').textContent).toBe(AMEND_ERROR_COPY.staleWrite);
    expect(statusText()).toBe('');
    expect(document.activeElement).toBe(amendInput());
    fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.cancel }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  /** A field error from one open must not reappear under a freshly re-seeded, correct value. */
  it('a reopened editor does not show the last open’s field error', async () => {
    vi.mocked(editBodyweightAction).mockResolvedValueOnce({
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: { value: [IMPLAUSIBLE_BODYWEIGHT_MESSAGE] },
    });
    render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '845' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    expect(screen.getByRole('alert').textContent).toBe(IMPLAUSIBLE_BODYWEIGHT_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.cancel }));
    open();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // V1-24 3b-life-a: the shared editor's two new branches, on the bodyweight row.
  it('a refusal under the field hands focus back to it (the tap on Save had blurred it)', async () => {
    vi.mocked(editBodyweightAction).mockResolvedValueOnce({
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: { value: [IMPLAUSIBLE_BODYWEIGHT_MESSAGE] },
    });
    render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '845' } });
    amendInput()!.blur(); // jsdom does not blur on click; a phone's tap does
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    expect(document.activeElement).toBe(amendInput());
  });

  it('a refusal on a field the editor does not show reads as not found, never "fix the errors below"', async () => {
    vi.mocked(editBodyweightAction).mockResolvedValueOnce({
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: { unit: ['Invalid option'] },
    });
    render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '85' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    expect(screen.getByRole('alert').textContent).toBe(AMEND_ERROR_COPY.notFound('weight'));
  });
});

// The one place the duplicates copy is typed out: a CONTRACT test pinning the const's branches (the
// AGENTS.md exception), because "twice" vs "N times" and "extra" vs "extras" is logic, not a literal.
describe('BODYWEIGHT_COPY.duplicates — its wording per case', () => {
  it('the same value repeated: "twice"/"N times", the extra(s) can’t be removed in the app yet', () => {
    expect(BODYWEIGHT_COPY.duplicates(['84.5 lb', '84.5 lb'])).toBe(
      'Logged twice — the extra can’t be removed in the app yet; ask a parent.',
    );
    expect(BODYWEIGHT_COPY.duplicates(['84.5 lb', '84.5 lb', '84.5 lb'])).toBe(
      'Logged 3 times — the extras can’t be removed in the app yet; ask a parent.',
    );
  });
  it('different values: asks which is right, never "remove the extra"', () => {
    const differ =
      'The weights differ — ask a parent which is right; it can’t be fixed in the app yet.';
    expect(BODYWEIGHT_COPY.duplicates(['84.5 lb', '845 lb'])).toBe(differ);
    expect(BODYWEIGHT_COPY.duplicates(['84.5 lb', '84.5 lb', '845 lb'])).toBe(differ);
  });
});
