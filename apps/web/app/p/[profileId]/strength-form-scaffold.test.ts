import {
  MOVEMENT_SEED_ROWS,
  MAX_SESSION_MOVEMENTS,
  MAX_SETS_PER_MOVEMENT,
  sessionMovementSchema,
} from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCAFFOLD_SETS,
  isUntouchedScaffold,
  type ScaffoldRow,
  scaffoldMovements,
} from './strength-form-scaffold';

const row = (over: Partial<ScaffoldRow> = {}): ScaffoldRow => ({
  idx: 0,
  movementName: 'Back squat',
  sets: 3,
  // The catalog's silent case — no declaration either way — so every pre-V1-26 test keeps asserting
  // the household-default behaviour it was written for, and the declaration tests opt in explicitly.
  isBodyweight: false,
  unitDefault: null,
  ...over,
});

describe('scaffoldMovements', () => {
  it('builds one card per prescription, in the coach’s order', () => {
    const out = scaffoldMovements(
      [
        row({ idx: 0, movementName: 'Med-Ball Slam' }),
        row({ idx: 1, movementName: 'Trap-Bar Deadlift' }),
      ],
      'lb',
    );
    expect(out.map((m) => m.movementName)).toEqual(['Med-Ball Slam', 'Trap-Bar Deadlift']);
  });

  /**
   * THE boundary test. The V1-10 panel's reason (2) is that the blank `required` field IS the human
   * confirmation, so a prefilled value logs a PRESCRIBED number as a PERFORMED one with no affirmative
   * entry — and that is a mechanism, not a load-specific rule, so it binds reps too. An earlier draft of
   * this plan proposed prefilling "clean integer" reps; the review panel caught it. Asserted over the
   * WHOLE structure so reintroducing either prefill fails CI rather than passing review.
   */
  it('leaves every reps AND weight field empty', () => {
    const out = scaffoldMovements(
      [
        row({ sets: 4 }),
        row({ idx: 1, movementName: 'Pull-Up', sets: 3 }),
        // The V1-23 default-count shape too: the wider structure is the one the live YDP produces
        // for 11 of its 13 prescriptions, so it is the one that must be provably blank.
        row({ idx: 2, movementName: 'Push-Up', sets: null }),
      ],
      'lb',
    );
    expect(out.flatMap((m) => m.sets)).toHaveLength(4 + 3 + DEFAULT_SCAFFOLD_SETS);
    for (const m of out) {
      for (const s of m.sets) {
        expect(s.reps).toBe('');
        expect(s.weight).toBe('');
      }
    }
  });

  it('gives each card and set a distinct id, so a replay cannot ON CONFLICT no-op', () => {
    const out = scaffoldMovements([row(), row({ idx: 1 })], 'lb');
    const ids = [...out.map((m) => m.clientId), ...out.flatMap((m) => m.sets.map((s) => s.key))];
    expect(new Set(ids).size).toBe(ids.length);
    // A second call must not reproduce the first's ids either.
    const again = scaffoldMovements([row()], 'lb');
    expect(again[0]!.clientId).not.toBe(out[0]!.clientId);
  });

  it('marks every card scaffolded, so the submit-time drop predicate can reach it', () => {
    expect(scaffoldMovements([row()], 'lb').every((m) => m.scaffolded === true)).toBe(true);
  });

  describe('set count', () => {
    it('uses the prescribed count', () => {
      expect(scaffoldMovements([row({ sets: 4 })], 'lb')[0]!.sets).toHaveLength(4);
    });

    // V1-23 PR 1. The YDP authors no set count on 11 of its 13 prescriptions, so this branch — not
    // the explicit one above — is what the kids actually get, and one row cost ~10 "Add set" taps a
    // session while the filled/total counter read 1/1 with two sets left.
    it('scaffolds the default structure for a movement-only prescription', () => {
      expect(scaffoldMovements([row({ sets: null })], 'lb')[0]!.sets).toHaveLength(
        DEFAULT_SCAFFOLD_SETS,
      );
    });

    // The contract assertion: the one place the literal is allowed, so a change to the default is a
    // deliberate edit here rather than a silent drift. Also pins it below the schema cap.
    it('defaults to three rows, within the schema cap', () => {
      expect(DEFAULT_SCAFFOLD_SETS).toBe(3);
      expect(DEFAULT_SCAFFOLD_SETS).toBeLessThanOrEqual(MAX_SETS_PER_MOVEMENT);
    });

    // Not zero: `[].every(...)` is vacuously true — the BUG-2(b) shape — and a non-skipped movement
    // with no sets fails the schema anyway. An explicit nonsense count floors to 1, NOT to the
    // default: a count the coach authored is not replaced by three rows they never asked for.
    it('floors an explicit count below one to a single row', () => {
      expect(scaffoldMovements([row({ sets: 0 })], 'lb')[0]!.sets).toHaveLength(1);
      expect(scaffoldMovements([row({ sets: -3 })], 'lb')[0]!.sets).toHaveLength(1);
    });

    it('clamps to what the session schema accepts', () => {
      expect(scaffoldMovements([row({ sets: 99 })], 'lb')[0]!.sets).toHaveLength(
        MAX_SETS_PER_MOVEMENT,
      );
    });
  });

  it('clamps the movement count, so a long day cannot scaffold an unsubmittable form', () => {
    const many = Array.from({ length: MAX_SESSION_MOVEMENTS + 5 }, (_, i) =>
      row({ idx: i, movementName: `M${i}` }),
    );
    expect(scaffoldMovements(many, 'lb')).toHaveLength(MAX_SESSION_MOVEMENTS);
  });
});

