// @vitest-environment jsdom
import { within, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNIT_DIMENSION } from '@mat-plan/shared';

// The form imports the Server Action module ('use server'), which cannot be evaluated under jsdom.
// Mock it — this test is about what the form SERIALIZES, not about the action, which has its own
// boundary tests in actions.test.ts.
vi.mock('./actions', () => ({ logStrengthSessionAction: vi.fn() }));

import { missingQuantityMessage, PARTIAL_SETS_COPY } from '@/lib/constants';

import { SetRepsWeightFields } from './set-fields';
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

    // The scaffold's own region, inside the form (V1-24 3a-ii added the island's save region beside it).
    const form = document.querySelector('form')!;
    expect(within(form).getByRole('status').textContent).toMatch(/replacing the 1 you had typed/i);
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
    // V1-30b — no longer a live region. It mounted WITH its text, and such a region may never be
    // announced, so the announcement was theatre. It is now a DESCRIPTION on every checked BW chip
    // (the note is about the movement, not one set), which is announced reliably.
    expect(note.getAttribute('role')).toBeNull();
    expect(note.id).toMatch(/^movement-.+-loaded-note$/);
    expect(bwChip(2).getAttribute('aria-describedby')).toBe(note.id);
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

// ── V1-27 — partial sets (docs/plans/v1-27-partial-sets.md) ─────────────────────────────────────────
// Card 1 has THREE rows, so "2 of 3" is a real trailing run; card 2 is collapsed until opened.
const PROGRAM3 = [
  { idx: 0, movementName: 'Back Squat', sets: 3, isBodyweight: false, unitDefault: 'lb' },
  { idx: 1, movementName: 'Push-Ups', sets: 3, isBodyweight: true, unitDefault: null },
];
const renderWith3 = () => {
  render(
    <StrengthForm profileId="p1" day="2026-08-12" defaultDayRole={null} programDay={PROGRAM3} />,
  );
  fireEvent.click(fillButton());
};
const repsOf = (card: number, set: number) =>
  screen.getByLabelText(`Movement ${card} set ${set} reps`) as HTMLInputElement;
// V1-30b — the field word is per dimension, so the locator accepts any of the three. Mass output is
// byte-identical to V1-30, so every assertion that pins the exact mass name still holds.
const weightOf = (card: number, set: number) =>
  screen.getByLabelText(
    new RegExp(`^Movement ${card} set ${set} (weight|time|length)`),
  ) as HTMLInputElement;
const fill = (card: number, set: number, reps = '8', weight = '20') => {
  fireEvent.change(repsOf(card, set), { target: { value: reps } });
  fireEvent.change(weightOf(card, set), { target: { value: weight } });
};
const setsSent = (i = 0) => (payload()[i]!.sets as unknown[]).length;
const summaryText = () => {
  const button = screen.getByRole('button', { name: /log strength/i });
  const id = button.getAttribute('aria-describedby');
  if (!id) throw new Error('Log strength has no aria-describedby');
  return document.getElementById(id)!.textContent;
};
/**
 * The summary must agree with the browser on blank required fields (final re-review B-A): it names a
 * blocker IFF some RENDERED input is required and blank — and, when it does, that input is the FIRST
 * blank required one on the page (the one the browser's bubble lands on).
 */
const BLOCKED_TEXT = /needs (finishing|a name)\.$/;
const expectSummaryAgrees = () => {
  const firstBlank = Array.from(
    document.querySelectorAll<HTMLInputElement>('form input[required]'),
  ).find((el) => el.value.trim() === '');
  expect(BLOCKED_TEXT.test(summaryText() ?? '')).toBe(firstBlank !== undefined);
  if (!firstBlank) return;
  // The first blank required input's own label says which card/set it is.
  const label = firstBlank.getAttribute('aria-label') ?? '';
  const where = /^Movement (\d+) set (\d+) /.exec(label);
  if (where) expect(summaryText()).toMatch(new RegExp(` set ${where[2]} needs finishing\\.$`));
  else expect(summaryText()).toMatch(/needs a name\.$/);
};

