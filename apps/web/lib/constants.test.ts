import { describe, expect, it } from 'vitest';

import {
  APP_HOME_PATH,
  PRACTICE_COPY,
  athleteEditPath,
  athletePath,
  itemCountText,
  NAME_WRAP_CLASS,
  NO_ATHLETE_SAVE,
  NO_PROFILE_LOG,
  NO_PROFILE_SAVE,
  PICKER_COPY,
  PICKER_EMPTY_COPY,
} from './constants';

describe('itemCountText: how many items a workout holds (FAM-1)', () => {
  it.each([
    [0, '0 items'],
    [1, '1 item'],
    [2, '2 items'],
    [12, '12 items'],
  ])('%i reads "%s"', (n, text) => {
    expect(itemCountText(n)).toBe(text);
  });
});

describe('APP_HOME_PATH', () => {
  it('is the profile picker — a contract the proxy, the gate action and the specs share', () => {
    expect(APP_HOME_PATH).toBe('/p');
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

describe('PRACTICE_COPY.hoursNotMinutes (V1-24 3b-life-b; maintainer, 2026-11-16)', () => {
  it('does the sum for a whole 1–5, and gives a fixed example in words otherwise', () => {
    expect(PRACTICE_COPY.hoursNotMinutes('1')).toBe('Minutes, not hours: 1 hour is 60.');
    expect(PRACTICE_COPY.hoursNotMinutes(' 2 ')).toBe('Minutes, not hours: 2 hours is 120.');
    for (const typed of ['6', '9', '1.5', '1:30']) {
      expect(PRACTICE_COPY.hoursNotMinutes(typed)).toBe(
        'Minutes, not hours: 1 and a half hours is 90.',
      );
    }
  });
});