/**
 * The scaffold writes a catalog `movements.name` into a field the session schema validates — and those
 * two constraints are NOT the same. `movements.name` is unconstrained `text`; `movementName` rejects
 * commas/newlines (the CSV row-splitting guard, GAP-1 P2) and caps at 100. A catalog name that fails
 * here would scaffold a card that can never submit, with the offending character invisible as the cause.
 */
describe('catalog names survive the session schema', () => {
  it('every seeded movement name is a legal movementName', () => {
    const field = sessionMovementSchema.shape.movementName;
    const rejected = MOVEMENT_SEED_ROWS.map((m) => m.name).filter(
      (name) => !field.safeParse(name).success,
    );
    expect(rejected).toEqual([]);
  });
});

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

/**
 * V1-26 PR-A — **all four quadrants**, because the plan's first draft had a two-row table that
 * covered neither real case.
 *
 * The movement carries a DECLARATION (`is_bodyweight`, `unit_default`); the coach carries a
 * PRESCRIPTION (`load`). Only the declaration crosses into the form, and only as the seeded unit.
 */
describe('scaffoldMovements — the movement’s declaration (V1-26 PR-A)', () => {
  it.each([
    {
      name: 'declared bodyweight, no unit (push-ups)',
      over: { isBodyweight: true, unitDefault: null },
      unit: 'lb',
      declaredLoaded: false,
    },
    {
      name: 'declared loaded with a unit (KB swings — the 2026-09-28 movement)',
      over: { isBodyweight: false, unitDefault: 'lb' },
      unit: 'lb',
      declaredLoaded: true,
    },
    {
      name: 'catalog silent (Pallof press)',
      over: { isBodyweight: false, unitDefault: null },
      unit: 'lb',
      declaredLoaded: false,
    },
    {
      name: 'declared bodyweight WITH a unit (a hold measured in seconds)',
      over: { isBodyweight: true, unitDefault: 'sec' },
      unit: 'sec',
      declaredLoaded: false,
    },
  ])('$name', ({ over, unit, declaredLoaded }) => {
    const [card] = scaffoldMovements([row(over)], 'lb');
    expect(card.unit).toBe(unit);
    expect(card.declaredLoaded ?? false).toBe(declaredLoaded);
  });

  it('seeds the DECLARED unit over the household default', () => {
    // The household logs in `lb`; this movement is measured in seconds. The select must show `sec`,
    // because it is VISIBLE and overridable — which is the whole reason the declaration rides on the
    // unit rather than on a pre-tapped chip.
    const [card] = scaffoldMovements([row({ unitDefault: 'sec', isBodyweight: true })], 'lb');
    expect(card.unit).toBe('sec');
  });

  it('falls back to the household default for a unit this build does not know', () => {
    // `movements.unit_default` is FK-constrained to `units.code`, so the DB guarantees the unit is
    // real — not that the shared enum has caught up. Expand→contract makes that ordering normal. A
    // select seeded to a value with no option renders BLANK and submits the wrong thing, so the safe
    // direction is wrong-but-visible.
    const [card] = scaffoldMovements([row({ unitDefault: 'furlong' })], 'lb');
    expect(card.unit).toBe('lb');
  });

  /**
   * ⚠️ **THE regression test.** Seeding `isBodyweight: true` on a scaffolded set is the V1-19 submit
   * wedge: `isUntouchedScaffold` requires `!s.isBodyweight`, so the card is permanently "touched",
   * survives `dropUntouchedMovements`, and blocks submit behind a COLLAPSED card whose `required` reps
   * input is unmounted — the browser refuses with an error it cannot render and the form appears dead.
   * Doing 5 of 7 programmed movements would be unsubmittable.
   *
   * Asserted over EVERY quadrant, including the declared-bodyweight ones where pre-selecting would be
   * most tempting.
   */
  it('NEVER pre-selects the bodyweight chip, whatever the catalog declares', () => {
    const cards = scaffoldMovements(
      [
        row({ isBodyweight: true, unitDefault: null }),
        row({ isBodyweight: true, unitDefault: 'sec' }),
        row({ isBodyweight: false, unitDefault: 'lb' }),
      ],
      'lb',
    );
    for (const card of cards) {
      for (const set of card.sets) {
        expect(set.isBodyweight).toBeUndefined();
        expect(set.isBand).toBeUndefined();
      }
      // The predicate that actually gates the submit — asserted directly, not inferred from the flags.
      expect(isUntouchedScaffold(card)).toBe(true);
    }
  });

  it('carries no prescribed load, however the declaration is shaped', () => {
    // The V1-26 widening must not have opened the door `ScaffoldRow` closes by construction.
    const [card] = scaffoldMovements([row({ isBodyweight: false, unitDefault: 'lb' })], 'lb');
    expect(card.sets.every((s) => s.reps === '' && s.weight === '')).toBe(true);
  });
});
