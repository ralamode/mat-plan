// @vitest-environment jsdom
import { DEFAULT_BODYWEIGHT_UNIT, IMPLAUSIBLE_BODYWEIGHT_MESSAGE } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The form imports the Server Action module ('use server'), which cannot be evaluated under jsdom
// (the precedent every component test that imports it follows). This file is about what the
// SECTION renders.
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

import { DAY_COPY } from '@/components/day/day-copy';
import { openFolded } from '@/components/day/day-test-utils';

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
  it('is headed "Bodyweight", and named so, in EVERY state (folded too)', () => {
    for (const props of [
      { logged: [] },
      { logged: [weight(84.5)] },
      { logged: [], writable: false },
      { logged: [weight(84.5)], writable: false },
    ]) {
      render(section(props));
      expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(
        BODYWEIGHT_COPY.heading,
      );
      // The region keeps its bare name when folded (12c-iii §3): the e2e finds it by exact name.
      expect(screen.getByRole('region', { name: BODYWEIGHT_COPY.heading })).toBeTruthy();
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
    openFolded();
    expect(screen.getByText(BODYWEIGHT_COPY.logged).className).toContain('sr-only');
    expect(screen.getByText(shown(w), { exact: false })).toBeTruthy();
    // THE half that stops the second submit: no create form.
    expect(screen.queryByLabelText('Weight')).toBeNull();
    expect(screen.queryByRole('button', { name: BODYWEIGHT_COPY.logLabel })).toBeNull();
    expect(
      screen.getByRole('button', { name: changeLabel(BODYWEIGHT_COPY.changeSubject, shown(w)) }),
    ).toBeTruthy();
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
      screen.getByRole('button', { name: changeLabel(BODYWEIGHT_COPY.changeSubject, shown(w)) }),
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
    fireEvent.click(
      screen.getByRole('button', {
        name: changeLabel(BODYWEIGHT_COPY.changeSubject, shown(weight(85))),
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does NOT announce when paging from an empty day to a logged one (not a save)', () => {
    const { rerender } = render(section());
    rerender(section({ day: NEXT_DAY, logged: [weight(84.5)] }));
    // The logged day arrives folded, so its region is behind the line.
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('');
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
    screen.getByRole('button', { name: changeLabel(BODYWEIGHT_COPY.changeSubject, shown(w)) });
  /** Change, after opening the section: a logged weight on a writable day arrives as one line. */
  const open = (w: LoggedBodyweight = W) => {
    openFolded();
    fireEvent.click(changeButton(w));
  };
  const SAVE = BODYWEIGHT_COPY.saveLabel;
  const CANCEL = BODYWEIGHT_COPY.cancelLabel;

  it('opens with the saved value SELECTED, so the first digit replaces it', () => {
    render(section({ logged: [W] }));
    open();
    const input = amendInput()!;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    // The icon-only pair on the field's line: ✓ then ✕ (maintainer, 2026-11-16). The value stays
    // visible above the editor.
    const buttons = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(buttons).toEqual([SAVE, CANCEL]);
    expect(input.parentElement!.contains(screen.getByRole('button', { name: CANCEL }))).toBe(true);
    expect(screen.getByText(shown(W), { exact: false })).toBeTruthy();
  });

  it('the hint is always there, and the ✓ is named Clear while the field is empty', () => {
    render(section({ logged: [W] }));
    open();
    const hint = screen.getByText(BODYWEIGHT_COPY.clearHint);
    expect(amendInput()!.getAttribute('aria-describedby')).toContain(hint.id);
    fireEvent.change(amendInput()!, { target: { value: '  ' } });
    // Same ✓, same look (no red Clear); only its name follows the clear.
    const clear = screen.getByRole('button', { name: BODYWEIGHT_COPY.clearLabel });
    expect(clear.getAttribute('data-variant')).toBe('default');
    fireEvent.change(amendInput()!, { target: { value: '8' } });
    expect(screen.getByRole('button', { name: SAVE })).toBe(clear);
  });

  it('an archived athlete: the ✓ keeps its save name, no hint, and a blank is refused before any request', async () => {
    render(section({ logged: [W], writable: false, amendable: true }));
    open();
    expect(screen.queryByText(BODYWEIGHT_COPY.clearHint)).toBeNull();
    fireEvent.change(amendInput()!, { target: { value: '' } });
    const save = screen.getByRole('button', { name: SAVE });
    // Move focus OFF the field first: the editor focused it on open, so asserting it after the tap
    // would pass with the refusal's own focus call deleted (docs/lessons.md, focus assertions).
    save.focus();
    expect(document.activeElement).toBe(save);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(editBodyweightAction).not.toHaveBeenCalled();
    // The copy names the ✓; a screen reader hears its name in the glyph's place.
    expect(screen.getByRole('alert').textContent).toBe(
      BODYWEIGHT_COPY.blankSave.replace('✓', `✓${SAVE}`),
    );
    expect(document.activeElement).toBe(amendInput());
  });

  it('a save announces the new value and focuses Change', async () => {
    const { rerender } = render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '85.2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
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
    // A new day is a new visit: it arrives folded (12c-iii §1).
    openFolded();
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

  it('Escape cancels from the field and from the ✓, and returns focus to Change', () => {
    render(section({ logged: [W] }));
    open();
    fireEvent.keyDown(amendInput()!, { key: 'Escape' });
    expect(amendInput()).toBeNull();
    expect(document.activeElement).toBe(changeButton());
    open();
    fireEvent.keyDown(screen.getByRole('button', { name: SAVE }), { key: 'Escape' });
    expect(amendInput()).toBeNull();
    expect(document.activeElement).toBe(changeButton());
  });

  it('while a save is in flight, Escape and the ✕ do nothing, and the ✕ is hidden', async () => {
    let resolve!: (r: { ok: true }) => void;
    vi.mocked(editBodyweightAction).mockImplementationOnce(
      () => new Promise((r) => (resolve = r as typeof resolve)),
    );
    render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '85' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
    });
    expect(screen.getByRole('button', { name: SAVE }).getAttribute('aria-busy')).toBe('true');
    // jsdom loads no CSS, so the class is the only check that it is hidden (no e2e holds a save in
    // flight); the click below proves the guard does not rest on CSS.
    const x = screen.getByRole('button', { name: CANCEL });
    expect(x.className).toMatch(/\binvisible\b/);
    fireEvent.keyDown(amendInput()!, { key: 'Escape' });
    expect(amendInput()).not.toBeNull();
    fireEvent.click(x); // the ✕ is still painted for a moment in a real browser
    expect(amendInput()).not.toBeNull();
    await act(async () => resolve({ ok: true }));
  });

  it('Cancel returns focus to Change', () => {
    render(section({ logged: [W] }));
    open();
    fireEvent.click(screen.getByRole('button', { name: CANCEL }));
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
    const save = screen.getByRole('button', { name: SAVE });
    save.focus(); // off the field, so the refusal's focus hand-off is what puts it back
    await act(async () => {
      fireEvent.click(save);
    });
    expect(screen.getByRole('alert').textContent).toBe(AMEND_ERROR_COPY.staleWrite);
    expect(statusText()).toBe('');
    expect(document.activeElement).toBe(amendInput());
    fireEvent.click(screen.getByRole('button', { name: CANCEL }));
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
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
    });
    expect(screen.getByRole('alert').textContent).toBe(IMPLAUSIBLE_BODYWEIGHT_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: CANCEL }));
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
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
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
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
    });
    expect(screen.getByRole('alert').textContent).toBe(
      AMEND_ERROR_COPY.notFound(BODYWEIGHT_COPY.noun),
    );
  });
});

