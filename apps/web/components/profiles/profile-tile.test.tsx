// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProfileDTO } from '@/lib/dal/profiles';

import { ProfileTile } from './profile-tile';

// COMPONENT TIER (RTL/jsdom — the first component test in the suite; see
// vitest.config.ts). ProfileTile is a pure sync Server Component (just renders a
// next/link), so RTL renders it directly. Asserts the pivotal contract: the tile
// is a semantic anchor pointing at the profile's scoped Today (`/p/<publicId>`),
// and surfaces the name + kind.
// RTL cleanup UNMOUNTS the React tree (cancels next/link's pending scheduler work);
// merely clearing innerHTML leaves it pending → it flushes after jsdom is torn down
// and throws `window is not defined`. Since vitest globals are off, register it here.
afterEach(cleanup);

const athleteOne: ProfileDTO = {
  id: '019826b4-0000-7000-8000-000000000001',
  name: 'Athlete One',
  kind: 'kid',
  avatar: null,
};

describe('ProfileTile', () => {
  it('links to the profile-scoped Today at /p/<publicId>', () => {
    render(<ProfileTile profile={athleteOne} />);
    const link = screen.getByRole('link', { name: /Athlete One/ });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link.getAttribute('href')).toBe(`/p/${athleteOne.id}`);
  });

  it('renders the profile name and kind', () => {
    render(<ProfileTile profile={athleteOne} />);
    expect(screen.getByText('Athlete One')).toBeTruthy();
    expect(screen.getByText('kid')).toBeTruthy();
  });

  it('falls back to the name initial when there is no avatar', () => {
    render(<ProfileTile profile={athleteOne} />);
    // The avatar bubble is aria-hidden; assert the initial is present in the DOM.
    expect(screen.getByText('A')).toBeTruthy(); // 'Athlete One' → 'A'
  });
});
