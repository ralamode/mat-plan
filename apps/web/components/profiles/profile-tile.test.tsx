// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PROFILE_KIND_LABELS } from '@mat-plan/shared';

import { athletePath, NAME_WRAP_CLASS } from '@/lib/constants';
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
    expect(link.getAttribute('href')).toBe(athletePath(athleteOne.id));
  });

  /**
   * 🔴 **The LABEL, not the stored value.** This asserted `getByText('kid')` while the tile rendered
   * `capitalize {profile.kind}` — so the screen read "Kid", the schema's word shown to a parent, and
   * the test agreed with it. Criterion 9: Child / Adult, from the one display map beside
   * `PROFILE_KINDS`, with `kid` / `adult` still stored.
   */
  it('renders the name, and the kind as its display LABEL', () => {
    render(<ProfileTile profile={athleteOne} />);
    expect(screen.getByText('Athlete One')).toBeTruthy();
    expect(screen.getByText(PROFILE_KIND_LABELS.kid)).toBeTruthy();
    // The stored value must not reach the screen at all.
    expect(screen.queryByText('kid')).toBeNull();
  });

  it('labels an adult as Adult', () => {
    render(<ProfileTile profile={{ ...athleteOne, kind: 'adult' }} />);
    expect(screen.getByText(PROFILE_KIND_LABELS.adult)).toBeTruthy();
    expect(screen.queryByText('adult')).toBeNull();
  });

  /**
   * D11, the renderer the decision is really about. The name sits in a column that is itself a
   * row-flex item beside a `shrink-0` avatar, so BOTH need `min-w-0` or a 40-character unbroken name
   * pushes the tile past a 360px phone's 328px. Asserted as classes because the wrap is CSS: jsdom
   * computes no layout, and the measured version lives in `e2e/a11y.spec.ts`.
   */
  it('gives the name the shared wrap rule, and its column a min-width floor of 0', () => {
    render(<ProfileTile profile={athleteOne} />);
    const name = screen.getByText('Athlete One');
    for (const cls of NAME_WRAP_CLASS.split(' ')) expect(name.className).toContain(cls);
    expect(name.parentElement?.className).toContain('min-w-0');
  });

  it('falls back to the name initial when there is no avatar', () => {
    render(<ProfileTile profile={athleteOne} />);
    // The avatar bubble is aria-hidden; assert the initial is present in the DOM.
    expect(screen.getByText('A')).toBeTruthy(); // 'Athlete One' → 'A'
  });
});
