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
  render(<StrengthForm profileId="p1" day="2026-08-12" defaultDayRole={null} programDay={[]} />);

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
    fireEvent.change(screen.getByLabelText(/movement 1 set 1 weight in/i), {
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
    fireEvent.change(screen.getByLabelText(/movement 1 set 1 weight in/i), {
      target: { value: 'BW' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add set/i }));
    fireEvent.change(screen.getByLabelText(/movement 1 set 2 reps/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/movement 1 set 2 weight in/i), {
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

// ── V1-19 — the program scaffold ────────────────────────────────────────────────────────────────
// V1-26 PR-A: `Trap-Bar Deadlift` is the declared-LOADED movement here — the shape of the
// 2026-09-28 KB-swings incident — so the BW-tap warning has a subject in this fixture.
const PROGRAM = [
  { idx: 0, movementName: 'Med-Ball Slam', sets: 2, isBodyweight: false, unitDefault: null },
  { idx: 1, movementName: 'Trap-Bar Deadlift', sets: 2, isBodyweight: false, unitDefault: 'lb' },
  { idx: 2, movementName: 'Pull-Up', sets: 1, isBodyweight: true, unitDefault: null },
];

const renderWithProgram = () =>
  render(
    <StrengthForm profileId="p1" day="2026-08-12" defaultDayRole={null} programDay={PROGRAM} />,
  );

const fillButton = () => screen.getByRole('button', { name: /fill in today.s movements/i });

describe('StrengthForm — program scaffold (V1-19)', () => {
  it('offers no button when the day has no programmed movements', () => {
    renderForm(); // programDay: []
    expect(screen.queryByRole('button', { name: /fill in today.s movements/i })).toBeNull();
  });

  it('builds a card per prescription — first open, the rest collapsed, all fields blank', () => {
    renderWithProgram();
    fireEvent.click(fillButton());

    // Card 1 opens so the athlete can start immediately; 2 and 3 are one-line summaries.
    expect(screen.getByDisplayValue('Med-Ball Slam')).toBeTruthy();
    expect(screen.getByRole('button', { name: /2\. Trap-Bar Deadlift/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /3\. Pull-Up/ })).toBeTruthy();

    // The V1-10 confirm-gate boundary, at the DOM: nothing arrives pre-filled.
    for (const el of screen.getAllByPlaceholderText(/reps|weight/)) {
      expect((el as HTMLInputElement).value).toBe('');
    }
  });

  // Right after scaffolding, EVERY card is untouched — so the payload is legitimately empty and the
  // schema's "add at least one movement" still fires. Scaffolding proposes structure; it never logs.
  it('submits nothing until the athlete types something', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    expect(payload()).toHaveLength(0);
  });

  /**
   * THE regression guard. `dropUntouchedMovements` decides a card is disposable by its BLANK NAME, and
   * every scaffolded card has one — so without `isUntouchedScaffold` an athlete who performed 1 of 3
   * programmed movements could not submit until they explicitly skipped or removed the other 2, behind
   * a native focus-bubble on an off-screen required input. Both review panels found this independently.
   */
  it('drops the scaffolded movements the athlete never touched', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    fireEvent.change(screen.getAllByPlaceholderText('reps')[0]!, { target: { value: '5' } });
    fireEvent.change(screen.getAllByPlaceholderText(/weight/)[0]!, { target: { value: '20' } });

    const p = payload();
    expect(p).toHaveLength(1);
    expect(p[0]!.movementName).toBe('Med-Ball Slam');
  });

  it('collapses the other cards, unmounting their required inputs', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    // A hidden-but-present `required` input blocks the native submit with an invisible error, so a
    // collapsed card's rows must be ABSENT from the DOM, not merely styled away. Card 1 (2 sets) only.
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /2\. Trap-Bar Deadlift/ }));
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(2);
    expect(screen.getByDisplayValue('Trap-Bar Deadlift')).toBeTruthy();
  });

  it('announces what happened, and offers Undo that restores typed work', () => {
    renderWithProgram();
    fireEvent.change(nameInput(), { target: { value: 'Front squat' } });
    fireEvent.click(fillButton());

    expect(screen.getByRole('status').textContent).toMatch(/replacing the 1 you had typed/i);
    expect(payload().map((m) => m.movementName)).not.toContain('Front squat');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(payload().map((m) => m.movementName)).toEqual(['Front squat']);
  });
});

