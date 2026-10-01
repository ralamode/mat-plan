// @vitest-environment jsdom
import { DEFAULT_BODYWEIGHT_UNIT } from '@mat-plan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form imports the Server Action module ('use server'), which cannot be evaluated under jsdom
// (the strength-form.test.tsx precedent). This file is about what the SECTION renders.
vi.mock('./actions', () => ({
  logBodyweightAction: vi.fn(),
  editBodyweightAction: vi.fn(async () => ({ ok: true, error: null })),
}));

import {
  AMEND_COPY,
  AMEND_ERROR_COPY,
  BODYWEIGHT_COPY,
  BODYWEIGHT_RECEIPT_ID,
  changeLabel,
  CLOSED_DAY_NOTICE,
} from '@/lib/constants';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';

import { editBodyweightAction } from './actions';
import { BodyweightSection } from './bodyweight-section';

// COMPONENT TIER (RTL/jsdom). V1-24 PR 1a: the weigh-in section's states, from the plan's
// §"The 1a receipt, exactly". Every expected string comes from BODYWEIGHT_COPY, never re-typed.
afterEach(cleanup);

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
  <BodyweightSection profileId="p1" day={DAY} writable logged={[]} {...overrides} />
);

/** Every status region in the section, joined — the create announcer AND the amend's own. */
const statusText = () =>
  screen
    .getAllByRole('status')
    .map((el) => el.textContent)
    .join('');