describe('StrengthForm — partial sets submit (V1-27)', () => {
  it('2 of 3: sends 2 sets; set 3 is not required; the summary says so', () => {
    renderWith3();
    fill(1, 1);
    fill(1, 2);
    expect(setsSent()).toBe(2);
    expect([1, 2, 3].map((s) => repsOf(1, s).required)).toEqual([true, true, false]);
    expect(weightOf(1, 3).required).toBe(false);
    expect(summaryText()).toBe('Logs 1 movement, 2 sets.');
    expectSummaryAgrees();
  });

  it('1 of 3: sends 1 set', () => {
    renderWith3();
    fill(1, 1);
    expect(setsSent()).toBe(1);
    expect(summaryText()).toBe('Logs 1 movement, 1 set.');
    expectSummaryAgrees();
  });

  it('a gap stays required, is sent, and the summary says the tap is blocked', () => {
    renderWith3();
    fill(1, 1);
    fill(1, 3);
    expect(repsOf(1, 2).required).toBe(true);
    expect(weightOf(1, 2).required).toBe(true);
    expect(setsSent()).toBe(3);
    expect(summaryText()).toBe('Back Squat set 2 needs finishing.');
    expectSummaryAgrees();
  });

  it('a half-entered last set (weight, no reps) still blocks', () => {
    renderWith3();
    fill(1, 1);
    fireEvent.change(weightOf(1, 2), { target: { value: '20' } });
    expect(repsOf(1, 2).required).toBe(true);
    expect(summaryText()).toBe('Back Squat set 2 needs finishing.');
    expectSummaryAgrees();
  });

  it('a sub-failure-only last set still blocks (it records what WAS done)', () => {
    renderWith3();
    fill(1, 1);
    fireEvent.click(screen.getByLabelText(/sub-failure — movement 1 set 2/i));
    expect(repsOf(1, 2).required).toBe(true);
    expectSummaryAgrees();
  });

  it.each([
    ['BW', /^BW — Bodyweight — movement 1 set 3$/],
    ['band', /^band — .* — movement 1 set 3$/],
  ])('%s + reps: reps required, weight NOT (the exemption), and not blocked', (_l, chip) => {
    renderWith3();
    fill(1, 1);
    fill(1, 2);
    fireEvent.change(repsOf(1, 3), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('checkbox', { name: chip }));
    expect(repsOf(1, 3).required).toBe(true);
    expect(weightOf(1, 3).required).toBe(false);
    expect(summaryText()).toBe('Logs 1 movement, 3 sets.');
    expectSummaryAgrees();
  });

  it('an untouched scaffolded card, even expanded, requires nothing and logs nothing', () => {
    renderWith3();
    expect(repsOf(1, 1).required).toBe(false);
    expect(screen.getByDisplayValue('Back Squat')).toHaveProperty('required', false);
    expect(summaryText()).toBe(PARTIAL_SETS_COPY.empty);
    expectSummaryAgrees();
  });

  it('a RENAMED scaffolded card with nothing entered blocks, and no longer collapses', () => {
    renderWith3();
    fireEvent.change(screen.getByDisplayValue('Back Squat'), { target: { value: 'Front Squat' } });
    expect(repsOf(1, 1).required).toBe(true);
    expect(summaryText()).toBe('Front Squat set 1 needs finishing.');
    expectSummaryAgrees();
    // Opening card 2 used to collapse card 1. A renamed card is hand-added now: it stays open.
    fireEvent.click(screen.getByRole('button', { name: /2\. Push-Ups/ }));
    expect(screen.getByDisplayValue('Front Squat')).toBeTruthy();
  });

  it('a hand-added card with filled sets and a BLANK name blocks', () => {
    renderForm();
    fill(1, 1);
    expect(nameInput()).toHaveProperty('required', true);
    expect(summaryText()).toBe('Movement 1 needs a name.');
    expectSummaryAgrees();
  });

  it('a blank hand-added card is dropped — its name is not required either', () => {
    renderForm();
    expect(nameInput()).toHaveProperty('required', false);
    expect(summaryText()).toBe(PARTIAL_SETS_COPY.empty);
    expectSummaryAgrees();
  });

  it('a COLLAPSED card with 2 of 3 sends 2 sets', () => {
    renderWith3();
    fireEvent.click(screen.getByRole('button', { name: /2\. Push-Ups/ }));
    fill(2, 1);
    fill(2, 2);
    fireEvent.click(screen.getByRole('button', { name: /1\. Back Squat/ })); // collapses card 2
    expect(setsSent(0)).toBe(2);
    expect(summaryText()).toBe('Logs 1 movement, 2 sets.');
  });

  it('a COLLAPSED gap card is sent as-is and is not "needs finishing" (the server refuses it)', () => {
    renderWith3();
    fireEvent.click(screen.getByRole('button', { name: /2\. Push-Ups/ }));
    fill(2, 1);
    fill(2, 3);
    fireEvent.click(screen.getByRole('button', { name: /1\. Back Squat/ }));
    expect(setsSent(0)).toBe(3);
    expect(summaryText()).toBe('Logs 1 movement, 3 sets.');
    expectSummaryAgrees();
  });

  it('the collapsed counter counts a sub-failure-only row (one predicate, ux-S1)', () => {
    renderWith3();
    fireEvent.click(screen.getByRole('button', { name: /2\. Push-Ups/ }));
    fill(2, 1);
    fill(2, 2);
    fireEvent.click(screen.getByLabelText(/sub-failure — movement 2 set 3/i));
    fireEvent.click(screen.getByRole('button', { name: /1\. Back Squat/ }));
    expect(screen.getByRole('button', { name: /2\. Push-Ups/ }).textContent).toContain('3/3');
  });
});

