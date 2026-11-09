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

  it('explains what the app is and what happens next — two statements, not three', () => {
    const { container } = render(<PickerEmptyState />);
    // 🔴 **TWO paragraphs since PROF-1 a-1u, not three.** The third said adding an athlete was not
    // in the app yet and existed to stop the reader hunting for a control. `a-1u` ships the control,
    // so the sentence is false and the hunt ends at the add tile `/p` renders below this.
    expect(container.querySelectorAll('p')).toHaveLength(2);
    for (const copy of [PICKER_EMPTY_COPY.what, PICKER_EMPTY_COPY.next]) {
      expect(container.textContent).toContain(copy);
    }
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
