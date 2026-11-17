// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  logLifeActivitiesAction: vi.fn(async () => ({ ok: true, error: null })),
}));

import { PRACTICE_COPY } from '@/lib/constants';

import { logLifeActivitiesAction } from './actions';
import { PracticeForm } from './life-form';
import { SingleValueLive } from './single-value-live';

// COMPONENT TIER (RTL/jsdom). V1-24 3b-life-b: the typed practice row (plan B1–B5). Every expected
// string comes from `PRACTICE_COPY`.
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const DAY = '2026-11-16';
const renderForm = () =>
  render(
    <SingleValueLive>
      <PracticeForm profileId="019826b4-0000-7000-8000-000000000001" day={DAY} />
    </SingleValueLive>,
  );
const field = () => screen.getByLabelText(PRACTICE_COPY.fieldLabel) as HTMLInputElement;
const tick = () => screen.getByRole('button', { name: PRACTICE_COPY.logLabel });
const submit = async () => {
  await act(async () => {
    fireEvent.click(tick());
  });
};
const postedClientId = (call: number) =>
  (vi.mocked(logLifeActivitiesAction).mock.calls[call]![1] as FormData).get('clientId');

describe('PracticeForm — the typed row (3b-life-b)', () => {
  it('a real label names the field (the label text is a tap target), with a numeric keypad', () => {
    renderForm();
    expect(field().getAttribute('inputmode')).toBe('numeric');
    expect(field().value).toBe(''); // no prefill (maintainer, 2026-11-15)
    expect(screen.getByText(PRACTICE_COPY.label).tagName).toBe('LABEL');
  });

  it.each([
    ['empty', '', PRACTICE_COPY.blankLog.replace('✓', `✓${PRACTICE_COPY.logLabel}`)],
    ['an hours-shaped 2', '2', PRACTICE_COPY.hoursNotMinutes('2')],
    ['a decimal 1.5', '1.5', PRACTICE_COPY.hoursNotMinutes('1.5')],
    ['above the ceiling', '301', PRACTICE_COPY.outOfRange],
  ])('refuses %s before any request, with focus on the field', async (_what, typed, message) => {
    renderForm();
    fireEvent.change(field(), { target: { value: typed } });
    await submit();
    expect(logLifeActivitiesAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe(typed); // controlled: the typed value survives
  });

  it('the ✓ is outline while empty and filled once a value waits to be sent (B3)', () => {
    renderForm();
    expect(tick().hasAttribute('data-ready')).toBe(false);
    fireEvent.change(field(), { target: { value: '45' } });
    expect(tick().hasAttribute('data-ready')).toBe(true);
    fireEvent.change(field(), { target: { value: '  ' } });
    expect(tick().hasAttribute('data-ready')).toBe(false);
  });

  it('posts the typed minutes, and a refusal mints a fresh client id for the next try (B4)', async () => {
    vi.mocked(logLifeActivitiesAction).mockResolvedValueOnce({
      ok: false,
      error: PRACTICE_COPY.notSaved,
    });
    renderForm();
    fireEvent.change(field(), { target: { value: '45' } });
    await submit();
    const sent = vi.mocked(logLifeActivitiesAction).mock.calls[0]![1] as FormData;
    expect(sent.get('minutes')).toBe('45');
    expect(screen.getByRole('alert').textContent).toBe(
      PRACTICE_COPY.notSaved.replace('✓', `✓${PRACTICE_COPY.logLabel}`),
    );
    await submit();
    expect(postedClientId(1)).not.toBe(postedClientId(0));
  });

  it('a success keeps the client id (a replay of the same write stays one write)', async () => {
    vi.mocked(logLifeActivitiesAction)
      .mockResolvedValueOnce({ ok: true, error: null })
      .mockResolvedValueOnce({ ok: true, error: null });
    renderForm();
    fireEvent.change(field(), { target: { value: '45' } });
    await submit();
    await submit();
    expect(postedClientId(1)).toBe(postedClientId(0));
  });

  it('a refusal the server puts on the field shows under it and hands focus back to it', async () => {
    vi.mocked(logLifeActivitiesAction).mockResolvedValueOnce({
      ok: false,
      error: PRACTICE_COPY.outOfRange,
      fieldErrors: { minutes: [PRACTICE_COPY.outOfRange] },
    });
    renderForm();
    fireEvent.change(field(), { target: { value: '45' } });
    field().blur(); // jsdom does not blur on click; a phone's tap does
    await submit();
    expect(screen.getByRole('alert').textContent).toBe(PRACTICE_COPY.outOfRange);
    expect(document.activeElement).toBe(field());
  });
});