describe('StrengthForm — the custom "missing" message never lingers (V1-27 decision 6)', () => {
  it('a blank required weight carries the message; tapping BW clears it', () => {
    renderWith3();
    fireEvent.change(repsOf(1, 1), { target: { value: '8' } });
    expect(weightOf(1, 1).validity.customError).toBe(true);
    expect(weightOf(1, 1).validationMessage).toBe(PARTIAL_SETS_COPY.missingWeight);
    fireEvent.click(screen.getByRole('checkbox', { name: /^BW — Bodyweight — movement 1 set 1$/ }));
    expect(weightOf(1, 1).validity.customError).toBe(false);
  });

  it('a gap row carries it; removing the later set makes the row trailing and clears it', () => {
    renderWith3();
    fill(1, 1);
    fill(1, 3);
    expect(repsOf(1, 2).validity.customError).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove movement 1 set 3' }));
    expect(repsOf(1, 2).required).toBe(false);
    expect(repsOf(1, 2).validity.customError).toBe(false);
  });

  it('filling the field clears it', () => {
    renderWith3();
    fireEvent.change(repsOf(1, 1), { target: { value: '8' } });
    fireEvent.change(weightOf(1, 1), { target: { value: '20' } });
    expect(weightOf(1, 1).validity.customError).toBe(false);
  });

  it('a TIMED card asks for the time and never points at BW (V1-30 refuses BW there)', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Plank' } });
    fireEvent.change(screen.getByLabelText('What movement 1 measures'), {
      target: { value: UNIT_DIMENSION.time },
    });
    fireEvent.change(repsOf(1, 1), { target: { value: '1' } });
    expect(weightOf(1, 1).validationMessage).toBe(missingQuantityMessage('sec'));
    expect(weightOf(1, 1).validationMessage).not.toMatch(/BW|band/);
  });

  it('blank reps on a multi-set card points at the per-set Remove', () => {
    renderWith3();
    fill(1, 1);
    fill(1, 3);
    expect(repsOf(1, 2).validationMessage).toBe(PARTIAL_SETS_COPY.missingReps);
  });

  it('a ONE-set card never mentions Remove: reps say "fill in", weight says "tap BW"', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Push-ups' } });
    fireEvent.change(repsOf(1, 1), { target: { value: '10' } });
    expect(weightOf(1, 1).validationMessage).toBe(PARTIAL_SETS_COPY.missingWeight);
    expect(weightOf(1, 1).validationMessage).not.toContain('Remove');
    fireEvent.change(repsOf(1, 1), { target: { value: '' } });
    fireEvent.change(weightOf(1, 1), { target: { value: '20' } });
    expect(repsOf(1, 1).validationMessage).toBe(PARTIAL_SETS_COPY.missingRepsOnly);
    expect(repsOf(1, 1).validationMessage).not.toContain('Remove');
  });

  it('without a missing message (the edit form) no custom validity is ever set', () => {
    render(
      <form>
        <SetRepsWeightFields
          reps=""
          weight=""
          onReps={() => {}}
          onWeight={() => {}}
          ariaLabel="Edit"
        />
      </form>,
    );
    expect(screen.getByLabelText('Edit reps')).toHaveProperty('required', true);
    expect((screen.getByLabelText('Edit reps') as HTMLInputElement).validity.customError).toBe(
      false,
    );
  });
});

