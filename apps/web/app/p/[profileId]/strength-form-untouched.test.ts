import { describe, expect, it } from 'vitest';

import { type ScaffoldRow, scaffoldMovements } from './strength-form-scaffold';
import {
  dropTrailingUntouchedSets,
  dropUntouchedMovements,
  hasTrailingUntouched,
  isDroppableMovement,
  isSubmitBlocked,
  isUntouchedMovement,
  isUntouchedScaffold,
  isUntouchedSet,
  type MovementDraft,
  nameRequired,
  repsRequired,
  setIsRequired,
  type SetDraft,
  trailingStart,
  weightRequired,
} from './strength-form-untouched';

const row = (over: Partial<ScaffoldRow> = {}): ScaffoldRow => ({
  idx: 0,
  movementName: 'Back squat',
  sets: 3,
  isBodyweight: false,
  unitDefault: null,
  ...over,
});

// ── Moved verbatim from strength-form-scaffold.test.ts (V1-27: the predicate moved here) ──────────

describe('isUntouchedScaffold', () => {
  const scaffolded = () => scaffoldMovements([row({ sets: 2 })], 'lb')[0]!;

  it('is true for a scaffolded card the athlete never touched', () => {
    expect(isUntouchedScaffold(scaffolded())).toBe(true);
  });

  it('is false once any value is typed', () => {
    const m = scaffolded();
    expect(isUntouchedScaffold({ ...m, sets: [{ ...m.sets[0]!, reps: '5' }, m.sets[1]!] })).toBe(
      false,
    );
    expect(isUntouchedScaffold({ ...m, sets: [{ ...m.sets[0]!, weight: '95' }, m.sets[1]!] })).toBe(
      false,
    );
  });

  // GAP-3 PR 4a. THE regression this guards: tapping BW is the ONLY input a bodyweight set needs
  // before reps, and if the predicate cannot see it, a scaffolded "Push-ups" card the kid tapped BW
  // on three times is silently DROPPED at submit — no error, the movement just is not in the log.
  // Caught by the UX panel, which found the predicate keyed on reps/weight alone.
  it('is false once a MODE is tapped, even with no reps or weight typed', () => {
    const m = scaffolded();
    expect(
      isUntouchedScaffold({ ...m, sets: [{ ...m.sets[0]!, isBodyweight: true }, m.sets[1]!] }),
    ).toBe(false);
    expect(isUntouchedScaffold({ ...m, sets: [{ ...m.sets[0]!, isBand: true }, m.sets[1]!] })).toBe(
      false,
    );
  });

  it('stays droppable when a mode is tapped and then untapped', () => {
    const m = scaffolded();
    expect(
      isUntouchedScaffold({ ...m, sets: [{ ...m.sets[0]!, isBodyweight: false }, m.sets[1]!] }),
    ).toBe(true);
  });

  it('is false once a status is set, and true again when it is cleared', () => {
    const m = scaffolded();
    expect(isUntouchedScaffold({ ...m, status: 'skipped' })).toBe(false);
    // Compared to the DEFAULT, never to `undefined` — un-skipping must return the card to droppable.
    expect(isUntouchedScaffold({ ...m, status: 'done' })).toBe(true);
  });

  // The whole reason this predicate exists separately: a hand-added blank card is caught by
  // `isUntouchedMovement`, which requires an empty NAME — and a scaffolded card always has one.
  it('never applies to a card the athlete added by hand', () => {
    const m = scaffolded();
    expect(isUntouchedScaffold({ ...m, scaffolded: undefined })).toBe(false);
  });
});

// ── Moved verbatim from strength-form-supersets.test.ts ──────────────────────────────────────────

