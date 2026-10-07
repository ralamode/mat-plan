// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GITHUB_REPO_URL, PICKER_EMPTY_COPY } from '@/lib/constants';

import { PickerEmptyState } from './picker-empty-state';

/**
 * COMPONENT TIER (RTL/jsdom, the `profile-tile.test.tsx` pattern). `PickerEmptyState` is a pure sync
 * Server Component, so RTL renders it directly.
 *
 * What this tier CAN'T see — stated so it isn't mistaken for full coverage: jsdom has no layout and no
 * cascade, so contrast, the 360px width math and the 44px tap target are not measured here. Those come
 * from `/design/tokens`, where the block renders as a `SurfacesCell` cell and `e2e/a11y.spec.ts` already
 * runs axe in BOTH themes plus a per-cell overflow check at 360px. The empty picker itself is
 * unreachable from Playwright (`fullyParallel: true`, one shared seeded DB).
 */
afterEach(cleanup);

describe('PickerEmptyState', () => {
  it('nests under the page’s h1 as an h2 — no second h1, no skipped level', () => {
    render(<PickerEmptyState />);
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveProperty('tagName', 'H2');
    expect(headings[0]?.textContent).toBe(PICKER_EMPTY_COPY.heading);
  });

  it('explains what the app is, what happens next, and why there is no Add button', () => {
    const { container } = render(<PickerEmptyState />);
    // Three paragraphs, not one muted sentence: the reader needs all three statements, and the one
    // that says adding an athlete is not in the app yet is what stops them hunting for a control.
    expect(container.querySelectorAll('p')).toHaveLength(3);
    for (const copy of [PICKER_EMPTY_COPY.what, PICKER_EMPTY_COPY.next, PICKER_EMPTY_COPY.notYet]) {
      expect(container.textContent).toContain(copy);
    }
  });

  it('offers exactly ONE control, a real link to the README section, in the SAME tab', () => {
    render(<PickerEmptyState />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    const link = links[0]!;
    // Composed from GITHUB_REPO_URL + the anchor, the `LANDING_COPY.sourceAnchor` idiom. The anchor is
    // bound to the real README heading by `lib/constants.test.ts`.
    expect(link.getAttribute('href')).toBe(`${GITHUB_REPO_URL}${PICKER_EMPTY_COPY.setupAnchor}`);
    // Same tab on purpose: on a phone the back button is the only recovery path a reader will find,
    // and that is also why no `rel="noopener"` is needed.
    expect(link.hasAttribute('target')).toBe(false);
  });
});