const clientId = () =>
  document.querySelector<HTMLInputElement>('input[name="clientId"]')?.value ?? null;

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

  it('writable + nothing logged → the form, and no receipt', () => {
    render(section());
    expect(screen.getByLabelText('Weight')).toBeTruthy();
    expect(document.getElementById(BODYWEIGHT_RECEIPT_ID)).toBeNull();
  });

  it('one weight on a writable day → the receipt, the reason there is no form, a Change control', () => {
    const w = weight(84.5);
    render(section({ logged: [w] }));
    const receipt = document.getElementById(BODYWEIGHT_RECEIPT_ID)!;
    expect(receipt.getAttribute('tabindex')).toBe('-1'); // focusable by script, not in tab order
    expect(screen.getByText(BODYWEIGHT_COPY.saved(shown(w)))).toBeTruthy();
    expect(screen.getByText(BODYWEIGHT_COPY.onePerDay)).toBeTruthy();
    // THE half that stops the second submit: no CREATE form. (V1-24 PR 1b replaced the "ask a
    // parent" recovery line with the amend itself — the line's own docblock said 1b deletes it.)
    expect(screen.queryByLabelText('Weight')).toBeNull();
    expect(screen.queryByRole('button', { name: /Log weight/ })).toBeNull();
    // ...and the amend, named with its value so several Changes on one screen stay distinguishable.
    expect(screen.getByRole('button', { name: changeLabel('weight', shown(w)) })).toBeTruthy();
  });

  it('several weights → all of them, never silently the newest', () => {
    const rows = [weight(84.5), weight(845)];
    render(section({ logged: rows }));
    expect(screen.getByText(BODYWEIGHT_COPY.several(rows.map(shown)))).toBeTruthy();
  });

  /**
   * Round 2 on #180: the commonest duplicate is ONE value twice (a double submit), where "One
   * weigh-in per day." contradicts the headline and "Wrong number?" asks about a right number. So a
   * duplicates receipt carries one line — what the parent has to do — on open AND closed days.
   */
  it('duplicates → one "ask a parent" line, and NO Change control', () => {
    for (const writable of [true, false]) {
      for (const rows of [
        [weight(84.5, 'a'), weight(84.5, 'b')], // the double submit
        [weight(84.5, 'a'), weight(845, 'b')], // two different weights
        [weight(84.5, 'a'), weight(84.5, 'b'), weight(845, 'c')],
      ]) {
        render(section({ logged: rows, writable }));
        expect(screen.getByText(BODYWEIGHT_COPY.several(rows.map(shown)))).toBeTruthy();
        expect(screen.getByText(BODYWEIGHT_COPY.duplicates(rows.map(shown)))).toBeTruthy();
        expect(screen.queryByText(BODYWEIGHT_COPY.onePerDay)).toBeNull();
        // ⚠️ V1-24 PR 1b: one row's worth of control cannot serve N rows. It would edit an unstated
        // one of them — most likely the CORRECT one — leaving two wrong values where there was one,
        // beside copy that says it can't be fixed in the app. An amend cannot remove a row; 1c/1d can.
        expect(screen.queryByRole('button', { name: /^Change/ })).toBeNull();
        cleanup();
      }
    }
  });

  /**
   * ⚠️ THE Decision 5 test. The amend has NO day bound — an amend never moves the entry's date — so
   * gating the control on `writable` would be that bound wearing a client-side hat, and would hide
   * it on exactly the history days a typo is found on. The 2026-09-28 entry that opened V1-24 was
   * corrected two days later.
   */
  it('a closed day still offers the amend, and does not repeat the page banner', () => {
    const w = weight(84.5);
    render(section({ logged: [w], writable: false }));
    expect(screen.getByText(BODYWEIGHT_COPY.saved(shown(w)))).toBeTruthy();
    expect(screen.getByRole('button', { name: changeLabel('weight', shown(w)) })).toBeTruthy();
    expect(screen.queryByText(BODYWEIGHT_COPY.onePerDay)).toBeNull();
    expect(screen.queryByText(CLOSED_DAY_NOTICE)).toBeNull();
  });

  it('a closed day with nothing → "No weight logged.", not a bare heading', () => {
    render(section({ writable: false }));
    expect(screen.getByText(BODYWEIGHT_COPY.noneOnClosedDay)).toBeTruthy();
    expect(screen.queryByLabelText('Weight')).toBeNull();
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

describe('BodyweightSection — across a save and a day change', () => {
  it('announces the saved value and focuses the receipt when the form is replaced by it', () => {
    const w = weight(84.5);
    const { rerender } = render(section());
    rerender(section({ logged: [w] }));
    expect(statusText()).toBe(BODYWEIGHT_COPY.announced(shown(w)));
    expect(document.activeElement?.id).toBe(BODYWEIGHT_RECEIPT_ID);
  });

  it('does NOT announce when paging from an empty day to a logged one (not a save)', () => {
    const { rerender } = render(section());
    rerender(section({ day: NEXT_DAY, logged: [weight(84.5)] }));
    expect(statusText()).toBe('');
    expect(document.activeElement).toBe(document.body);
  });

  /**
   * P1 on #180 (verified): without `key={day}` the form survives a client-side day change with its
   * `useState(newId)` key, so a key spent on one day is replayed for the next — an `ON CONFLICT DO
   * NOTHING` no-op that reports success and saves nothing.
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

describe('BodyweightSection — the amend (V1-24 PR 1b review fixes)', () => {
  const W = weight(84.5, 'entry-a');
  const amendInput = () =>
    screen.queryByLabelText(AMEND_COPY.valueLabel(W.unit)) as HTMLInputElement | null;
  const open = (w: LoggedBodyweight = W) =>
    fireEvent.click(screen.getByRole('button', { name: changeLabel('weight', shown(w)) }));

  /** P1-2: paging days is a client-side transition; an unkeyed island amended the OTHER day's row. */
  it('a day change drops an open editor and its typed value', () => {
    const { rerender } = render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '85.2' } });
    const b = weight(70, 'entry-b');
    rerender(section({ day: NEXT_DAY, logged: [b] }));
    expect(amendInput()).toBeNull();
    expect(screen.getByRole('button', { name: changeLabel('weight', shown(b)) })).toBeTruthy();
  });

  /** P1-1: after a refused stale save revalidates, the box must hold the value that WON. */
  it('a revalidated value replaces the typed one while the editor is open', () => {
    const { rerender } = render(section({ logged: [W] }));
    open();
    fireEvent.change(amendInput()!, { target: { value: '84.9' } });
    rerender(section({ logged: [weight(85.2, 'entry-a')] }));
    expect(amendInput()!.value).toBe('85.2');
    // ...and that is not announced as a save, nor does it pull focus out of the editor.
    expect(statusText()).toBe('');
  });

  it('the input is named with its unit', () => {
    render(section({ logged: [W] }));
    open();
    expect(amendInput()).toBeTruthy();
  });

  /** P1-4: Cancel unmounts the button that had focus; focus goes back to Change, not <body>. */
  it('Cancel returns focus to Change', () => {
    render(section({ logged: [W] }));
    open();
    fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.cancel }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: changeLabel('weight', shown(W)) }),
    );
  });

  /** P1-3: announced from the action's own success — so even an unchanged value is announced. */
  it('a successful save of the SAME value announces and focuses the receipt', async () => {
    render(section({ logged: [W] }));
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    expect(amendInput()).toBeNull();
    expect(statusText()).toBe(BODYWEIGHT_COPY.announced(shown(W)));
    expect(document.activeElement?.id).toBe(BODYWEIGHT_RECEIPT_ID);
  });

  /** An error from a previous open must not reappear under a freshly re-seeded, correct value. */
  it('a reopened editor does not show the last open’s error', async () => {
    vi.mocked(editBodyweightAction).mockResolvedValueOnce({
      ok: false,
      error: AMEND_ERROR_COPY.staleWrite,
    });
    render(section({ logged: [W] }));
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.save }));
    });
    expect(screen.getByRole('alert').textContent).toBe(AMEND_ERROR_COPY.staleWrite);
    expect(statusText()).toBe(''); // a refusal is never announced as saved
    fireEvent.click(screen.getByRole('button', { name: AMEND_COPY.cancel }));
    open();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