describe('dropUntouchedMovements / isUntouchedMovement (V1-9 log ergonomics)', () => {
  const draft = (
    movementName: string,
    sets: { reps: string; weight: string; isBodyweight?: boolean; isBand?: boolean }[],
  ) => ({
    clientId: 'c',
    movementName,
    unit: 'lb',
    sets,
  });
  const blank = () => draft('', [{ reps: '', weight: '' }]);
  const filled = () => draft('Back squat', [{ reps: '10', weight: '75' }]);

  it('treats a blank name + all-blank sets as untouched', () => {
    expect(isUntouchedMovement(blank())).toBe(true);
    expect(isUntouchedMovement(draft('  ', [{ reps: ' ', weight: '' }]))).toBe(true); // whitespace only
  });

  it('does NOT treat a partially-typed card as untouched (never silently discard input)', () => {
    expect(isUntouchedMovement(draft('Back squat', [{ reps: '', weight: '' }]))).toBe(false); // name only
    expect(isUntouchedMovement(draft('', [{ reps: '10', weight: '' }]))).toBe(false); // a rep only
    expect(isUntouchedMovement(draft('', [{ reps: '', weight: '75' }]))).toBe(false); // a weight only
  });

  // GAP-3 PR 4a — the same regression as the scaffold predicate's. A mode flag is real input, and a
  // card carrying only one must survive to the payload. Pinned here so the flags cannot be dropped
  // from this predicate while the sibling keeps them.
  it('does NOT treat a card whose only input is a MODE as untouched', () => {
    expect(isUntouchedMovement(draft('', [{ reps: '', weight: '', isBodyweight: true }]))).toBe(
      false,
    );
    expect(isUntouchedMovement(draft('', [{ reps: '', weight: '', isBand: true }]))).toBe(false);
  });

  it('drops only the untouched cards, keeps filled + partial', () => {
    const partial = draft('Bench', [{ reps: '', weight: '' }]);
    const out = dropUntouchedMovements([filled(), blank(), partial]);
    expect(out.map((m) => m.movementName)).toEqual(['Back squat', 'Bench']); // blank dropped, partial kept
  });

  it('returns [] when every card is untouched (so the min(1) schema error still fires)', () => {
    expect(dropUntouchedMovements([blank(), blank()])).toEqual([]);
  });
});

// GAP-1 P1-1c (BUG-2b). `[].every(...)` is VACUOUSLY TRUE, so before this fix a skipped movement —
// which legitimately carries zero sets — with a blank name was silently discarded on submit: no row,
// no validation message. The same argument applies one level down to a set status.
describe('isUntouchedMovement — a status is a typed field (GAP-1 P1-1c / BUG-2b)', () => {
  const card = (o: Partial<MovementDraft> = {}): MovementDraft => ({
    movementName: '',
    sets: [{ reps: '', weight: '' }],
    ...o,
  });

  it('an ordinary blank card is STILL untouched (the existing drop behaviour is unchanged)', () => {
    expect(isUntouchedMovement(card())).toBe(true);
  });

  it('a SKIPPED card with a blank name and ZERO sets is NOT untouched', () => {
    // The regression. Without the guard, `[].every(...)` → true → dropUntouchedMovements discards it.
    expect(isUntouchedMovement(card({ status: 'skipped', sets: [] }))).toBe(false);
  });

  it('a card whose ONLY input is a SET status is NOT untouched', () => {
    // The other direction — guarding only the movement level would ship the same bug in this PR.
    expect(
      isUntouchedMovement(card({ sets: [{ reps: '', weight: '', status: 'sub_failure' }] })),
    ).toBe(false);
  });

  it('check-then-UNCHECK returns the card to droppable (a mis-tap must not wedge the form)', () => {
    // The toggle sets `undefined`, not 'done'. Presence-checking would leave this card permanently
    // un-droppable, blocking submit behind "Movement N: Enter a movement." with Remove as the only out.
    expect(isUntouchedMovement(card({ status: undefined, sets: [] }))).toBe(true);
  });

  it('an explicit `done` at either level is still untouched (compare to the DEFAULT, not to undefined)', () => {
    expect(isUntouchedMovement(card({ status: 'done' }))).toBe(true);
    expect(isUntouchedMovement(card({ sets: [{ reps: '', weight: '', status: 'done' }] }))).toBe(
      true,
    );
  });

  it('a typed name still wins regardless of status', () => {
    expect(isUntouchedMovement(card({ movementName: 'Back squat', sets: [] }))).toBe(false);
  });

  it('dropUntouchedMovements keeps a skipped blank card so it can produce a real error', () => {
    const kept = dropUntouchedMovements([
      { clientId: 'a', ...card({ status: 'skipped', sets: [] }) },
      { clientId: 'b', ...card() },
    ]);
    expect(kept.map((m) => m.clientId)).toEqual(['a']);
  });
});

// ── V1-27 — partial sets (docs/plans/v1-27-partial-sets.md) ────────────────────────────────────────