describe('BodyweightSection — one weight folds to one line (FAM-1 12c-iii)', () => {
  const W = weight(84.5, 'entry-a');
  const line = () => screen.queryByRole('button', { expanded: false });
  const collapse = () =>
    screen.queryByRole('button', { name: DAY_COPY.collapseLabel(BODYWEIGHT_COPY.heading) });
  const change = (w: LoggedBodyweight = W) =>
    screen.queryByRole('button', { name: changeLabel(BODYWEIGHT_COPY.changeSubject, shown(w)) });
  const SAVE = BODYWEIGHT_COPY.saveLabel;

  it('a weight logged when the day opens arrives as "Bodyweight, 84.5 lb", its Change behind it', () => {
    render(section({ logged: [W] }));
    expect(line()!.getAttribute('aria-label')).toBe(`${BODYWEIGHT_COPY.heading}, ${shown(W)}`);
    expect(change()).toBeNull();
    expect(screen.getByRole('region', { name: BODYWEIGHT_COPY.heading })).toBeTruthy();
  });

  it('never folds: nothing logged, two weights, a read-only day or an archived athlete with one weight', () => {
    for (const props of [
      { logged: [] },
      { logged: [weight(84.5, 'a'), weight(845, 'b')] },
      { logged: [W], writable: false, amendable: false },
      { logged: [W], writable: false, amendable: true },
    ]) {
      render(section(props));
      expect(line()).toBeNull();
      expect(collapse()).toBeNull();
      cleanup();
    }
  });

  it('a weight logged during the visit stays open, with Collapse; a new day, an athlete, or back again folds', async () => {
    const { rerender } = render(section());
    fireEvent.change(field(), { target: { value: '84.5' } });
    await act(async () => {
      fireEvent.click(logButton());
    });
    rerender(section({ logged: [W] }));
    expect(line()).toBeNull();
    expect(collapse()).not.toBeNull();
    // Coming back is a new mount: the section is keyed on athlete and day.
    rerender(section({ day: NEXT_DAY, logged: [] }));
    rerender(section({ logged: [W] }));
    expect(line()).not.toBeNull();
    openFolded();
    rerender(section({ profileId: 'p2', logged: [W] }));
    expect(line()).not.toBeNull();
  });

  it('a tap opens it with focus on Collapse, Collapse folds it with focus on the line, and nothing is announced', () => {
    render(section({ logged: [W] }));
    fireEvent.click(line()!);
    expect(document.activeElement).toBe(collapse());
    expect(change()).not.toBeNull();
    fireEvent.click(collapse()!);
    expect(document.activeElement).toBe(line());
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('');
  });

  it('no Collapse while the editor is open; it returns on Cancel', () => {
    render(section({ logged: [W] }));
    openFolded();
    fireEvent.click(change()!);
    expect(collapse()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: BODYWEIGHT_COPY.cancelLabel }));
    expect(collapse()).not.toBeNull();
  });

  it('no Collapse while a save is in flight; it returns once the save lands', async () => {
    let resolve!: (r: { ok: true; error: null }) => void;
    vi.mocked(editBodyweightAction).mockImplementationOnce(
      () => new Promise((r) => (resolve = r as typeof resolve)),
    );
    const { rerender } = render(section({ logged: [W] }));
    openFolded();
    fireEvent.click(change()!);
    fireEvent.change(screen.getByLabelText(AMEND_COPY.valueLabel(W.unit)), {
      target: { value: '85' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SAVE }));
    });
    expect(screen.getByRole('button', { name: SAVE }).getAttribute('aria-busy')).toBe('true');
    expect(collapse()).toBeNull();
    await act(async () => resolve({ ok: true, error: null }));
    rerender(section({ logged: [weight(85, 'entry-a')] }));
    expect(collapse()).not.toBeNull();
  });

  it('no Collapse while an alert shows; it returns once the alert goes', async () => {
    vi.mocked(logBodyweightAction).mockResolvedValueOnce({
      ok: false,
      error: BODYWEIGHT_COPY.dayTaken,
    });
    const { rerender } = render(section());
    fireEvent.change(field(), { target: { value: '84.5' } });
    await act(async () => {
      fireEvent.click(logButton());
    });
    const other = weight(85);
    rerender(section({ logged: [other] }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(collapse()).toBeNull();
    // Change drops it; Cancel closes the editor: nothing is left behind the line.
    fireEvent.click(change(other)!);
    fireEvent.click(screen.getByRole('button', { name: BODYWEIGHT_COPY.cancelLabel }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(collapse()).not.toBeNull();
  });

  it('under StrictMode a mount moves no focus, and a tap still focuses Collapse', () => {
    render(<StrictMode>{section({ logged: [W] })}</StrictMode>);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(line()!);
    expect(document.activeElement).toBe(collapse());
    fireEvent.click(collapse()!);
    expect(document.activeElement).toBe(line());
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
