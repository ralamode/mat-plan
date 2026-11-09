import { LOGGABLE_DIMENSIONS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import {
  APP_HOME_PATH,
  athleteEditPath,
  athletePath,
  blockedSummary,
  NAME_WRAP_CLASS,
  NO_ATHLETE_SAVE,
  NO_PROFILE_LOG,
  NO_PROFILE_SAVE,
  PICKER_COPY,
  missingQuantityMessage,
  PARTIAL_SETS_COPY,
  PICKER_EMPTY_COPY,
  SUMMARY_NAME_MAX,
  QUANTITY_FIELD_WORD,
  quantityInputLabel,
  usuallyLoggedAs,
} from './constants';

describe('blockedSummary — the summary names the first blocker (V1-27)', () => {
  it('a set: "<name> set N needs finishing."', () => {
    expect(blockedSummary({ kind: 'set', index: 0, setIndex: 1, movementName: 'Back squat' })).toBe(
      'Back squat set 2 needs finishing.',
    );
  });
  it('an unnamed card falls back to its on-screen number', () => {
    expect(blockedSummary({ kind: 'set', index: 2, setIndex: 0, movementName: '  ' })).toBe(
      'Movement 3 set 1 needs finishing.',
    );
    expect(blockedSummary({ kind: 'name', index: 0 })).toBe('Movement 1 needs a name.');
  });
  it('a long name is truncated so the line fits one row at 360px', () => {
    const out = blockedSummary({
      kind: 'set',
      index: 0,
      setIndex: 19,
      movementName: 'Single-leg Romanian deadlift with pause',
    });
    expect(out.endsWith('… set 20 needs finishing.')).toBe(true);
    expect(out.indexOf('…')).toBeLessThanOrEqual(SUMMARY_NAME_MAX);
  });
});

describe('missingQuantityMessage', () => {
  it('a mass unit points at BW or band', () => {
    expect(missingQuantityMessage('lb')).toBe(PARTIAL_SETS_COPY.missingWeight);
    expect(missingQuantityMessage('kg')).toBe(PARTIAL_SETS_COPY.missingWeight);
  });
  it('a time or distance asks for the number and never mentions BW (V1-30 refuses it there)', () => {
    for (const unit of ['sec', 'min', 'm', 'yd', 'cm', 'in', 'ft'] as const) {
      const msg = missingQuantityMessage(unit);
      expect(msg).not.toMatch(/BW|band/);
      expect(msg).toMatch(/^Enter the .+\.$/);
    }
  });
});

describe('APP_HOME_PATH', () => {
  it('is the profile picker — a contract the proxy, the gate action and the specs share', () => {
    expect(APP_HOME_PATH).toBe('/p');
  });
});

/**
 * V1-30b-i — the form must offer only what the server keeps, and the number must read as what it is.
 */
describe('quantityInputLabel / QUANTITY_FIELD_WORD / usuallyLoggedAs (V1-30b)', () => {
  it('mass output is BYTE-IDENTICAL to V1-30, so every existing locator holds', () => {
    expect(quantityInputLabel('Movement 1 set 2', 'lb')).toBe('Movement 1 set 2 weight in lb');
    expect(quantityInputLabel('Movement 1 set 2', 'kg')).toBe('Movement 1 set 2 weight in kg');
    // No unit (the edit form before a primary resolves) keeps the bare noun.
    expect(quantityInputLabel('Movement 1 set 2')).toBe('Movement 1 set 2 weight');
  });

  it('non-mass spells the unit out, because `sec` and `in` read as nothing aloud', () => {
    expect(quantityInputLabel('Movement 1 set 1', 'sec')).toBe('Movement 1 set 1 time in seconds');
    expect(quantityInputLabel('Movement 1 set 1', 'in')).toBe('Movement 1 set 1 length in inches');
    expect(quantityInputLabel('Movement 1 set 1', 'm')).toBe('Movement 1 set 1 length in metres');
  });

  it('every loggable dimension has a field word — a new one without one must fail, not fall back', () => {
    for (const d of LOGGABLE_DIMENSIONS) {
      expect(QUANTITY_FIELD_WORD[d]).toBeTruthy();
    }
  });

  it('the field word fits the w-24 field: never longer than "weight"', () => {
    // The row is ~275 of ~294px at 360px, so a longer word overflows. `length`, not "height or
    // distance" — and not `distance`, which would mislabel a box jump, the main length movement.
    for (const d of LOGGABLE_DIMENSIONS) {
      expect(QUANTITY_FIELD_WORD[d]!.length).toBeLessThanOrEqual('weight'.length);
    }
  });

  it('usuallyLoggedAs keeps V1-26’s sentence verbatim for mass, and reads naturally otherwise', () => {
    expect(usuallyLoggedAs('Trap-Bar Deadlift', 'mass')).toBe(
      'Trap-Bar Deadlift is usually logged with a weight.',
    );
    expect(usuallyLoggedAs('Plank', 'time')).toBe('Plank is usually logged as a time.');
    expect(usuallyLoggedAs('Box Jump', 'length')).toBe(
      'Box Jump is usually logged as a height or distance.',
    );
  });
});

describe('the athlete paths are built from one definition (PROF-1 D8)', () => {
  const ID = '019826b4-0000-7000-8000-000000000001';

  it('athletePath is APP_HOME_PATH plus the public id', () => {
    expect(athletePath(ID)).toBe(`${APP_HOME_PATH}/${ID}`);
  });

  /**
   * The edit path is DERIVED from `athletePath`, not re-typed. Asserted by composition so that moving
   * `/p` moves both — the failure this helper exists to prevent is one of them being left behind.
   */
  it('athleteEditPath nests under athletePath', () => {
    expect(athleteEditPath(ID)).toBe(`${athletePath(ID)}/edit`);
    expect(athleteEditPath(ID).startsWith(APP_HOME_PATH)).toBe(true);
  });
});

describe('NAME_WRAP_CLASS (PROF-1 D11)', () => {
  /**
   * 🔴 **A CONTRACT TEST that pins the utility by name**, which AGENTS.md allows exactly once: the
   * literal on the assertion side is the point. `break-words` and `wrap-anywhere` break lines
   * identically, so no rendered assertion anywhere can tell them apart — but only `anywhere` lets a
   * break count toward `min-content`, which is the property four of the name renderers depend on. A
   * silent swap to `break-words` would leave every other test in the repo green. It already happened
   * once, in a component that cited D11 in its own comment.
   */
  it('is wrap-anywhere, never break-words, and carries the min-width floor', () => {
    expect(NAME_WRAP_CLASS).toBe('min-w-0 wrap-anywhere');
    expect(NAME_WRAP_CLASS).not.toContain('break-words');
  });
});

describe('the refusal copy stays distinguishable from its neighbours', () => {
  /**
   * PUX-8: athlete management says "athlete"; the logging surfaces keep "profile". The three must be
   * DIFFERENT strings, or a reader of a test failure cannot tell which surface refused — and they
   * must be close enough in shape that none of them hints at WHICH check refused (ADR 0006's
   * 404-never-403 argument, which depends on byte-identity within a surface, not across them).
   */
  it('the three refusals are distinct', () => {
    expect(new Set([NO_ATHLETE_SAVE, NO_PROFILE_LOG, NO_PROFILE_SAVE]).size).toBe(3);
  });

  it('the athlete refusal uses the human noun, not the schema’s', () => {
    expect(NO_ATHLETE_SAVE).toContain('athlete');
    expect(NO_ATHLETE_SAVE).not.toContain('profile');
  });
});

describe('the picker copy no longer sends a first-run reader to an unlinked screen', () => {
  /**
   * Acceptance criterion 11 (M30) removes the app's only link to the routine editor, and
   * `PICKER_EMPTY_COPY.next` named it — so a first-run reader was about to be told to go somewhere
   * with no entry point. The assertion is on the ABSENCE because that is the defect; the replacement
   * wording is a copy decision, not a contract.
   */
  it('the empty state does not name the routine editor', () => {
    expect(PICKER_EMPTY_COPY.next.toLowerCase()).not.toContain('routine editor');
  });

  /** "Tap your name", following the prototype: the gesture, and the noun the reader actually uses. */
  it('the picker subhead names the gesture and the human noun', () => {
    expect(PICKER_COPY.subhead).toBe('Tap your name to start logging.');
    expect(PICKER_COPY.subhead).not.toContain('profile');
  });
});