const blankSet = (): SetDraft => ({ reps: '', weight: '' });
const done = (reps = '8', weight = '20'): SetDraft => ({ reps, weight });
const card = (
  sets: SetDraft[],
  o: Partial<MovementDraft & { clientId: string }> = {},
): MovementDraft & { clientId: string } => ({
  clientId: 'c1',
  movementName: 'Back squat',
  scaffolded: true,
  sets,
  ...o,
});

describe('isUntouchedSet — the one "touched" judgement', () => {
  it('an empty row is untouched', () => {
    expect(isUntouchedSet(blankSet())).toBe(true);
    expect(isUntouchedSet({ reps: '  ', weight: ' ' })).toBe(true);
    expect(isUntouchedSet({ reps: '', weight: '', status: 'done' })).toBe(true);
  });
  it.each<[string, SetDraft]>([
    ['reps', { reps: '8', weight: '' }],
    ['weight', { reps: '', weight: '20' }],
    ['a typed 0', { reps: '0', weight: '' }],
    ['BW', { reps: '', weight: '', isBodyweight: true }],
    ['band', { reps: '', weight: '', isBand: true }],
    ['sub-failure', { reps: '', weight: '', status: 'sub_failure' }],
  ])('%s is a touch', (_label, s) => {
    expect(isUntouchedSet(s)).toBe(false);
  });
});

describe('trailingStart', () => {
  it('is the index after the last touched set', () => {
    expect(trailingStart([done(), done(), blankSet()])).toBe(2);
    expect(trailingStart([done(), blankSet(), blankSet()])).toBe(1);
    expect(trailingStart([done(), blankSet(), done()])).toBe(3); // a gap has no trailing run
  });
  it('is sets.length when NO set is touched — no trailing run (re-review rr-B1)', () => {
    expect(trailingStart([blankSet(), blankSet(), blankSet()])).toBe(3);
    expect(trailingStart([])).toBe(0);
  });
});

describe('setIsRequired / repsRequired / weightRequired, across the case table', () => {
  it('2 of 3: sets 1-2 required, set 3 (trailing) not', () => {
    const m = card([done(), done(), blankSet()]);
    expect([0, 1, 2].map((i) => setIsRequired(m, i))).toEqual([true, true, false]);
  });
  it('1 of 3: only set 1 required', () => {
    const m = card([done(), blankSet(), blankSet()]);
    expect([0, 1, 2].map((i) => setIsRequired(m, i))).toEqual([true, false, false]);
  });
  it('a gap stays required', () => {
    const m = card([done(), blankSet(), done()]);
    expect([0, 1, 2].map((i) => setIsRequired(m, i))).toEqual([true, true, true]);
  });
  it('a half-entered last set is touched, so required (weight typed, reps blank)', () => {
    const m = card([done(), done(), { reps: '', weight: '20' }]);
    expect(repsRequired(m, 2)).toBe(true);
  });
  it('a BW-only or sub-failure-only last set stays required', () => {
    expect(repsRequired(card([done(), { reps: '', weight: '', isBodyweight: true }]), 1)).toBe(
      true,
    );
    expect(repsRequired(card([done(), { reps: '', weight: '', status: 'sub_failure' }]), 1)).toBe(
      true,
    );
  });
  it('BW + reps: reps required, weight NOT (the load-bearing exemption, re-review rr-B4)', () => {
    const m = card([done(), { reps: '8', weight: '', isBodyweight: true }]);
    expect(repsRequired(m, 1)).toBe(true);
    expect(weightRequired(m, 1)).toBe(false);
  });
  it('band + reps: reps required, weight NOT', () => {
    const m = card([done(), { reps: '8', weight: '', isBand: true }]);
    expect(repsRequired(m, 1)).toBe(true);
    expect(weightRequired(m, 1)).toBe(false);
  });
  it('an untouched scaffolded card (expanded or collapsed) requires nothing — it is dropped', () => {
    const m = card([blankSet(), blankSet(), blankSet()]);
    expect(isDroppableMovement(m)).toBe(true);
    expect([0, 1, 2].map((i) => setIsRequired(m, i))).toEqual([false, false, false]);
    expect(nameRequired(m)).toBe(false);
  });
  it('a RENAMED scaffolded card (scaffolded cleared) with every set blank: every row required', () => {
    const m = card([blankSet(), blankSet()], { scaffolded: undefined, movementName: 'Chin-up' });
    expect(isDroppableMovement(m)).toBe(false);
    expect([0, 1].map((i) => setIsRequired(m, i))).toEqual([true, true]);
    expect(nameRequired(m)).toBe(true);
  });
  it('a named hand-added card with every set blank: every row required', () => {
    const m = card([blankSet()], { scaffolded: undefined, movementName: 'Dips' });
    expect(setIsRequired(m, 0)).toBe(true);
  });
  it('a blank hand-added card requires nothing, its name included (it is never sent)', () => {
    const m = card([blankSet()], { scaffolded: undefined, movementName: '' });
    expect(setIsRequired(m, 0)).toBe(false);
    expect(nameRequired(m)).toBe(false);
  });
});