describe('StrengthForm — the summary line and the hint (V1-27 UX)', () => {
  it('counts a skipped movement separately', () => {
    renderWith3();
    fill(1, 1);
    fill(1, 2);
    fireEvent.click(screen.getByRole('button', { name: /2\. Push-Ups/ }));
    fireEvent.click(screen.getByLabelText(/movement 2 skipped/i));
    expect(summaryText()).toBe('Logs 1 movement, 2 sets, 1 skipped.');
  });

  it('a payload of only skipped movements reads "Nothing to log yet."', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Dips' } });
    fireEvent.click(skippedBox());
    expect(summaryText()).toBe(PARTIAL_SETS_COPY.empty);
  });

  it('plural forms', () => {
    renderWith3();
    fill(1, 1);
    fill(1, 2);
    fireEvent.click(screen.getByRole('button', { name: /2\. Push-Ups/ }));
    fill(2, 1);
    expect(summaryText()).toBe('Logs 2 movements, 3 sets.');
  });

  it('the hint shows only on a mixed card, and the trailing rows and Add set point at it', () => {
    renderWith3();
    expect(screen.queryByText(PARTIAL_SETS_COPY.trailingHint)).toBeNull();
    fill(1, 1);
    const hint = screen.getByText(PARTIAL_SETS_COPY.trailingHint);
    expect(hint.id).not.toBe('');
    expect(repsOf(1, 1).getAttribute('aria-describedby')).toBeNull();
    expect(repsOf(1, 2).getAttribute('aria-describedby')).toBe(hint.id);
    expect(repsOf(1, 3).getAttribute('aria-describedby')).toBe(hint.id);
    expect(screen.getByRole('button', { name: /add set/i }).getAttribute('aria-describedby')).toBe(
      hint.id,
    );
    fill(1, 2);
    fill(1, 3);
    expect(screen.queryByText(PARTIAL_SETS_COPY.trailingHint)).toBeNull();
  });
});

