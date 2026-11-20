import { addDays, WRITABLE_DAY_RADIUS } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

import { RESTORE_DEADLINE, restoreDeadline } from './restore-deadline';

const TODAY = '2026-11-19';

describe('restoreDeadline (V1-9b B2-ii)', () => {
  it('pins the radius the words are written for', () => {
    expect(WRITABLE_DAY_RADIUS).toBe(1);
  });

  it('a clear of today is restorable until the end of tomorrow', () => {
    expect(restoreDeadline(TODAY, TODAY)).toBe(RESTORE_DEADLINE.tomorrow);
  });

  it('a clear of yesterday, seen today, is restorable until the end of today', () => {
    expect(restoreDeadline(addDays(TODAY, -1), TODAY)).toBe(RESTORE_DEADLINE.today);
  });

  it.each([
    ['the day before yesterday', addDays(TODAY, -2)],
    ['tomorrow', addDays(TODAY, 1)],
  ])('%s has no deadline: nothing can be restored there', (_label, day) => {
    expect(restoreDeadline(day, TODAY)).toBeNull();
  });
});
