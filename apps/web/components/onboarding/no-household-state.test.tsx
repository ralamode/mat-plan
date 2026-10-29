// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { NO_HOUSEHOLD_COPY } from '@/lib/constants';

import { NoHouseholdState } from './no-household-state';

/**
 * COMPONENT TIER (RTL/jsdom, the `picker-empty-state.test.tsx` pattern). `NoHouseholdState` is a pure
 * sync Server Component, so RTL renders it directly.
 *
 * What this tier CAN'T see — stated so it isn't mistaken for full coverage: jsdom has no layout and no
 * cascade, so contrast and the 360px width math are not measured here. Those come from
 * `/design/tokens`, where the block renders as a `SurfacesCell` cell and `e2e/a11y.spec.ts` runs axe in
 * BOTH themes plus a per-cell overflow check at 360px. The screen itself is **further out of
 * Playwright's reach than the empty picker**: it needs zero live households, which breaks
 * `selectProfile` in every other spec against the one shared seeded DB. `screenshot:ephemeral --state
 * no-household` is the only way to see it rendered in the real app.
 */
afterEach(cleanup);

describe('NoHouseholdState', () => {
  it('renders NO heading — the page’s own h1 already branches to this state’s heading', () => {
    // The distinction from `PickerEmptyState`, which DOES carry an `<h2>`: there the page keeps
    // "Who's logging today?" as the `<h1>` and the block needs its own label. Here `p/page.tsx`
    // swaps the `<h1>` to `NO_HOUSEHOLD_COPY.heading`, so a heading in here would either duplicate it
    // or add a second, competing one.
    render(<NoHouseholdState />);
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });

  it('states what a household is, the wrong-account fix, and that the screen is a dead end', () => {
    const { container } = render(<NoHouseholdState />);
    expect(container.querySelectorAll('p')).toHaveLength(4);
    for (const copy of [
      NO_HOUSEHOLD_COPY.what,
      NO_HOUSEHOLD_COPY.wrongAccount,
      NO_HOUSEHOLD_COPY.notYet,
      NO_HOUSEHOLD_COPY.next,
    ]) {
      expect(container.textContent).toContain(copy);
    }
  });

  it('says on screen that sign-out is not here yet, beside the line that prescribes it', () => {
    // Without this line `wrongAccount` tells the reader to sign out with no affordance anywhere on
    // the page, and `next`'s "Otherwise" makes that read as a live branch. 1c-3 deletes `notYet` and
    // ships the button; this test is what notices if the copy is removed before the control exists.
    const { container } = render(<NoHouseholdState />);
    const paragraphs = [...container.querySelectorAll('p')];
    const notYet = paragraphs.find((el) => el.textContent === NO_HOUSEHOLD_COPY.notYet);
    expect(notYet, 'the not-yet line must render').toBeTruthy();
    // Muted follow-up, exactly as `PickerEmptyState` renders its own `notYet`.
    expect(notYet?.className).toContain('text-muted-foreground');
    // …and it must sit AFTER the line it qualifies, or it reads as a caption for the wrong sentence.
    const wrongAccountIndex = paragraphs.findIndex(
      (el) => el.textContent === NO_HOUSEHOLD_COPY.wrongAccount,
    );
    // Without this, removing `wrongAccount` makes `findIndex` return -1 and the ordering assertion
    // below passes for the wrong reason.
    expect(wrongAccountIndex).toBeGreaterThanOrEqual(0);
    expect(paragraphs.indexOf(notYet!)).toBeGreaterThan(wrongAccountIndex);
  });

  it('offers NO control at all — not a link, not a button', () => {
    // Deliberate, and the reason is in the component's comment: the one control this screen wants is
    // **Sign out**, and until the session is the boundary (1c-3) signing out of Clerk would leave the
    // gate cookie in place and the person still logged in. The copy names the fix rather than
    // offering a button that would lie about performing it — the argument that parked #303.
    render(<NoHouseholdState />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('says nothing only an OPERATOR could act on — the copy is cause-free', () => {
    // `householdState()` answers `'none'` for five situations (unseeded deploy · table missing ·
    // parent with no membership · the maintainer pre-correction · the wrong Google account). A line
    // naming one of them is false for the other four, and the maintainer's three are served by
    // `scope_outcome` in Sentry and the runbook, not by a line on a family's screen. This fails the
    // moment someone "helpfully" adds "the database may not be seeded yet".
    const { container } = render(<NoHouseholdState />);
    expect(container.textContent?.toLowerCase()).not.toMatch(
      // `\benv\b` because a bare `env` fires on "seven"/"eleven". `admin` is PREFIX-bounded only:
      // "ask your administrator" is the plausible future edit to family-facing copy, and `\badmin\b`
      // would stop matching it. "administer" is a false positive worth paying for.
      /seed|database|deploy|migration|localhost|\badmin|\benv\b|environment/,
    );
  });
});