describe('dropTrailingUntouchedSets', () => {
  const sent = (sets: SetDraft[]) => dropTrailingUntouchedSets([card(sets)])[0]!.sets.length;
  it('2 of 3 → 2 sets; 1 of 3 → 1 set', () => {
    expect(sent([done(), done(), blankSet()])).toBe(2);
    expect(sent([done(), blankSet(), blankSet()])).toBe(1);
  });
  it('a gap is NOT dropped (so set numbers still match the screen)', () => {
    expect(sent([done(), blankSet(), done()])).toBe(3);
  });
  it('an all-untouched card is returned unchanged', () => {
    const m = card([blankSet(), blankSet()]);
    expect(dropTrailingUntouchedSets([m])[0]).toBe(m);
  });
  it('preserves order and the kept rows', () => {
    const a = done('5', '10');
    const b = done('6', '12');
    const [m] = dropTrailingUntouchedSets([card([a, b, blankSet()])]);
    expect(m!.sets).toEqual([a, b]);
  });
});

describe('hasTrailingUntouched (the hint)', () => {
  it('only on a mixed card', () => {
    expect(hasTrailingUntouched(card([done(), blankSet()]))).toBe(true);
    expect(hasTrailingUntouched(card([done(), blankSet(), done(), blankSet()]))).toBe(true); // gap card too
    expect(hasTrailingUntouched(card([done(), done()]))).toBe(false);
    expect(hasTrailingUntouched(card([blankSet(), blankSet()]))).toBe(false);
    expect(hasTrailingUntouched(card([done(), blankSet()], { status: 'skipped' }))).toBe(false);
  });
});

describe('isSubmitBlocked — what the BROWSER would refuse', () => {
  it('2 of 3 on the expanded card is NOT blocked', () => {
    expect(isSubmitBlocked([card([done(), done(), blankSet()])], 'c1')).toBe(false);
  });
  it('a gap on the expanded card IS blocked', () => {
    expect(isSubmitBlocked([card([done(), blankSet(), done()])], 'c1')).toBe(true);
  });
  it('a gap on a COLLAPSED card is not blocked — its inputs are unmounted; the server refuses', () => {
    expect(isSubmitBlocked([card([done(), blankSet(), done()])], 'other')).toBe(false);
  });
  it('BW + reps with a blank weight is NOT blocked (exemption)', () => {
    expect(
      isSubmitBlocked([card([done(), { reps: '8', weight: '', isBodyweight: true }])], 'c1'),
    ).toBe(false);
  });
  it('a half-entered set on the expanded card IS blocked', () => {
    expect(isSubmitBlocked([card([done(), { reps: '', weight: '20' }])], 'c1')).toBe(true);
  });
  it('a hand-added card with filled sets and a BLANK name IS blocked (always rendered)', () => {
    expect(
      isSubmitBlocked([card([done()], { scaffolded: undefined, movementName: '' })], null),
    ).toBe(true);
  });
  it('a blank hand-added card is NOT blocked — it is dropped, name included', () => {
    expect(
      isSubmitBlocked([card([blankSet()], { scaffolded: undefined, movementName: '' })], null),
    ).toBe(false);
  });
  it('an untouched scaffolded card, even expanded, is NOT blocked (dropped)', () => {
    expect(isSubmitBlocked([card([blankSet(), blankSet()])], 'c1')).toBe(false);
  });
  it('a named all-blank hand-added card IS blocked', () => {
    expect(
      isSubmitBlocked([card([blankSet()], { scaffolded: undefined, movementName: 'Dips' })], null),
    ).toBe(true);
  });
  it('a skipped card renders no rows, so its blank sets never block', () => {
    expect(isSubmitBlocked([card([done(), blankSet(), done()], { status: 'skipped' })], 'c1')).toBe(
      false,
    );
  });
});
