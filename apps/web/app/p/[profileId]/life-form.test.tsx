// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ logLifeActivitiesAction: vi.fn() }));

import { ACTIVITY_TYPE_KEYS } from '@mat-plan/shared';

import { LIFE_ACTIVITIES } from '@/lib/life/life-activities';

import { LifeForm } from './life-form';
import { SingleValueLive } from './single-value-live';

/**
 * COMPONENT TIER for the life buttons (`V1-9b` B1-2).
 *
 * 🔴 **The subject is the button's React KEY, which is not a style detail here — it is a lost-write
 * fix.** `LifeButton` holds its `client_id` in `useState`, so a key that does not change across a
 * day leaves the SAME instance — and the same id — mounted when the person navigates to another
 * day. The second tap then replays the first day's row and writes nothing, while the action reports
 * success.
 *
 * ⚠️ React identity is not directly observable from the DOM, so this asserts the consequence RTL can
 * see: re-rendering the same tree with a different `day` must produce a form whose hidden
 * `client_id` input has changed. That is exactly the property the bug violated.
 */
const ACTIVITY = LIFE_ACTIVITIES.find((a) => a.key === ACTIVITY_TYPE_KEYS.wrestling_practice)!;

const clientIdOf = () =>
  document.querySelector('input[name="clientId"]')?.getAttribute('value') ?? null;

afterEach(cleanup);

describe('LifeForm — the button’s identity', () => {
  it('mints a DIFFERENT client_id for a different day', () => {
    const { rerender } = render(
      <SingleValueLive>
        <LifeForm profileId="p1" day="2026-03-10" activities={[ACTIVITY]} />
      </SingleValueLive>,
    );
    const first = clientIdOf();
    expect(first, 'the open button submits a client_id').not.toBeNull();

    // The same tree, one day earlier — what pressing ‹ does.
    rerender(
      <SingleValueLive>
        <LifeForm profileId="p1" day="2026-03-09" activities={[ACTIVITY]} />
      </SingleValueLive>,
    );
    expect(
      clientIdOf(),
      'a day change must remount the button with a FRESH id — reusing it replays the other ' +
        "day's row and writes nothing",
    ).not.toBe(first);
  });

  it('mints a different client_id when a logged activity re-opens', () => {
    const { rerender } = render(
      <SingleValueLive>
        <LifeForm profileId="p1" day="2026-03-10" activities={[ACTIVITY]} />
      </SingleValueLive>,
    );
    const first = clientIdOf();
    // Logged: `LifeSection` stops passing the activity, so the button unmounts.
    rerender(
      <SingleValueLive>
        <LifeForm profileId="p1" day="2026-03-10" activities={[]} />
      </SingleValueLive>,
    );
    expect(document.querySelector('form')).toBeNull();
    // Re-opened (after a delete): a new instance, and it must NOT reuse the id the hidden row holds.
    rerender(
      <SingleValueLive>
        <LifeForm profileId="p1" day="2026-03-10" activities={[ACTIVITY]} />
      </SingleValueLive>,
    );
    expect(clientIdOf(), 'the re-opened button submits an id').not.toBeNull();
    expect(clientIdOf()).not.toBe(first);
  });
});
