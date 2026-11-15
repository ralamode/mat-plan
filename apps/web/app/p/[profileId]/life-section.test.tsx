// @vitest-environment jsdom
import { ACTIVITY_TYPE_KEYS } from '@mat-plan/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ logLifeActivitiesAction: vi.fn() }));

import { LIFE_COPY, LIFE_LOGGED_ID } from '@/lib/constants';
import type { LoggedLifeActivity } from '@/lib/entries/activity-totals';
import { LIFE_ACTIVITIES } from '@/lib/life/life-activities';

import { LifeSection } from './life-section';

// COMPONENT TIER (RTL/jsdom). V1-24 3b-page: the Life section's states. The page is an async Server
// Component Vitest cannot render, and no e2e reaches a day before yesterday, so this is where the
// read-only states are proved. Every expected string comes from `LIFE_COPY`.
afterEach(cleanup);

const DAY = '2026-09-30';
const PRACTICE = ACTIVITY_TYPE_KEYS.wrestling_practice;
const WAKE = ACTIVITY_TYPE_KEYS.wake;
const practiceLabel = LIFE_ACTIVITIES.find((a) => a.key === PRACTICE)!.label;
const wakeLabel = LIFE_ACTIVITIES.find((a) => a.key === WAKE)!.label;

const practice = (value: number, entryId = `lp-${value}`): LoggedLifeActivity => ({
  entryId,
  activityKey: PRACTICE,
  value,
  unit: 'min',
});

type Props = Parameters<typeof LifeSection>[0];
const section = (overrides: Partial<Props> = {}) => (
  <LifeSection
    profileId="p1"
    day={DAY}
    writable
    activityKeys={[WAKE, PRACTICE]}
    logged={[]}
    {...overrides}
  />
);
const row = (value: number) => LIFE_COPY.logged(practiceLabel, `${value} min`);

describe('LifeSection — its states', () => {
  it('writable and nothing logged: the practice button, and no Wake', () => {
    render(section());
    expect(screen.getByRole('heading', { name: LIFE_COPY.heading })).toBeTruthy();
    expect(screen.getByRole('button', { name: practiceLabel })).toBeTruthy();
    expect(screen.queryByRole('button', { name: wakeLabel })).toBeNull();
    expect(screen.queryByText(LIFE_COPY.noneOnClosedDay)).toBeNull();
  });

  it('logged: the row shows its minutes on every day, and the button is gone', () => {
    for (const writable of [true, false]) {
      render(section({ writable, logged: [practice(90)] }));
      const list = screen.getByRole('list');
      expect(list.id).toBe(LIFE_LOGGED_ID);
      expect(within(list).getByText(row(90))).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByText(LIFE_COPY.noneOnClosedDay)).toBeNull();
      cleanup();
    }
  });

  it('two practices on one day are two rows, never one of them silently', () => {
    render(section({ writable: false, logged: [practice(90, 'a'), practice(45, 'b')] }));
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([row(90), row(45)]);
  });

  it('read-only and nothing logged: "Nothing logged.", not a bare heading', () => {
    render(section({ writable: false }));
    expect(screen.getByText(LIFE_COPY.noneOnClosedDay)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a logged Wake is not shown', () => {
    const wake: LoggedLifeActivity = {
      entryId: 'w',
      activityKey: WAKE,
      value: 412,
      unit: 'timing',
    };
    render(section({ writable: false, logged: [wake] }));
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText(LIFE_COPY.noneOnClosedDay)).toBeTruthy();
  });

  it('renders nothing when the routine has no life activity to show', () => {
    for (const activityKeys of [[], [WAKE]]) {
      const { container } = render(section({ activityKeys }));
      expect(container.innerHTML).toBe('');
      cleanup();
    }
  });

  it('opening a day that already has a practice announces nothing', () => {
    render(section({ logged: [practice(90)] }));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('a log on this day announces it, and paging days does not', () => {
    const { rerender } = render(section());
    rerender(section({ logged: [practice(90)] }));
    expect(screen.getByRole('status').textContent).toBe(LIFE_COPY.announced(practiceLabel));

    // Paging to another day that is already logged is a first render, not a log (the day key).
    rerender(section({ day: '2026-09-29', logged: [practice(60)] }));
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
