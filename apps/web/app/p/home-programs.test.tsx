// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/p', useRouter: () => ({}) }));
vi.mock('@/lib/dal/session', () => ({ requireSession: vi.fn(async () => {}) }));
vi.mock('@/lib/clerk', () => ({ clerkIsConfigured: () => false }));
vi.mock('@/lib/dal/profiles', () => ({
  listProfiles: vi.fn(async () => []),
  listHouseholdAthletes: vi.fn(async () => []),
}));
vi.mock('@/lib/dal/household', () => ({
  HOUSEHOLD_STATE: { none: 'none', member: 'member' },
  householdState: vi.fn(async () => ({ state: 'member' })),
}));
vi.mock('@/lib/active-timezone', () => ({ getActiveLocalDay: vi.fn(async () => TODAY) }));
vi.mock('@/lib/dal/program/reads', () => ({ getProgramsByAthlete: vi.fn(async () => new Map()) }));
vi.mock('@/components/theme/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('./add-athlete-tile', () => ({ AddAthleteTile: () => null }));

import { PROFILE_KIND } from '@mat-plan/shared';

import { PROGRAM_COPY } from '@/components/day/day-copy';
import { NO_PROGRAM_YET_LINE } from '@/components/program-builder/builder-text';
import { getActiveLocalDay } from '@/lib/active-timezone';
import { SETTINGS_COPY } from '@/lib/constants';
import { householdState } from '@/lib/dal/household';
import { getProgramsByAthlete } from '@/lib/dal/program/reads';
import { listHouseholdAthletes, listProfiles } from '@/lib/dal/profiles';

import ProfilePickerPage from './page';

const TODAY = '2026-11-19';
const ONE = {
  id: '019826b4-0000-7000-8000-000000000001',
  name: 'Athlete One',
  kind: PROFILE_KIND.kid,
  avatar: null,
};
const TWO = {
  id: '019826b4-0000-7000-8000-000000000002',
  name: 'Athlete Two',
  kind: PROFILE_KIND.kid,
  avatar: null,
};
const PROGRAM = {
  programPublicId: '019826b4-0000-7000-8000-0000000000a1',
  name: 'Mat strength',
  activeFrom: '2026-11-02',
  activeTo: null,
};

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('Home’s tiles name each athlete’s programs (FAM-1 15 PR 3)', () => {
  it('reads once for the whole page, with the route’s today, and gives each tile its own entry', async () => {
    vi.mocked(listProfiles).mockResolvedValueOnce([ONE, TWO]);
    vi.mocked(listHouseholdAthletes).mockResolvedValueOnce(
      [ONE, TWO].map((a) => ({ ...a, archived: false, hasHistory: false })),
    );
    vi.mocked(getProgramsByAthlete).mockResolvedValueOnce(
      new Map([
        [ONE.id, [PROGRAM]],
        [TWO.id, []],
      ]),
    );
    render(await ProfilePickerPage());
    expect(getActiveLocalDay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getProgramsByAthlete).mock.calls).toEqual([[TODAY]]);
    // Named by the name and kind ONLY; the programs line is the description (UX2-S4).
    const list = within(screen.getByRole('list', { name: SETTINGS_COPY.athletes }));
    expect(
      list.getByRole('link', {
        name: 'Athlete One Child',
        description: PROGRAM_COPY.line([PROGRAM.name]),
      }),
    ).toBeTruthy();
    expect(
      list.getByRole('link', { name: 'Athlete Two Child', description: NO_PROGRAM_YET_LINE }),
    ).toBeTruthy();
  });

  it('asks for no programs when the household has no athletes, or there is no household', async () => {
    render(await ProfilePickerPage());
    vi.mocked(householdState).mockResolvedValueOnce({ state: 'none' } as never);
    cleanup();
    render(await ProfilePickerPage());
    expect(getProgramsByAthlete).not.toHaveBeenCalled();
  });
});
