import { addDays, ON_PROGRAM, type DayPlan } from '@mat-plan/shared';
import {
  closedDayLoggedOnly,
  noProgram,
  todayTwoPrograms,
  tomorrowReadOnly,
} from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { dayPageView, lookAheadFallsBack, offersProgramsLink, startsTomorrow } from './day-notices';

/** What the day page shows around the screen (FAM-1 12c; maintainer, 2026-11-17). */

const page = (
  over: Partial<{ future: boolean; showClosedNotice: boolean; archived: boolean }>,
) => ({
  future: false,
  showClosedNotice: false,
  archived: false,
  ...over,
});

describe('dayPageView', () => {
  it('a writable day: no notice, the sections and the screen', () => {
    expect(dayPageView(todayTwoPrograms, page({}))).toEqual({
      notice: null,
      sections: true,
      screen: true,
    });
  });

  it('archived wins over every other notice, a future day included', () => {
    for (const over of [{ future: true }, { showClosedNotice: true }, {}]) {
      expect(dayPageView(tomorrowReadOnly, page({ archived: true, ...over })).notice).toBe(
        'archived',
      );
    }
  });

  it('a future day on a program: Coming up, and no Bodyweight or Life', () => {
    expect(tomorrowReadOnly.future).toBe(true);
    expect(dayPageView(tomorrowReadOnly, page({ future: true }))).toEqual({
      notice: 'comingUp',
      sections: false,
      screen: true,
    });
  });

  it('a future day whose programs all rest: no Coming up, the rest line says it alone', () => {
    const rest: DayPlan = { ...structuredClone(tomorrowReadOnly), workouts: [] };
    expect(dayPageView(rest, page({ future: true })).notice).toBeNull();
  });

  it('a past closed day: the closed sentence', () => {
    expect(dayPageView(closedDayLoggedOnly, page({ showClosedNotice: true })).notice).toBe(
      'closed',
    );
  });

  it('no program and no rows: no screen (no empty Workouts landmark)', () => {
    expect(noProgram.workouts).toHaveLength(0);
    expect(dayPageView(noProgram, page({})).screen).toBe(false);
  });
});

describe('lookAheadFallsBack', () => {
  it('a future day renders only while the athlete is on a program that day', () => {
    expect(lookAheadFallsBack(tomorrowReadOnly)).toBe(false);
    expect(lookAheadFallsBack({ ...tomorrowReadOnly, onProgram: ON_PROGRAM.never })).toBe(true);
    expect(lookAheadFallsBack({ ...noProgram, future: false })).toBe(false);
  });
});

describe('offersProgramsLink (FAM-1 15)', () => {
  // Any day (maintainer, 2026-11-19): the rule reads no day at all, so a past day, open or closed,
  // links like today. Only an archived athlete, who cannot be put on a program, does not.
  it('a live athlete links to Programs', () => {
    expect(offersProgramsLink({ archived: false })).toBe(true);
  });

  it('an archived athlete does not', () => {
    expect(offersProgramsLink({ archived: true })).toBe(false);
  });
});

describe('startsTomorrow (D46)', () => {
  /** Today, on no program today, with one from tomorrow: the line's case. */
  const today: DayPlan = {
    ...noProgram,
    onProgram: ON_PROGRAM['not-this-day'],
    day: noProgram.today,
    writable: true,
    canGoForward: true,
  };

  it('today, with a program from tomorrow: says it starts tomorrow', () => {
    expect(startsTomorrow(today)).toBe(true);
  });

  it('🔴 never on yesterday, though it is writable and every past day can go forward', () => {
    expect(startsTomorrow({ ...today, day: addDays(today.today, -1) })).toBe(false);
  });

  it('not when nothing covers tomorrow, nor for an archived athlete (not writable)', () => {
    expect(startsTomorrow({ ...today, canGoForward: false })).toBe(false);
    expect(startsTomorrow({ ...today, writable: false })).toBe(false);
  });

  it('only for an athlete on no program today: never and yes do not say it', () => {
    expect(startsTomorrow({ ...today, onProgram: ON_PROGRAM.never })).toBe(false);
    expect(startsTomorrow({ ...today, onProgram: ON_PROGRAM.yes })).toBe(false);
  });
});
