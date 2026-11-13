// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// `site-footer.tsx` is a client component: it reads `usePathname()` for `aria-current`. The shell
// renders it, so the hook has to answer something — any authenticated route will do.
vi.mock('next/navigation', () => ({ usePathname: () => '/p' }));

import { PROFILE_KIND } from '@mat-plan/shared';

import { MAIN_CONTENT_ID, NAV_RAIL_COPY, athletePath } from '@/lib/constants';
import type { ProfileDTO } from '@/lib/dal/profiles';

import { AppShell } from './app-shell';

/**
 * COMPONENT TIER for the shell (the `no-household-state.test.tsx` pattern — `AppShell` and `NavRail`
 * are sync Server Components, so RTL renders them directly).
 *
 * 🔴 **What this tier CANNOT see, stated so it is not mistaken for the acceptance proof.** jsdom has
 * no layout and no cascade: `hidden lg:flex` does not hide the rail here, the grid does not exist, and
 * `getBoundingClientRect` returns zeroes. So **every assertion below is about the DOM the shell
 * builds** — which landmarks exist, how they nest, what is linked. The geometry — that the phone
 * layout did not move — is `e2e/ui5-geometry.spec.ts`, which measures real boxes in a real browser.
 * Two tiers, two different claims; neither substitutes for the other.
 */
const ATHLETES: readonly ProfileDTO[] = [
  {
    id: 'aaaaaaaa-0000-7000-8000-000000000001',
    name: 'Athlete One',
    kind: PROFILE_KIND.kid,
    avatar: null,
  },
  {
    id: 'aaaaaaaa-0000-7000-8000-000000000002',
    name: 'Athlete Two',
    kind: PROFILE_KIND.kid,
    avatar: null,
  },
];

afterEach(cleanup);

describe('AppShell — the landmarks', () => {
  it('renders exactly one <main>, carrying only the skip target and the focus fallback', () => {
    render(<AppShell athletes={ATHLETES}>body</AppShell>);

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    const main = mains[0];
    expect(main.id, 'the skip link and sheet.tsx both address it by id').toBe(MAIN_CONTENT_ID);
    // `sheet.tsx:433` patches `tabIndex` onto `document.querySelector('main')` when it restores
    // focus. Setting it here is what makes that deterministic rather than a runtime mutation.
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(main.getAttribute('aria-busy'), 'absent unless asked for').toBeNull();
  });

  it('puts the footer OUTSIDE <main>', () => {
    render(<AppShell athletes={ATHLETES}>body</AppShell>);

    // 🔴 Not cosmetic. A `<footer>` inside `<main>` is not exposed as `contentinfo` at all — and
    // `e2e/privacy.spec.ts` clicks `getByRole('contentinfo')` on an authenticated page — while
    // `a11y.spec.ts`'s `expectLinkTapTargets` counts links inside `main` and would start counting
    // the footer's two.
    const footer = screen.getByRole('contentinfo');
    expect(screen.getByRole('main').contains(footer)).toBe(false);
  });

  it('carries aria-busy only when asked (app/p/loading.tsx)', () => {
    render(<AppShell busy>body</AppShell>);
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
  });

  it('offers a skip link to the main landmark', () => {
    render(<AppShell athletes={ATHLETES}>body</AppShell>);
    const skip = screen.getByRole('link', { name: NAV_RAIL_COPY.skipToContent });
    expect(skip.getAttribute('href')).toBe(`#${MAIN_CONTENT_ID}`);
  });
});

describe('AppShell — when the rail appears', () => {
  const rail = () => screen.queryByRole('navigation', { name: NAV_RAIL_COPY.label });

  it('lists every athlete, linked to their own day page', () => {
    render(<AppShell athletes={ATHLETES}>body</AppShell>);

    expect(rail()).not.toBeNull();
    for (const athlete of ATHLETES) {
      expect(
        screen.getByRole('link', { name: athlete.name }).getAttribute('href'),
        'the rail invents no destination — every item is a link /p already renders',
      ).toBe(athletePath(athlete.id));
    }
  });

  it('marks the open athlete, and only them', () => {
    render(
      <AppShell athletes={ATHLETES} current={{ athlete: ATHLETES[1].id }}>
        body
      </AppShell>,
    );

    // `aria-current` from a PROP, not `usePathname()` — which is what keeps this whole PR free of a
    // client boundary. The page knows what it is; the rail does not have to ask the router.
    expect(screen.getByRole('link', { name: ATHLETES[1].name }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('link', { name: ATHLETES[0].name }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('labels the settings row "Settings", never "Household settings"', () => {
    render(
      <AppShell athletes={ATHLETES} current="settings">
        body
      </AppShell>,
    );

    // 🔴 The rail's label must stay DISTINCT from the prose link `/p/new`, `/edit` and the archived
    // day page each render, or those screens show two visible links with the same accessible name —
    // the Playwright strict-mode collision this repo has shipped once. This test is the record of
    // why the shorter label is not a style choice.
    expect(
      screen.getByRole('link', { name: NAV_RAIL_COPY.settings }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.queryByRole('link', { name: 'Household settings' })).toBeNull();
  });

  it('renders no rail with no athletes, and none when the page opts out', () => {
    // `/p`'s no-household branch: a rail here would be an empty region.
    const { unmount } = render(<AppShell athletes={[]}>body</AppShell>);
    expect(rail()).toBeNull();
    unmount();

    // `/p` itself: the page IS the athlete switcher, so a rail would link every athlete twice.
    render(<AppShell nav={false}>body</AppShell>);
    expect(rail()).toBeNull();
    expect(screen.getByRole('main')).toBeTruthy();
  });
});
