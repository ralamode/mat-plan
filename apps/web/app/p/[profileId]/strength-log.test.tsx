// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form imports the Server Action module ('use server'), which jsdom can't evaluate.
vi.mock('./actions', () => ({
  logStrengthSessionAction: vi.fn(async () => ({ ok: true, error: null, savedId: 's-new' })),
}));

import { STRENGTH_COPY, strengthReceiptId } from '@/lib/constants';

import { logStrengthSessionAction } from './actions';
import { StrengthForm } from './strength-form';

// V1-24 3a-ii — the StrengthForm ISLAND: open/collapsed, the "Log more" toggle, the trust lines, and
// announcing + focusing a save from its OWN action result (never from a server-side count change).
afterEach(cleanup);

type Logged = { id: string; heading: string; names: string }[];
const S1: Logged = [{ id: 's1', heading: 'Strength A session', names: 'Back squat, Bench' }];
const island = (logged: Logged, alreadySaved: string | null = null) => (
  <>
    {/* Stand-ins for the section's receipts, so focus has somewhere to land. */}
    {logged.map((l) => (
      <div key={l.id} id={strengthReceiptId(l.id)} tabIndex={-1} />
    ))}
    <StrengthForm
      profileId="p1"
      day="2026-10-02"
      defaultDayRole={null}
      programDay={[]}
      logged={logged}
      alreadySaved={alreadySaved}
    />
  </>
);
const toggle = () => screen.getByRole('button', { name: STRENGTH_COPY.logMore });
// By attribute, not role: a `hidden` group is (correctly) out of the accessibility tree.
const group = () =>
  document.querySelector<HTMLElement>(`[role="group"][aria-label="${STRENGTH_COPY.group}"]`)!;
const statusText = () => screen.getAllByRole('status')[0]!.textContent;
const nameInput = () => screen.getByLabelText('Movement');
function fillOneSet() {
  fireEvent.change(nameInput(), { target: { value: 'Rows' } });
  fireEvent.change(screen.getByLabelText('Movement 1 set 1 reps'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText(/^Movement 1 set 1 weight/), { target: { value: '95' } });
}
async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: STRENGTH_COPY.submit }));
  });
}

describe('StrengthForm island — the form after a save (V1-24 3a-ii)', () => {
  it('nothing logged: no toggle, the form is simply open', () => {
    render(island([]));
    expect(screen.queryByRole('button', { name: STRENGTH_COPY.logMore })).toBeNull();
    expect(screen.queryByRole('button', { name: STRENGTH_COPY.close })).toBeNull();
    expect(group().hidden).toBe(false);
  });

  it('something logged: starts collapsed behind "Log more strength"', () => {
    render(island(S1, 'Back squat, Bench'));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe(group().id);
    expect(group().hidden).toBe(true);
  });

  it('opening shows the trust lines, describes the focused group with them', () => {
    render(island(S1, 'Back squat, Bench (skipped)'));
    fireEvent.click(toggle());
    expect(group().hidden).toBe(false);
    expect(document.activeElement).toBe(group());
    const described = (group().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual([
      STRENGTH_COPY.alreadySaved('Back squat, Bench (skipped)'),
      STRENGTH_COPY.newSession,
    ]);
  });

  it('Cancel hides (never unmounts): a typed draft survives a reopen, and focus returns to the toggle', () => {
    render(island(S1, 'Back squat, Bench'));
    fireEvent.click(toggle());
    fireEvent.change(nameInput(), { target: { value: 'Rows' } });
    fireEvent.click(screen.getByRole('button', { name: STRENGTH_COPY.close }));
    expect(group().hidden).toBe(true);
    expect(document.activeElement).toBe(toggle());
    fireEvent.click(toggle());
    expect((nameInput() as HTMLInputElement).value).toBe('Rows');
  });

  it('a session from ANOTHER device never collapses an open, typed form', () => {
    const { rerender } = render(island([]));
    fireEvent.change(nameInput(), { target: { value: 'Rows' } });
    rerender(island(S1, 'Back squat, Bench'));
    expect(group().hidden).toBe(false);
    expect((nameInput() as HTMLInputElement).value).toBe('Rows');
    expect(statusText()).toBe(''); // and it is never announced as THIS user's save
  });

  it('a save collapses, then announces THAT session and focuses its receipt when it arrives', async () => {
    const { rerender } = render(island([]));
    fillOneSet();
    await submit();
    // The result can land a render before the revalidated receipt: hold focus on the toggle.
    expect(group().hidden).toBe(true);
    expect(document.activeElement).toBe(toggle());
    expect(statusText()).toBe('');
    rerender(island([{ id: 's-new', heading: 'Strength A session', names: 'Rows' }], 'Rows'));
    expect(statusText()).toBe(STRENGTH_COPY.announced('Strength A session', 'Rows'));
    expect(document.activeElement?.id).toBe(strengthReceiptId('s-new'));
  });

  it('the SECOND session of the day is announced and focused too', async () => {
    vi.mocked(logStrengthSessionAction).mockResolvedValueOnce({
      ok: true,
      error: null,
      savedId: 's2',
    });
    const { rerender } = render(island(S1, 'Back squat, Bench'));
    fireEvent.click(toggle());
    fillOneSet();
    await submit();
    rerender(
      island(
        [...S1, { id: 's2', heading: 'Strength A session 2', names: 'Rows' }],
        'Back squat, Bench, Rows',
      ),
    );
    expect(group().hidden).toBe(true);
    expect(statusText()).toBe(STRENGTH_COPY.announced('Strength A session 2', 'Rows'));
    expect(document.activeElement?.id).toBe(strengthReceiptId('s2'));
  });

  it('two saves in a row with the SAME movements both reach the live region', async () => {
    const at = (n: number) => ({
      id: `s${n}`,
      heading: n === 1 ? 'Strength A session' : `Strength A session ${n}`,
      names: 'Rows',
    });
    vi.mocked(logStrengthSessionAction)
      .mockResolvedValueOnce({ ok: true, error: null, savedId: 's2' })
      .mockResolvedValueOnce({ ok: true, error: null, savedId: 's3' });
    const { rerender } = render(island([at(1)], 'Rows'));
    const seen: string[] = [];
    for (const n of [2, 3]) {
      fireEvent.click(toggle());
      fillOneSet();
      await submit();
      rerender(
        island(
          Array.from({ length: n }, (_, k) => at(k + 1)),
          'Rows',
        ),
      );
      seen.push(statusText() ?? '');
    }
    expect(seen).toEqual([
      STRENGTH_COPY.announced('Strength A session 2', 'Rows'),
      STRENGTH_COPY.announced('Strength A session 3', 'Rows'),
    ]);
  });

  it('the toggle is disabled while a save is pending', async () => {
    let resolve!: (v: { ok: boolean; error: null; savedId: string }) => void;
    vi.mocked(logStrengthSessionAction).mockImplementationOnce(
      () => new Promise((r) => (resolve = r)),
    );
    render(island(S1, 'Back squat, Bench'));
    fireEvent.click(toggle());
    fillOneSet();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: STRENGTH_COPY.submit }));
    });
    expect(screen.getByRole('button', { name: STRENGTH_COPY.close }).hasAttribute('disabled')).toBe(
      true,
    );
    await act(async () => resolve({ ok: true, error: null, savedId: 's9' }));
  });
});
