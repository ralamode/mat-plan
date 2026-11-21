// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CLOSED_DAY_NOTICE, NOTICE_CLASS } from '@/lib/constants';

import { ClosedDayNotice } from './closed-day-notice';

afterEach(cleanup);

describe('ClosedDayNotice', () => {
  it('says the past day is locked, and nothing more when the day was not cleared', () => {
    const { container } = render(<ClosedDayNotice clearedLine={null} />);
    expect(screen.getByText(CLOSED_DAY_NOTICE)).toBeTruthy();
    expect(container.querySelectorAll('p')).toHaveLength(1);
    // In the page's notice box, as the archived and coming-up notices are.
    expect(container.firstElementChild!.className).toContain(NOTICE_CLASS);
  });

  it('adds the cleared line after it', () => {
    const cleared = 'This day was also cleared: 3 sets.';
    const { container } = render(<ClosedDayNotice clearedLine={cleared} />);
    const lines = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(lines).toEqual([CLOSED_DAY_NOTICE, cleared]);
  });
});
