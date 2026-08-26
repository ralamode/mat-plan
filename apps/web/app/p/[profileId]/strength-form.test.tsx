// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form imports the Server Action module ('use server'), which cannot be evaluated under jsdom.
// Mock it — this test is about what the form SERIALIZES, not about the action, which has its own
// boundary tests in actions.test.ts.
vi.mock('./actions', () => ({ logStrengthSessionAction: vi.fn() }));

import { StrengthForm } from './strength-form';

// COMPONENT TIER (RTL/jsdom — the profile-tile.test.tsx idiom). This file exists for ONE reason:
// GAP-1 P1-1c's acceptance criteria live in the SERIALIZED PAYLOAD, and nothing else in the suite can
// see it. The pure helpers (strength-form-supersets.test.ts) can't reach React state, and the schema
// tests (strength-session-schema.test.ts) start from a payload that is already built — the gap between
// "state is correct" and "the hidden input carries it" is exactly where #98's `dayRole` went missing,
// validated and then silently dropped on the way out. So every assertion here reads the hidden
// `movements` input's value and parses it, never component state.
afterEach(cleanup);

/** The hidden field the action JSON.parses — the actual wire, not a React-state proxy. */
function payload(): Array<Record<string, unknown>> {
  const input = document.querySelector<HTMLInputElement>('input[name="movements"]');
  if (!input) throw new Error('hidden movements input not found');
  return JSON.parse(input.value) as Array<Record<string, unknown>>;
}

const renderForm = () =>
  render(<StrengthForm profileId="p1" day="2026-08-12" defaultDayRole={null} />);

const nameInput = () => screen.getByLabelText('Movement');
const skippedBox = () => screen.getByLabelText(/movement 1 skipped/i);

describe('StrengthForm — skipped movement payload (GAP-1 P1-1c)', () => {
  it('a plain movement emits NO status key (absent stays absent → the DB default applies)', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Back squat' } });
    const [m] = payload();
    expect(m!.movementName).toBe('Back squat');
    expect('status' in m!).toBe(false);
  });

  it('checking Skipped emits status: skipped AND zero sets', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Bulgarian split squat' } });
    fireEvent.click(skippedBox());
    const [m] = payload();
    expect(m!.status).toBe('skipped');
    expect(m!.sets).toEqual([]);
  });

  it('unchecking RESTORES the typed sets — they were never cleared, only hidden', () => {
    // The Open-Q2 answer made executable: re-typing on a gym floor is the expensive operation, so
    // the sets live in parent state and the rows are merely unmounted while skipped.
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Back squat' } });
    fireEvent.change(screen.getByLabelText(/movement 1 set 1 reps/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/movement 1 set 1 weight or load/i), {
      target: { value: '135' },
    });
    expect(payload()[0]!.sets).toEqual([{ reps: '5', weight: '135' }]);

    fireEvent.click(skippedBox());
    expect(payload()[0]!.sets).toEqual([]);

    fireEvent.click(skippedBox()); // uncheck
    const [m] = payload();
    expect(m!.sets).toEqual([{ reps: '5', weight: '135' }]);
    expect('status' in m!).toBe(false); // undefined on uncheck, not 'done'
  });

  it('hides the set rows while skipped, and says so rather than going silent', () => {
    renderForm();
    fireEvent.click(skippedBox());
    expect(screen.queryByLabelText(/movement 1 set 1 reps/i)).toBeNull();
    expect(screen.getByText(/no sets will be logged/i)).toBeTruthy();
  });
});

describe('StrengthForm — sub-failure set payload (GAP-1 P1-1c)', () => {
  it('marks ONLY the toggled set, and keeps its reps', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Pull-up' } });
    fireEvent.change(screen.getByLabelText(/movement 1 set 1 reps/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/movement 1 set 1 weight or load/i), {
      target: { value: 'BW' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add set/i }));
    fireEvent.change(screen.getByLabelText(/movement 1 set 2 reps/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/movement 1 set 2 weight or load/i), {
      target: { value: 'BW' },
    });

    fireEvent.click(screen.getByLabelText(/sub-failure — movement 1 set 2/i));

    const sets = payload()[0]!.sets as Array<Record<string, unknown>>;
    expect(sets).toHaveLength(2);
    expect('status' in sets[0]!).toBe(false); // set 1 untouched
    expect(sets[1]!.status).toBe('sub_failure');
    expect(sets[1]!.reps).toBe('2'); // reps survive — the DB is the richer record
  });

  it('untoggling removes the key entirely rather than writing done', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Pull-up' } });
    const toggle = screen.getByLabelText(/sub-failure — movement 1 set 1/i);
    fireEvent.click(toggle);
    expect((payload()[0]!.sets as Array<Record<string, unknown>>)[0]!.status).toBe('sub_failure');
    fireEvent.click(toggle);
    expect('status' in (payload()[0]!.sets as Array<Record<string, unknown>>)[0]!).toBe(false);
  });
});
