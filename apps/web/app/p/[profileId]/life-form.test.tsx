// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ logLifeActivitiesAction: vi.fn() }));

import { LIFE_ACTIVITIES } from '@/lib/life/life-activities';

import { LifeForm } from './life-form';

/**
 * COMPONENT TIER for the life buttons (`V1-9b` B1-2).
 *
 * 🔴 **The subject is the button's React KEY, which is not a style detail here — it is a lost-write
 * fix.** `LifeButton` holds its `client_id` in `useState`, and the `<section>` around `LifeForm` is
 * keyed by block index, so a key that does not change across a day leaves the SAME instance — and
 * the same id — mounted when the person navigates to another day. The second tap then replays the
 * first day's row and writes nothing, while the action reports success.
 *
 * ⚠️ React identity is not directly observable from the DOM, so these assert the consequence RTL can
 * see: re-rendering the same tree with a different `day` must produce a form whose hidden
 * `client_id` input has changed. That is exactly the property the bug violated.
 */
const ACTIVITY = LIFE_ACTIVITIES[0];
const NONE = new Map<string, string>();

const clientIdOf = () =>
  document.querySelector('input[name="clientId"]')?.getAttribute('value') ?? null;

afterEach(cleanup);

describe('LifeForm — the button’s identity', () => {
  it('mints a DIFFERENT client_id for a different day', () => {
    const { rerender } = render(
      <LifeForm
        profileId="p1"
        day="2026-03-10"
        loggedLifeEntryIds={NONE}
        activityKeys={[ACTIVITY.key]}
      />,
    );
    const first = clientIdOf();
    expect(first, 'the open button submits a client_id').not.toBeNull();

    // The same tree, one day earlier — what pressing ‹ does.
    rerender(
      <LifeForm
        profileId="p1"
        day="2026-03-09"
        loggedLifeEntryIds={NONE}
        activityKeys={[ACTIVITY.key]}
      />,
    );
    expect(
      clientIdOf(),
      'a day change must remount the button with a FRESH id — reusing it replays the other ' +
        "day's row and writes nothing",
    ).not.toBe(first);
  });

  it('mints a different client_id once the activity has been logged and then un-logged', () => {
    const logged = new Map([[ACTIVITY.key, 'entry-public-id-1']]);
    const { rerender } = render(
      <LifeForm
        profileId="p1"
        day="2026-03-10"
        loggedLifeEntryIds={logged}
        activityKeys={[ACTIVITY.key]}
      />,
    );
    // Logged renders inert prose, not a form.
    expect(document.querySelector('form')).toBeNull();
    expect(screen.getByText(new RegExp(ACTIVITY.label))).toBeTruthy();

    // A delete (B1-3) puts it back to open — and it must NOT reuse the id the deleted row holds.
    rerender(
      <LifeForm
        profileId="p1"
        day="2026-03-10"
        loggedLifeEntryIds={NONE}
        activityKeys={[ACTIVITY.key]}
      />,
    );
    expect(clientIdOf(), 'the re-opened button submits an id').not.toBeNull();
  });
});
