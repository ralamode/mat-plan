import { describe, expect, it } from 'vitest';

import { CLEAR_DAY_COPY } from '@/lib/constants';
import { RESTORE_DEADLINE } from '@/lib/entries/restore-deadline';

import { clearedNoticeLine } from './clear-day-notice';

const base = { clearedTotal: 4, deadline: null, athleteName: 'Athlete One' } as const;

describe('clearedNoticeLine (V1-9b B2-ii)', () => {
  it('archived, with Restore all still open: how to get it back', () => {
    expect(
      clearedNoticeLine({ ...base, notice: 'archived', deadline: RESTORE_DEADLINE.today }),
    ).toBe(CLEAR_DAY_COPY.archivedCleared('Athlete One', 4, CLEAR_DAY_COPY.deadline.today));
  });

  it('archived after the window: kept, not erased', () => {
    expect(clearedNoticeLine({ ...base, notice: 'archived' })).toBe(
      CLEAR_DAY_COPY.closedCleared(4),
    );
  });

  it('a closed day: kept, not erased', () => {
    expect(clearedNoticeLine({ ...base, notice: 'closed' })).toBe(CLEAR_DAY_COPY.closedCleared(4));
  });

  it.each([
    ['no clear', { ...base, notice: 'closed' as const, clearedTotal: 0 }],
    ['a coming-up day', { ...base, notice: 'comingUp' as const }],
    ['no notice', { ...base, notice: null }],
  ])('%s: nothing', (_label, args) => {
    expect(clearedNoticeLine(args)).toBeNull();
  });
});