describe('StrengthForm — the form offers only what the server keeps (V1-30b-i)', () => {
  const measuring = (n: number) => screen.getByLabelText(`What movement ${n} measures`);
  const unitSelect = (n: number) => screen.getByLabelText(`Unit for movement ${n}`);
  // V1-19 — a scaffolded card's set rows are UNMOUNTED while collapsed, so a card other than the
  // first has to be opened before its controls exist.
  const expand = (n: number, name: string) =>
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${n}\\. ${name}`) }));
  // The payload DROPS untouched scaffolded cards, so a card's position in it is not its card number.
  // Look it up by name.
  const sentSets = (name: string) =>
    (payload().find((m) => m.movementName === name)!.sets as Array<Record<string, unknown>>) ?? [];
  const chips = (n: number, set: number) => ({
    bw: screen.queryByRole('checkbox', { name: `BW — Bodyweight — movement ${n} set ${set}` }),
    band: screen.queryByRole('checkbox', { name: `band — Band — movement ${n} set ${set}` }),
  });

  it('a non-mass card renders NO load-mode chips; a mass card renders both', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Plank' } });
    expect(chips(1, 1).bw).not.toBeNull();
    expect(chips(1, 1).band).not.toBeNull();

    fireEvent.change(measuring(1), { target: { value: UNIT_DIMENSION.time } });
    // UNMOUNTED, not hidden: a hidden checkbox left in the tab order is the "form appears dead" trap.
    expect(chips(1, 1).bw).toBeNull();
    expect(chips(1, 1).band).toBeNull();
  });

  it('leaving mass clears every set’s load modes — in one update, so the wire never pairs them', () => {
    renderWith3();
    expand(2, 'Push-Ups');
    fireEvent.click(screen.getByRole('checkbox', { name: 'BW — Bodyweight — movement 2 set 1' }));
    fireEvent.change(repsOf(2, 1), { target: { value: '10' } });

    fireEvent.change(measuring(2), { target: { value: UNIT_DIMENSION.time } });
    // `undefined`, never `false` — "absent stays absent" on the wire.
    expect(sentSets('Push-Ups').every((set) => !('isBodyweight' in set))).toBe(true);
  });

  it('changing the unit WITHIN mass clears nothing (lb → kg keeps BW)', () => {
    renderWith3();
    expand(2, 'Push-Ups');
    fireEvent.click(screen.getByRole('checkbox', { name: 'BW — Bodyweight — movement 2 set 1' }));
    fireEvent.change(repsOf(2, 1), { target: { value: '10' } });

    fireEvent.change(measuring(2), { target: { value: UNIT_DIMENSION.mass } });
    fireEvent.change(unitSelect(2), { target: { value: 'kg' } });
    expect(sentSets('Push-Ups')[0]!.isBodyweight).toBe(true);
  });

  it('reps + BW switched to Time blocks with the RIGHT copy rather than dropping the set', () => {
    renderWith3();
    expand(2, 'Push-Ups');
    fireEvent.change(repsOf(2, 1), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'BW — Bodyweight — movement 2 set 1' }));

    fireEvent.change(measuring(2), { target: { value: UNIT_DIMENSION.time } });
    // The reps survive, BW is gone, so the quantity is now required — a block, not a silent drop.
    expect(repsOf(2, 1).value).toBe('10');
    expect(weightOf(2, 1).validationMessage).toBe(missingQuantityMessage('sec'));
    expectSummaryAgrees();
  });

  it('the accessible name is per dimension, and mass stays byte-identical', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Plank' } });
    // Mass: the V1-30 text, unchanged, so every existing locator holds.
    expect(screen.getByLabelText('Movement 1 set 1 weight in lb')).toBeTruthy();

    fireEvent.change(measuring(1), { target: { value: UNIT_DIMENSION.time } });
    expect(screen.getByLabelText('Movement 1 set 1 time in seconds')).toBeTruthy();
    expect(weightOf(1, 1).placeholder).toBe('time');

    fireEvent.change(measuring(1), { target: { value: UNIT_DIMENSION.length } });
    expect(screen.getByLabelText('Movement 1 set 1 length in inches')).toBeTruthy();
    expect(weightOf(1, 1).placeholder).toBe('length');
  });

  it('one precision for every unit: 61.25 kg and 6.25 ft are valid, 1.2345 is not', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Back Squat' } });
    const field = weightOf(1, 1);
    // step="0.5" used to refuse 61.25 kg (1.25 kg plates are real) and 6.25 ft.
    expect(field.step).toBe('0.001');
    fireEvent.change(field, { target: { value: '61.25' } });
    expect(field.checkValidity()).toBe(true);
    fireEvent.change(field, { target: { value: '1.2345' } });
    expect(field.checkValidity()).toBe(false);
  });

  it('the mis-tap hint names the declared dimension, describes the Measuring select, and is its own id', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    expand(2, 'Trap-Bar Deadlift');
    // Trap-Bar Deadlift declares `lb` (mass); no hint while Measuring agrees.
    expect(screen.queryByText(/usually logged/)).toBeNull();

    fireEvent.change(measuring(2), { target: { value: UNIT_DIMENSION.time } });
    const hint = screen.getByText('Trap-Bar Deadlift is usually logged with a weight.');
    expect(hint.id).toMatch(/^movement-.+-dimension-hint$/);
    expect(measuring(2).getAttribute('aria-describedby')).toBe(hint.id);
    // ⚠️ Distinct from V1-27's trailing hint, which can render at the same time.
    expect(hint.id).not.toMatch(/trailing-hint$/);
  });

  it('a hand-added card has no declaration, so it never shows the hint', () => {
    renderForm();
    fireEvent.change(nameInput(), { target: { value: 'Something New' } });
    fireEvent.change(measuring(1), { target: { value: UNIT_DIMENSION.time } });
    expect(screen.queryByText(/usually logged/)).toBeNull();
  });

  it('renaming a scaffolded card clears the declaration, so the hint goes with it', () => {
    renderWithProgram();
    fireEvent.click(fillButton());
    expand(2, 'Trap-Bar Deadlift');
    fireEvent.change(measuring(2), { target: { value: UNIT_DIMENSION.time } });
    expect(screen.getByText(/usually logged/)).toBeTruthy();

    const name = screen.getByLabelText('Movement');
    fireEvent.change(name, { target: { value: 'Something Else' } });
    // The declaration was derived from a name that is now gone — a warning that outlived its subject
    // would be worse than none.
    expect(screen.queryByText(/usually logged/)).toBeNull();
  });
});
