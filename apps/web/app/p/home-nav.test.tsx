// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
// The page's other parts are their own tests'; here, only the Household nav.
vi.mock('@/components/theme/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('./add-athlete-tile', () => ({ AddAthleteTile: () => null }));

import { BUILDER_COPY } from '@/components/program-builder/builder-text';
import { PROGRAMS_PATH } from '@/components/program-builder/routes';
import { SETTINGS_COPY, SETTINGS_PATH } from '@/lib/constants';

import ProfilePickerPage from './page';

afterEach(cleanup);

describe('Home’s Household nav (FAM-1 7b-i)', () => {
  it('is a list: Programs first, then Settings, each a full-width row', async () => {
    render(await ProfilePickerPage());
    const nav = screen.getByRole('navigation', { name: 'Household' });
    const rows = within(within(nav).getByRole('list')).getAllByRole('listitem');
    expect(rows.map((li) => within(li).getByRole('link').getAttribute('href'))).toEqual([
      PROGRAMS_PATH,
      SETTINGS_PATH,
    ]);
    expect(rows.map((li) => li.textContent)).toEqual([
      BUILDER_COPY.programsNavLink,
      SETTINGS_COPY.navLink,
    ]);
    expect(BUILDER_COPY.programsNavLink).toBe(`${BUILDER_COPY.programs} ›`);
  });
});
