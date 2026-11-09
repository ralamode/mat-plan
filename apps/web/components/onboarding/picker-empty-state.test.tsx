// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PICKER_EMPTY_COPY } from '@/lib/constants';

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

  it('says what the app is in ONE paragraph — the add tile has to stay above the fold', () => {
    const { container } = render(<PickerEmptyState />);
    // 🔴 **ONE paragraph since PROF-1 a-1u, down from three.** `notYet` went when adding became
    // possible; `next` went because this screen's only way forward is the add tile `/p` renders
    // below it, and two paragraphs pushed that tile to the fold at 360px. The count is asserted
    // rather than the absence of a specific string, so adding a paragraph back fails here and has
    // to argue against the measurement in the component's docblock.
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.textContent).toContain(PICKER_EMPTY_COPY.what);
  });

  it("offers NO control of its own — the add tile is the screen's only one", () => {
    render(<PickerEmptyState />);
    // 🔴 **The inverted assertion, not a deleted one.** This component shipped a GitHub button until
    // `a-1u`; the test that pinned it is re-taken rather than removed, so a future author who adds a
    // second control to this screen — beside the add tile `/p` already renders — fails here and has
    // to argue for it. `queryAllByRole` because the expected answer is zero.
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
