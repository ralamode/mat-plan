import { ON_PROGRAM, type DayPlan } from '@mat-plan/shared';
import {
  closedDayLoggedOnly,
  noProgram,
  todayTwoPrograms,
  tomorrowReadOnly,
} from '@mat-plan/shared/program/fixtures';
import { describe, expect, it } from 'vitest';

import { dayPageView, lookAheadFallsBack } from './day-notices';

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