/**
 * V1-26 PR-A — the form carries the MOVEMENT's declaration.
 *
 * The 2026-09-28 incident: Liam's KB swings were logged `20 × BW` when the session was `10 × 20 lb`.
 * The app said nothing at the moment of the mistake, and then could not fix it afterwards. PR-A is
 * the first half — say something.
 */
describe('StrengthForm — the movement’s declaration (V1-26 PR-A)', () => {
  const bwChip = (n: number) =>
    screen.getByRole('checkbox', { name: `BW — Bodyweight — movement ${n} set 1` });

  it('seeds the Unit select from the catalog, not the household default', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    // Card 1 is the open one: `Med-Ball Slam`, catalog-silent → the household default.
    expect(screen.getByLabelText(/Unit for movement 1/)).toHaveProperty('value', 'lb');
  });

  it('warns — and does NOT block — when BW is tapped on a movement the catalog declares loaded', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    // Open card 2, the declared-loaded Trap-Bar Deadlift.
    fireEvent.click(screen.getByRole('button', { name: /2\. Trap-Bar Deadlift/ }));

    expect(screen.queryByText(/usually logged with a weight/)).toBeNull();
    fireEvent.click(bwChip(2));

    const note = screen.getByText('Trap-Bar Deadlift is usually logged with a weight.');
    expect(note).toBeTruthy();
    // A WARNING, not a lockout — the athlete may be right, and the chip stays on.
    expect(bwChip(2)).toHaveProperty('checked', true);
    // `status`, not `alert`: advisory copy must not interrupt.
    expect(note.getAttribute('role')).toBe('status');
  });

  it('says nothing when BW is tapped on a movement the catalog declares bodyweight', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    fireEvent.click(screen.getByRole('button', { name: /3\. Pull-Up/ }));
    fireEvent.click(bwChip(3));
    expect(screen.queryByText(/usually logged with a weight/)).toBeNull();
  });

  it('clears the carried declaration when the card is renamed', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    fireEvent.click(screen.getByRole('button', { name: /2\. Trap-Bar Deadlift/ }));
    fireEvent.click(bwChip(2));
    expect(screen.getByText(/usually logged with a weight/)).toBeTruthy();

    // The declaration was derived from a name that is now gone. A warning naming a movement the card
    // no longer holds is worse than no warning.
    fireEvent.change(screen.getByDisplayValue('Trap-Bar Deadlift'), {
      target: { value: 'Kettlebell swing' },
    });
    expect(screen.queryByText(/usually logged with a weight/)).toBeNull();
  });

  /**
   * ⚠️ THE regression this whole design exists to avoid. A scaffolded card seeded `isBodyweight: true`
   * is permanently "touched" (`isUntouchedScaffold` requires `!s.isBodyweight`), survives
   * `dropUntouchedMovements`, and blocks submit behind a COLLAPSED card whose `required` reps input is
   * unmounted — the form appears dead. This asserts the SUBMIT, not the flags.
   */
  it('doing some of the programmed movements still submits (the V1-19 wedge stays closed)', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    fireEvent.change(screen.getAllByPlaceholderText('reps')[0]!, { target: { value: '8' } });
    fireEvent.change(screen.getAllByPlaceholderText(/weight/)[0]!, { target: { value: '30' } });

    const p = payload();
    expect(p).toHaveLength(1);
    expect(p[0].movementName).toBe('Med-Ball Slam');
  });
});
